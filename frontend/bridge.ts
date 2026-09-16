import type {
  Ack,
  AppId,
  DataRoots,
  LockedAppRecord,
  LockResult,
  MigrateResult,
  RefreshResult,
  RestoreResult,
  UnlockResult,
} from "./index";

function as_result<T>(result: Promise<unknown>): Promise<T> {
  return result as Promise<T>;
}

export function set_build_info(appid: AppId, dump: string): Promise<Ack> {
  return as_result<Ack>(backend.set_build_info(JSON.stringify({ appid, dump })));
}

export function lock_app(appid: AppId, auto_update_behavior?: number): Promise<LockResult> {
  const payload: { appid: AppId; auto_update_behavior?: number } = { appid };
  if (typeof auto_update_behavior === "number") {
    payload.auto_update_behavior = auto_update_behavior;
  }
  return as_result<LockResult>(backend.lock_app(JSON.stringify(payload)));
}

export function refresh_app(appid: AppId): Promise<RefreshResult> {
  return as_result<RefreshResult>(backend.refresh_app(JSON.stringify({ appid })));
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

export function set_data_root(path: string): Promise<MigrateResult> {
  return as_result<MigrateResult>(backend.set_data_root(JSON.stringify({ path })));
}

export function reapply_app(appid: AppId): Promise<Ack> {
  return as_result<Ack>(backend.reapply_app(JSON.stringify({ appid })));
}
