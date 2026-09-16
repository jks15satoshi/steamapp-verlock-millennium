import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { log_error, log_info, log_warn } from "../log";
import {
  bridge as recorder,
  flush,
  installSteamClient,
  resetBackendResponses,
  setBackendResponse,
} from "./harness";

beforeEach(() => {
  recorder.reset();
  resetBackendResponses();
  installSteamClient({ Console: {}, Apps: {}, System: {} });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("log_info writes the console line and relays an info record", async () => {
  log_info("hello");
  expect(console.log).toHaveBeenCalledWith("[steamapp-verlock] hello");
  const calls = recorder.find("append_log");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({ level: "info", message: "hello" });
  await flush();
});

test("log_warn writes the console line and relays a warn record", async () => {
  log_warn("careful");
  expect(console.warn).toHaveBeenCalledWith("[steamapp-verlock] careful");
  const calls = recorder.find("append_log");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({ level: "warn", message: "careful" });
  await flush();
});

test("log_error writes the console line and relays an error record", async () => {
  log_error("bad");
  expect(console.error).toHaveBeenCalledWith("[steamapp-verlock] bad");
  const calls = recorder.find("append_log");
  expect(calls).toHaveLength(1);
  expect(typeof calls[0]?.payload).toBe("string");
  expect(JSON.parse(calls[0]?.payload as string)).toEqual({ level: "error", message: "bad" });
  await flush();
});

test("a rejected relay is swallowed and the console line still appears", async () => {
  setBackendResponse("append_log", Promise.reject(new Error("relay failed")));
  log_error("boom");
  expect(console.error).toHaveBeenCalledWith("[steamapp-verlock] boom");
  const calls = recorder.find("append_log");
  expect(calls).toHaveLength(1);
  await flush();
});
