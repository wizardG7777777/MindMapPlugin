# 上一轮设计归档：CLI 与本地 WebUI

归档日期：2026-10-09（Australia/Perth）。

**状态：历史资料，不再作为新架构的规范或实施依据。新架构在归档时尚待讨论，当前进展见[文档入口](../../README.md)。**

本归档保存归档时的工作区内容，包括尚未提交的修改和未跟踪文档。它不是仅按 Git HEAD 导出的快照，也不代表这些资料已经提交。

## 归档内容

- [旧项目 README](snapshot/README.md)。
- [架构规范](snapshot/docs/architecture.md)、[实现路线](snapshot/docs/implementation-roadmap.md)、[验收规范](snapshot/docs/acceptance.md)及其余全部设计文档。
- [旧 CLI Skill](snapshot/skills/mindmap-cli/SKILL.md)，已从当前 Skill 目录移出。
- [布局示例](snapshot/examples/layout-gallery/README.md)、[登录鉴权示例](snapshot/examples/login-authentication/README.md)、[AgentGo 架构示例](snapshot/examples/agentgo-architecture/README.md)，含对应图示、源图与生成记录。
- 历史验收记录位于 snapshot/verification/。这些记录不作为新架构的验收结果。
- samples/ 与 schemas/ 的原样副本随归档保存，用于保留示例引用和旧格式定义；工作区原件已随旧实现于 2026-10-16 移除。

## 保存方式

所有快照文件保持原始字节，snapshot/ 内保留原有相对目录结构。原文中的“当前”“已实现”等措辞仅表示上一轮设计当时的陈述。文中的项目根目录命令仍指旧实现所在的仓库根目录；指向其他仓库的绝对链接也保持原样。

[manifest.json](manifest.json) 记录每个文件的原路径、归档路径、移动或复制方式、字节数和 SHA-256，可用于核对内容是否完整。

## 旧实现边界

2026-10-09 的归档操作没有迁移或重写运行代码、测试、构建配置和依赖，仅验证归档完整性与文档链接，没有宣称旧版打包验收通过。当时旧版打包验收仍依赖已归档的 Skill 路径。

2026-10-16，旧 CLI/WebUI 代码、测试、根目录依赖及旧构建产物已从工作区移除，根目录命令统一转发到新版 `app/`。本归档的 `snapshot/` 原始字节和 `manifest.json` 保持不变；其中的旧命令、旧路径仅供历史回查。

## 文档目录

- [README.md](snapshot/README.md)
- [docs/acceptance.md](snapshot/docs/acceptance.md)
- [docs/architecture.md](snapshot/docs/architecture.md)
- [docs/cli-reference.md](snapshot/docs/cli-reference.md)
- [docs/cli-workflows.md](snapshot/docs/cli-workflows.md)
- [docs/command-contract.md](snapshot/docs/command-contract.md)
- [docs/command-results.md](snapshot/docs/command-results.md)
- [docs/context-management.md](snapshot/docs/context-management.md)
- [docs/data-model.md](snapshot/docs/data-model.md)
- [docs/editing-architecture.md](snapshot/docs/editing-architecture.md)
- [docs/implementation-roadmap.md](snapshot/docs/implementation-roadmap.md)
- [docs/installation.md](snapshot/docs/installation.md)
- [docs/mermaid-projection.md](snapshot/docs/mermaid-projection.md)
- [docs/operation-schema.md](snapshot/docs/operation-schema.md)
- [docs/persistence-and-concurrency.md](snapshot/docs/persistence-and-concurrency.md)
- [docs/rendering.md](snapshot/docs/rendering.md)
- [docs/theme-template.md](snapshot/docs/theme-template.md)
- [docs/view-state.md](snapshot/docs/view-state.md)
- [docs/webui.md](snapshot/docs/webui.md)
- [skills/mindmap-cli/SKILL.md](snapshot/skills/mindmap-cli/SKILL.md)
- [examples/agentgo-architecture/README.md](snapshot/examples/agentgo-architecture/README.md)
- [examples/layout-gallery/README.md](snapshot/examples/layout-gallery/README.md)
- [examples/login-authentication/README.md](snapshot/examples/login-authentication/README.md)
