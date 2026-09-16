import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Millennium } from "millennium";
import type { AppId, LockedAppRecord } from "./index";
import { lock_app, refresh_app, unlock_app } from "./actions";
import { as_record_list, is_locked, refresh_locked_ids, subscribe_locked } from "./locked";
import * as bridge from "./bridge";
import { log_error, log_info, log_warn } from "./log";

const PROPERTIES_CONTENT_SELECTOR = "div.DialogContent[id$='/properties/general_Content']";
const APPID_PATTERN = /\/app\/(\d+)\/properties\//;
const PROBE_TIMEOUT_MS = 1000;
const TAB_MARKER = "data-verlock-tab";
const TAB_LABEL = "Steam App Verlock";

const BEHAVIOR_LABELS: Record<number, string> = {
  0: "Always",
  1: "Launch",
  2: "High priority",
};

const roots: Root[] = [];

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

export function format_time(value: number | undefined): string {
  if (typeof value !== "number" || value <= 0) {
    return "Never";
  }
  return new Date(value * 1000).toLocaleString();
}

export function behavior_label(value: number | undefined): string {
  if (typeof value !== "number") {
    return "Store default";
  }
  return BEHAVIOR_LABELS[value] ?? `Unknown (${value})`;
}

export function find_record(
  records: LockedAppRecord[] | null,
  appid: AppId,
): LockedAppRecord | null {
  return records?.find((entry) => String(entry.appid) === appid) ?? null;
}

function DepotList({ record }: { record: LockedAppRecord }) {
  const entries = Object.entries(record.locked_build?.depots ?? {});
  if (entries.length === 0) {
    return <div>Depots: none</div>;
  }
  return (
    <div>
      <div>Depots:</div>
      {entries.map(([depot, manifest]) => (
        <div key={depot}>
          {depot}: {manifest}
        </div>
      ))}
    </div>
  );
}

