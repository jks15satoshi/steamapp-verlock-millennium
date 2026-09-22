import { expect, mock, test } from "bun:test";
import { millennium_mock } from "./millennium_mock";

const toast_calls: unknown[] = [];
let throw_on_toast = false;

void mock.module("millennium", () => ({
  ...millennium_mock(),
  toaster: {
    toast: (data: unknown) => {
      if (throw_on_toast) {
        throw new Error("toast unavailable");
      }
      toast_calls.push(data);
      return { dismiss: () => {} };
    },
  },
}));

void mock.module("react", () => ({
  useEffect: () => {},
  useState: (initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    () => {},
  ],
}));

void mock.module("react/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
}));

const { report_success } = await import("../notify");

test("report_success shows a transient toast with the default title", () => {
  toast_calls.length = 0;
  report_success("Locked Counter-Strike 2");
  expect(toast_calls).toEqual([{ title: "Steam App Verlock", body: "Locked Counter-Strike 2" }]);
});

test("report_success accepts a custom title", () => {
  toast_calls.length = 0;
  report_success("Refreshed app 730", "Custom");
  expect(toast_calls).toEqual([{ title: "Custom", body: "Refreshed app 730" }]);
});

test("a failing toaster never propagates", () => {
  throw_on_toast = true;
  expect(() => report_success("Unlocked app 730")).not.toThrow();
  throw_on_toast = false;
});
