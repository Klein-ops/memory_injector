/**
 * Memory Injector - shared helpers
 *
 * 记忆注入器：在每次构建模型输入时，自动把记忆库中的记忆标题
 * （可选附带内容摘要）注入到系统提示词或用户输入中。
 * 无需智能体主动检索，全部在 prompt hook 阶段自动完成。
 */

declare function logInfo(message: string): void;
declare function logError(message: string): void;

const SETTINGS_PREFS_NAME = "toolpkg_memory_injector";
const SETTINGS_KEY = "memory_injector_settings";
const LOG_PREFIX = "[memory_injector]";

export type MemoryInjectTarget = "system" | "user";

/**
 * 注入内容策略：
 *  - "title"         仅标题
 *  - "title_snippet" 标题 + 内容摘要（从记忆正文截取前 N 字符）
 *  - "title_body"    标题 + 记忆完整正文
 */
export type MemoryInjectContentMode = "title" | "title_snippet" | "title_body";

export type MemoryInjectorSettings = {
  /** 总开关 */
  masterEnabled: boolean;
  /** 注入目标：system=系统提示词 / user=当前用户输入 */
  injectTarget: MemoryInjectTarget;
  /** 注入内容策略（默认仅标题） */
  contentMode: MemoryInjectContentMode;
  /** 摘要模式下单条内容摘要最大长度（字符） */
  contentMaxLength: number;
  /** 是否在系统提示词中注入"记忆使用准则"（独立于注入目标） */
  injectGuidelines: boolean;
};
export const DEFAULT_SETTINGS: MemoryInjectorSettings = {
  masterEnabled: true,
  // 默认注入到用户消息末尾：系统提示词变化会破坏 prompt 前缀缓存（OpenAI/Anthropic/DeepSeek 等），
  // 而用户消息本身每轮都在变，附加在末尾不会额外破坏缓存。
  injectTarget: "user",
  contentMode: "title",
  contentMaxLength: 120,
  injectGuidelines: true,
};

export function logMemoryInjectorInfo(event: string, detail?: string): void {
  try {
    const message = `${LOG_PREFIX} ${event}${detail ? ` ${detail}` : ""}`;
    if (typeof logInfo === "function") {
      logInfo(message);
    } else {
      console.log(message);
    }
  } catch (_ignored) {
    // 日志失败不影响主流程
  }
}

export function logMemoryInjectorError(event: string, error?: unknown, detail?: string): void {
  try {
    const reason = error instanceof Error ? error.message : String(error || "unknown");
    const message = `${LOG_PREFIX} ${event} error=${reason}${detail ? ` ${detail}` : ""}`;
    if (typeof logError === "function") {
      logError(message);
    } else {
      console.error(message);
    }
  } catch (_ignored) {
    // 日志失败不影响主流程
  }
}

export function getAppContext(): any {
  if (
    typeof Java !== "undefined" &&
    Java &&
    typeof Java.getApplicationContext === "function"
  ) {
    return Java.getApplicationContext();
  }
  return null;
}

function getPrefs(): any {
  const context = getAppContext();
  if (!context) {
    throw new Error("application context unavailable");
  }
  return context.getSharedPreferences(SETTINGS_PREFS_NAME, 0);
}

export function sanitizeSettings(
  input: Partial<MemoryInjectorSettings> | null | undefined
): MemoryInjectorSettings {
  const target = String(input?.injectTarget || "").trim();
  const mode = String(input?.contentMode || "").trim();
  const contentMaxLength = Number(input?.contentMaxLength);
  return {
    masterEnabled: Boolean(input?.masterEnabled ?? DEFAULT_SETTINGS.masterEnabled),
    injectTarget:
      target === "user" || target === "system"
        ? (target as MemoryInjectTarget)
        : DEFAULT_SETTINGS.injectTarget,
    contentMode:
      mode === "title_snippet" || mode === "title_body"
        ? (mode as MemoryInjectContentMode)
        : DEFAULT_SETTINGS.contentMode,
    contentMaxLength:
      Number.isFinite(contentMaxLength) && contentMaxLength >= 0
        ? Math.floor(contentMaxLength)
        : DEFAULT_SETTINGS.contentMaxLength,
    injectGuidelines: Boolean(
      input?.injectGuidelines ?? DEFAULT_SETTINGS.injectGuidelines
    ),
  };
}

