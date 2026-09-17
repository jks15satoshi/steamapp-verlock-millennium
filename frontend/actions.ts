import { EAppAutoUpdateBehavior } from "millennium";
import type { Ack, AppId } from "./index";
import { capture_build_info } from "./console";
import {
  apply_auto_update_behavior,
  read_auto_update_behavior,
  unwatch_then_unlock,
  watch_app,
} from "./watch";
import { mark_locked, mark_unlocked } from "./locked";
import * as bridge from "./bridge";
import { format_error, report_failure, show_failure_dialog } from "./notify";

function parse_json(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

function is_ack(value: unknown): value is Ack {
  return Boolean(value) && typeof value === "object" && typeof (value as Ack).ok === "boolean";
}

export async function lock_app(appid: AppId): Promise<void> {
  const captured = await capture_build_info(appid);
  if (!captured.ok) {
    show_failure_dialog(`Lock failed for app ${appid}`, captured.error);
    return;
  }

  const auto_update_behavior = read_auto_update_behavior(appid);
  if (auto_update_behavior === undefined) {
    report_failure(
      `Lock failed for app ${appid}`,
      `aborted the lock for app ${appid}: the auto-update behavior was unreadable`,
    );
    return;
  }

  let locked: unknown;
  try {
    locked = parse_json(await bridge.lock_app(appid, auto_update_behavior));
  } catch (error) {
    report_failure(
      `Lock failed for app ${appid}`,
      `lock failed for app ${appid}: ${format_error(error)}`,
    );
    return;
  }
  if (!is_ack(locked)) {
    report_failure(
      `Lock failed for app ${appid}`,
      `lock failed for app ${appid}: the backend returned an invalid response`,
    );
    return;
  }
  if (!locked.ok) {
    show_failure_dialog(`Lock failed for app ${appid}`, locked.error ?? "the lock was refused");
    return;
  }

  if (!apply_auto_update_behavior(appid, EAppAutoUpdateBehavior.Launch)) {
    await unlock_app(appid);
    report_failure(
      `Lock failed for app ${appid}`,
      `rolled back the lock for ${appid} after the auto-update write failed`,
    );
    return;
  }

  watch_app(appid);
  mark_locked(appid);
}

export async function refresh_app(appid: AppId): Promise<void> {
  const captured = await capture_build_info(appid);
  if (!captured.ok) {
    show_failure_dialog(`Refresh failed for app ${appid}`, captured.error);
    return;
  }

  let refreshed: unknown;
  try {
    refreshed = parse_json(await bridge.refresh_app(appid));
  } catch (error) {
    report_failure(
      `Refresh failed for app ${appid}`,
      `refresh failed for app ${appid}: ${format_error(error)}`,
    );
    return;
  }
  if (!is_ack(refreshed)) {
    report_failure(
      `Refresh failed for app ${appid}`,
      `refresh failed for app ${appid}: the backend returned an invalid response`,
    );
    return;
  }
  if (!refreshed.ok) {
    show_failure_dialog(
      `Refresh failed for app ${appid}`,
      refreshed.error ?? "the refresh was refused",
    );
  }
}

export async function unlock_app(appid: AppId): Promise<void> {
  const result = await unwatch_then_unlock(appid);
  if (result.ok) {
    mark_unlocked(appid);
    return;
  }
  show_failure_dialog(`Unlock failed for app ${appid}`, result.error ?? "the unlock was refused");
}
