import type { ComposeDslContext, ComposeNode } from "../../../types/compose-dsl";
import {
  loadSettings,
  saveSettings,
  logMemoryInjectorError,
  type MemoryInjectorSettings,
} from "../shared";

function useStateValue<T>(ctx: ComposeDslContext, key: string, initialValue: T): {
  value: T;
  set: (value: T) => void;
} {
  const pair = ctx.useState<T>(key, initialValue);
  return { value: pair[0], set: pair[1] };
}

function createSectionTitle(ctx: ComposeDslContext, icon: string, title: string): ComposeNode {
  return ctx.UI.Row({ verticalAlignment: "center" }, [
    ctx.UI.Icon({ name: icon, tint: "primary", size: 20 }),
    ctx.UI.Spacer({ width: 8 }),
    ctx.UI.Text({
      text: title,
      style: "titleMedium",
      fontWeight: "bold",
      color: "primary",
    }),
  ]);
}

const cardStyle = {
  fillMaxWidth: true,
  shape: { cornerRadius: 8 },
  containerColor: "surfaceVariant",
  alpha: 0.38,
} as const;

function createToggleCard(
  ctx: ComposeDslContext,
  title: string,
  subtitle: string,
  checked: boolean,
  onCheckedChange: (checked: boolean) => void,
  enabled = true
): ComposeNode {
  return ctx.UI.Surface(cardStyle, [
    ctx.UI.Row(
      {
        fillMaxWidth: true,
        padding: { horizontal: 14, vertical: 12 },
        verticalAlignment: "center",
        horizontalArrangement: "spaceBetween",
      },
      [
        ctx.UI.Column({ weight: 1, spacing: 4 }, [
          ctx.UI.Text({
            text: title,
            style: "bodyMedium",
            fontWeight: "medium",
            color: "onSurface",
          }),
          ctx.UI.Text({
            text: subtitle,
            style: "bodySmall",
            color: "onSurface",
          }),
        ]),
        ctx.UI.Spacer({ width: 12 }),
        ctx.UI.Switch({
          checked,
          enabled,
          onCheckedChange,
        }),
      ]
    ),
  ]);
}

function createSegmentSelector(
  ctx: ComposeDslContext,
  options: Array<{ value: string; label: string }>,
  selectedValue: string,
  onSelect: (value: string) => void,
  enabled = true
): ComposeNode {
  return ctx.UI.Row(
    {
      fillMaxWidth: true,
      spacing: 8,
      padding: { horizontal: 4, vertical: 4 },
    },
    options.map((option) => {
      const selected = option.value === selectedValue;
      // 选中态：实心 primary 背景 + onPrimary 文字，对比强烈；
      // 未选中态：浅灰 surfaceVariant 背景 + onSurfaceVariant 文字。
      return ctx.UI.Button({
        key: option.value,
        enabled: enabled,
        fillMaxWidth: true,
        weight: 1,
        shape: { cornerRadius: 20 },
        containerColor: selected ? "primary" : "surfaceVariant",
        contentPadding: { horizontal: 8, vertical: 10 },
        content: [
          ctx.UI.Text({
            text: option.label,
            style: "labelLarge",
            color: selected
              ? "onPrimary"
              : (enabled ? "onSurfaceVariant" : "outline"),
            fontWeight: selected ? "bold" : "normal",
          }),
        ],
        onClick: () => {
          onSelect(option.value);
        },
      });
    })
  );
}

function createNumberFieldSection(
  ctx: ComposeDslContext,
  label: string,
  description: string,
  value: string,
  onValueChange: (value: string) => void,
  onApply: () => void,
  enabled = true,
  placeholder = "20"
): ComposeNode {
  return ctx.UI.Surface(cardStyle, [
    ctx.UI.Column(
      { fillMaxWidth: true, padding: { horizontal: 14, vertical: 12 }, spacing: 10 },
      [
        ctx.UI.TextField({
          enabled,
          label,
          placeholder,
          value,
          onValueChange,
          singleLine: true,
        }),
        ctx.UI.Text({
          text: description,
          style: "bodySmall",
          color: "onSurfaceVariant",
        }),
        ctx.UI.Button({
          enabled,
          fillMaxWidth: true,
          containerColor: "primary",
          shape: { cornerRadius: 20 },
          content: [
            ctx.UI.Text({
              text: "应用",
              style: "labelLarge",
              color: "onPrimary",
            }),
          ],
          onClick: onApply,
        }),
      ]
    ),
  ]);
}

