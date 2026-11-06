/**
 * Memory Injector - ToolPkg entry
 *
 * 更好的记忆（记忆工具包）：
 *  - SystemPromptComposeHook(after_compose_system_prompt):
 *      * 注入记忆使用准则（可选开关，默认开启）
 *  - PromptFinalizeHook(before_send_to_model):
 *      * 把记忆内容以附件（attachment）形式附加到最新用户输入末尾
 *      * 不写入聊天记录：历史消息中的旧记忆不会反复占用上下文，
 *        每次请求都实时携带最新记忆
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
} from "./shared";

async function resolveAndBuildBlock(chatId?: string) {
  const settings = loadSettings();
  if (!settings.masterEnabled) {
    logMemoryInjectorInfo("inject.skipped", "reason=master_disabled");
    return null;
  }

  logMemoryInjectorInfo(
    "inject.started",
    `chat_id=${chatId || "-"} content_mode=${settings.contentMode}`
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

/**
 * 系统提示词注入：after_compose_system_prompt 阶段。
 * 只注入记忆使用准则（可选开关，默认开启）。
 * 记忆内容不在此注入——改由 PromptFinalizeHook 以附件方式附加，
 * 避免系统提示词每轮变化破坏前缀缓存，也避免历史旧记忆占用上下文。
 */
export async function onSystemPromptCompose(
  event: ToolPkg.SystemPromptComposeHookEvent
): Promise<ToolPkg.PromptHookObjectResult | null> {
  const stage = String(event.eventName || event.event || "");
  if (stage !== "after_compose_system_prompt") {
    return null;
  }
  const settings = loadSettings();
  if (!settings.injectGuidelines) {
    return null;
  }

  const guidelines = buildGuidelinesBlock();
  if (!guidelines) {
    return null;
  }

  const nextSystemPrompt = String(event.eventPayload?.systemPrompt || "");
  const result = nextSystemPrompt
    ? `${nextSystemPrompt}\n\n${guidelines}`
    : guidelines;
  logMemoryInjectorInfo(
    "sysprompt.injected",
    `guidelines=true new_length=${result.length}`
  );
  return { systemPrompt: result };
}

/**
 * 用户输入注入：before_send_to_model 阶段（transient，不落盘）。
 * 把记忆附件文本追加到最新用户输入末尾，只对本次发送给模型的请求生效，
 * 不写入聊天记录——历史消息中看不到记忆，不会反复占用上下文。
 */
export async function onPromptFinalize(
  event: ToolPkg.PromptFinalizeHookEvent
): Promise<ToolPkg.PromptHookObjectResult | null> {
  const stage = String(event.eventName || event.event || "");
  if (stage !== "before_send_to_model") {
    return null;
  }

  const settings = loadSettings();
  if (!settings.masterEnabled) {
    return null;
  }

  const payload = event.eventPayload || {};
  const processedInput = String(payload.processedInput || payload.rawInput || "");
  if (!processedInput.trim()) {
    logMemoryInjectorInfo("userinject.skipped", "reason=empty_input");
    return null;
  }

  const chatId = String(payload.chatId || "").trim() || undefined;
  const block = await resolveAndBuildBlock(chatId);
  if (!block) {
    return null;
  }

  const nextProcessedInput = `${processedInput}\n\n${block}`;
  logMemoryInjectorInfo(
    "userinject.injected",
    `mode=attachment_transient new_length=${nextProcessedInput.length}`
  );
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