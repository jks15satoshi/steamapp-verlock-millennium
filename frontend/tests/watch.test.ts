import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, mock, test } from "bun:test";
import {
  appIdsFor,
  bridge,
  flush,
  installSteamClient,
  pump,
  resetBackendResponses,
  setBackendResponse,
  settle,
} from "./harness";
import { millennium_mock } from "./millennium_mock";

void mock.module("millennium", () => millennium_mock());

void mock.module("react/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
}));

void mock.module("react", () => ({
  useEffect: () => {},
  useState: (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    () => {},
  ],
}));

const {
  app_name,
  apply_auto_update_behavior,
  read_auto_update_behavior,
  reapply_all,
  unwatch_all,
  unwatch_all_then_restore,
  unwatch_app,
  unwatch_then_unlock,
  watch_app,
} = await import("../watch");

const APPID = "730";
const FAILED_APPID = "999";

type Callback = (...args: unknown[]) => void;

interface AppsHarness {
  apps: Record<string, unknown>;
  appDetails: Map<string, Set<Callback>>;
  overviewChanges: Set<Callback>;
  gameActions: Set<Callback>;
  activeActions: Set<number>;
  canceled: number[];
  runGameCalls: { appid: string; launchOptions: string; param2: number; launchSource: unknown }[];
  continueCalls: { gameActionId: number; actionType: string }[];
  behaviors: { appid: string; mode: number }[];
  reset(): void;
  setCancelFails(value: boolean): void;
  setBehaviorFails(value: boolean): void;
  setRunGameReenters(value: boolean): void;
}

function removeFrom(callbacks: Set<Callback>, callback: Callback): { unregister(): void } {
  return {
    unregister: (): void => {
      callbacks.delete(callback);
    },
  };
}

function createApps(): AppsHarness {
  const appDetails = new Map<string, Set<Callback>>();
  const overviewChanges = new Set<Callback>();
  const gameActions = new Set<Callback>();
  const activeActions = new Set<number>();
  const canceled: number[] = [];
  const runGameCalls: {
    appid: string;
    launchOptions: string;
    param2: number;
    launchSource: unknown;
  }[] = [];
  const continueCalls: { gameActionId: number; actionType: string }[] = [];
  const behaviors: { appid: string; mode: number }[] = [];
  let cancelFails = false;
  let behaviorFails = false;
  let runGameReenters = false;
  let nextActionId = 1000;
  const apps = {
    RegisterForAppDetails(appid: number | string, callback: Callback): { unregister(): void } {
      const key = String(appid);
      const callbacks = appDetails.get(key) ?? new Set<Callback>();
      callbacks.add(callback);
      appDetails.set(key, callbacks);
      return removeFrom(callbacks, callback);
    },
    RegisterForAppOverviewChanges(callback: Callback): void {
      overviewChanges.add(callback);
    },
    RegisterForGameActionStart(callback: Callback): { unregister(): void } {
      gameActions.add(callback);
      return removeFrom(gameActions, callback);
    },
    GetActiveGameActions(): Promise<Array<{ nGameActionID: number }>> {
      return Promise.resolve([...activeActions].map((id) => ({ nGameActionID: id })));
    },
    CancelGameAction(gameActionId: number): void {
      if (cancelFails) {
        throw new Error("cancel failed");
      }
      activeActions.delete(gameActionId);
      canceled.push(gameActionId);
    },
    RunGame(appid: string, launchOptions: string, param2: number, launchSource: unknown): void {
      runGameCalls.push({ appid, launchOptions, param2, launchSource });
      if (runGameReenters) {
        const gameActionId = nextActionId;
        nextActionId += 1;
        activeActions.add(gameActionId);
        for (const callback of gameActions) {
          callback(gameActionId, appid, "LaunchApp", launchSource);
        }
      }
    },
    ContinueGameAction(gameActionId: number, actionType: string): void {
      continueCalls.push({ gameActionId, actionType });
    },
    SetAppAutoUpdateBehavior(appid: number | string, mode: number): void {
      if (behaviorFails) {
        throw new Error("behavior failed");
      }
      behaviors.push({ appid: String(appid), mode });
    },
  };
  return {
    apps,
    appDetails,
    overviewChanges,
    gameActions,
    activeActions,
    canceled,
    runGameCalls,
    continueCalls,
    behaviors,
    reset(): void {
      canceled.length = 0;
      runGameCalls.length = 0;
      continueCalls.length = 0;
      activeActions.clear();
      behaviors.length = 0;
    },
    setCancelFails(value: boolean): void {
      cancelFails = value;
    },
    setBehaviorFails(value: boolean): void {
      behaviorFails = value;
    },
    setRunGameReenters(value: boolean): void {
      runGameReenters = value;
    },
  };
}

