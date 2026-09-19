import { useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialogHeader, Millennium } from "millennium";
import type { AppId, FileContentResult, LockedAppRecord, PathsResult } from "./index";
import { lock_app, refresh_app, unlock_app } from "./actions";
import { as_record_list, is_locked, refresh_locked_ids, subscribe_locked } from "./locked";
import * as bridge from "./bridge";
import { log_error, log_info, log_warn } from "./log";
import { format_error, show_failure_dialog, show_text_dialog } from "./notify";
import {
  accent_color,
  ActionButton,
  divider_color,
  MUTED_COLOR,
  native_button_class,
  read_button_class,
} from "./native";

const PROPERTIES_CONTENT_SELECTOR = "div.DialogContent[id$='/properties/general_Content']";
const APPID_PATTERN = /\/app\/(\d+)\/properties\//;
const DIALOG_TIMEOUT_MS = 1000;
const TAB_MARKER = "data-verlock-tab";
const TAB_LABEL = "Steam App Verlock";

const BEHAVIOR_LABELS: Record<number, string> = {
  0: "Always",
  1: "Launch",
  2: "High priority",
};

const LOCK_FORMAT_NOTE = "For readability, the original text has been pretty-printed.";

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

export function format_time(value: number | undefined): string | null {
  if (typeof value !== "number" || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function format_lock_text(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  if (parsed === null || typeof parsed !== "object") {
    return content;
  }
  return JSON.stringify(parsed, null, 2);
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

function Value({ children }: { children: ReactNode }) {
  return <span style={{ marginLeft: "5px" }}>{children}</span>;
}

function StatusValue({ color, children }: { color: string; children: ReactNode }) {
  return <span style={{ fontWeight: 700, marginLeft: "5px", color }}>{children}</span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: MUTED_COLOR, marginLeft: "5px" }}>{children}</span>;
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ lineHeight: "20px" }}>{children}</div>;
}

function DepotSection({ record }: { record: LockedAppRecord | null }) {
  const [expanded, set_expanded] = useState(false);
  if (record === null) {
    return (
      <Row>
        Depots: <Muted>N/A</Muted>
      </Row>
    );
  }
  const entries = Object.entries(record.locked_build?.depots ?? {});
  if (entries.length === 0) {
    return <Row>Depots: none</Row>;
  }
  return (
    <>
      <Row>
        <span
          role="button"
          tabIndex={0}
          onClick={() => set_expanded((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              set_expanded((value) => !value);
            }
          }}
          style={{ cursor: "pointer" }}
        >
          Depots ({entries.length})&nbsp; {expanded ? "▾" : "▸"}
        </span>
      </Row>
      {expanded
        ? entries.map(([depot, manifest]) => (
            <Row key={depot}>
              Depot {depot}: <Value>{manifest}</Value>
            </Row>
          ))
        : null}
    </>
  );
}