export function VerlockTabContent({ appid }: { appid: AppId }) {
  const [record, set_record] = useState<LockedAppRecord | null>(null);
  const [locked, set_locked] = useState<boolean>(() => is_locked(appid));
  const [busy, set_busy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reload = async (): Promise<void> => {
      set_locked(is_locked(appid));
      try {
        const list = as_record_list(parse_json(await bridge.list_locked()));
        if (cancelled) {
          return;
        }
        set_record(find_record(list, appid));
      } catch {
        return;
      }
    };
    void reload();
    void refresh_locked_ids();
    const unsubscribe = subscribe_locked(() => {
      void reload();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [appid]);

  const run = (task: () => Promise<void>): void => {
    set_busy(true);
    void task().finally(() => {
      set_busy(false);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px" }}>
      <div style={{ fontSize: "1.1em", fontWeight: 700 }}>{TAB_LABEL}</div>
      <div>State: {locked ? "Locked" : "Not locked"}</div>
      <div>App ID: {appid}</div>
      {locked && record ? (
        <>
          <div>Name: {record.name}</div>
          <div>Build: {record.locked_build?.buildid ?? "Unknown"}</div>
          <DepotList record={record} />
          <div>Locked: {format_time(record.locked_at)}</div>
          <div>Refreshed: {format_time(record.refreshed_at)}</div>
          <div>Auto-update: {behavior_label(record.auto_update_behavior)}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button disabled={busy} onClick={() => run(() => refresh_app(appid))}>
              Refresh
            </button>
            <button disabled={busy} onClick={() => run(() => unlock_app(appid))}>
              Unlock
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button disabled={busy || locked} onClick={() => run(() => lock_app(appid))}>
            Lock
          </button>
        </div>
      )}
    </div>
  );
}

function outer_tabs(tabs: Element[]): Element[] {
  return tabs.filter((tab) => !tab.parentElement?.closest("[role='tab']"));
}

function inject(document_ref: Document, appid: string): void {
  if (document_ref.querySelector(`[${TAB_MARKER}]`)) {
    return;
  }

  const tablist = document_ref.querySelector("[role='tablist']");
  const general = document_ref.querySelector(PROPERTIES_CONTENT_SELECTOR);
  const content_area = general?.parentElement ?? null;
  const container = content_area?.parentElement ?? null;
  const outers = outer_tabs([...document_ref.querySelectorAll("[role='tab']")]);
  const template = outers.find((tab) => tab.getAttribute("aria-selected") === "false") ?? outers[0];
  if (!tablist || !general || !content_area || !container || !template) {
    log_warn(`could not add the app properties tab for app ${appid}: the dialog shape changed`);
    return;
  }

  const prefix = general.id.slice(0, general.id.indexOf("/app/"));
  const tab_id = `${prefix}/app/${appid}/properties/verlock`;
  const content_id = `${tab_id}_Content`;

  const active_tab = outers.find((tab) => tab.getAttribute("aria-selected") === "true");
  const inactive_tab = outers.find((tab) => tab.getAttribute("aria-selected") === "false");
  const active_marker =
    active_tab && inactive_tab
      ? [...active_tab.classList].find((name) => !inactive_tab.classList.contains(name))
      : undefined;
  let last_native_active: Element | null = active_tab ?? outers[0] ?? null;

  const our_tab = template.cloneNode(true) as HTMLElement;
  our_tab.removeAttribute("id");
  our_tab.id = tab_id;
  our_tab.setAttribute("aria-controls", content_id);
  our_tab.setAttribute("aria-selected", "false");
  our_tab.setAttribute(TAB_MARKER, "");
  const nested = our_tab.querySelector("[role='tab']");
  if (nested) {
    nested.removeAttribute("id");
    nested.removeAttribute("role");
    nested.removeAttribute("aria-selected");
    nested.removeAttribute("aria-controls");
    nested.textContent = TAB_LABEL;
  } else {
    our_tab.textContent = TAB_LABEL;
  }

  const our_area = content_area.cloneNode(false) as HTMLElement;
  our_area.removeAttribute("id");
  our_area.style.display = "none";
  const our_page = document_ref.createElement("div");
  our_page.id = content_id;
  our_page.className = general.className;
  our_page.setAttribute("role", "tabpanel");
  our_page.setAttribute("aria-labelledby", tab_id);
  our_area.appendChild(our_page);

  const page_list = container.children[0] ?? null;

  tablist.appendChild(our_tab);
  container.appendChild(our_area);

  const native_area = (): HTMLElement | null => {
    for (const child of [...container.children]) {
      if (child !== our_area && child !== page_list) {
        return child as HTMLElement;
      }
    }
    return null;
  };

  const set_active = (active: boolean): void => {
    if (active_marker !== undefined) {
      for (const tab of outers) {
        tab.classList.remove(active_marker);
      }
      if (active) {
        our_tab.classList.add(active_marker);
      } else if (last_native_active !== null) {
        last_native_active.classList.add(active_marker);
      }
    }
    our_tab.setAttribute("aria-selected", active ? "true" : "false");
    const native = native_area();
    if (native) {
      native.style.display = active ? "none" : "";
    }
    our_area.style.display = active ? "" : "none";
  };

  our_tab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    set_active(true);
  });

  tablist.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || our_tab.contains(target)) {
      return;
    }
    if (target.closest("[role='tab']")) {
      last_native_active = outers.find((tab) => tab.contains(target)) ?? last_native_active;
      set_active(false);
    }
  });

  const root = createRoot(our_page);
  roots.push(root);
  root.render(<VerlockTabContent appid={appid} />);
  log_info(`added the app properties tab for app ${appid}`);
}

export function install_properties_patch(): () => void {
  const add_hook = Millennium.AddWindowCreateHook;
  if (typeof add_hook !== "function") {
    log_warn("the app properties tab is unavailable: AddWindowCreateHook is missing");
    return (): void => {};
  }

  add_hook((popup: unknown) => {
    const document_ref = (popup as { m_popup?: { document?: Document } } | null)?.m_popup?.document;
    if (!document_ref) {
      return;
    }
    void (async () => {
      try {
        const matches = await Millennium.findElement(
          document_ref,
          PROPERTIES_CONTENT_SELECTOR,
          PROBE_TIMEOUT_MS,
        );
        const general = matches[0];
        if (!general) {
          return;
        }
        const appid = APPID_PATTERN.exec(general.id)?.[1];
        if (appid !== undefined) {
          inject(document_ref, appid);
        }
      } catch {
        return;
      }
    })();
  });

  return (): void => {
    for (const root of roots.splice(0)) {
      try {
        root.unmount();
      } catch (error) {
        log_error(`could not unmount the app properties tab: ${String(error)}`);
      }
    }
  };
}