export default function Screen(ctx: ComposeDslContext): ComposeNode {
  const initial = loadSettings();

  const masterEnabledState = useStateValue(ctx, "masterEnabled", initial.masterEnabled);
  const injectTargetState = useStateValue(ctx, "injectTarget", initial.injectTarget);
  const contentModeState = useStateValue(ctx, "contentMode", initial.contentMode);
  const contentMaxLengthState = useStateValue(
    ctx,
    "contentMaxLength",
    initial.contentMaxLength
  );
  const contentMaxLengthInputState = useStateValue(
    ctx,
    "contentMaxLengthInput",
    String(initial.contentMaxLength)
  );
  const successMessageState = useStateValue(ctx, "successMessage", "");
  const errorMessageState = useStateValue(ctx, "errorMessage", "");
  const hasInitializedState = useStateValue(ctx, "hasInitialized", false);

  const syncSettings = (next: MemoryInjectorSettings): void => {
    masterEnabledState.set(next.masterEnabled);
    injectTargetState.set(next.injectTarget);
    contentModeState.set(next.contentMode);
    contentMaxLengthState.set(next.contentMaxLength);
    contentMaxLengthInputState.set(String(next.contentMaxLength));
  };

  const persistSettings = (patch: Partial<MemoryInjectorSettings>, successMessage = ""): void => {
    try {
      const next = saveSettings(patch);
      syncSettings(next);
      errorMessageState.set("");
      successMessageState.set(successMessage);
    } catch (error) {
      logMemoryInjectorError("settings.save_failed", error);
      const message = error instanceof Error ? error.message : String(error || "unknown");
      successMessageState.set("");
      errorMessageState.set(`保存失败：${message}`);
    }
  };

  const applyContentMaxLength = (): void => {
    const length = Number(contentMaxLengthInputState.value.trim());
    if (!Number.isFinite(length) || length < 0) {
      successMessageState.set("");
      errorMessageState.set("摘要长度必须是大于等于 0 的整数");
      return;
    }
    persistSettings({ contentMaxLength: Math.floor(length) }, "已保存摘要长度上限");
  };

  const targetDescription =
    injectTargetState.value === "system"
      ? "注入到系统提示词末尾（注意：系统提示词变化可能破坏按前缀的 prompt 缓存）"
      : "注入到用户消息末尾（推荐：不额外破坏 prompt 缓存）";

  const modeDescription =
    contentModeState.value === "title_snippet"
      ? "记忆正文截取前 N 个字符作为摘要拼在标题后面（N 为下方摘要长度上限）"
      : contentModeState.value === "title_body"
        ? "记忆完整正文拼在标题后面注入（占用 token 较多）"
        : "仅注入记忆标题（最省 token）";

  const rootChildren: ComposeNode[] = [
    ctx.UI.Row({ verticalAlignment: "center" }, [
      ctx.UI.Icon({ name: "memory", tint: "primary", size: 24 }),
      ctx.UI.Spacer({ width: 8 }),
      ctx.UI.Text({
        text: "记忆注入",
        style: "headlineSmall",
        fontWeight: "bold",
        color: "onSurface",
      }),
    ]),
    ctx.UI.Text({
      text: "无需智能体主动检索，每次构建模型输入时自动把记忆库中的记忆注入到输入上下文。",
      style: "bodyMedium",
      color: "onSurfaceVariant",
    }),

    createSectionTitle(ctx, "settings", "总开关"),
    createToggleCard(
      ctx,
      "启用记忆注入",
      "关闭后所有自动注入功能暂停",
      masterEnabledState.value,
      (checked) => {
        persistSettings({ masterEnabled: checked }, checked ? "已启用记忆注入" : "已禁用记忆注入");
      }
    ),

    createSectionTitle(ctx, "place", "注入位置"),
    createSegmentSelector(
      ctx,
      [
        { value: "user", label: "用户消息" },
        { value: "system", label: "系统提示词" },
      ],
      injectTargetState.value,
      (value) => {
        persistSettings({ injectTarget: value as MemoryInjectorSettings["injectTarget"] });
      },
      masterEnabledState.value
    ),
    ctx.UI.Text({
      text: targetDescription,
      style: "bodySmall",
      color: "onSurfaceVariant",
      padding: { horizontal: 14 },
    }),

    createSectionTitle(ctx, "content", "注入内容"),
    createSegmentSelector(
      ctx,
      [
        { value: "title", label: "仅标题" },
        { value: "title_snippet", label: "标题+摘要" },
        { value: "title_body", label: "标题+正文" },
      ],
      contentModeState.value,
      (value) => {
        persistSettings({ contentMode: value as MemoryInjectorSettings["contentMode"] });
      },
      masterEnabledState.value
    ),
    ctx.UI.Text({
      text: modeDescription,
      style: "bodySmall",
      color: "onSurfaceVariant",
      padding: { horizontal: 14 },
    }),

    createNumberFieldSection(
      ctx,
      "摘要长度上限",
      "标题+摘要模式下，单条记忆正文截取的最大字符数（默认 120，0 表示不截断）",
      contentMaxLengthInputState.value,
      (value) => {
        contentMaxLengthInputState.set(value);
      },
      applyContentMaxLength,
      masterEnabledState.value && contentModeState.value === "title_snippet"
    ),

    ctx.UI.Card(
      {
        fillMaxWidth: true,
        shape: { cornerRadius: 12 },
        containerColor: "secondaryContainer",
        elevation: 1,
      },
      [
        ctx.UI.Column({ padding: 16, spacing: 6 }, [
          ctx.UI.Text({
            text: "当前规则",
            style: "titleSmall",
            fontWeight: "bold",
            color: "onSecondaryContainer",
          }),
          ctx.UI.Text({
            text: `开关：${masterEnabledState.value ? "已启用" : "已禁用"}`,
            style: "bodySmall",
            color: "onSecondaryContainer",
          }),
          ctx.UI.Text({
            text: `位置：${injectTargetState.value === "system" ? "系统提示词" : "用户消息"}`,
            style: "bodySmall",
            color: "onSecondaryContainer",
          }),
          ctx.UI.Text({
            text: `内容：${
              contentModeState.value === "title_snippet"
                ? "标题+摘要"
                : contentModeState.value === "title_body"
                  ? "标题+正文"
                  : "仅标题"
            }`,
            style: "bodySmall",
            color: "onSecondaryContainer",
          }),
        ]),
      ]
    ),
  ];

  if (successMessageState.value.trim()) {
    rootChildren.push(
      ctx.UI.Card({ containerColor: "primaryContainer", fillMaxWidth: true }, [
        ctx.UI.Row({ padding: { horizontal: 14, vertical: 12 }, verticalAlignment: "center" }, [
          ctx.UI.Icon({ name: "checkCircle", tint: "onPrimaryContainer" }),
          ctx.UI.Spacer({ width: 8 }),
          ctx.UI.Text({
            text: successMessageState.value,
            style: "bodyMedium",
            color: "onPrimaryContainer",
          }),
        ]),
      ])
    );
  }

  if (errorMessageState.value.trim()) {
    rootChildren.push(
      ctx.UI.Card({ containerColor: "errorContainer", fillMaxWidth: true }, [
        ctx.UI.Row({ padding: { horizontal: 14, vertical: 12 }, verticalAlignment: "center" }, [
          ctx.UI.Icon({ name: "error", tint: "onErrorContainer" }),
          ctx.UI.Spacer({ width: 8 }),
          ctx.UI.Text({
            text: errorMessageState.value,
            style: "bodyMedium",
            color: "onErrorContainer",
          }),
        ]),
      ])
    );
  }

  return ctx.UI.LazyColumn(
    {
      fillMaxSize: true,
      padding: 16,
      spacing: 16,
      onLoad: async () => {
        if (!hasInitializedState.value) {
          hasInitializedState.set(true);
          syncSettings(loadSettings());
        }
      },
    },
    rootChildren
  );
}