export function VerlockTabContent({
  appid,
  accent,
  divider,
  button_class,
  parent,
}: {
  appid: AppId;
  accent: string;
  divider: string;
  button_class: string;
  parent?: EventTarget;
}) {
  const [record, set_record] = useState<LockedAppRecord | null>(null);
  const [paths, set_paths] = useState<PathsResult | null>(null);
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
      try {
        const fetched = parse_json(await bridge.get_paths(appid)) as PathsResult | undefined;
        if (!cancelled) {
          set_paths(fetched?.ok ? fetched : null);
        }
      } catch {
        if (!cancelled) {
          set_paths(null);
        }
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

  const show_content = async (target: "appmanifest" | "lock"): Promise<void> => {
    const label = target === "lock" ? "Lock File" : "Appmanifest";
    try {
      const fetched = parse_json(await bridge.read_file(appid, target)) as
        | FileContentResult
        | undefined;
      if (fetched?.ok === true && typeof fetched.content === "string") {
        const message = target === "lock" ? format_lock_text(fetched.content) : fetched.content;
        const note =
          target === "lock" && message !== fetched.content ? LOCK_FORMAT_NOTE : undefined;
        show_text_dialog(label, message, parent, note);
        return;
      }
      const message = fetched?.error ?? "the file could not be read";
      log_error(`could not read the ${target} for app ${appid}: ${message}`);
      show_failure_dialog(TAB_LABEL, message, parent);
    } catch (caught) {
      const message = format_error(caught);
      log_error(`could not read the ${target} for app ${appid}: ${message}`);
      show_failure_dialog(TAB_LABEL, message, parent);
    }
  };

  const locked_time = locked && record ? format_time(record.locked_at) : null;
  const refreshed_time = locked && record ? format_time(record.refreshed_at) : null;

  const status = (time: string | null, not_yet: boolean): ReactNode => {
    if (time !== null) {
      return <StatusValue color={accent}>{time}</StatusValue>;
    }
    if (not_yet) {
      return <StatusValue color={accent}>Not yet</StatusValue>;
    }
    return <StatusValue color={MUTED_COLOR}>N/A</StatusValue>;
  };

  const lock_path = paths?.lock;
  const manifest_path = paths?.appmanifest;

  return (
    <div className="DialogContent_InnerWidth">
      <DialogHeader>{TAB_LABEL}</DialogHeader>
      <div className="DialogBody" style={{ fontSize: "14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <span>
            State:{" "}
            <span
              style={{ fontWeight: 700, marginLeft: "5px", color: locked ? accent : undefined }}
            >
              {locked ? "Locked" : "Not locked"}
            </span>
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            {locked ? (
              <>
                <ActionButton
                  button_class={button_class}
                  disabled={busy}
                  onClick={() => run(() => refresh_app(appid, parent))}
                >
                  Refresh
                </ActionButton>
                <ActionButton
                  button_class={button_class}
                  disabled={busy}
                  onClick={() => run(() => unlock_app(appid, parent))}
                >
                  Unlock
                </ActionButton>
              </>
            ) : (
              <ActionButton
                button_class={button_class}
                disabled={busy}
                onClick={() => run(() => lock_app(appid, parent))}
              >
                Lock
              </ActionButton>
            )}
          </div>
        </div>
        <Row>Locked: {status(locked_time, false)}</Row>
        <Row>Refreshed: {status(refreshed_time, locked_time !== null)}</Row>
        <div
          style={{
            flexShrink: 0,
            marginTop: "20px",
            paddingTop: "20px",
            borderTop: `1px solid ${divider}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <div className="SettingsDialogSubHeader">Lock Snapshot</div>
            <div style={{ display: "flex", gap: "8px" }}>
              {lock_path !== undefined ? (
                <ActionButton
                  button_class={button_class}
                  disabled={false}
                  onClick={() => void show_content("lock")}
                >
                  Lock File
                </ActionButton>
              ) : null}
              <ActionButton
                button_class={button_class}
                disabled={manifest_path === undefined}
                onClick={() => void show_content("appmanifest")}
              >
                Appmanifest
              </ActionButton>
            </div>
          </div>
          <Row>
            App ID: <Value>{record?.appid ?? appid}</Value>
          </Row>
          <Row>
            Build ID:{" "}
            {record ? (
              <Value>{record.locked_build?.buildid ?? "Unknown"}</Value>
            ) : (
              <Muted>N/A</Muted>
            )}
          </Row>
          <DepotSection record={record} />
          <Row>
            Auto-update:{" "}
            {record ? (
              <Value>{behavior_label(record.auto_update_behavior)}</Value>
            ) : (
              <Muted>N/A</Muted>
            )}
          </Row>
        </div>
      </div>
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

  tablist.appendChild(our_tab);
  container.appendChild(our_area);

  const native_area = (): HTMLElement | null => {
    for (const child of [...container.children]) {
      if (child !== our_area && !child.contains(tablist)) {
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
      our_tab.classList.remove(active_marker);
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

  let refresh_content: () => void = () => {};

  our_tab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    refresh_content();
    set_active(true);
  });

  tablist.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (target === null || our_tab.contains(target)) {
        return;
      }
      const native = outers.find((tab) => tab.contains(target));
      if (native !== undefined) {
        last_native_active = native;
        set_active(false);
      }
    },
    true,
  );

  if (active_marker !== undefined) {
    const marker = active_marker;
    const observer = new MutationObserver(() => {
      if (our_tab.getAttribute("aria-selected") !== "true") {
        return;
      }
      if (outers.some((tab) => tab.classList.contains(marker))) {
        set_active(false);
      }
    });
    observer.observe(tablist, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-selected"],
    });
  }

  let button_class = read_button_class(container, our_page);
  const root = createRoot(our_page);
  roots.push(root);
  refresh_content = () => {
    button_class = read_button_class(container, our_page);
    root.render(
      <VerlockTabContent
        appid={appid}
        accent={accent_color(document_ref)}
        divider={divider_color(document_ref)}
        button_class={button_class}
        parent={document_ref.defaultView ?? undefined}
      />,
    );
  };
  refresh_content();
  log_info(`added the app properties tab for app ${appid}`);

  const button_observer = new MutationObserver(() => {
    const sampled = native_button_class(container, our_page);
    if (sampled !== undefined && sampled !== button_class) {
      refresh_content();
    }
  });
  button_observer.observe(container, { subtree: true, childList: true });
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
          DIALOG_TIMEOUT_MS,
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
