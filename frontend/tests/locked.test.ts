import { beforeEach, expect, test } from "bun:test";
import { is_locked, mark_locked, mark_unlocked, sync_locked_ids } from "../locked";

beforeEach(() => {
  mark_unlocked("730");
  mark_unlocked("570");
});

test("sync_locked_ids treats an empty object as an empty list", () => {
  mark_locked("730");
  sync_locked_ids({});
  expect(is_locked("730")).toBe(false);
});

test("sync_locked_ids keeps the set for an error envelope", () => {
  mark_locked("730");
  sync_locked_ids({ ok: false, error: "migration in progress" });
  expect(is_locked("730")).toBe(true);
});

test("sync_locked_ids replaces the set from a record list", () => {
  mark_locked("730");
  sync_locked_ids([{ appid: "570" }]);
  expect(is_locked("730")).toBe(false);
  expect(is_locked("570")).toBe(true);
});
