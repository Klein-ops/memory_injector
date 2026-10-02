"use strict";
/**
 * Memory Injector - ToolPkg entry
 *
 * 记忆自动注入器：
 *  - SystemPromptComposeHook(after_compose_system_prompt): 注入到系统提示词
 *  - PromptFinalizeHook(before_finalize_prompt): 注入到当前用户输入
 *  - InputMenuToggle: 输入菜单中的总开关
 *  - Toolbox UI: 工具箱配置页面（注入位置 / 内容策略 / 数量上限等）
 *
 * 注入内容来自记忆库（标题 / 摘要 / 完整正文），
 * 由宿主自动调用 query_memory 完成，不依赖智能体主动检索。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onSystemPromptCompose = onSystemPromptCompose;
exports.onPromptFinalize = onPromptFinalize;
exports.onInputMenuToggle = onInputMenuToggle;
exports.registerToolPkg = registerToolPkg;
const index_ui_js_1 = __importDefault(require("./ui/index.ui.js"));
const shared_1 = require("./shared");
async function resolveAndBuildBlock(chatId) {
    const settings = (0, shared_1.loadSettings)();
    if (!settings.masterEnabled) {
        (0, shared_1.logMemoryInjectorInfo)("inject.skipped", "reason=master_disabled");
        return null;
    }
    (0, shared_1.logMemoryInjectorInfo)("inject.started", `chat_id=${chatId || "-"} target=${settings.injectTarget} content_mode=${settings.contentMode}`);
    try {
        const needFullContent = settings.contentMode === "title_body";
        const memories = await (0, shared_1.fetchMemories)(needFullContent);
        if (!memories || memories.length === 0) {
            (0, shared_1.logMemoryInjectorInfo)("inject.completed", "memory_count=0");
            return null;
        }
        const block = (0, shared_1.buildInjectionBlock)(settings, memories);
        (0, shared_1.logMemoryInjectorInfo)("inject.completed", `memory_count=${memories.length} block_length=${block ? block.length : 0} full_content=${needFullContent}`);
        return block;
    }
    catch (error) {
        (0, shared_1.logMemoryInjectorError)("inject.failed", error);
        return null;
    }
}
function shouldInjectSystem(settings) {
    return settings.injectTarget === "system";
}
function shouldInjectUser(settings) {
    return settings.injectTarget === "user";
}
/**
 * 系统提示词注入：after_compose_system_prompt 阶段，
 * 把记忆标题附加到 systemPrompt 末尾。
 */
async function onSystemPromptCompose(event) {
    const stage = String(event.eventName || event.event || "");
    if (stage !== "after_compose_system_prompt") {
        return null;
    }
    const settings = (0, shared_1.loadSettings)();
    if (!shouldInjectSystem(settings)) {
        return null;
    }
    const chatId = String(event.eventPayload?.chatId || "").trim() || undefined;
    const block = await resolveAndBuildBlock(chatId);
    if (!block) {
        return null;
    }
    const currentSystemPrompt = String(event.eventPayload?.systemPrompt || "");
    const nextSystemPrompt = currentSystemPrompt
        ? `${currentSystemPrompt}\n\n${block}`
        : block;
    (0, shared_1.logMemoryInjectorInfo)("sysprompt.injected", `new_length=${nextSystemPrompt.length}`);
    return { systemPrompt: nextSystemPrompt };
}
/**
 * 用户输入注入：before_finalize_prompt 阶段，
 * 把记忆块作为一条独立的 turn 追加到对话历史最后（用户消息之后），
 * 而不是拼进 processedInput 文本（那样它在语义上属于用户消息的一部分）。
 */
async function onPromptFinalize(event) {
    const stage = String(event.eventName || event.event || "");
    if (stage !== "before_finalize_prompt") {
        return null;
    }
    const settings = (0, shared_1.loadSettings)();
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
        ? payload.preparedHistory
        : Array.isArray(payload.chatHistory)
            ? payload.chatHistory
            : null;
    if (history) {
        // 独立块：在历史末尾追加一条 USER turn（内容就是 <memory> 块）
        history.push({
            kind: "USER",
            content: block,
            metadata: { memory: true },
        });
        (0, shared_1.logMemoryInjectorInfo)("userinject.injected", `mode=standalone_turn turns=${history.length} block_length=${block.length}`);
        return { preparedHistory: history };
    }
    // 回退：宿主未提供历史时，退化为追加到用户输入末尾（旧行为）
    const processedInput = String(payload.processedInput || payload.rawInput || "");
    if (!processedInput.trim()) {
        (0, shared_1.logMemoryInjectorInfo)("userinject.skipped", "reason=empty_input");
        return null;
    }
    const nextProcessedInput = `${processedInput}\n\n${block}`;
    (0, shared_1.logMemoryInjectorInfo)("userinject.injected", `mode=append_input new_length=${nextProcessedInput.length}`);
    return { processedInput: nextProcessedInput };
}
/**
 * 输入菜单开关：create 时返回 toggle 定义，toggle 时切换总开关。
 */
function onInputMenuToggle(event) {
    const action = String(event.eventPayload?.action || "").toLowerCase();
    if (action === "toggle") {
        const enabled = !(0, shared_1.getMemoryInjectorEnabled)();
        (0, shared_1.setMemoryInjectorEnabled)(enabled);
        (0, shared_1.logMemoryInjectorInfo)("menu_toggle.updated", `enabled=${enabled}`);
        return [];
    }
    if (action !== "create") {
        (0, shared_1.logMemoryInjectorInfo)("menu_toggle.skipped", `reason=unsupported_action action=${action}`);
        return [];
    }
    const locale = typeof getLang === "function" ? String(getLang() || "").toLowerCase() : "";
    const isEn = locale.startsWith("en");
    (0, shared_1.logMemoryInjectorInfo)("menu_toggle.created");
    return [
        {
            id: "memory_injector_toggle",
            title: isEn ? "Memory Injection" : "记忆注入",
            description: isEn
                ? "Auto-inject memories into the model input on every message"
                : "每次发送消息时自动把记忆注入到模型输入",
            isChecked: (0, shared_1.getMemoryInjectorEnabled)(),
            slot: "memory",
        },
    ];
}
function registerToolPkg() {
    ToolPkg.registerToolboxUiModule({
        id: "memory_injector_settings",
        runtime: "compose_dsl",
        screen: index_ui_js_1.default,
        params: {},
        title: {
            zh: "记忆注入",
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
    (0, shared_1.logMemoryInjectorInfo)("plugin.registered");
    return true;
}