interface SystemHarness {
  system: Record<string, unknown>;
  resume: Set<Callback>;
}

function createSystem(): SystemHarness {
  const resume = new Set<Callback>();
  const system = {
    RegisterForOnResumeFromSuspend(callback: Callback): { unregister(): void } {
      resume.add(callback);
      return {
        unregister: (): void => {
          resume.delete(callback);
        },
      };
    },
  };
  return { system, resume };
}

const apps = createApps();
const system = createSystem();

const spewSubscribers = new Set<(output: { spew: string; spew_type: string }) => void>();

function install_console(dump: string): void {
  installSteamClient({
    Console: {
      ExecCommand(command: string): void {
        if (!command.startsWith("app_info_print")) {
          return;
        }
        for (const callback of spewSubscribers) {
          callback({ spew: dump, spew_type: "info" });
        }
      },
      RegisterForSpewOutput(callback: (output: { spew: string; spew_type: string }) => void): {
        unregister(): void;
      } {
        spewSubscribers.add(callback);
        return {
          unregister(): void {
            spewSubscribers.delete(callback);
          },
        };
      },
    },
    Apps: apps.apps,
    System: system.system,
  });
}

installSteamClient({ Console: {}, Apps: apps.apps, System: system.system });

function fireAppDetails(appid: string): void {
  for (const callback of apps.appDetails.get(appid) ?? []) {
    callback({});
  }
}

function isWatching(appid: string): boolean {
  return (apps.appDetails.get(appid)?.size ?? 0) > 0;
}

function fireGameAction(
  gameActionId: number,
  appid: string,
  action: string,
  launchSource: unknown,
): void {
  apps.activeActions.add(gameActionId);
  for (const callback of apps.gameActions) {
    callback(gameActionId, appid, action, launchSource);
  }
}

function fireOverview(): void {
  for (const callback of apps.overviewChanges) {
    callback();
  }
}

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.setSystemTime(0);
  apps.reset();
  apps.setCancelFails(false);
  apps.setBehaviorFails(false);
  unwatch_all();
  bridge.reset();
  resetBackendResponses();
});

afterEach(() => {
  unwatch_app(APPID);
  unwatch_app(FAILED_APPID);
});

test("watch_app registers the app callbacks and re-applies on change", async () => {
  watch_app(APPID);
  await flush();
  expect(apps.appDetails.has(APPID)).toBe(true);
  bridge.reset();
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
});

test("unwatch_app releases the app callbacks", async () => {
  watch_app(APPID);
  await flush();
  unwatch_app(APPID);
  bridge.reset();
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).not.toContain(APPID);
});

test("the game action handler lets a launch action proceed after a reapply", async () => {
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireGameAction(42, APPID, "LaunchApp", 1000);
  await pump(100, 20);
  expect(apps.canceled).toHaveLength(0);
  expect(apps.runGameCalls).toHaveLength(0);
  expect(apps.continueCalls).toHaveLength(0);
  expect(appIdsFor("reapply_app")).toContain(APPID);
});

test("the game action handler re-applies and lets an update proceed when cancel fails", async () => {
  apps.setCancelFails(true);
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireGameAction(43, APPID, "UpdateApp", 1000);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
  expect(apps.runGameCalls).toHaveLength(0);
  expect(apps.continueCalls).toHaveLength(0);
});

test("the game action handler cancels an update action and relaunches through RunGame", async () => {
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireGameAction(44, APPID, "UpdateApp", 1000);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
  expect(apps.canceled).toContain(44);
  expect(apps.runGameCalls).toEqual([
    { appid: APPID, launchOptions: "", param2: 0, launchSource: 1000 },
  ]);
  expect(apps.continueCalls).toHaveLength(0);
});

test("the update interception does not re-cancel the launch it re-issues", async () => {
  apps.setRunGameReenters(true);
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireGameAction(45, APPID, "UpdateApp", 1000);
  await pump(100, 20);
  apps.setRunGameReenters(false);
  expect(apps.canceled).toEqual([45]);
  expect(apps.runGameCalls).toHaveLength(1);
});

test("the backstop timer refreshes a watched app", async () => {
  install_console('"730"\n{\n"depots"\n{\n}\n}');
  watch_app(APPID);
  await flush();
  bridge.reset();
  await pump(3_700_000, 60_000);
  expect(appIdsFor("refresh_app")).toContain(APPID);
});

