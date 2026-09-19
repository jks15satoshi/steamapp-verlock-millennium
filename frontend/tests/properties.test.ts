import { expect, mock, test } from "bun:test";
import type { LockedAppRecord } from "../index";
import { millennium_mock } from "./millennium_mock";

void mock.module("react", () => ({
  useEffect: () => {},
  useState: (initial: unknown) =>
    typeof initial === "function" ? [(initial as () => unknown)(), () => {}] : [initial, () => {}],
}));

void mock.module("react/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
}));

void mock.module("react-dom/client", () => ({
  createRoot: () => ({ render: () => {}, unmount: () => {} }),
}));

void mock.module("millennium", () => millennium_mock());

const { behavior_label, find_record, format_lock_text, format_time } =
  await import("../properties");

const record: LockedAppRecord = {
  version: 1,
  appid: "440",
  name: "Team Fortress 2",
  manifest_path: "/steam/steamapps/appmanifest_440.acf",
  locked_at: 1726000000,
  refreshed_at: 1726003600,
  auto_update_behavior: 1,
  locked_build: { buildid: "12345678", depots: { "441": "7588696787324571854" } },
  original: "appmanifest text",
};

test("format_time renders the client format and treats missing times as absent", () => {
  const format = { locale: "en", hour12: false };
  expect(format_time(undefined, format)).toBeNull();
  expect(format_time(0, format)).toBeNull();
  expect(format_time(-1, format)).toBeNull();
  expect(format_time(1726000000, format)).toMatch(/2024/);
});

test("format_lock_text pretty-prints a JSON object with two-space indentation", () => {
  const compact = JSON.stringify(record);
  const pretty = format_lock_text(compact);
  expect(pretty).toBe(JSON.stringify(record, null, 2));
  expect(JSON.parse(pretty)).toEqual(record);
});

test("format_lock_text returns the text unchanged when it is not a JSON object", () => {
  expect(format_lock_text("not json")).toBe("not json");
  expect(format_lock_text("42")).toBe("42");
  expect(format_lock_text('"text"')).toBe('"text"');
  expect(format_lock_text("null")).toBe("null");
});

test("behavior_label maps the known behaviors and falls back", () => {
  expect(behavior_label(0)).toBe("Always");
  expect(behavior_label(1)).toBe("Launch");
  expect(behavior_label(2)).toBe("High priority");
  expect(behavior_label(9)).toBe("Unknown (9)");
  expect(behavior_label(undefined)).toBe("Store default");
});

test("find_record matches an app id regardless of number or string", () => {
  expect(find_record([record], "440")).toBe(record);
  expect(find_record([record], "730")).toBeNull();
  expect(find_record([], "440")).toBeNull();
  expect(find_record(null, "440")).toBeNull();
});
