import { expect, test } from "bun:test";
import {
  current_locale,
  current_locale_tag,
  init_i18n,
  refresh_locale,
  resolve_error,
  set_locale,
  t,
  type MessageKey,
} from "../i18n";
import english from "../locales/english.json";
import schinese from "../locales/schinese.json";
import { clearLanguage, installLanguage } from "./harness";

test("the default catalog is English", () => {
  expect(current_locale()).toBe("english");
  expect(current_locale_tag()).toBe("en");
  expect(t("menu.lock")).toBe("Lock");
});

test("init_i18n selects the catalog for the client language", async () => {
  installLanguage("schinese");
  await init_i18n();
  expect(current_locale()).toBe("schinese");
  expect(current_locale_tag()).toBe("zh-CN");
  expect(t("menu.lock")).toBe("锁定");
});

test("init_i18n is a no-op after the first call", async () => {
  installLanguage("english");
  await init_i18n();
  expect(current_locale()).toBe("schinese");
});

test("init_i18n resolves English for an unknown language", async () => {
  set_locale("english");
  clearLanguage();
  await init_i18n();
  expect(current_locale()).toBe("english");
});

test("set_locale resolves an unknown name to English", () => {
  set_locale("klingon");
  expect(current_locale()).toBe("english");
});

test("refresh_locale picks up a changed client language", async () => {
  set_locale("english");
  installLanguage("schinese");
  await refresh_locale();
  expect(current_locale()).toBe("schinese");
});

test("refresh_locale keeps the current catalog when the call rejects", async () => {
  set_locale("schinese");
  installLanguage(() => Promise.reject(new Error("no settings")));
  await refresh_locale();
  expect(current_locale()).toBe("schinese");
});

test("refresh_locale keeps the current catalog for an unknown language", async () => {
  set_locale("schinese");
  installLanguage("klingon");
  await refresh_locale();
  expect(current_locale()).toBe("schinese");
});

test("t interpolates the given parameters", () => {
  set_locale("english");
  expect(t("settings.dialog.refresh_failed", { appid: "730" })).toBe("Refresh failed for app 730");
});

test("t keeps a placeholder without a matching parameter", () => {
  set_locale("english");
  expect(t("settings.dialog.refresh_failed")).toBe("Refresh failed for app {{appid}}");
});

test("t ignores a parameter without a placeholder", () => {
  set_locale("english");
  expect(t("menu.lock", { appid: "730" })).toBe("Lock");
});

test("t returns the key itself for a missing message key", () => {
  set_locale("english");
  expect(t("does.not.exist" as MessageKey)).toBe("does.not.exist");
});

test("resolve_error localizes a known code", () => {
  set_locale("english");
  expect(resolve_error({ ok: false, code: "not_installed", error: "gone" })).toBe(
    "This app is not installed.",
  );
});

test("resolve_error falls back to the error text for an unknown code", () => {
  set_locale("english");
  expect(resolve_error({ ok: false, code: "no_such_code", error: "raw text" })).toBe("raw text");
});

test("resolve_error falls back to the unknown message when nothing is present", () => {
  set_locale("english");
  expect(resolve_error({ ok: false })).toBe("An unknown error occurred.");
});

test("resolve_error ignores an object prototype key as a code", () => {
  set_locale("english");
  expect(resolve_error({ ok: false, code: "constructor", error: "raw text" })).toBe("raw text");
});

test("the two catalogs carry the same key set", () => {
  expect(Object.keys(english).toSorted()).toEqual(Object.keys(schinese).toSorted());
});
