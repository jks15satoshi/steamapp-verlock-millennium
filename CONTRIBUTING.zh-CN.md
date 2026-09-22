# 贡献指南

[English](CONTRIBUTING.md) | **简体中文**

感谢你帮助 `Steam App Verlock` —— 一个将 Steam 应用锁定在其已安装构建版本的 Millennium 插件。

本指南帮助人类贡献者从全新克隆走到合并的拉取请求。它概括了流程；真正的规则由 [Spec 3](.agents/specs/003_collaboration-conventions.md) 拥有，两者不一致时以该规范为准。

## 环境要求

项目需要以下运行时与工具。推荐用 `mise install` 一次性安装全部锁定版本；如果你更愿意自行安装，`mise.toml` 声明了同样的清单。

运行时：

- Bun 1.x
- Node.js 26.x
- Lua 5.4
- LuaJIT 2.1

工具：

- StyLua 2.x
- lua-language-server 3.x
- LuaRocks 3.13.0
- cspell
- markdownlint-cli2
- tombi

LuaRocks 3.13.0 安装 Lua 开发用的 rocks（`luacheck`、`busted`、`luacov`）。`bun install` 按 `bun.lock` 中固定的版本带来 JavaScript 与 TypeScript 工具。

## 快速开始

推荐用 `mise install` 安装锁定的工具版本：

    mise install
    bun install
    bun run prepare     # generates the .millennium/ type stubs

你不必使用 `mise`。如果你愿意，可以按照 `mise.toml` 中声明的版本，自行安装“环境要求”清单中的工具。

Lua 测试通过 LuaRocks 运行：

    bun run setup:lua   # builds .rocks/

`setup:lua` 用 `mise where luajit` 查找 LuaJIT，因此它依赖 `mise`。若不用 `mise`，请自行安装 LuaRocks 3.13.0、`luacheck`、`busted` 和 `luacov`。

`.rocks/`、`.millennium/`、`.tmp/` 和 `coverage/` 是生成且被 gitignore 的目录；永远不要编辑或提交它们。

## 常用命令

    bun run test                    # frontend then backend
    bun run test:frontend           # bun test frontend
    bun run test:backend            # busted
    bun run lint                    # oxlint + luacheck + tombi
    bun run typecheck               # tsc --noEmit (after prepare)
    bun run format                  # oxfmt, stylua, tombi
    bun run spell                   # cspell
    bun run build                   # starlight pack
    bun run build:release           # starlight pack --release into dist/
    bun run dev                     # starlight watch

单个测试：

    bun test frontend/tests/locked.test.ts
    busted backend/tests/lock_spec.lua
    busted --filter="lock_app"

## 进行修改

- 从 `master` 分出 `<type>/<slug>` 形式的分支，例如 `feat/app-verlock`。
- 首选 [Conventional Commits](https://www.conventionalcommits.org/) 头：`<type>(<scope>): <subject>`。类型表、scope 规则与 subject 措辞由 [Spec 3](.agents/specs/003_collaboration-conventions.md) 拥有。
- 每次提交只包含一个逻辑改动，并在推送前运行上面的检查。

## 发起拉取请求

- bug 修复类拉取请求引用一个 issue。非平凡改动还需引用拥有它的规范，或说明为何豁免。
- 模板要求 `Motivation`（带有 `Fixes #NN`、`Closes #NN`、`Resolves #NN`、`Related #NN` 或 `Refs #NN`）和 `Changes`；`Testing` 可选，只承载没有任何自动化门禁能覆盖的测试。
- 在检查与证据就绪之前，让拉取请求保持草稿状态。
- 你可以评审并合并自己的拉取请求。

## 报告 Bug 与请求功能

用匹配的表单开启 issue：`Bug`、`Feature` 或 `Task`。表单会询问评审者所需的细节。

## 延伸阅读

[specs 目录](.agents/specs/) 保存项目的决策。[Spec 3](.agents/specs/003_collaboration-conventions.md) 拥有贡献规则，[Spec 0](.agents/specs/000_metaspec.md) 说明规范流程。
