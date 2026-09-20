import type { AppId, LockedAppRecord } from "./index";
import * as bridge from "./bridge";

const LOCKED_CACHE_TTL_MS = 1000;

let locked_ids = new Set<AppId>();
let loaded_at = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

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

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function as_record_list(value: unknown): LockedAppRecord[] | null {
  if (Array.isArray(value)) {
    return value as LockedAppRecord[];
  }
  if (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("ok" in (value as Record<string, unknown>)) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return [];
  }
  return null;
}

export function is_locked(appid: AppId): boolean {
  return locked_ids.has(appid);
}

export function subscribe_locked(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sync_locked_ids(records: unknown): void {
  const list = as_record_list(records);
  if (list === null) {
    return;
  }
  locked_ids = new Set(list.map((record) => record.appid));
  loaded_at = Date.now();
  notify();
}

export async function refresh_locked_ids(force = false): Promise<void> {
  const now = Date.now();
  if (!force && loaded_at !== 0 && now - loaded_at < LOCKED_CACHE_TTL_MS) {
    return;
  }
  if (pending) {
    return pending;
  }

  pending = (async () => {
    try {
      const result = parse_json(await bridge.list_locked());
      sync_locked_ids(result);
    } catch {
      return;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function mark_locked(appid: AppId): void {
  locked_ids.add(appid);
  loaded_at = Date.now();
  notify();
}

export function mark_unlocked(appid: AppId): void {
  locked_ids.delete(appid);
  loaded_at = Date.now();
  notify();
}
