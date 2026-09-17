import type { ELaunchSource, Unregisterable } from "millennium";
import type { Ack, AppId, RestoreResult, UnlockResult } from "./index";
import * as bridge from "./bridge";
import { as_record_list } from "./locked";
import { log_error, log_warn } from "./log";
import { report_warning } from "./notify";

const BACKSTOP_INTERVAL_MS = 3600000;
const SYNC_RETRY_ATTEMPTS = 5;
const SYNC_RETRY_DELAY_MS = 1000;
const NUMERIC_APPID_PATTERN = /^[0-9]+$/;

const watched = new Set<AppId>();
const app_handles = new Map<AppId, Unregisterable[]>();

let watch_generation = 0;
let globals_registered = false;
let overview_registered = false;
let global_handles: Unregisterable[] = [];
let backstop_started = false;
let backstop_timer: ReturnType<typeof setInterval> | null = null;

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

function is_unregisterable(value: unknown): value is Unregisterable {
  return Boolean(value) && typeof (value as Unregisterable).unregister === "function";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function track(handle: unknown): void {
  if (is_unregisterable(handle)) {
    global_handles.push(handle);
  }
}

async function reapply(appid: AppId): Promise<void> {
  try {
    const result = parse_json(await bridge.reapply_app(appid));
    if (is_ack(result) && !result.ok && result.code === "not_installed") {
      log_warn(`stopped watching app ${appid}: it is no longer installed`);
      unwatch_app(appid);
    }
  } catch (error) {
    log_error(`reapply failed for app ${appid}: ${String(error)}`);
    return;
  }
}

function register_globals(): void {
  if (globals_registered) {
    return;
  }

  const client = SteamClient;
  if (!client) {
    return;
  }

  globals_registered = true;

  const apps = client.Apps;
  if (!overview_registered && typeof apps?.RegisterForAppOverviewChanges === "function") {
    overview_registered = true;
    apps.RegisterForAppOverviewChanges(() => {
      for (const appid of watched) {
        void reapply(appid);
      }
    });
  }

  if (typeof apps?.RegisterForGameActionStart === "function") {
    track(
      apps.RegisterForGameActionStart((game_action_id, appid, action, launch_source) => {
        void handle_game_action_start(game_action_id, appid, action, launch_source);
      }),
    );
  }

  const system = client.System;
  if (typeof system?.RegisterForOnResumeFromSuspend === "function") {
    track(
      system.RegisterForOnResumeFromSuspend(() => {
        void reapply_all();
      }),
    );
  }
}

function reissue_action(
  appid: AppId,
  action: string,
  launch_source: ELaunchSource,
  game_action_id: number,
): void {
  if (action === "UpdateApp") {
    SteamClient.Apps.ContinueGameAction(game_action_id, action);
    return;
  }
  SteamClient.Apps.RunGame(appid, "", 0, launch_source);
}

async function handle_game_action_start(
  game_action_id: number,
  appid: AppId,
  action: string,
  launch_source: ELaunchSource,
): Promise<void> {
  if (!watched.has(appid)) {
    return;
  }

  let cancelled = false;
  try {
    SteamClient.Apps.CancelGameAction(game_action_id);
    cancelled = true;
  } catch {
    cancelled = false;
  }

  if (!cancelled) {
    report_warning(`could not cancel the action for app ${appid}; reapplied and let it proceed`);
  }

  await reapply(appid);

  if (cancelled) {
    reissue_action(appid, action, launch_source, game_action_id);
  }
}

function start_backstop(): void {
  if (backstop_started) {
    return;
  }
  backstop_started = true;
  backstop_timer = setInterval(() => {
    void reapply_all();
  }, BACKSTOP_INTERVAL_MS);
}

async function read_locked_appids(): Promise<AppId[] | null> {
  try {
    const result = parse_json(await bridge.list_locked());
    const records = as_record_list(result);
    if (records === null) {
      return null;
    }
    return records.map((record) => String(record.appid));
  } catch {
    return null;
  }
}

export async function sync_watches(): Promise<void> {
  const generation = watch_generation;
  register_globals();
  start_backstop();

  for (let attempt = 0; attempt < SYNC_RETRY_ATTEMPTS; attempt += 1) {
    const appids = await read_locked_appids();
    if (generation !== watch_generation) {
      return;
    }
    if (appids !== null) {
      for (const appid of appids) {
        watch_app(appid);
      }
      return;
    }
    if (attempt < SYNC_RETRY_ATTEMPTS - 1) {
      await delay(SYNC_RETRY_DELAY_MS);
      if (generation !== watch_generation) {
        return;
      }
    }
  }
  log_warn(`could not load the lock records after ${SYNC_RETRY_ATTEMPTS} attempts`);
}

export function watch_app(appid: AppId): void {
  if (!NUMERIC_APPID_PATTERN.test(appid)) {
    return;
  }

  watched.add(appid);
  register_globals();
  start_backstop();

  if (app_handles.has(appid)) {
    return;
  }

  const handles: Unregisterable[] = [];
  const details = SteamClient?.Apps?.RegisterForAppDetails?.(Number(appid), () => {
    void reapply(appid);
  });
  if (details) {
    handles.push(details);
  }
  app_handles.set(appid, handles);
}

export function unwatch_app(appid: AppId): void {
  const handles = app_handles.get(appid);
  if (handles) {
    for (const handle of handles) {
      handle.unregister();
    }
    app_handles.delete(appid);
  }
  watched.delete(appid);
}

export function unwatch_all(): void {
  watch_generation += 1;
  globals_registered = false;

  for (const handle of global_handles) {
    handle.unregister();
  }
  global_handles = [];

  for (const handles of app_handles.values()) {
    for (const handle of handles) {
      handle.unregister();
    }
  }
  app_handles.clear();
  watched.clear();

  if (backstop_timer !== null) {
    clearInterval(backstop_timer);
    backstop_timer = null;
  }
  backstop_started = false;
}

export async function reapply_all(): Promise<void> {
  const generation = watch_generation;
  await sync_watches();
  if (generation !== watch_generation) {
    return;
  }
  await Promise.all([...watched].map((appid) => reapply(appid)));
}

export function read_auto_update_behavior(appid: AppId): number | undefined {
  try {
    const id = Number(appid);
    const details_store = window.appDetailsStore;
    const details = details_store?.GetAppDetails?.(id) ?? details_store?.GetAppData?.(id)?.details;
    const value = details?.eAutoUpdateValue;
    if (typeof value === "number") {
      return value;
    }
    const overview = window.appStore?.GetAppOverviewByAppID?.(id) as
      | { eAutoUpdateValue?: unknown }
      | null
      | undefined;
    const fallback = overview?.eAutoUpdateValue;
    return typeof fallback === "number" ? fallback : undefined;
  } catch {
    return undefined;
  }
}

export function apply_auto_update_behavior(appid: AppId, behavior: number): boolean {
  try {
    SteamClient.Apps.SetAppAutoUpdateBehavior(Number(appid), behavior);
    return true;
  } catch {
    return false;
  }
}

function restore_behaviors(entries: { appid: AppId; behavior: number }[] | undefined): AppId[] {
  const failed: AppId[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!apply_auto_update_behavior(entry.appid, entry.behavior)) {
      report_warning(`could not restore the auto-update setting for app ${entry.appid}`);
      failed.push(entry.appid);
    }
  }
  return failed;
}

