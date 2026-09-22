import { expect, test } from "bun:test";
import { format_error } from "../errors";

test("format_error normalizes errors, strings, objects, and empty values", () => {
  expect(format_error(new Error("boom"))).toBe("boom");
  expect(format_error("plain")).toBe("plain");
  expect(format_error({ a: 1 })).toBe('{"a":1}');
  expect(format_error(undefined)).toBe("Unknown error");
  expect(format_error(null)).toBe("Unknown error");
});

test("format_error falls back to String for an unstringifiable value", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(format_error(circular)).toBe("[object Object]");
});
