import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Millennium } from "millennium";
import type { AppId } from "./index";
import { as_record_list, is_locked, refresh_locked_ids, subscribe_locked } from "./locked";
import { log_info, log_warn } from "./log";
import {
  current_clock_format,
  format_client_time,
  subscribe_clock_format,
  type ClockFormat,
} from "./time";
import * as bridge from "./bridge";

const APPID_PATTERN = /\/app\/(\d+)/;
const PLAY_TIME_LABEL = /^(play\s*time|playtime|游戏时间|遊戲時間|总时数|總時數)$/i;

const HERO_SELECTOR = 'img[src*="library_hero"]';
const HERO_APPID = /\/(?:assets|apps)\/(\d+)\//i;
const LINK_APPID =
  /(?:steam:\/\/rungameid\/|steam:\/\/nav\/games\/details\/|store\.steampowered\.com\/app\/)(\d+)/i;
const IMG_APPID = /\/(?:apps|assets)\/(\d+)\//i;

const PLAY_TIME_CELL = "._1kiZKVbDe-9Ikootk57kpA._1aKegVl9_lSdNAyWYZQlr9";
const DISPLAY_CELL = "._1kiZKVbDe-9Ikootk57kpA";

const MAIN_POPUP = "SP Desktop_uid0";

export type BadgeStyle = {
  label: CSSProperties;
  value: CSSProperties;
  icon: { color: string; width: string; height: string; opacity: number };
};

type SampledBadgeStyle = {
  label?: CSSProperties;
  value?: CSSProperties;
  icon?: Partial<BadgeStyle["icon"]>;
};

export const FALLBACK_BADGE_STYLE: BadgeStyle = {
  label: {
    color: "#8b929a",
    fontSize: "12px",
    fontWeight: 500,
    letterSpacing: "0.5px",
    lineHeight: "18px",
    textTransform: "uppercase",
  },
  value: {
    color: "#dfe3e6",
    fontSize: "14px",
    fontWeight: 500,
    lineHeight: "18px",
  },
  icon: {
    color: "#8b929a",
    height: "20px",
    opacity: 1,
    width: "20px",
  },
};

const CONTAINER_STYLE: CSSProperties = {
  alignItems: "center",
  alignSelf: "center",
  display: "flex",
  gap: "8px",
  padding: "0 12px",
};

const ICON_CONTAINER_STYLE: CSSProperties = {
  alignItems: "center",
  display: "flex",
};

const TEXT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  whiteSpace: "nowrap",
};

type SteamWindowGlobals = {
  MainWindowBrowserManager?: { m_lastLocation?: { pathname?: string } };
};

type SteamPopup = {
  m_strName?: string;
  m_popup?: { document?: Document };
};

type PopupManager = {
  GetExistingPopup?: (name: string) => SteamPopup | null;
  AddPopupCreatedCallback?: (callback: (popup: SteamPopup) => void) => void;
};

type Mounted = {
  appid: AppId;
  container: HTMLElement;
  root: Root;
  parent: HTMLElement | null;
  previous_flex_wrap: string;
};

let mounted: Mounted | null = null;
let last_logged_appid: AppId | undefined;

function popup_manager(): PopupManager | undefined {
  return (globalThis as unknown as { g_PopupManager?: PopupManager }).g_PopupManager;
}

function popup_document(popup: SteamPopup | null | undefined): Document | null {
  return popup?.m_popup?.document ?? null;
}

export function appid_from_path(path: string): AppId | undefined {
  return APPID_PATTERN.exec(path)?.[1];
}

export function appid_from_image_src(src: string): AppId | undefined {
  return HERO_APPID.exec(src)?.[1];
}

export function merge_style(sampled: SampledBadgeStyle | null, fallback: BadgeStyle): BadgeStyle {
  if (sampled === null) {
    return fallback;
  }
  return {
    label: { ...fallback.label, ...sampled.label },
    value: { ...fallback.value, ...sampled.value },
    icon: { ...fallback.icon, ...sampled.icon },
  };
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

function current_path(doc: Document): string {
  const globals = globalThis as unknown as SteamWindowGlobals;
  const path = globals.MainWindowBrowserManager?.m_lastLocation?.pathname;
  if (typeof path === "string" && path.length > 0) {
    return path;
  }
  return doc.defaultView?.location?.pathname ?? "";
}

function find_play_time_label(root: HTMLElement): HTMLElement | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    if (PLAY_TIME_LABEL.test((node.nodeValue ?? "").trim())) {
      return (node as Text).parentElement;
    }
    node = walker.nextNode();
  }
  return null;
}

