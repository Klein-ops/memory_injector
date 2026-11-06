"use strict";
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
    (0, shared_1.logMemoryInjectorInfo)("inject.started", `chat_id=${chatId || "-"} content_mode=${settings.contentMode}`);
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
/**
 * 系统提示词注入：after_compose_system_prompt 阶段。
 * 只注入记忆使用准则（可选开关，默认开启）。
 * 记忆内容不在此注入——改由 PromptFinalizeHook 以附件方式附加，
 * 避免系统提示词每轮变化破坏前缀缓存，也避免历史旧记忆占用上下文。
 */
async function onSystemPromptCompose(event) {
    const stage = String(event.eventName || event.event || "");
    if (stage !== "after_compose_system_prompt") {
        return null;
    }
    const settings = (0, shared_1.loadSettings)();
    if (!settings.injectGuidelines) {
        return null;
    }
    const guidelines = (0, shared_1.buildGuidelinesBlock)();
    if (!guidelines) {
        return null;
    }
    const nextSystemPrompt = String(event.eventPayload?.systemPrompt || "");
    const result = nextSystemPrompt
        ? `${nextSystemPrompt}\n\n${guidelines}`
        : guidelines;
    (0, shared_1.logMemoryInjectorInfo)("sysprompt.injected", `guidelines=true new_length=${result.length}`);
    return { systemPrompt: result };
}
/**
 * 用户输入注入：before_send_to_model 阶段（transient，不落盘）。
 * 把记忆附件文本追加到最新用户输入末尾，只对本次发送给模型的请求生效，
 * 不写入聊天记录——历史消息中看不到记忆，不会反复占用上下文。
 */
async function onPromptFinalize(event) {
    const stage = String(event.eventName || event.event || "");
    if (stage !== "before_send_to_model") {
        return null;
    }
    const settings = (0, shared_1.loadSettings)();
    if (!settings.masterEnabled) {
        return null;
    }
    const payload = event.eventPayload || {};
    const processedInput = String(payload.processedInput || payload.rawInput || "");
    if (!processedInput.trim()) {
        (0, shared_1.logMemoryInjectorInfo)("userinject.skipped", "reason=empty_input");
        return null;
    }
    const chatId = String(payload.chatId || "").trim() || undefined;
    const block = await resolveAndBuildBlock(chatId);
    if (!block) {
        return null;
    }
    const nextProcessedInput = `${processedInput}\n\n${block}`;
    (0, shared_1.logMemoryInjectorInfo)("userinject.injected", `mode=attachment_transient new_length=${nextProcessedInput.length}`);
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
    (0, shared_1.logMemoryInjectorInfo)("plugin.registered");
    return true;
}
