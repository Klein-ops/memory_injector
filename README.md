# memory_injector（记忆注入）

Operit 平台的记忆注入工具包：无需智能体主动检索，在每次发送消息时自动把记忆库中的记忆直接注入到输入上下文，并支持在工具箱中配置注入位置与内容策略。

## 功能特性

- **自动注入**：每次发送消息时，自动从记忆库中取出记忆并注入到模型输入上下文，省去主动检索步骤。
- **三种内容模式**：
  - `仅标题`：只注入记忆标题，详细内容请自行查看记忆库；
  - `标题 + 摘要`：注入标题与摘要（可配置每条截取前 N 字符）；
  - `标题 + 正文`：注入完整正文。
- **按模式注入说明头**：注入时会在记忆块开头附带说明，告知模型当前记忆的类型（仅标题 / 摘要了 N 条 / 完整内容），并统一附带提示：*以下记忆可能不是来自你本人，这是共享记忆*，避免把他人记忆误当作本人经历。
- **注入位置可配置**：支持注入到 `user` 消息或 `system` 上下文。
- **深色模式适配**：配置界面全部文字与按钮使用 Material 主题 token（`onSurface` / `primary` / `onPrimary` 等），白天/夜间模式自动切换，夜间不再出现黑色文字。

## 安装

1. 将 `com.operit.memory_injector.toolpkg` 放入 Operit 的外部包目录（或通过 Operit 包管理导入）。
2. 重启 Operit 使包被扫描加载。
3. 在工具箱中打开「记忆注入」配置界面，启用总开关并按需设置内容模式与注入位置。

> 注意：若 Operit 中已存在同名包，直接导入会提示 `A package with name ... already exists in available packages`，此时请直接覆盖外部包目录中的源文件后重启，而不是重复导入。

## 配置项

| 配置项 | 说明 | 可选值 |
|---|---|---|
| 启用记忆注入 | 总开关，关闭后所有自动注入功能暂停 | `true` / `false` |
| 注入目标 | 记忆注入到哪一侧上下文 | `user` / `system` |
| 内容模式 | 注入标题 / 标题+摘要 / 标题+正文 | `title` / `title_snippet` / `title_body` |
| 摘要截取长度 | `title_snippet` 模式下每条摘要截取的最大字符数 | 数字（0 表示不截取说明） |

## 开发

```bash
# 安装依赖（若 tsconfig 需要）
npm install -g typescript

# 编译 TypeScript 源码到 dist/
tsc -p tsconfig.json

# 重新打包 toolpkg（zip，含 manifest + src + dist + tsconfig）
python3 -c "import zipfile, os; ..."
```

### 目录结构

```
com.operit.memory_injector/
├── manifest.json          # 包元数据（toolpkg_id / version / display_name / description）
├── tsconfig.json          # TypeScript 编译配置
├── src/
│   ├── main.ts            # 包入口：注入钩子注册、设置读写
│   ├── shared.ts          # 记忆块构建（buildInjectionBlock）、三模式说明头
│   └── ui/
│       └── index.ui.ts    # 配置界面（Compose DSL，深色模式适配）
├── dist/                  # 编译产物（main.js / shared.js / ui/index.ui.js）
└── com.operit.memory_injector.toolpkg  # 打包后的分发包
```

## 版本历史

- **v0.5.0**：深色模式适配（标题/开关/按钮主题色）；按内容模式注入说明头 + 共享记忆提醒。
- **v0.4.3**：此前版本。

## 开源协议

[MIT](LICENSE)
