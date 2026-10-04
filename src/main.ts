/**
 * Memory Injector - ToolPkg entry
 *
 * 更好的记忆（记忆工具包）：
 *  - SystemPromptComposeHook(after_compose_system_prompt):
 *      * 注入记忆使用准则（可选开关，默认开启）
 *      * 注入记忆内容（可选，注入目标=system 时）
 *  - PromptFinalizeHook(before_finalize_prompt): 注入记忆内容到当前用户输入
 *  - InputMenuToggle: 输入菜单中的记忆注入总开关
 *  - Toolbox UI: 工具箱配置页面（记忆注入子功能 + 记忆使用准则子功能）
 *
 * 注入内容来自记忆库（标题 / 摘要 / 完整正文），
 * 由宿主自动调用 query_memory 完成，不依赖智能体主动检索。
 */
declare function getLang(): string;
import memoryInjectorScreen from "./ui/index.ui.js";
import {
  buildGuidelinesBlock,
  buildInjectionBlock,
  fetchMemories,
  getMemoryInjectorEnabled,
  loadSettings,
  logMemoryInjectorError,
  logMemoryInjectorInfo,
  setMemoryInjectorEnabled,
  type MemoryInjectorSettings,
} from "./shared";

async function resolveAndBuildBlock(chatId?: string) {
  const settings = loadSettings();
  if (!settings.masterEnabled) {
    logMemoryInjectorInfo("inject.skipped", "reason=master_disabled");
    return null;
  }

  logMemoryInjectorInfo(
    "inject.started",
    `chat_id=${chatId || "-"} target=${settings.injectTarget} content_mode=${settings.contentMode}`
  );
  try {
    const needFullContent = settings.contentMode === "title_body";
    const memories = await fetchMemories(needFullContent);
    if (!memories || memories.length === 0) {
      logMemoryInjectorInfo("inject.completed", "memory_count=0");
      return null;
    }
    const block = buildInjectionBlock(settings, memories);
    logMemoryInjectorInfo(
      "inject.completed",
      `memory_count=${memories.length} block_length=${block ? block.length : 0} full_content=${needFullContent}`
    );
    return block;
  } catch (error) {
    logMemoryInjectorError("inject.failed", error);
    return null;
  }
}

function shouldInjectSystem(settings: MemoryInjectorSettings): boolean {
  return settings.injectTarget === "system";
}

function shouldInjectUser(settings: MemoryInjectorSettings): boolean {
  return settings.injectTarget === "user";
}

/**
 * 系统提示词注入：after_compose_system_prompt 阶段。
 * 1. 若开启了"注入记忆使用准则"（默认开启），把准则块拼到 systemPrompt 末尾；
 * 2. 若注入目标为 system，再把记忆内容块拼到末尾。
 * 准则与记忆注入相互独立：关闭记忆内容注入不影响准则注入。
 */
export async function onSystemPromptCompose(
  event: ToolPkg.SystemPromptComposeHookEvent
): Promise<ToolPkg.PromptHookObjectResult | null> {
  const stage = String(event.eventName || event.event || "");
  if (stage !== "after_compose_system_prompt") {
    return null;
  }
  const settings = loadSettings();
  let nextSystemPrompt = String(event.eventPayload?.systemPrompt || "");
  let changed = false;

  // 1. 记忆使用准则（独立于注入目标与记忆内容开关）
  if (settings.injectGuidelines) {
    const guidelines = buildGuidelinesBlock();
    if (guidelines) {
      nextSystemPrompt = nextSystemPrompt
        ? `${nextSystemPrompt}\n\n${guidelines}`
        : guidelines;
      changed = true;
    }
  }

  // 2. 记忆内容注入（仅当注入目标为 system）
  if (shouldInjectSystem(settings)) {
    const chatId = String(event.eventPayload?.chatId || "").trim() || undefined;
    const block = await resolveAndBuildBlock(chatId);
    if (block) {
      nextSystemPrompt = nextSystemPrompt
        ? `${nextSystemPrompt}\n\n${block}`
        : block;
      changed = true;
    }
  }

  if (!changed) {
    return null;
  }
  logMemoryInjectorInfo(
    "sysprompt.injected",
    `guidelines=${settings.injectGuidelines} new_length=${nextSystemPrompt.length}`
  );
  return { systemPrompt: nextSystemPrompt };
}

