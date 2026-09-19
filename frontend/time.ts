import * as bridge from "./bridge";

export type ClockFormat = {
  locale: string;
  hour12: boolean | undefined;
};

export type ClientTimeOptions = {
  current_year_short?: boolean;
};

type SteamClientGlobals = {
  Settings?: {
    GetCurrentLanguage?: () => Promise<string>;
    RegisterForSettingsChanges?: (callback: (settings: unknown) => void) => void;
  };
  FriendSettings?: { RegisterForSettingsChanges?: (callback: (settings: string) => void) => void };
};

const LANGUAGE_TAGS: Record<string, string> = {
  english: "en",
  schinese: "zh-CN",
};

let clock_format: ClockFormat = { locale: "en", hour12: undefined };
let clock_installed = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function parse_json(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

function set_clock_format(partial: Partial<ClockFormat>): void {
  clock_format = { ...clock_format, ...partial };
  notify();
}

export function subscribe_clock_format(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function current_clock_format(): ClockFormat {
  return clock_format;
}

export function install_clock_format(): void {
  if (clock_installed) {
    return;
  }
  clock_installed = true;
  const client = (globalThis as unknown as { SteamClient?: SteamClientGlobals }).SteamClient;
  if (typeof client?.Settings?.GetCurrentLanguage === "function") {
    void client.Settings.GetCurrentLanguage()
      .then((short_name) => {
        set_clock_format({ locale: LANGUAGE_TAGS[short_name] ?? "en" });
      })
      .catch(() => {
        return;
      });
  }
  if (typeof client?.Settings?.RegisterForSettingsChanges === "function") {
    client.Settings.RegisterForSettingsChanges((settings) => {
      const record = (settings ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (/24|hour|clock/i.test(key)) {
          apply_24h(record[key]);
        }
      }
    });
  }
  if (typeof client?.FriendSettings?.RegisterForSettingsChanges === "function") {
    client.FriendSettings.RegisterForSettingsChanges((raw) => {
      const parsed = parse_json(raw) as Record<string, unknown> | undefined;
      apply_24h(parsed?.b24HourClock);
    });
  }
  void bridge
    .get_clock_format()
    .then((result) => {
      if (result.ok && (result.is_24h === true || result.is_24h === false)) {
        set_clock_format({ hour12: result.is_24h ? false : undefined });
      }
    })
    .catch(() => {
      return;
    });
}

function apply_24h(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  const on = value === true || value === 1 || value === "1" || value === "true";
  const off = value === false || value === 0 || value === "0" || value === "false";
  if (on || off) {
    set_clock_format({ hour12: on ? false : undefined });
  }
}

function format_date(locale: string, options: Intl.DateTimeFormatOptions, date: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

export function format_client_time(
  value: number | undefined,
  format: ClockFormat,
  options: ClientTimeOptions = {},
  now: Date = new Date(),
): string | undefined {
  if (typeof value !== "number" || value <= 0) {
    return undefined;
  }
  const date = new Date(value * 1000);
  const current_year_short =
    options.current_year_short === true && date.getFullYear() === now.getFullYear();
  const formatter_options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(current_year_short ? {} : { year: "numeric" }),
    ...(format.hour12 === undefined ? {} : { hour12: format.hour12 }),
  };
  return format_date(format.locale, formatter_options, date);
}