export function loadSettings(): MemoryInjectorSettings {
  try {
    const raw = String(getPrefs().getString(SETTINGS_KEY, "") || "").trim();
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<MemoryInjectorSettings> & {
      includeContent?: boolean;
      legacyInjectTarget?: string;
      legacyContentMode?: string;
      legacyMaxMemories?: number;
    };
    // 旧版本（v0.1.x / v0.2.x）迁移：旧设置可能写入了 includeContent / injectTarget=both / maxMemories。
    // 注意：contentMode 的 title_body 是当前合法值，不能作为旧标记（否则每次加载都触发迁移，日志刷屏）。
    const legacy = parsed as any;
    const legacyMark =
      typeof legacy.includeContent === "boolean" ||
      legacy.injectTarget === "both" ||
      legacy.maxMemories !== undefined;
    if (parsed && legacyMark) {
      const migrated: Partial<MemoryInjectorSettings> = {
        masterEnabled: legacy.masterEnabled,
        injectTarget: legacy.injectTarget === "system" ? "system" : "user",
        contentMode:
          legacy.includeContent === true || legacy.contentMode === "title_body"
            ? "title_body"
            : legacy.contentMode === "title_snippet"
              ? "title_snippet"
              : "title",
        contentMaxLength: legacy.contentMaxLength,
      };
      const next = sanitizeSettings(migrated);
      getPrefs().edit().putString(SETTINGS_KEY, JSON.stringify(next)).apply();
      logMemoryInjectorInfo("settings.migrated", `to ${next.contentMode}@${next.injectTarget}`);
      return next;
    }
    return sanitizeSettings(parsed);
  } catch (error) {
    logMemoryInjectorError("settings.load_failed", error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  patch: Partial<MemoryInjectorSettings>
): MemoryInjectorSettings {
  const next = sanitizeSettings({ ...loadSettings(), ...patch });
  getPrefs()
    .edit()
    .putString(SETTINGS_KEY, JSON.stringify(next))
    .apply();
  logMemoryInjectorInfo(
    "settings.saved",
    `enabled=${next.masterEnabled} target=${next.injectTarget} content_mode=${next.contentMode}`
  );
  return next;
}

export function getMemoryInjectorEnabled(): boolean {
  return loadSettings().masterEnabled;
}

export function setMemoryInjectorEnabled(enabled: boolean): MemoryInjectorSettings {
  return saveSettings({ masterEnabled: !!enabled });
}

/** 原始记忆条目（来自 query_memory 结果） */
export interface MemoryItem {
  title: string;
  content?: string;
}

/**
 * 读取记忆条目。
 * fullContent=false（列表模式）：使用 query_memory 的 "*" 全量查询，
 *   返回的 content 是宿主摘要（较短，适合 title / title_snippet 模式）。
 * fullContent=true（完整正文模式）：在列表基础上，逐条调用
 *   get_memory_by_title 拉取完整正文（供 title_body 模式使用）。
 */
export async function fetchMemories(fullContent = false): Promise<MemoryItem[]> {
  const result: any = await toolCall("query_memory", {
    query: "*",
  });
  const memories = Array.isArray(result?.memories) ? result.memories : [];
  const items = memories
    .map((memory: any) => ({
      title: String(memory?.title || "").trim(),
      content: String(memory?.content || "").trim(),
    }))
    .filter((memory: MemoryItem) => Boolean(memory.title));

  if (!fullContent || items.length === 0) {
    return items;
  }

  // title_body 模式：逐条读取完整正文（query_memory 列表查询的 content 是截断摘要）
  const detailed: MemoryItem[] = [];
  for (const item of items) {
    try {
      const detail: any = await toolCall("get_memory_by_title", {
        title: item.title,
      });
      const ms = Array.isArray(detail?.memories) ? detail.memories : [];
      const full =
        ms.find((m: any) => String(m?.title || "").trim() === item.title) || ms[0] || null;
      detailed.push({
        title: item.title,
        content: full ? String(full?.content || "").trim() : item.content,
      });
    } catch (error) {
      // 单条读取失败时退回列表摘要，不中断整体注入
      logMemoryInjectorError("memory.fetch_detail_failed", error, `title=${item.title}`);
      detailed.push(item);
    }
  }
  return detailed;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 构建注入文本块。
 * 纯标题模式（title）：
 *   <memory>
 *   - 标题A
 *   - 标题B
 *   </memory>
 * 标题+摘要模式（title_snippet）：
 *   <memory>
 *   - 标题A：记忆正文摘要...
 *   </memory>
 * 标题+正文模式（title_body）：
 *   <memory>
 *   - 标题A：
 *     记忆完整正文……
 *   </memory>
 */
export function buildInjectionBlock(
  settings: MemoryInjectorSettings,
  memories: MemoryItem[]
): string | null {
  if (!memories || memories.length === 0) {
    return null;
  }

  const lines: string[] = ["<memory>"];
  const maxSnippetLength = Math.max(0, Math.floor(settings.contentMaxLength) || 0);
  const mode = settings.contentMode || "title";
  // 模式说明头：明确告知 AI 这份记忆的类型与来源（共享记忆），避免把他人记忆误当成本人经历；
  // 并额外要求：与当前对话无关的记忆直接忽略，不要当作自己的经历或事实。
  const sharedNote =
    "注意：以下记忆可能不是来自你本人，这是共享记忆。若某条记忆与你无关、对当前对话没有任何帮助，请直接忽略，不要将其当作自己的经历或事实。";
  if (mode === "title") {
    lines.push(`以下记忆仅标题（共 ${memories.length} 条），详细记忆请自行查看记忆库。${sharedNote}`);
  } else if (mode === "title_snippet") {
    lines.push(
      `以下是 ${memories.length} 条记忆的摘要（仅摘录${maxSnippetLength > 0 ? `，每条截取前 ${maxSnippetLength} 字符` : ""}），完整内容请查看记忆库。${sharedNote}`
    );
  } else {
    lines.push(`以下为记忆完整内容（共 ${memories.length} 条）。${sharedNote}`);
  }
  for (const memory of memories) {
    const title = collapseWhitespace(String(memory.title || ""));
    if (!title) {
      continue;
    }

    if ((mode === "title_snippet" || mode === "title_body") && memory.content) {
      const content = collapseWhitespace(memory.content);
      if (mode === "title_snippet") {
        let snippet = content;
        if (maxSnippetLength > 0 && snippet.length > maxSnippetLength) {
          snippet = `${snippet.slice(0, maxSnippetLength)}...`;
        }
        lines.push(`- ${title}：${snippet}`);
      } else {
        // title_body：注入完整正文
        lines.push(`- ${title}：${content}`);
      }
    } else {
      lines.push(`- ${title}`);
    }
  }
  lines.push("</memory>");
  const block = lines.join("\n");
  return block.length > 0 ? block : null;
}
/**
 * 记忆使用准则（注入到系统提示词，独立于记忆内容注入）。
 * 用户拟定草稿 + AI 补充改写，最终文本：
 *   - 敏感信息保护
 *   - 使用范围与相关性判断
 *   - 标题是索引，正文才是知识
 *   - 记忆的正确性与优先级
 */
export const MEMORY_GUIDELINES_TEXT = `记忆使用准则

记忆库是你跨会话的长期知识存储；注入到上下文中的记忆块用于帮助你快速定位相关信息。请严格遵守以下准则：

一、敏感信息保护
1. 严禁将用户的个人敏感信息写入记忆库，包括但不限于：身份证号、银行卡号及支付密码、账号密码与短信验证码、家庭住址、手机号码、生物识别信息（指纹/人脸）、医疗健康记录等。
2. 若上下文中已出现上述敏感信息（无论来自记忆注入还是用户消息），不得主动复述、传播或用于输出；仅在用户明确要求且必要的最小范围内使用。
3. 遵循"最小必要"原则：不确定是否敏感的信息，默认按敏感处理，不写入记忆库。

二、使用范围与相关性判断
4. 记忆块以标题形式注入上下文（可能附带摘要或正文），其作用是帮助你快速发现相关信息，而非要求你全量依赖。
5. 判断相关性：扫视标题后，若该记忆与当前对话主题、任务或用户意图无关，或对当前对话没有任何帮助，请直接忽略，不要将其当作自己的经历或事实，也不要强行引用。
6. 需要细节时，按需调用 query_memory / get_memory_by_title 读取对应记忆的正文，不要仅凭标题臆测内容。

三、标题是索引，正文才是知识
7. 创建或更新记忆时，标题应简短、具体，并注明适用范围（建议格式：项目-主题-用途，如"某项目-架构方案-开发参考"），便于快速检索定位。
8. 不要把知识塞进标题：标题只是索引，正文才是知识的载体。完整内容应写在正文中，保持结构化、可独立理解。
9. 记忆面向未来复用：写入时注明关键上下文（时间、项目、结论），避免过时或产生歧义。

四、记忆的正确性与优先级
10. 记忆可能过时或来自共享：当记忆与当前对话中的明确信息冲突时，以当前对话为准，记忆仅作参考。
11. 不得臆造或篡改记忆内容；若发现读取到的记忆有明显错误，应指出而非盲从。`;
export function buildGuidelinesBlock(): string {
  return `<memory_guidelines>\n${MEMORY_GUIDELINES_TEXT}\n</memory_guidelines>`;
}