export async function unwatch_then_unlock(appid: AppId): Promise<UnlockResult> {
  unwatch_app(appid);
  let result: unknown;
  try {
    result = parse_json(await bridge.unlock_app(appid));
  } catch (error) {
    log_error(`unlock failed for app ${appid}: ${String(error)}`);
    watch_app(appid);
    return { ok: false, error: "unlock failed" };
  }
  if (!is_ack(result) || !result.ok) {
    watch_app(appid);
    if (!is_ack(result)) {
      log_error(`unlock failed for app ${appid}: the backend returned an invalid response`);
    }
    return is_ack(result) ? (result as UnlockResult) : { ok: false, error: "unlock failed" };
  }
  const unlock = result as UnlockResult;
  if (typeof unlock.auto_update_behavior === "number") {
    unlock.auto_update_restored = apply_auto_update_behavior(appid, unlock.auto_update_behavior);
    if (!unlock.auto_update_restored) {
      report_warning(`could not restore the auto-update setting for app ${appid}`);
    }
  } else {
    unlock.auto_update_restored = true;
  }
  return unlock;
}

export async function unwatch_all_then_restore(appids: AppId[]): Promise<RestoreResult> {
  unwatch_all();
  let result: unknown;
  try {
    result = parse_json(await bridge.restore_all());
  } catch (error) {
    log_error(`restore all failed: ${String(error)}`);
    for (const appid of appids) {
      watch_app(appid);
    }
    return { ok: false, error: "restore all failed", restored: 0, failed: [] };
  }
  if (!is_ack(result) || !result.ok) {
    for (const appid of appids) {
      watch_app(appid);
    }
    if (!is_ack(result)) {
      log_error("restore all failed: the backend returned an invalid response");
    }
    return is_ack(result)
      ? (result as RestoreResult)
      : { ok: false, error: "restore all failed", restored: 0, failed: [] };
  }
  const restore = result as RestoreResult;
  const failed = Array.isArray(restore.failed) ? restore.failed : [];
  for (const appid of failed.map((value) => String(value))) {
    watch_app(appid);
  }
  restore.auto_update_failed = restore_behaviors(restore.auto_update);
  return restore;
}
