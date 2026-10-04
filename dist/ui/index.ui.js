"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;
const shared_1 = require("../shared");
function useStateValue(ctx, key, initialValue) {
    const pair = ctx.useState(key, initialValue);
    return { value: pair[0], set: pair[1] };
}
function createSectionTitle(ctx, icon, title) {
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
};
function createToggleCard(ctx, title, subtitle, checked, onCheckedChange, enabled = true) {
    return ctx.UI.Surface(cardStyle, [
        ctx.UI.Row({
            fillMaxWidth: true,
            padding: { horizontal: 14, vertical: 12 },
            verticalAlignment: "center",
            horizontalArrangement: "spaceBetween",
        }, [
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
        ]),
    ]);
}
function createSegmentSelector(ctx, options, selectedValue, onSelect, enabled = true) {
    return ctx.UI.Row({
        fillMaxWidth: true,
        spacing: 8,
        padding: { horizontal: 4, vertical: 4 },
    }, options.map((option) => {
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
    }));
}
function createNumberFieldSection(ctx, label, description, value, onValueChange, onApply, enabled = true, placeholder = "20") {
    return ctx.UI.Surface(cardStyle, [
        ctx.UI.Column({ fillMaxWidth: true, padding: { horizontal: 14, vertical: 12 }, spacing: 10 }, [
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
        ]),
    ]);
}
function Screen(ctx) {
    const initial = (0, shared_1.loadSettings)();
    const masterEnabledState = useStateValue(ctx, "masterEnabled", initial.masterEnabled);
    const injectGuidelinesState = useStateValue(ctx, "injectGuidelines", initial.injectGuidelines);
    const injectTargetState = useStateValue(ctx, "injectTarget", initial.injectTarget);
    const contentModeState = useStateValue(ctx, "contentMode", initial.contentMode);
    const contentMaxLengthState = useStateValue(ctx, "contentMaxLength", initial.contentMaxLength);
    const contentMaxLengthInputState = useStateValue(ctx, "contentMaxLengthInput", String(initial.contentMaxLength));
    const successMessageState = useStateValue(ctx, "successMessage", "");
    const errorMessageState = useStateValue(ctx, "errorMessage", "");
    const hasInitializedState = useStateValue(ctx, "hasInitialized", false);
    const syncSettings = (next) => {
        masterEnabledState.set(next.masterEnabled);
        injectGuidelinesState.set(next.injectGuidelines);
        injectTargetState.set(next.injectTarget);
        contentModeState.set(next.contentMode);
        contentMaxLengthState.set(next.contentMaxLength);
        contentMaxLengthInputState.set(String(next.contentMaxLength));
    };
    const persistSettings = (patch, successMessage = "") => {
        try {
            const next = (0, shared_1.saveSettings)(patch);
            syncSettings(next);
            errorMessageState.set("");
            successMessageState.set(successMessage);
        }
        catch (error) {
            (0, shared_1.logMemoryInjectorError)("settings.save_failed", error);
            const message = error instanceof Error ? error.message : String(error || "unknown");
            successMessageState.set("");
            errorMessageState.set(`保存失败：${message}`);
        }
    };
    const applyContentMaxLength = () => {
        const length = Number(contentMaxLengthInputState.value.trim());
        if (!Number.isFinite(length) || length < 0) {
            successMessageState.set("");
            errorMessageState.set("摘要长度必须是大于等于 0 的整数");
            return;
        }
        persistSettings({ contentMaxLength: Math.floor(length) }, "已保存摘要长度上限");
    };
    const targetDescription = injectTargetState.value === "system"
        ? "注入到系统提示词末尾（注意：系统提示词变化可能破坏按前缀的 prompt 缓存）"
        : "注入到用户消息末尾（推荐：不额外破坏 prompt 缓存）";
    const modeDescription = contentModeState.value === "title_snippet"
        ? "记忆正文截取前 N 个字符作为摘要拼在标题后面（N 为下方摘要长度上限）"
        : contentModeState.value === "title_body"
            ? "记忆完整正文拼在标题后面注入（占用 token 较多）"
            : "仅注入记忆标题（最省 token）";
    const rootChildren = [
        ctx.UI.Row({ verticalAlignment: "center" }, [
            ctx.UI.Icon({ name: "memory", tint: "primary", size: 24 }),
            ctx.UI.Spacer({ width: 8 }),
            ctx.UI.Text({
                text: "更好的记忆",
                style: "headlineSmall",
                fontWeight: "bold",
                color: "onSurface",
            }),
        ]),
        ctx.UI.Text({
            text: "记忆工具包：自动把记忆库中的记忆注入到输入上下文，并为 AI 提供记忆使用准则。",
            style: "bodyMedium",
            color: "onSurfaceVariant",
        }),
        createSectionTitle(ctx, "settings", "记忆使用准则"),
        createToggleCard(ctx, "注入记忆使用准则", "在系统提示词中注入记忆使用准则（敏感信息保护、相关性判断、标题规范等），默认开启", injectGuidelinesState.value, (checked) => {
            persistSettings({ injectGuidelines: checked }, checked ? "已开启记忆使用准则注入" : "已关闭记忆使用准则注入");
        }),
        createSectionTitle(ctx, "memory", "记忆注入（子功能）"),
        createToggleCard(ctx, "启用记忆注入", "关闭后记忆内容不再自动注入（记忆使用准则注入不受影响）", masterEnabledState.value, (checked) => {
            persistSettings({ masterEnabled: checked }, checked ? "已启用记忆注入" : "已禁用记忆注入");
        }),
        createSectionTitle(ctx, "place", "注入位置"),
        createSegmentSelector(ctx, [
            { value: "user", label: "用户消息" },
            { value: "system", label: "系统提示词" },
        ], injectTargetState.value, (value) => {
            persistSettings({ injectTarget: value });
        }, masterEnabledState.value),
        ctx.UI.Text({
            text: targetDescription,
            style: "bodySmall",
            color: "onSurfaceVariant",
            padding: { horizontal: 14 },
        }),
        createSectionTitle(ctx, "content", "注入内容"),
        createSegmentSelector(ctx, [
            { value: "title", label: "仅标题" },
            { value: "title_snippet", label: "标题+摘要" },
            { value: "title_body", label: "标题+正文" },
        ], contentModeState.value, (value) => {
            persistSettings({ contentMode: value });
        }, masterEnabledState.value),
        ctx.UI.Text({
            text: modeDescription,
            style: "bodySmall",
            color: "onSurfaceVariant",
            padding: { horizontal: 14 },
        }),
        createNumberFieldSection(ctx, "摘要长度上限", "标题+摘要模式下，单条记忆正文截取的最大字符数（默认 120，0 表示不截断）", contentMaxLengthInputState.value, (value) => {
            contentMaxLengthInputState.set(value);
        }, applyContentMaxLength, masterEnabledState.value && contentModeState.value === "title_snippet"),
        ctx.UI.Card({
            fillMaxWidth: true,
            shape: { cornerRadius: 12 },
            containerColor: "secondaryContainer",
            elevation: 1,
        }, [
            ctx.UI.Column({ padding: 16, spacing: 6 }, [
                ctx.UI.Text({
                    text: "当前规则",
                    style: "titleSmall",
                    fontWeight: "bold",
                    color: "onSecondaryContainer",
                }),
                ctx.UI.Text({
                    text: `记忆使用准则：${injectGuidelinesState.value ? "已注入" : "未注入"}`,
                    style: "bodySmall",
                    color: "onSecondaryContainer",
                }),
                ctx.UI.Text({
                    text: `记忆注入：${masterEnabledState.value ? "已启用" : "已禁用"}`,
                    style: "bodySmall",
                    color: "onSecondaryContainer",
                }),
                ctx.UI.Text({
                    text: `位置：${injectTargetState.value === "system" ? "系统提示词" : "用户消息"}`,
                    style: "bodySmall",
                    color: "onSecondaryContainer",
                }),
                ctx.UI.Text({
                    text: `内容：${contentModeState.value === "title_snippet"
                        ? "标题+摘要"
                        : contentModeState.value === "title_body"
                            ? "标题+正文"
                            : "仅标题"}`,
                    style: "bodySmall",
                    color: "onSecondaryContainer",
                }),
            ]),
        ]),
    ];
    if (successMessageState.value.trim()) {
        rootChildren.push(ctx.UI.Card({ containerColor: "primaryContainer", fillMaxWidth: true }, [
            ctx.UI.Row({ padding: { horizontal: 14, vertical: 12 }, verticalAlignment: "center" }, [
                ctx.UI.Icon({ name: "checkCircle", tint: "onPrimaryContainer" }),
                ctx.UI.Spacer({ width: 8 }),
                ctx.UI.Text({
                    text: successMessageState.value,
                    style: "bodyMedium",
                    color: "onPrimaryContainer",
                }),
            ]),
        ]));
    }
    if (errorMessageState.value.trim()) {
        rootChildren.push(ctx.UI.Card({ containerColor: "errorContainer", fillMaxWidth: true }, [
            ctx.UI.Row({ padding: { horizontal: 14, vertical: 12 }, verticalAlignment: "center" }, [
                ctx.UI.Icon({ name: "error", tint: "onErrorContainer" }),
                ctx.UI.Spacer({ width: 8 }),
                ctx.UI.Text({
                    text: errorMessageState.value,
                    style: "bodyMedium",
                    color: "onErrorContainer",
                }),
            ]),
        ]));
    }
    return ctx.UI.LazyColumn({
        fillMaxSize: true,
        padding: 16,
        spacing: 16,
        onLoad: async () => {
            if (!hasInitializedState.value) {
                hasInitializedState.set(true);
                syncSettings((0, shared_1.loadSettings)());
            }
        },
    }, rootChildren);
}
