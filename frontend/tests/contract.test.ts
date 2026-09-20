import { beforeEach, expect, test } from "bun:test";
import type * as Plugin from "../index";
import type {
  Ack,
  AppId,
  CaptureResult,
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
} from "../index";
import * as wire from "../bridge";
import english from "../locales/english.json";
import schinese from "../locales/schinese.json";
import { bridge as recorder, installSteamClient, resetBackendResponses } from "./harness";

interface FrontendToBackend {
  lock_app(
    appid: AppId,
    dumps: Record<AppId, string>,
    auto_update_behavior?: number,
  ): Promise<LockResult>;
  refresh_app(appid: AppId, dumps: Record<AppId, string>): Promise<RefreshResult>;
  get_required_apps(appid: AppId, dump: string): Promise<RequiredAppsResult>;
  unlock_app(appid: AppId): Promise<UnlockResult>;
  list_locked(): Promise<LockedAppRecord[] | Ack>;
  restore_all(): Promise<RestoreResult>;
  get_data_root(): Promise<DataRoots>;
  get_paths(appid: AppId): Promise<PathsResult>;
  read_file(appid: AppId, target: "appmanifest" | "lock"): Promise<FileContentResult>;
  set_data_root(path: string): Promise<MigrateResult>;
  reapply_app(appid: AppId): Promise<Ack>;
  append_log(level: string, message: string): Promise<Ack>;
  get_clock_format(): Promise<Ack & { is_24h?: boolean }>;
}

interface BackendToFrontend {
  request_build_info: typeof Plugin.request_build_info;
}

const FRONTEND_TO_BACKEND_METHODS = [
  "lock_app",
  "refresh_app",
  "get_required_apps",
  "unlock_app",
  "list_locked",
  "restore_all",
  "get_data_root",
  "get_paths",
  "read_file",
  "set_data_root",
  "reapply_app",
  "append_log",
  "get_clock_format",
] as const;

const BACKEND_TO_FRONTEND_METHODS = ["request_build_info"] as const;

const backendToFrontend: BackendToFrontend = {
  request_build_info: (_appid: AppId): void => {},
};

const lockRecord: LockedAppRecord = {
  version: 1,
  appid: "730",
  name: "Counter-Strike 2",
  manifest_path: "/steam/steamapps/appmanifest_730.acf",
  locked_at: 1726000000,
  refreshed_at: 1726003600,
  auto_update_behavior: 0,
  locked_build: { buildid: "22222222", depots: { "730": "2222222222222222222" } },
  original: "appmanifest text",
};

const captureSuccess: CaptureResult = { ok: true, appid: "730", dump: "app_info_print 730" };
const captureFailure: CaptureResult = { ok: false, error: "non-numeric appid" };

beforeEach(() => {
  recorder.reset();
  resetBackendResponses();
  installSteamClient({ Console: {}, Apps: {}, System: {} });
});

test("the frontend-to-backend bridge exposes the thirteen documented methods", () => {
  expect(FRONTEND_TO_BACKEND_METHODS).toHaveLength(13);
  expect(new Set(FRONTEND_TO_BACKEND_METHODS).size).toBe(13);
  for (const method of FRONTEND_TO_BACKEND_METHODS) {
    expect(typeof wire[method]).toBe("function");
  }
});

test("the bridge implementation matches the shared-type signatures", () => {
  const contract: FrontendToBackend = wire;
  expect(typeof contract.lock_app).toBe("function");
  expect(typeof contract.refresh_app).toBe("function");
  expect(typeof contract.get_required_apps).toBe("function");
});

test("list_locked's union result accepts both records and the Ack error envelope", () => {
  const as_records: Awaited<ReturnType<typeof wire.list_locked>> = [lockRecord];
  const as_error: Awaited<ReturnType<typeof wire.list_locked>> = {
    ok: false,
    error: "migration in progress",
  };
  expect(Array.isArray(as_records)).toBe(true);
  expect(as_error).toEqual({ ok: false, error: "migration in progress" });
});

test("the backend-to-frontend bridge exposes request_build_info", () => {
  expect(BACKEND_TO_FRONTEND_METHODS).toEqual(["request_build_info"]);
  expect(typeof backendToFrontend.request_build_info).toBe("function");
});