test("unwatch_app stops the backstop for that app", async () => {
  install_console('"730"\n{\n"depots"\n{\n}\n}');
  watch_app(APPID);
  await flush();
  unwatch_app(APPID);
  bridge.reset();
  await pump(3_700_000, 60_000);
  expect(appIdsFor("refresh_app")).not.toContain(APPID);
});

test("a prior overview callback stays inert after unwatch_all and re-watch", async () => {
  watch_app(APPID);
  await flush();
  unwatch_all();
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireOverview();
  await pump(100, 20);
  const reapplies = appIdsFor("reapply_app").filter((appid) => appid === APPID);
  expect(reapplies).toHaveLength(1);
});

test("reapply_all re-watches persisted locks after a restart", async () => {
  setBackendResponse("list_locked", [{ appid: APPID, name: "Game" }]);
  await reapply_all();
  await flush();
  expect(apps.appDetails.has(APPID)).toBe(true);
  bridge.reset();
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
});

test("sync_watches retries list_locked and watches the persisted app once it succeeds", async () => {
  let attempts = 0;
  setBackendResponse("list_locked", () => {
    attempts += 1;
    return attempts === 1 ? "not-an-array" : [{ appid: APPID, name: "Game" }];
  });
  await settle(reapply_all(), 5000, 20);
  expect(attempts).toBeGreaterThan(1);
  expect(apps.appDetails.has(APPID)).toBe(true);
  bridge.reset();
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
});

test("sync_watches treats an empty object record set as an empty list without retrying", async () => {
  setBackendResponse("list_locked", {});
  await settle(reapply_all(), 5000, 20);
  expect(bridge.find("list_locked")).toHaveLength(1);
  expect(isWatching(APPID)).toBe(false);
});

test("sync_watches still retries an error envelope", async () => {
  setBackendResponse("list_locked", { ok: false, error: "migration in progress" });
  await settle(reapply_all(), 6000, 20);
  expect(bridge.find("list_locked").length).toBeGreaterThan(1);
});

test("a not_installed reapply result unwatches the app", async () => {
  setBackendResponse("reapply_app", { ok: false, code: "not_installed", error: "app is gone" });
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
  const relays = bridge.find("append_log");
  expect(JSON.parse(relays[relays.length - 1]?.payload as string)).toMatchObject({
    level: "warn",
  });
  bridge.reset();
  fireAppDetails(APPID);
  fireOverview();
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).not.toContain(APPID);
});

test("a transient reapply error keeps the app watched", async () => {
  setBackendResponse("reapply_app", { ok: false, error: "temporary failure" });
  watch_app(APPID);
  await flush();
  bridge.reset();
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
  bridge.reset();
  setBackendResponse("reapply_app", { ok: true });
  fireAppDetails(APPID);
  await pump(100, 20);
  expect(appIdsFor("reapply_app")).toContain(APPID);
});

test("read_auto_update_behavior reads eAutoUpdateValue from the app details store", () => {
  const globals = globalThis as Record<string, unknown>;
  globals.window = {
    appDetailsStore: { GetAppDetails: () => ({ eAutoUpdateValue: 2 }) },
  };
  expect(read_auto_update_behavior(APPID)).toBe(2);

  globals.window = {
    appDetailsStore: { GetAppData: () => ({ details: { eAutoUpdateValue: 1 } }) },
  };
  expect(read_auto_update_behavior(APPID)).toBe(1);

  globals.window = {
    appStore: { GetAppOverviewByAppID: () => ({ eAutoUpdateValue: 2 }) },
  };
  expect(read_auto_update_behavior(APPID)).toBe(2);

  globals.window = {
    appDetailsStore: { GetAppDetails: () => ({}) },
    appStore: { GetAppOverviewByAppID: () => ({}) },
  };
  expect(read_auto_update_behavior(APPID)).toBeUndefined();

  globals.window = undefined;
  expect(read_auto_update_behavior(APPID)).toBeUndefined();
});

test("app_name prefers the app store, then the fallback, then the app id", () => {
  const globals = globalThis as Record<string, unknown>;
  globals.window = {
    appStore: { GetAppOverviewByAppID: () => ({ display_name: "Counter-Strike 2" }) },
  };
  expect(app_name(APPID)).toBe("Counter-Strike 2");
  expect(app_name(APPID, "Fallback")).toBe("Counter-Strike 2");

  globals.window = { appStore: { GetAppOverviewByAppID: () => ({}) } };
  expect(app_name(APPID, "Fallback")).toBe("Fallback");
  expect(app_name(APPID)).toBe(`app ${APPID}`);

  globals.window = { appStore: { GetAppOverviewByAppID: () => ({ display_name: "   " }) } };
  expect(app_name(APPID, "Fallback")).toBe("Fallback");

  globals.window = undefined;
  expect(app_name(APPID)).toBe(`app ${APPID}`);
});