/**
 * 用户输入注入：before_finalize_prompt 阶段，
 * 把记忆块作为一条独立的 turn 追加到对话历史最后（用户消息之后），
 * 而不是拼进 processedInput 文本（那样它在语义上属于用户消息的一部分）。
 */
export async function onPromptFinalize(
  event: ToolPkg.PromptFinalizeHookEvent
): Promise<ToolPkg.PromptHookObjectResult | null> {
  const stage = String(event.eventName || event.event || "");
  if (stage !== "before_finalize_prompt") {
    return null;
  }

  const settings = loadSettings();
  if (!shouldInjectUser(settings)) {
    return null;
  }

  const chatId = String(event.eventPayload?.chatId || "").trim() || undefined;
  const block = await resolveAndBuildBlock(chatId);
  if (!block) {
    return null;
  }

  const payload = event.eventPayload || {};
  const history = Array.isArray(payload.preparedHistory)
    ? (payload.preparedHistory as ToolPkg.PromptTurn[])
    : Array.isArray(payload.chatHistory)
      ? (payload.chatHistory as ToolPkg.PromptTurn[])
      : null;

  if (history) {
    // 独立块：在历史末尾追加一条 USER turn（内容就是 <memory> 块）
    history.push({
      kind: "USER",
      content: block,
      metadata: { memory: true },
    });
    logMemoryInjectorInfo(
      "userinject.injected",
      `mode=standalone_turn turns=${history.length} block_length=${block.length}`
    );
    return { preparedHistory: history };
  }

  // 回退：宿主未提供历史时，退化为追加到用户输入末尾（旧行为）
  const processedInput = String(payload.processedInput || payload.rawInput || "");
  if (!processedInput.trim()) {
    logMemoryInjectorInfo("userinject.skipped", "reason=empty_input");
    return null;
  }
  const nextProcessedInput = `${processedInput}\n\n${block}`;
  logMemoryInjectorInfo("userinject.injected", `mode=append_input new_length=${nextProcessedInput.length}`);
  return { processedInput: nextProcessedInput };
}

/**
 * 输入菜单开关：create 时返回 toggle 定义，toggle 时切换总开关。
 */
export function onInputMenuToggle(
  event: ToolPkg.InputMenuToggleHookEvent
): ToolPkg.InputMenuToggleDefinitionResult[] {
  const action = String(event.eventPayload?.action || "").toLowerCase();

  if (action === "toggle") {
    const enabled = !getMemoryInjectorEnabled();
    setMemoryInjectorEnabled(enabled);
    logMemoryInjectorInfo("menu_toggle.updated", `enabled=${enabled}`);
    return [];
  }

  if (action !== "create") {
    logMemoryInjectorInfo("menu_toggle.skipped", `reason=unsupported_action action=${action}`);
    return [];
  }

  const locale = typeof getLang === "function" ? String(getLang() || "").toLowerCase() : "";
  const isEn = locale.startsWith("en");
  logMemoryInjectorInfo("menu_toggle.created");
  return [
    {
      id: "memory_injector_toggle",
      title: isEn ? "Memory Injection" : "记忆注入",
      description: isEn
        ? "Auto-inject memories into the model input on every message"
        : "每次发送消息时自动把记忆注入到模型输入",
      isChecked: getMemoryInjectorEnabled(),
      slot: "memory",
    },
  ];
}

export function registerToolPkg(): boolean {
  ToolPkg.registerToolboxUiModule({
    id: "memory_injector_settings",
    runtime: "compose_dsl",
    screen: memoryInjectorScreen,
    params: {},
    title: {
      zh: "更好的记忆",
      en: "Memory Injection",
    },
  });

  ToolPkg.registerSystemPromptComposeHook({
    id: "memory_injector_sysprompt",
    function: onSystemPromptCompose,
  });

  ToolPkg.registerPromptFinalizeHook({
    id: "memory_injector_user",
    function: onPromptFinalize,
  });

  ToolPkg.registerInputMenuTogglePlugin({
    id: "memory_injector_toggle",
    function: onInputMenuToggle,
  });

  logMemoryInjectorInfo("plugin.registered");
  return true;
}