function appid_from_dom(doc: Document): AppId | undefined {
  const hero = doc.querySelector(HERO_SELECTOR);
  const hero_appid = appid_from_image_src(hero?.getAttribute("src") ?? "");
  if (hero_appid !== undefined) {
    return hero_appid;
  }

  const data = doc.querySelector("[data-appid]")?.getAttribute("data-appid") ?? undefined;
  if (data !== undefined && /^\d+$/.test(data)) {
    return data;
  }

  for (const link of doc.querySelectorAll("a[href]")) {
    const match = LINK_APPID.exec(link.getAttribute("href") ?? "");
    if (match) {
      return match[1];
    }
  }

  for (const image of doc.querySelectorAll("img[src]")) {
    const match = IMG_APPID.exec(image.getAttribute("src") ?? "");
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function find_anchor_by_label(doc: Document): HTMLElement | null {
  const label = find_play_time_label(doc.body);
  if (label === null) {
    return null;
  }
  return label.parentElement?.parentElement ?? label.parentElement ?? label;
}

function find_anchor(doc: Document): HTMLElement | null {
  const play_time = doc.querySelectorAll(PLAY_TIME_CELL);
  if (play_time.length > 0) {
    return play_time[play_time.length - 1] as HTMLElement;
  }
  const labeled = find_anchor_by_label(doc);
  if (labeled !== null) {
    return labeled;
  }
  const cells = doc.querySelectorAll(DISPLAY_CELL);
  if (cells.length > 0) {
    return cells[cells.length - 1] as HTMLElement;
  }
  return null;
}

function cell_parts(cell: HTMLElement): {
  icon: SVGSVGElement | null;
  label: HTMLElement | null;
  value: HTMLElement | null;
} {
  const children = [...cell.children] as HTMLElement[];
  const icon_container = children.find((child) => child.querySelector("svg") !== null) ?? null;
  const icon = icon_container?.querySelector("svg") ?? null;
  let text =
    children.find((child) => child !== icon_container && child.childElementCount > 0) ?? null;
  let label = (text?.firstElementChild as HTMLElement | null) ?? null;
  let value = (text?.children[1] as HTMLElement | undefined) ?? null;

  if (label === null) {
    label = find_play_time_label(cell);
    if (label !== null) {
      text = label.parentElement;
      value =
        ([...(text?.children ?? [])] as HTMLElement[]).find((child) => child !== label) ?? null;
    }
  }

  return { icon, label, value };
}

function pick_text_style(view: Window, element: HTMLElement): CSSProperties {
  const style = view.getComputedStyle(element);
  return {
    color: style.color,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    textTransform: style.textTransform as CSSProperties["textTransform"],
  };
}

function sample_badge_style(cell: HTMLElement): SampledBadgeStyle | null {
  const view = cell.ownerDocument.defaultView;
  if (view === null) {
    return null;
  }

  const { icon, label, value } = cell_parts(cell);
  const sampled: SampledBadgeStyle = {};

  if (label !== null) {
    sampled.label = pick_text_style(view, label);
  }
  if (value !== null) {
    sampled.value = pick_text_style(view, value);
  }
  if (icon !== null) {
    const rect = icon.getBoundingClientRect();
    const icon_style = view.getComputedStyle(icon);
    const label_color =
      label !== null ? view.getComputedStyle(label).color : FALLBACK_BADGE_STYLE.label.color;
    const opacity = Number.parseFloat(icon_style.opacity);
    sampled.icon = {
      color: icon_style.color || label_color || FALLBACK_BADGE_STYLE.icon.color,
      height: rect.height > 0 ? `${Math.round(rect.height)}px` : FALLBACK_BADGE_STYLE.icon.height,
      opacity: Number.isFinite(opacity) ? opacity : FALLBACK_BADGE_STYLE.icon.opacity,
      width: rect.width > 0 ? `${Math.round(rect.width)}px` : FALLBACK_BADGE_STYLE.icon.width,
    };
  }

  return Object.keys(sampled).length > 0 ? sampled : null;
}

function LockIcon({ width, height }: { width: string; height: string }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width={width} height={height} fill="currentColor" aria-hidden="true">
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Zm3 3a2 2 0 0 1 1 3.732V18a1 1 0 0 1-2 0v-1.268A2 2 0 0 1 12 13Z" />
    </svg>
  );
}

export function LockBadge({ appid, style }: { appid: AppId; style: BadgeStyle }): ReactNode {
  const [locked, set_locked] = useState<boolean>(() => is_locked(appid));
  const [refreshed_at, set_refreshed_at] = useState<number | undefined>(undefined);
  const [clock, set_clock] = useState<ClockFormat>(() => current_clock_format());

  useEffect(() => subscribe_clock_format(() => set_clock(current_clock_format())), []);

  useEffect(() => {
    let cancelled = false;
    const update = (): void => {
      set_locked(is_locked(appid));
    };
    const load = (): void => {
      void bridge
        .list_locked()
        .then((raw) => {
          if (cancelled) {
            return;
          }
          const list = as_record_list(parse_json(raw));
          const record = list?.find((entry) => String(entry.appid) === appid);
          set_refreshed_at(record?.refreshed_at ?? record?.locked_at);
        })
        .catch(() => {
          return;
        });
    };
    update();
    load();
    void refresh_locked_ids();
    const unsubscribe = subscribe_locked(() => {
      update();
      load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [appid]);

  if (!locked) {
    return null;
  }

  const refreshed = format_client_time(refreshed_at, clock, { current_year_short: true });

  return (
    <div style={CONTAINER_STYLE}>
      <div
        style={{ ...ICON_CONTAINER_STYLE, color: style.icon.color, opacity: style.icon.opacity }}
      >
        <LockIcon width={style.icon.width} height={style.icon.height} />
      </div>
      <div style={TEXT_STYLE}>
        <div style={style.label}>Last refreshed</div>
        {refreshed !== undefined ? <div style={style.value}>{refreshed}</div> : null}
      </div>
    </div>
  );
}

function last_cell(parent: HTMLElement | null): HTMLElement | null {
  if (parent === null) {
    return null;
  }
  const children = parent.children;
  return children.length > 0 ? (children[children.length - 1] as HTMLElement) : null;
}

function mount(doc: Document, appid: AppId, anchor: HTMLElement): boolean {
  const target = last_cell(anchor.parentElement) ?? anchor;
  const parent = target.parentElement;
  if (parent === null) {
    return false;
  }

  const container = doc.createElement("div");
  container.style.display = "contents";
  target.after(container);

  const previous_flex_wrap = parent.style.flexWrap;
  parent.style.flexWrap = "nowrap";
  const style = merge_style(sample_badge_style(anchor), FALLBACK_BADGE_STYLE);
  const root = createRoot(container);
  root.render(<LockBadge appid={appid} style={style} />);
  mounted = { appid, container, root, parent, previous_flex_wrap };
  log_info(`game page badge mounted for app ${appid}`);
  return true;
}

function reanchor(): void {
  if (mounted === null || mounted.parent === null) {
    return;
  }
  if (mounted.parent.lastElementChild !== mounted.container) {
    mounted.parent.append(mounted.container);
  }
}

function teardown(): void {
  if (mounted === null) {
    return;
  }
  const current = mounted;
  mounted = null;
  if (current.parent !== null && current.parent.style.flexWrap === "nowrap") {
    current.parent.style.flexWrap = current.previous_flex_wrap;
  }
  try {
    current.root.unmount();
  } catch {
    // A failed unmount still removes the node below.
  }
  current.container.remove();
}

export function install_gamepage_patch(): () => void {
  let active: { doc: Document; observer: MutationObserver } | null = null;
  let scheduled = false;

  const sync_for = (doc: Document): void => {
    const path = current_path(doc);
    const url_appid = appid_from_path(path);
    const anchor = find_anchor(doc);

    if (url_appid === undefined && anchor === null) {
      if (mounted !== null) {
        teardown();
      }
      return;
    }

    const appid = url_appid ?? appid_from_dom(doc);
    if (appid === undefined) {
      if (mounted !== null) {
        teardown();
      }
      return;
    }

    if (mounted !== null) {
      if (mounted.appid === appid && mounted.container.isConnected) {
        reanchor();
        return;
      }
      teardown();
      last_logged_appid = undefined;
    }

    if (anchor === null) {
      if (appid !== last_logged_appid) {
        last_logged_appid = appid;
        log_warn(`game page badge found no anchor for app ${appid}`);
      }
      return;
    }

    mount(doc, appid, anchor);
  };

  const schedule_for = (doc: Document): void => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    const view = doc.defaultView ?? window;
    view.setTimeout(() => {
      scheduled = false;
      sync_for(doc);
    }, 250);
  };

  const attach = (doc: Document): void => {
    if (active?.doc === doc) {
      return;
    }
    active?.observer.disconnect();
    const observer = new MutationObserver(() => {
      schedule_for(doc);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    active = { doc, observer };
    sync_for(doc);
    log_info("game page badge watcher installed");
  };

  const detect = (): void => {
    const doc = popup_document(popup_manager()?.GetExistingPopup?.(MAIN_POPUP) ?? null);
    if (doc !== null && doc.body) {
      attach(doc);
    }
  };

  const add_hook = Millennium?.AddWindowCreateHook;
  if (typeof add_hook === "function") {
    add_hook((popup: unknown) => {
      const candidate = popup as SteamPopup | null;
      if ((candidate?.m_strName ?? MAIN_POPUP) !== MAIN_POPUP) {
        return;
      }
      const doc = popup_document(candidate);
      if (doc !== null && doc.body) {
        attach(doc);
      }
    });
  }

  popup_manager()?.AddPopupCreatedCallback?.((popup) => {
    if ((popup.m_strName ?? MAIN_POPUP) !== MAIN_POPUP) {
      return;
    }
    const doc = popup_document(popup);
    if (doc !== null && doc.body) {
      attach(doc);
    }
  });

  detect();
  const poll = setInterval(detect, 1000);

  return () => {
    clearInterval(poll);
    active?.observer.disconnect();
    active = null;
    teardown();
  };
}
