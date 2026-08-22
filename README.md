# ppt4ai

面向 Microsoft PPTX 兼容性的 Web PPT 编辑器插件，内部使用 JSON 文档模型。

## 环境

- Node.js `>=20.19.0`
- pnpm `10.33.2`
- Windows 中文 IME 人工验收适用于 IME 风险实验；普通开发也可在 macOS/Linux 运行。

## 安装

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 验证

```bash
pnpm check:boundaries
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm build
```

`check:boundaries` 会检查 12 个 `@ppt4ai/*` 包是否存在、headless 包是否误依赖 Vue/DOM，以及 `engine`、`editor`、`player` 的依赖方向。

## 开发

```bash
pnpm dev       # Vue + UnoCSS playground: http://127.0.0.1:4174
pnpm dev:ime   # IME 风险实验: http://127.0.0.1:4173
```

UnoCSS 是编辑器唯一的样式工具；项目不引入 Element Plus 或其他组件框架。

## 文档

- [架构设计总纲](docs/superpowers/specs/2026-08-22-ppt4ai-architecture-design.md)
- [IME 自动换行设计](docs/superpowers/specs/2026-08-22-ime-auto-wrap-design.md)
- [IME 预研结果](docs/verification/2026-08-22-ime-spike-result.md)
- [Windows IME 人工验收清单](apps/ime-lab/e2e/manual-ime-checklist.md)
- [阶段 0 全量验证](docs/verification/2026-08-22-stage-0-verification.md)
- [开发进度](进度.md)