test("apply_auto_update_behavior writes the behavior and reports failure", () => {
  expect(apply_auto_update_behavior(APPID, 1)).toBe(true);
  expect(apps.behaviors).toContainEqual({ appid: APPID, mode: 1 });
  apps.setBehaviorFails(true);
  expect(apply_auto_update_behavior(APPID, 1)).toBe(false);
  apps.setBehaviorFails(false);
});

test("unwatch_then_unlock stops watching before it unlocks and restores the behavior", async () => {
  watch_app(APPID);
  await flush();
  let unwatched_before_call = false;
  setBackendResponse("unlock_app", () => {
    unwatched_before_call = !isWatching(APPID);
    return { ok: true, auto_update_behavior: 0 };
  });
  const result = await unwatch_then_unlock(APPID);
  expect(unwatched_before_call).toBe(true);
  expect(result.ok).toBe(true);
  expect(isWatching(APPID)).toBe(false);
  expect(apps.behaviors).toContainEqual({ appid: APPID, mode: 0 });
});

test("unwatch_then_unlock re-watches the app when unlock fails", async () => {
  watch_app(APPID);
  await flush();
  setBackendResponse("unlock_app", { ok: false, error: "locked" });
  const result = await unwatch_then_unlock(APPID);
  expect(result.ok).toBe(false);
  expect(isWatching(APPID)).toBe(true);
});

test("unwatch_then_unlock reports a failed auto-update restore", async () => {
  watch_app(APPID);
  await flush();
  apps.setBehaviorFails(true);
  setBackendResponse("unlock_app", { ok: true, auto_update_behavior: 0 });
  const result = await unwatch_then_unlock(APPID);
  expect(result.ok).toBe(true);
  expect(result.auto_update_restored).toBe(false);
  const relays = bridge.find("append_log");
  expect(JSON.parse(relays[relays.length - 1]?.payload as string)).toMatchObject({
    level: "warn",
  });
});

test("unwatch_then_unlock reports success when the record has no behavior", async () => {
  watch_app(APPID);
  await flush();
  setBackendResponse("unlock_app", { ok: true });
  const result = await unwatch_then_unlock(APPID);
  expect(result.ok).toBe(true);
  expect(result.auto_update_restored).toBe(true);
});

test("unwatch_all_then_restore re-watches only the failed records and restores behaviors", async () => {
  watch_app(APPID);
  watch_app(FAILED_APPID);
  await flush();
  setBackendResponse("restore_all", {
    ok: true,
    restored: 1,
    failed: [FAILED_APPID],
    auto_update: [{ appid: APPID, behavior: 1 }],
  });
  const result = await unwatch_all_then_restore([APPID, FAILED_APPID]);
  expect(result.ok).toBe(true);
  expect(isWatching(APPID)).toBe(false);
  expect(isWatching(FAILED_APPID)).toBe(true);
  expect(apps.behaviors).toContainEqual({ appid: APPID, mode: 1 });
});

test("unwatch_all_then_restore re-watches every record when restore all fails", async () => {
  watch_app(APPID);
  await flush();
  setBackendResponse("restore_all", { ok: false, error: "boom" });
  const result = await unwatch_all_then_restore([APPID]);
  expect(result.ok).toBe(false);
  expect(isWatching(APPID)).toBe(true);
});

test("unwatch_all_then_restore records failed auto-update restores", async () => {
  watch_app(APPID);
  await flush();
  apps.setBehaviorFails(true);
  setBackendResponse("restore_all", {
    ok: true,
    restored: 1,
    failed: [],
    auto_update: [{ appid: APPID, behavior: 1 }],
  });
  const result = await unwatch_all_then_restore([APPID]);
  expect(result.ok).toBe(true);
  expect(result.auto_update_failed).toContain(APPID);
});

test("unwatch_all_then_restore tolerates empty failed and auto_update collections", async () => {
  watch_app(APPID);
  await flush();
  setBackendResponse("restore_all", {
    ok: true,
    restored: 0,
    failed: {},
    auto_update: {},
  });
  const result = await unwatch_all_then_restore([APPID]);
  expect(result.ok).toBe(true);
  expect(result.restored).toBe(0);
  expect(isWatching(APPID)).toBe(false);
});
