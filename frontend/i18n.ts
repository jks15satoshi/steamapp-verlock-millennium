import type { Ack } from "./index";
import english from "./locales/english.json";
import schinese from "./locales/schinese.json";

export type MessageKey = keyof typeof english;

type Catalog = Record<string, string>;

const CATALOGS: Record<string, Catalog> = {
  english,
  schinese,
};

const LOCALE_TAGS: Record<string, string> = {
  english: "en",
  schinese: "zh-CN",
};

const DEFAULT_LOCALE = "english";

let locale = DEFAULT_LOCALE;
let catalog: Catalog = english;
let initialized = false;

type LanguageSettings = {
  GetCurrentLanguage?: () => Promise<string>;
};

function is_catalog_name(language: string): language is keyof typeof CATALOGS {
  return Object.prototype.hasOwnProperty.call(CATALOGS, language);
}

function read_language(): Promise<string | undefined> {
  const settings = (globalThis as unknown as { SteamClient?: { Settings?: LanguageSettings } })
    .SteamClient?.Settings;
  if (settings === undefined || typeof settings.GetCurrentLanguage !== "function") {
    return Promise.resolve(undefined);
  }
  return Promise.resolve()
    .then(() => settings.GetCurrentLanguage?.())
    .then((short_name) =>
      typeof short_name === "string" && is_catalog_name(short_name) ? short_name : undefined,
    )
    .catch(() => undefined);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

export function set_locale(language: string): void {
  locale = is_catalog_name(language) ? language : DEFAULT_LOCALE;
  catalog = CATALOGS[locale];
}

export function current_locale(): string {
  return locale;
}

export function current_locale_tag(): string {
  return LOCALE_TAGS[locale] ?? "en";
}

export async function init_i18n(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  set_locale((await read_language()) ?? DEFAULT_LOCALE);
}

export async function refresh_locale(): Promise<void> {
  const detected = await read_language();
  if (detected !== undefined) {
    set_locale(detected);
  }
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalog[key] ?? english[key] ?? key;
  return interpolate(template, params);
}

export function resolve_error(result: Ack): string {
  const code = result.code;
  if (typeof code === "string") {
    const key = `error.${code}` as MessageKey;
    if (Object.prototype.hasOwnProperty.call(english, key)) {
      return t(key);
    }
  }
  if (typeof result.error === "string" && result.error !== "") {
    return result.error;
  }
  return t("error.unknown");
}
