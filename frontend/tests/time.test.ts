import { expect, test } from "bun:test";
import { format_client_time } from "../time";

const now = new Date("2026-09-19T12:00:00Z");
const current = Date.UTC(2026, 8, 19, 17, 20) / 1000;
const older = Date.UTC(2025, 10, 29, 17, 20) / 1000;

test("format_client_time returns undefined for a missing or non-positive value", () => {
  const format = { locale: "en", hour12: undefined };
  expect(format_client_time(undefined, format)).toBeUndefined();
  expect(format_client_time(0, format)).toBeUndefined();
  expect(format_client_time(-1, format)).toBeUndefined();
});

test("format_client_time includes the year by default", () => {
  const format = { locale: "en", hour12: false };
  expect(format_client_time(current, format, {}, now)).toMatch(/2026/);
  expect(format_client_time(older, format, {}, now)).toMatch(/2025/);
});

test("format_client_time omits the current year with current_year_short", () => {
  const format = { locale: "en", hour12: false };
  const options = { current_year_short: true };
  expect(format_client_time(current, format, options, now)).not.toMatch(/2026/);
  expect(format_client_time(older, format, options, now)).toMatch(/2025/);
});

test("format_client_time follows the 24-hour clock flag", () => {
  const twelve = format_client_time(current, { locale: "en", hour12: true }, {}, now);
  const twenty_four = format_client_time(current, { locale: "en", hour12: false }, {}, now);
  expect(twelve).not.toBe(twenty_four);
});

test("format_client_time falls back to en for an invalid locale", () => {
  expect(format_client_time(current, { locale: "not a locale", hour12: false }, {}, now)).toBe(
    format_client_time(current, { locale: "en", hour12: false }, {}, now),
  );
});
