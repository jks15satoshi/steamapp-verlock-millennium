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

const { behavior_label, find_record, format_time } = await import("../properties");

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

test("format_time renders a localized time and treats missing times as absent", () => {
  expect(format_time(undefined)).toBeNull();
  expect(format_time(0)).toBeNull();
  expect(format_time(-1)).toBeNull();
  expect(format_time(1726000000)).toBe(
    new Date(1726000000 * 1000).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  );
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
