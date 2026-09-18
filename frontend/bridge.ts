import type {
  Ack,
  AppId,
  DataRoots,
  FileContentResult,
  LockedAppRecord,
  LockResult,
  MigrateResult,
  PathsResult,
  RefreshResult,
  RequiredAppsResult,
  RestoreResult,
  UnlockResult,
} from "./index";

function as_result<T>(result: Promise<unknown>): Promise<T> {
  return result as Promise<T>;
}

export function get_required_apps(appid: AppId, dump: string): Promise<RequiredAppsResult> {
  return as_result<RequiredAppsResult>(backend.get_required_apps(JSON.stringify({ appid, dump })));
}

export function lock_app(
  appid: AppId,
  dumps: Record<AppId, string>,
  auto_update_behavior?: number,
): Promise<LockResult> {
  const payload: {
    appid: AppId;
    dumps: Record<AppId, string>;
    auto_update_behavior?: number;
  } = { appid, dumps };
  if (typeof auto_update_behavior === "number") {
    payload.auto_update_behavior = auto_update_behavior;
  }
  return as_result<LockResult>(backend.lock_app(JSON.stringify(payload)));
}

export function refresh_app(appid: AppId, dumps: Record<AppId, string>): Promise<RefreshResult> {
  return as_result<RefreshResult>(backend.refresh_app(JSON.stringify({ appid, dumps })));
}

export function unlock_app(appid: AppId): Promise<UnlockResult> {
  return as_result<UnlockResult>(backend.unlock_app(JSON.stringify({ appid })));
}

export function list_locked(): Promise<LockedAppRecord[] | Ack> {
  return as_result<LockedAppRecord[] | Ack>(backend.list_locked());
}

export function restore_all(): Promise<RestoreResult> {
  return as_result<RestoreResult>(backend.restore_all());
}

export function get_data_root(): Promise<DataRoots> {
  return as_result<DataRoots>(backend.get_data_root());
}

export function get_paths(appid: AppId): Promise<PathsResult> {
  return as_result<PathsResult>(backend.get_paths(JSON.stringify({ appid })));
}

export function open_path(appid: AppId, target: "appmanifest" | "lock"): Promise<Ack> {
  return as_result<Ack>(backend.open_path(JSON.stringify({ appid, target })));
}

export function read_file(
  appid: AppId,
  target: "appmanifest" | "lock",
): Promise<FileContentResult> {
  return as_result<FileContentResult>(backend.read_file(JSON.stringify({ appid, target })));
}

export function set_data_root(path: string): Promise<MigrateResult> {
  return as_result<MigrateResult>(backend.set_data_root(JSON.stringify({ path })));
}

export function reapply_app(appid: AppId): Promise<Ack> {
  return as_result<Ack>(backend.reapply_app(JSON.stringify({ appid })));
}

export function append_log(level: string, message: string): Promise<Ack> {
  return as_result<Ack>(backend.append_log(JSON.stringify({ level, message })));
}
