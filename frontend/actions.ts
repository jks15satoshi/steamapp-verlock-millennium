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
import { log_error, log_warn } from "./log";

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
    return;
  }

  const auto_update_behavior = read_auto_update_behavior(appid);
  if (auto_update_behavior === undefined) {
    log_warn(`aborted the lock for app ${appid}: the auto-update behavior was unreadable`);
    return;
  }

  let locked: unknown;
  try {
    locked = parse_json(await bridge.lock_app(appid, auto_update_behavior));
  } catch (error) {
    log_error(`lock failed for app ${appid}: ${String(error)}`);
    return;
  }
  if (!is_ack(locked)) {
    log_error(`lock failed for app ${appid}: the backend returned an invalid response`);
    return;
  }
  if (!locked.ok) {
    return;
  }

  if (!apply_auto_update_behavior(appid, EAppAutoUpdateBehavior.Launch)) {
    await unlock_app(appid);
    log_warn(`rolled back the lock for ${appid} after the auto-update write failed`);
    return;
  }

  watch_app(appid);
  mark_locked(appid);
}

export async function refresh_app(appid: AppId): Promise<void> {
  const captured = await capture_build_info(appid);
  if (!captured.ok) {
    return;
  }

  try {
    await bridge.refresh_app(appid);
  } catch (error) {
    log_error(`refresh failed for app ${appid}: ${String(error)}`);
    return;
  }
}

export async function unlock_app(appid: AppId): Promise<void> {
  const result = await unwatch_then_unlock(appid);
  if (result.ok) {
    mark_unlocked(appid);
  }
}
