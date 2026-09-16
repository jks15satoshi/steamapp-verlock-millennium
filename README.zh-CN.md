# Steam App Verlock

[English](README.md) | **简体中文**

一个 [Millennium](https://steambrew.app/) 插件，将 Steam 应用锁定在其已安装的构建版本，阻止其自动更新。

## 背景

Steam 客户端不提供将应用锁定在特定构建版本的功能：它只提供静默自动更新以及“仅在启动时更新”的延缓更新选项。但有些用户（例如使用 Mod 的玩家，或需要固定构建的开发者）可能希望应用保持在当前构建版本、不被自动更新。

本项目旨在提供这一功能，补齐这一需求；同时，借助 Millennium 插件系统，实现在 Steam 客户端内关联应用锁定的无缝体验。

## 功能

- 将已安装的应用锁定在当前构建，使 Steam 不再更新它。
- 在库右键菜单中提供 `Lock`、`Refresh` 与 `Unlock`。
- 设置面板列出每个已锁应用，支持多选批量 `Refresh` 与 `Unlock`、`Restore All`，以及可切换的数据目录。
- 后台监听每个已锁应用，在 Steam 改写 `appmanifest` 后重写回锁。

## 支持平台

本插件支持 Windows 与 Linux 桌面版 Steam 客户端（已在 AMD64（x86-64）平台测试）。

不提供对 macOS、SteamOS 设备以及 Big Screen Mode 的支持。详见 [已知限制](#已知限制) 部分。

## 安装插件

Steam App Verlock 依赖 Millennium：请先安装 [Millennium](https://steambrew.app/)。

- **插件商店**：打开 Millennium 设置 → 插件 → “安装插件”，搜索或输入 Steam App Verlock 的插件 ID 进行安装。
- **手动安装**：从 [Releases](https://github.com/jks15satoshi/steamapp-verlock-millennium/releases) 下载发布包，解压到 Millennium 的 `plugins` 目录，重启 Steam 后在 Millennium 菜单中启用。

## 使用

1. 在 Steam 库中右键点击目标应用，打开 Steam App Verlock 子菜单。
2. 选择 `Lock`：插件捕获最新的构建信息，并把应用锁定在当前构建；锁定后菜单会显示 `Locked`。处于下载中或待更新状态的应用不会被锁定。
3. 应用有新构建时，选择 `Refresh` 将锁定更新到最新构建。
4. 需要恢复自动更新时，选择 `Unlock`。

设置面板列出所有已锁应用，支持多选批量 `Refresh` 或 `Unlock`，并可运行 `Restore All` 一次性解除全部锁定。卸载插件前请先运行 `Restore All`，以免留下无法自动解除的锁定记录。

## 工作原理

插件改写应用的 `appmanifest_<appid>.acf`，使 Steam 把已安装的构建视为最新：写入捕获的 `buildid` 与各 depot manifest，将 `StateFlags` 设为 `4`、`TargetBuildID` 设为 `0`，并把应用的自动更新行为设为 `Launch`。插件会持续监听已锁应用，并在 Steam 改写 manifest 后重新写入这些值。完整设计见 [Spec 4](.agents/specs/004_app-version-lock.md)。

## 已知限制

- **不支持 SteamOS 设备。** 由于 Millennium 目前不提供对 SteamOS Game Mode 的支持，作为依赖于 Millennium 的插件，Steam App Verlock 自然也无法对 SteamOS Game Mode 提供支持；对于 SteamOS Desktop Mode，理论上将其视为普通的 Linux 桌面环境，Steam App Verlock 应该能够正常工作，但考虑到 SteamOS 用户通常会使用 Decky Loader 来管理插件，而 Millennium 明确不兼容 Decky Loader，因此在 SteamOS Desktop Mode 下的使用可能会受到限制，对于这一场景我们也不提供官方支持。
- **不支持 macOS。** 由于 Millennium 目前只提供对 macOS 的实验性支持，在 Millennium 提供对 macOS 的正式支持以前，Steam App Verlock 不计划提供对 macOS 的支持。
- **不支持 Big Screen Mode。** Millennium 目前不提供对 Big Screen Mode 的支持，因此 Steam App Verlock 也无法在该模式下正常工作。
- **无法保证对所有应用的锁定有效性。** 对于某些依赖于第三方启动器或特殊更新机制的应用，Steam App Verlock 可能无法成功锁定其版本。使用前请根据具体情况评估风险。
- **可能影响在线多人联机游戏、反作弊、联网验证等功能。** 对于在线多人联机游戏或包含反作弊组件、联网验证的应用，锁定版本可能导致无法正常连接服务器，甚至被游戏的反作弊系统或发行商封禁账户。我们强烈不建议对这类应用使用 Steam App Verlock，锁定前请务必充分了解相关风险。

## 贡献

首先感谢你的支持。我们欢迎任何形式的贡献，包括但不限于提交 bug 报告、提出功能请求、撰写文档、提交代码等。

如需贡献代码，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，了解项目的贡献流程与规范。

## 许可协议与免责声明

Copyright © 2026 Satoshi Jek。本项目基于 [MIT 协议](LICENSE) 授权。

Steam App Verlock 是一个社区维护项目，与 Valve 无任何关联。

> [!WARNING]
> Steam App Verlock 涉及操作/模拟 Steam 客户端内部文件，可能涉嫌违反《[Steam 订户协议](https://store.steampowered.com/subscriber_agreement/)》。截至目前，尚无公开记录表明此类操作会导致账户封禁（参考：[Millennium FAQ](https://docs.steambrew.app/users/getting-started/faq)、[appmanifest 社区指南](https://steamcommunity.com/sharedfiles/filedetails/?id=3517757180)）。但「没有公开案例」并不等于「不会发生」，此处明确告知潜在风险。
>
> 使用本项目即表示你已了解上述风险，并愿意自行承担由此产生的后果。
