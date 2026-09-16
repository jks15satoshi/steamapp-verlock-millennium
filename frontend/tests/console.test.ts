import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import betaBranchDump from "./fixtures/beta-branch.txt";
import emptyDump from "./fixtures/empty.txt";
import multiDepotDump from "./fixtures/multi-depot.txt";
import staleFirstDump from "./fixtures/stale-first.txt";
import { bridge, installSteamClient, Millennium, settle, sleep } from "./harness";

void mock.module("millennium", () => ({ Millennium, sleep }));

const { capture_build_info, capture_then_refresh } = await import("../console");

const APPID = "730";

type Spew = { spew: string; spew_type: string };
type SpewCallback = (output: Spew) => void;

interface ConsoleFake {
  ExecCommand(command: string): void;
  RegisterForSpewOutput(callback: SpewCallback): { unregister(): void };
}

interface ConsoleHarness {
  consoleFake: ConsoleFake;
  commands: string[];
}

function createConsole(dumps: string[]): ConsoleHarness {
  const subscribers = new Set<SpewCallback>();
  const commands: string[] = [];
  let sampleIndex = 0;
  const consoleFake: ConsoleFake = {
    ExecCommand(command: string): void {
      commands.push(command);
      if (!command.startsWith("app_info_print")) {
        return;
      }
      const dump = dumps[Math.min(sampleIndex, dumps.length - 1)] ?? "";
      sampleIndex += 1;
      for (const callback of subscribers) {
        callback({ spew: dump, spew_type: "info" });
      }
    },
    RegisterForSpewOutput(callback: SpewCallback) {
      subscribers.add(callback);
      return {
        unregister(): void {
          subscribers.delete(callback);
        },
      };
    },
  };
  return { consoleFake, commands };
}

let commands: string[] = [];

function setup(dumps: string[]): void {
  const harness = createConsole(dumps);
  commands = harness.commands;
  installSteamClient({ Console: harness.consoleFake, Apps: {}, System: {} });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
});

afterEach(() => {
  jest.useRealTimers();
});

test("capture_build_info accepts the first dump that differs from the stale baseline", async () => {
  setup([staleFirstDump, multiDepotDump]);
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.appid).toBe(APPID);
    expect(result.dump).toBe(multiDepotDump);
  }
  expect(commands[0]).toBe("app_info_update 1");
  expect(commands).toContain(`app_info_print ${APPID}`);
});

test("capture_build_info falls back to the most recent dump when the time limit expires", async () => {
  setup([staleFirstDump]);
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.dump).toBe(staleFirstDump);
  }
});

test("capture_build_info keeps sampling past an empty dump", async () => {
  setup([emptyDump, betaBranchDump]);
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.dump).toBe(betaBranchDump);
  }
});

test("capture_build_info rejects a non-numeric appid without running a command", async () => {
  setup([]);
  let ok = true;
  try {
    const result = await capture_build_info("12ab");
    ok = result.ok;
  } catch {
    ok = false;
  }
  expect(ok).toBe(false);
  expect(commands).toEqual([]);
});

test("capture_build_info treats an empty first dump as neither baseline nor candidate", async () => {
  setup([emptyDump, staleFirstDump, multiDepotDump]);
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.dump).toBe(multiDepotDump);
  }
});

test("capture_then_refresh stores the dump and then refreshes the app", async () => {
  setup([staleFirstDump, multiDepotDump]);
  bridge.reset();
  await settle(capture_then_refresh(APPID), 4000, 20);
  const methods = bridge.calls.map((call) => call.method);
  expect(methods).toContain("set_build_info");
  expect(methods).toContain("refresh_app");
  expect(methods.indexOf("set_build_info")).toBeLessThan(methods.indexOf("refresh_app"));
});

test("capture_then_refresh does not refresh when the capture fails", async () => {
  setup([]);
  bridge.reset();
  await settle(capture_then_refresh(APPID), 4000, 20);
  expect(bridge.find("refresh_app")).toHaveLength(0);
});
