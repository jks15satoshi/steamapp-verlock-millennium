import { EAppAutoUpdateBehavior } from "millennium";
import type { Ack, AppId, UnlockResult } from "./index";
import { capture_build_info_set } from "./console";
import {
  app_name,
  apply_auto_update_behavior,
  read_auto_update_behavior,
  unwatch_then_unlock,
  watch_app,
} from "./watch";
import { mark_locked, mark_unlocked } from "./locked";
import * as bridge from "./bridge";
import { format_error, report_failure, report_success, show_failure_dialog } from "./notify";

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

export async function lock_app(appid: AppId, parent?: EventTarget): Promise<void> {
  const captured = await capture_build_info_set(appid);
  if (!captured.ok) {
    show_failure_dialog(`Lock failed for app ${appid}`, captured.error, parent);
    return;
  }

  const auto_update_behavior = read_auto_update_behavior(appid);
  if (auto_update_behavior === undefined) {
    report_failure(
      `Lock failed for app ${appid}`,
      `aborted the lock for app ${appid}: the auto-update behavior was unreadable`,
      parent,
    );
    return;
  }

  let locked: unknown;
  try {
    locked = parse_json(await bridge.lock_app(appid, captured.dumps, auto_update_behavior));
  } catch (error) {
    report_failure(
      `Lock failed for app ${appid}`,
      `lock failed for app ${appid}: ${format_error(error)}`,
      parent,
    );
    return;
  }
  if (!is_ack(locked)) {
    report_failure(
      `Lock failed for app ${appid}`,
      `lock failed for app ${appid}: the backend returned an invalid response`,
      parent,
    );
    return;
  }
  if (!locked.ok) {
    show_failure_dialog(
      `Lock failed for app ${appid}`,
      locked.error ?? "the lock was refused",
      parent,
    );
    return;
  }

  if (!apply_auto_update_behavior(appid, EAppAutoUpdateBehavior.Launch)) {
    await perform_unlock(appid);
    report_failure(
      `Lock failed for app ${appid}`,
      `rolled back the lock for ${appid} after the auto-update write failed`,
      parent,
    );
    return;
  }

  watch_app(appid);
  mark_locked(appid);
  report_success(`Locked ${app_name(appid)}`);
}

export async function refresh_app(appid: AppId, parent?: EventTarget): Promise<void> {
  const captured = await capture_build_info_set(appid);
  if (!captured.ok) {
    show_failure_dialog(`Refresh failed for app ${appid}`, captured.error, parent);
    return;
  }

  let refreshed: unknown;
  try {
    refreshed = parse_json(await bridge.refresh_app(appid, captured.dumps));
  } catch (error) {
    report_failure(
      `Refresh failed for app ${appid}`,
      `refresh failed for app ${appid}: ${format_error(error)}`,
      parent,
    );
    return;
  }
  if (!is_ack(refreshed)) {
    report_failure(
      `Refresh failed for app ${appid}`,
      `refresh failed for app ${appid}: the backend returned an invalid response`,
      parent,
    );
    return;
  }
  if (!refreshed.ok) {
    show_failure_dialog(
      `Refresh failed for app ${appid}`,
      refreshed.error ?? "the refresh was refused",
      parent,
    );
    return;
  }
  mark_locked(appid);
  report_success(`Refreshed ${app_name(appid)}`);
}

async function perform_unlock(appid: AppId): Promise<UnlockResult> {
  const result = await unwatch_then_unlock(appid);
  if (result.ok) {
    mark_unlocked(appid);
  }
  return result;
}

export async function unlock_app(appid: AppId, parent?: EventTarget): Promise<void> {
  const result = await perform_unlock(appid);
  if (!result.ok) {
    show_failure_dialog(
      `Unlock failed for app ${appid}`,
      result.error ?? "the unlock was refused",
      parent,
    );
    return;
  }
  if (result.auto_update_restored !== false) {
    report_success(`Unlocked ${app_name(appid)}`);
  }
}
