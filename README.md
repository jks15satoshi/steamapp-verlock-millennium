# Steam App Verlock

**English** | [简体中文](README.zh-CN.md)

A [Millennium](https://steambrew.app/) plugin that locks Steam apps to their installed builds, preventing them from auto-updating.

## Background

The Steam client offers no way to pin an app to a specific build: it provides only silent auto-updates and the "only update when I launch it" deferral. Some users (for example players who use mods, or developers who need a fixed build) may want an app to stay on its current build. This project fills that gap, and through the Millennium plugin system it delivers the locking experience inside the Steam client.

## Features

- Lock an installed app to its current build so Steam stops updating it.
- `Lock`, `Refresh`, and `Unlock` in the library context menu.
- A settings panel that lists every locked app, with multi-select batch `Refresh` and `Unlock`, `Restore All`, and a selectable data directory.
- A background watch that reapplies the lock whenever Steam rewrites the `appmanifest`.

## Supported Platforms

Windows and Linux desktop Steam clients (tested on AMD64 (x86-64)). macOS, SteamOS devices, and Big Screen Mode are not supported; see [Known Limitations](#known-limitations).

## Installing the Plugin

Steam App Verlock depends on Millennium: install [Millennium](https://steambrew.app/) first.

- **Plugin store**: open Millennium Settings → Plugins → "Install a plugin", then search for or enter the Steam App Verlock plugin ID.
- **Manual install**: download the release package from [Releases](https://github.com/jks15satoshi/steamapp-verlock-millennium/releases), extract it into Millennium's `plugins` directory, restart Steam, and enable the plugin from the Millennium menu.

## Usage

1. Right-click an app in your Steam library and open the Steam App Verlock submenu.
2. Choose `Lock`: the plugin captures the latest build info and locks the app to its current build; once locked, the menu shows `Locked`. An app that is downloading or has a pending update is not locked.
3. When the app has a new build, choose `Refresh` to move the lock to the latest build.
4. To restore auto-updates, choose `Unlock`.

The settings panel lists every locked app, supports multi-select batch `Refresh` and `Unlock`, and runs `Restore All` to release every lock at once. Run `Restore All` before you uninstall the plugin, or it may leave lock records that cannot be released automatically.

## How It Works

The plugin rewrites the app's `appmanifest_<appid>.acf` so Steam treats the installed build as current: it writes the captured `buildid` and depot manifests, sets `StateFlags` to `4` and `TargetBuildID` to `0`, and sets the app's auto-update behavior to `Launch`. It watches each locked app and reapplies the values whenever Steam rewrites the manifest. See [Spec 4](.agents/specs/004_app-version-lock.md) for the full design.

## Known Limitations

- **SteamOS devices are not supported.** Millennium does not currently support SteamOS Game Mode, so a plugin that depends on Millennium cannot support it either. SteamOS Desktop Mode is effectively an ordinary Linux desktop and Steam App Verlock should work there, but SteamOS users typically manage plugins with Decky Loader, which Millennium is explicitly incompatible with, so that scenario stays outside official support.
- **macOS is not supported.** Millennium offers only experimental macOS support, and Steam App Verlock does not plan to support macOS until Millennium supports it officially.
- **Big Screen Mode is not supported.** Millennium does not support Big Screen Mode, so Steam App Verlock cannot work in it.
- **Locking is not guaranteed for every app.** Apps that depend on a third-party launcher or a special update mechanism may not be locked successfully; assess the risk for your case before use.
- **Online multiplayer, anti-cheat, and online validation may be affected.** For apps with online multiplayer, anti-cheat components, or online validation, locking the build may prevent connecting to servers or lead to a ban by the game's anti-cheat system or publisher. We strongly advise against using Steam App Verlock on such apps, and urge you to understand the risks before locking.

## Contributing

Thanks for your support. We welcome any kind of contribution, including bug reports, feature requests, documentation, and code.

Before contributing code, read [CONTRIBUTING.md](CONTRIBUTING.md) for the project's contribution process and conventions.

## License and Disclaimer

Copyright © 2026 Satoshi Jek. Licensed under the [MIT License](LICENSE).

Steam App Verlock is a community-maintained project and has no affiliation with Valve whatsoever.

> [!WARNING]
> Steam App Verlock operates on and simulates the internal files of the Steam client, which may violate the [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/). There is no public record to date of an account ban from this kind of operation (references: [Millennium FAQ](https://docs.steambrew.app/users/getting-started/faq), [appmanifest community guide](https://steamcommunity.com/sharedfiles/filedetails/?id=3517757180)). Absence of public cases does not mean none can happen, so the potential risk is stated here explicitly.
>
> By using this project you accept these risks and proceed at your own risk.
