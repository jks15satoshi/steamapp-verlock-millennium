import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import multiDepotDump from "./fixtures/multi-depot.txt";
import { bridge, installSteamClient, settle } from "./harness";
import { millennium_mock } from "./millennium_mock";

void mock.module("millennium", () => millennium_mock());

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

test("capture_build_info returns the dump that carries the app block", async () => {
  setup([multiDepotDump]);
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.appid).toBe(APPID);
    expect(result.dump).toBe(multiDepotDump);
  }
  expect(commands).toEqual([`app_info_print ${APPID}`]);
});

test("capture_build_info rejects a dump that carries only the command echo", async () => {
  setup([`app_info_print ${APPID}\n`]);
  bridge.reset();
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(false);
  expect(bridge.find("refresh_app")).toHaveLength(0);
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

test("capture_build_info relays an error when the console is unavailable", async () => {
  installSteamClient({ Console: {}, Apps: {}, System: {} });
  bridge.reset();
  const result = await capture_build_info(APPID);
  expect(result.ok).toBe(false);
  const relays = bridge.find("append_log");
  expect(JSON.parse(relays[relays.length - 1]?.payload as string)).toMatchObject({
    level: "error",
  });
});

test("capture_build_info relays an error when the capture times out", async () => {
  setup([]);
  bridge.reset();
  const result = await settle(capture_build_info(APPID), 4000, 20);
  expect(result.ok).toBe(false);
  const relays = bridge.find("append_log");
  expect(JSON.parse(relays[relays.length - 1]?.payload as string)).toMatchObject({
    level: "error",
  });
});

test("capture_then_refresh refreshes the app with the captured dump", async () => {
  setup([multiDepotDump]);
  bridge.reset();
  await settle(capture_then_refresh(APPID), 4000, 20);
  const refreshes = bridge.find("refresh_app");
  expect(refreshes).toHaveLength(1);
  expect(JSON.parse(refreshes[0]?.payload as string)).toEqual({
    appid: APPID,
    dump: multiDepotDump,
  });
});

test("capture_then_refresh does not refresh when the capture fails", async () => {
  setup([]);
  bridge.reset();
  await settle(capture_then_refresh(APPID), 4000, 20);
  expect(bridge.find("refresh_app")).toHaveLength(0);
});
