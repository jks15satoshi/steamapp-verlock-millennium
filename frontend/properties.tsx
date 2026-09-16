import { useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DialogHeader, Millennium } from "millennium";
import type { AppId, LockedAppRecord } from "./index";
import { lock_app, refresh_app, unlock_app } from "./actions";
import { as_record_list, is_locked, refresh_locked_ids, subscribe_locked } from "./locked";
import * as bridge from "./bridge";
import { log_error, log_info, log_warn } from "./log";

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

const ACCENT_FALLBACK = "#1a9fff";

export function accent_color(document_ref: Document): string {
  const view = document_ref.defaultView;
  if (!view) {
    return ACCENT_FALLBACK;
  }
  let best: { color: string; size: number } | null = null;
  let scanned = 0;
  for (const element of document_ref.querySelectorAll("div, span, a")) {
    scanned += 1;
    if (scanned > 4000) {
      break;
    }
    const style = view.getComputedStyle(element);
    const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(style.color);
    if (!match) {
      continue;
    }
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (b - r <= 30 || b <= 120) {
      continue;
    }
    const size = Number.parseFloat(style.fontSize) || 0;
    if (best === null || size > best.size) {
      best = { color: `rgb(${r}, ${g}, ${b})`, size };
    }
  }
  return best?.color ?? ACCENT_FALLBACK;
}

const BUTTON_CLASS_KEY = "steamapp-verlock.button_class";
const BUTTON_CLASS_FALLBACK =
  "_1KAp5PPYG7si-T_66zNEcU DialogButton _DialogLayout Secondary Focusable";

function native_button_class(document_ref: Document, our_page: Element): string | undefined {
  for (const button of document_ref.querySelectorAll("button")) {
    if (our_page.contains(button)) {
      continue;
    }
    const name = button.getAttribute("class") ?? "";
    if (name.includes("DialogButton") && name.split(/\s+/).some((part) => part.startsWith("_"))) {
      return name;
    }
  }
  return undefined;
}

function read_button_class(document_ref: Document, our_page: Element): string {
  const sampled = native_button_class(document_ref, our_page);
  if (sampled !== undefined) {
    try {
      window.localStorage.setItem(BUTTON_CLASS_KEY, sampled);
    } catch {
      // A storage failure only costs the cached class.
    }
    return sampled;
  }
  try {
    const stored = window.localStorage.getItem(BUTTON_CLASS_KEY);
    if (stored !== null && stored !== "") {
      return stored;
    }
  } catch {
    // A storage failure only costs the cached class.
  }
  return BUTTON_CLASS_FALLBACK;
}

function ActionButton({
  button_class,
  disabled,
  onClick,
  children,
}: {
  button_class: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={button_class} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Value({ color, children }: { color: string; children: ReactNode }) {
  return <span style={{ color, fontWeight: 500, marginLeft: "5px" }}>{children}</span>;
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ lineHeight: "20px" }}>{children}</div>;
}

function DepotList({ record, accent }: { record: LockedAppRecord; accent: string }) {
  const entries = Object.entries(record.locked_build?.depots ?? {});
  if (entries.length === 0) {
    return <Row>Depots: none</Row>;
  }
  return (
    <>
      {entries.map(([depot, manifest]) => (
        <Row key={depot}>
          Depot {depot}: <Value color={accent}>{manifest}</Value>
        </Row>
      ))}
    </>
  );
}

export function VerlockTabContent({
  appid,
  accent,
  button_class,
}: {
  appid: AppId;
  accent: string;
  button_class: string;
}) {
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
                  onClick={() => run(() => refresh_app(appid))}
                >
                  Refresh
                </ActionButton>
                <ActionButton
                  button_class={button_class}
                  disabled={busy}
                  onClick={() => run(() => unlock_app(appid))}
                >
                  Unlock
                </ActionButton>
              </>
            ) : (
              <ActionButton
                button_class={button_class}
                disabled={busy}
                onClick={() => run(() => lock_app(appid))}
              >
                Lock
              </ActionButton>
            )}
          </div>
        </div>
        {locked && record ? (
          <>
            <Row>
              App ID: <Value color={accent}>{record.appid}</Value>
            </Row>
            <Row>
              Build ID: <Value color={accent}>{record.locked_build?.buildid ?? "Unknown"}</Value>
            </Row>
            <DepotList record={record} accent={accent} />
            <Row>
              Locked: <Value color={accent}>{format_time(record.locked_at)}</Value>
            </Row>
            <Row>
              Refreshed: <Value color={accent}>{format_time(record.refreshed_at)}</Value>
            </Row>
            <Row>
              Auto-update:{" "}
              <Value color={accent}>{behavior_label(record.auto_update_behavior)}</Value>
            </Row>
          </>
        ) : null}
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

  let button_class = read_button_class(document_ref, our_page);
  const root = createRoot(our_page);
  roots.push(root);
  refresh_content = () => {
    button_class = read_button_class(document_ref, our_page);
    root.render(
      <VerlockTabContent
        appid={appid}
        accent={accent_color(document_ref)}
        button_class={button_class}
      />,
    );
  };
  refresh_content();
  log_info(`added the app properties tab for app ${appid}`);

  const button_observer = new MutationObserver(() => {
    const sampled = native_button_class(document_ref, our_page);
    if (sampled !== undefined && sampled !== button_class) {
      refresh_content();
    }
  });
  button_observer.observe(document_ref.body, { subtree: true, childList: true });
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
