import { IconsModule, definePlugin } from "millennium";
import { capture_then_refresh } from "./console";
import { install_gamepage_patch } from "./gamepage";
import { init_i18n } from "./i18n";
import { install_menu_patch } from "./menu";
import { install_properties_patch } from "./properties";
import SettingsPanel from "./settings";
import { install_clock_format } from "./time";
import { sync_watches, unwatch_all } from "./watch";

export type AppId = string;

export type Ack = { ok: boolean; error?: string; code?: string };

export type LockResult = Ack & { record?: LockedAppRecord };

export type RefreshResult = Ack;

export type UnlockResult = Ack & {
  auto_update_behavior?: number;
  auto_update_restored?: boolean;
};

export type CaptureResult =
  | { ok: true; appid: AppId; dump: string }
  | { ok: false; error: string; code?: string };

export type CaptureSet =
  | { ok: true; dumps: Record<AppId, string> }
  | { ok: false; error: string; code?: string };

export type RequiredAppsResult = Ack & { apps?: AppId[] };

export type BuildInfo = { buildid: string; depots: Record<string, string> };

export type LockedAppRecord = {
  version: number;
  appid: AppId;
  name: string;
  manifest_path: string;
  locked_at: number;
  refreshed_at?: number;
  auto_update_behavior?: number;
  locked_build: BuildInfo;
  original: string;
};

export type DataRoots = {
  data_root: string;
  is_default: boolean;
};

export type MigrateResult = Ack & { data_root?: string; warning?: string; is_default?: boolean };

export type PathsResult = Ack & { appmanifest?: string; lock?: string };

export type FileContentResult = Ack & { content?: string };

export type RestoreResult = Ack & {
  restored: number;
  failed: AppId[];
  auto_update?: { appid: AppId; behavior: number }[];
  auto_update_failed?: AppId[];
};

/** @ffi */
export function request_build_info(appid: string): void {
  void capture_then_refresh(appid);
}

export default definePlugin(() => {
  void init_i18n();
  install_clock_format();
  const unpatch_menu = install_menu_patch();
  const unpatch_properties = install_properties_patch();
  const unpatch_gamepage = install_gamepage_patch();
  void sync_watches();

  return {
    title: "Steam App Verlock",
    icon: <IconsModule.Settings />,
    content: <SettingsPanel />,
    onDismount() {
      unpatch_menu();
      unpatch_properties();
      unpatch_gamepage();
      unwatch_all();
    },
  };
});