test("the shared payload and response shapes match the bridge contract", () => {
  expect(lockRecord.version).toBe(1);
  expect(lockRecord.refreshed_at).toBe(1726003600);
  expect(lockRecord.auto_update_behavior).toBe(0);
  expect(lockRecord.locked_build).toEqual({
    buildid: "22222222",
    depots: { "730": "2222222222222222222" },
  });
  expect(captureSuccess).toEqual({ ok: true, appid: "730", dump: "app_info_print 730" });
  expect(captureFailure).toEqual({ ok: false, error: "non-numeric appid" });
});

test("set_data_root sends one JSON string argument with the path payload", async () => {
  await wire.set_data_root("/tmp/verlock");
  const calls = recorder.find("set_data_root");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({ path: "/tmp/verlock" });
});

test("appid payload methods send one JSON string argument", async () => {
  const dumps = { "730": "dump text" };
  await wire.lock_app("730", dumps);
  await wire.refresh_app("730", dumps);
  await wire.unlock_app("730");
  await wire.reapply_app("730");
  await wire.get_paths("730");
  await wire.get_required_apps("730", "dump text");
  const expected: Record<string, unknown> = {
    lock_app: { appid: "730", dumps },
    refresh_app: { appid: "730", dumps },
    unlock_app: { appid: "730" },
    reapply_app: { appid: "730" },
    get_paths: { appid: "730" },
    get_required_apps: { appid: "730", dump: "dump text" },
  };
  for (const method of [
    "lock_app",
    "refresh_app",
    "unlock_app",
    "reapply_app",
    "get_paths",
    "get_required_apps",
  ] as const) {
    const calls = recorder.find(method);
    expect(calls).toHaveLength(1);
    expect(typeof calls[0]?.payload).toBe("string");
    expect(JSON.parse(calls[0]?.payload as string)).toEqual(expected[method]);
  }
});

test("lock_app includes the auto update behavior when it is provided", async () => {
  await wire.lock_app("730", { "730": "dump text" }, 1);
  const calls = recorder.find("lock_app");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({
    appid: "730",
    dumps: { "730": "dump text" },
    auto_update_behavior: 1,
  });
});

test("read_file sends one JSON string argument with the appid and target", async () => {
  await wire.read_file("730", "appmanifest");
  const calls = recorder.find("read_file");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({
    appid: "730",
    target: "appmanifest",
  });
});

test("append_log sends one JSON string argument with the level and message", async () => {
  await wire.append_log("info", "hello");
  const calls = recorder.find("append_log");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({ level: "info", message: "hello" });
});

const ERROR_CODES = [
  "invalid_appid",
  "invalid_behavior",
  "invalid_target",
  "build_info_required",
  "dump_parse_failed",
  "dump_validation_failed",
  "already_locked",
  "not_locked",
  "not_installed",
  "not_fully_installed",
  "cannot_read_manifest",
  "cannot_parse_manifest",
  "manifest_write_failed",
  "record_persist_failed",
  "record_read_failed",
  "operation_in_progress",
  "record_removed",
  "restore_in_progress",
  "data_root_required",
  "data_root_invalid",
  "default_data_root_unavailable",
  "migration_in_progress",
  "migration_failed",
  "unknown_method",
  "read_failed",
  "steam_path_unavailable",
  "console_unavailable",
  "capture_timeout",
  "invalid_response",
  "unlock_failed",
  "restore_all_failed",
  "unknown",
] as const;

test("the catalogs carry an identical key set", () => {
  expect(Object.keys(english).toSorted()).toEqual(Object.keys(schinese).toSorted());
});

test("every error code has an error.<code> catalog key and no key is orphaned", () => {
  const expected = new Set(ERROR_CODES.map((code) => `error.${code}`));
  const present = new Set(Object.keys(english).filter((key) => key.startsWith("error.")));
  expect(present).toEqual(expected);
  for (const code of ERROR_CODES) {
    expect(english[`error.${code}` as keyof typeof english]).toBeString();
    expect(schinese[`error.${code}` as keyof typeof schinese]).toBeString();
  }
});

test("zero-argument methods send no arguments", async () => {
  await wire.list_locked();
  await wire.restore_all();
  await wire.get_data_root();
  await wire.get_clock_format();
  for (const method of [
    "list_locked",
    "restore_all",
    "get_data_root",
    "get_clock_format",
  ] as const) {
    const calls = recorder.find(method);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toBeUndefined();
  }
});
