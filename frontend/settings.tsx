import { DialogCheckbox, Spinner, TextField } from "millennium";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Ack, AppId, DataRoots, LockedAppRecord, MigrateResult } from "./index";
import { capture_build_info_set } from "./console";
import { reapply_all, unwatch_all_then_restore, unwatch_then_unlock } from "./watch";
import { as_record_list, sync_locked_ids } from "./locked";
import * as bridge from "./bridge";
import { log_error, log_warn } from "./log";
import { format_error, report_failure, show_failure_dialog } from "./notify";
import {
  ActionButton,
  BUTTON_CLASS_FALLBACK,
  divider_color,
  DIVIDER_FALLBACK,
  MUTED_COLOR,
  read_button_class,
} from "./native";

const TABLE_FONT_SIZE = "13px";
const TABLE_BACKGROUND = "rgb(35, 38, 46)";
const HEADER_BACKGROUND = "rgb(61, 68, 80)";

const TABLE_CONTAINER_STYLE: CSSProperties = {
  background: TABLE_BACKGROUND,
  color: MUTED_COLOR,
  display: "flex",
  flexDirection: "column",
};

const HEADER_CELL_STYLE: CSSProperties = {
  color: MUTED_COLOR,
  fontSize: TABLE_FONT_SIZE,
  fontWeight: 500,
  padding: "10px 8px",
};

const HEADER_ROW_STYLE: CSSProperties = {
  alignItems: "center",
  background: HEADER_BACKGROUND,
  display: "grid",
  gridTemplateColumns: "auto 1fr",
};

const RECORD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "8px",
};

const ACTION_ROW_STYLE: CSSProperties = {
  display: "flex",
  gap: "8px",
};

const BUTTON_HALF_STYLE: CSSProperties = {
  display: "flex",
  flex: "1 1 0",
};

const BUTTON_FULL_STYLE: CSSProperties = {
  display: "flex",
  flex: "1 1 100%",
};

const MUTED_TEXT_STYLE: CSSProperties = {
  color: MUTED_COLOR,
  fontSize: TABLE_FONT_SIZE,
};

function SectionHeader({ children }: { children: string }) {
  return <div className="SettingsDialogSubHeader">{children}</div>;
}

function SectionDivider({ color }: { color: string }) {
  return <div style={{ borderTop: `1px solid ${color}`, margin: "6px 0" }} />;
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

function is_ack(value: unknown): value is Ack {
  return Boolean(value) && typeof value === "object" && typeof (value as Ack).ok === "boolean";
}

function format_time(value: number | undefined): string {
  if (typeof value !== "number" || value <= 0) {
    return "Never";
  }
  return new Date(value * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function is_installed(appid: AppId): boolean {
  try {
    const overview = window.appStore?.GetAppOverviewByAppID?.(Number(appid));
    return Boolean(overview?.local_per_client_data?.installed);
  } catch {
    return false;
  }
}

export default function SettingsPanel() {
  const [records, set_records] = useState<LockedAppRecord[]>([]);
  const [roots, set_roots] = useState<DataRoots | null>(null);
  const [path_draft, set_path_draft] = useState("");
  const [selected, set_selected] = useState<Set<AppId>>(new Set());
  const [busy, set_busy] = useState(false);
  const [status, set_status] = useState("");
  const [button_class, set_button_class] = useState(BUTTON_CLASS_FALLBACK);
  const [divider, set_divider] = useState(DIVIDER_FALLBACK);
  const page_ref = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = parse_json(await bridge.list_locked());
      const records = as_record_list(list);
      if (is_ack(list) && !list.ok) {
        log_warn(`could not load the lock state: ${list.error ?? "unavailable"}`);
        set_status("Lock state is temporarily unavailable");
      } else {
        set_records(records ?? []);
        sync_locked_ids(list);
      }

      const data_roots = parse_json(await bridge.get_data_root());
      if (data_roots && typeof data_roots === "object") {
        const resolved = data_roots as DataRoots;
        set_roots(resolved);
        set_path_draft(resolved.data_root ?? "");
      }
    } catch (error) {
      log_error(`failed to load the lock state: ${String(error)}`);
      set_status("Failed to load lock state");
    }
  }, []);

  useEffect(() => {
    const page = page_ref.current;
    if (page) {
      set_button_class(read_button_class(document, page));
      set_divider(divider_color(document));
    }
  }, []);

  useEffect(() => {
    void reapply_all();
    void reload();
  }, [reload]);

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    set_busy(true);
    set_status("");
    try {
      await task();
    } catch (error) {
      set_status("Operation failed");
      report_failure("Operation failed", format_error(error));
    } finally {
      set_busy(false);
    }
  }

  async function refresh_one(appid: AppId): Promise<void> {
    const captured = await capture_build_info_set(appid);
    if (!captured.ok) {
      set_status(captured.error);
      show_failure_dialog(`Refresh failed for app ${appid}`, captured.error);
      return;
    }

    const refreshed = parse_json(await bridge.refresh_app(appid, captured.dumps));
    if (is_ack(refreshed) && !refreshed.ok) {
      const message = refreshed.error ?? "Refresh failed";
      set_status(message);
      show_failure_dialog(`Refresh failed for app ${appid}`, message);
    }
  }

  async function unlock_one(appid: AppId): Promise<void> {
    const result = await unwatch_then_unlock(appid);
    if (!result.ok) {
      const message = result.error ?? "Unlock failed";
      set_status(message);
      show_failure_dialog(`Unlock failed for app ${appid}`, message);
    } else if (result.auto_update_restored === false) {
      set_status(`Unlocked ${appid}, but the auto-update setting could not be restored`);
    }
  }

  function batch_refresh(): void {
    const targets = records.filter((record) => selected.has(record.appid));
    void run(async () => {
      for (const record of targets) {
        await refresh_one(record.appid);
      }
      await reload();
    });
  }

  function batch_unlock(): void {
    const targets = records.filter((record) => selected.has(record.appid));
    void run(async () => {
      for (const record of targets) {
        await unlock_one(record.appid);
      }
      await reload();
    });
  }

  function restore_all(): void {
    const snapshot = records;
    void run(async () => {
      const restore = await unwatch_all_then_restore(snapshot.map((record) => record.appid));
      if (restore.ok) {
        const failed = (Array.isArray(restore.failed) ? restore.failed : []).map((appid) =>
          String(appid),
        );
        const auto_update_failed = (
          Array.isArray(restore.auto_update_failed) ? restore.auto_update_failed : []
        ).map((appid) => String(appid));
        const notes: string[] = [];
        if (failed.length > 0) {
          notes.push(`${failed.length} failed: ${failed.join(", ")}`);
        }
        if (auto_update_failed.length > 0) {
          notes.push(`auto-update restore failed for ${auto_update_failed.join(", ")}`);
        }
        if (notes.length > 0) {
          set_status(`Restored ${restore.restored ?? 0} app(s); ${notes.join("; ")}`);
        } else {
          set_status("Restored all locked apps");
        }
      } else {
        const message = restore.error ?? "Restore All failed";
        set_status(message);
        show_failure_dialog("Restore All failed", message);
      }
      await reload();
    });
  }

  function apply_root(next_path: string): void {
    void run(async () => {
      const result = parse_json(await bridge.set_data_root(next_path));
      if (is_ack(result) && !result.ok) {
        const message = result.error ?? "Data directory change failed";
        set_status(message);
        show_failure_dialog("Data directory change failed", message);
        return;
      }
      const migrated = result as MigrateResult | undefined;
      await reload();
      set_status(
        migrated?.data_root
          ? `Data directory set to ${migrated.data_root}`
          : "Data directory updated",
      );
    });
  }

  function toggle_selected(appid: AppId, checked: boolean): void {
    set_selected((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(appid);
      } else {
        next.delete(appid);
      }
      return next;
    });
  }

  function toggle_all(checked: boolean): void {
    set_selected(checked ? new Set(records.map((record) => record.appid)) : new Set());
  }

  const all_selected = records.length > 0 && records.every((record) => selected.has(record.appid));
  const can_open_directory =
    typeof SteamClient?.System?.OpenLocalDirectoryInSystemExplorer === "function";

  return (
    <div ref={page_ref} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <SectionHeader>Locked Apps</SectionHeader>
      {records.length === 0 ? (
        <div style={MUTED_TEXT_STYLE}>No locked apps.</div>
      ) : (
        <>
          <div style={ACTION_ROW_STYLE}>
            <div style={BUTTON_HALF_STYLE}>
              <ActionButton button_class={button_class} disabled={busy} onClick={batch_refresh}>
                Refresh selected
              </ActionButton>
            </div>
            <div style={BUTTON_HALF_STYLE}>
              <ActionButton button_class={button_class} disabled={busy} onClick={batch_unlock}>
                Unlock selected
              </ActionButton>
            </div>
            {busy ? <Spinner /> : null}
          </div>
          <div style={TABLE_CONTAINER_STYLE}>
            <div style={HEADER_ROW_STYLE}>
              <div style={HEADER_CELL_STYLE}>
                <DialogCheckbox
                  bottomSeparator="none"
                  checked={all_selected}
                  controlled
                  onChange={toggle_all}
                  tooltip="Select all"
                />
              </div>
              <div style={HEADER_CELL_STYLE}>NAME</div>
            </div>
            {records.map((record) => {
              const installed = is_installed(record.appid);
              return (
                <div key={record.appid} style={RECORD_STYLE}>
                  <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                    <DialogCheckbox
                      bottomSeparator="none"
                      checked={selected.has(record.appid)}
                      controlled
                      onChange={(checked) => toggle_selected(record.appid, checked)}
                    />
                    <span style={{ flex: "1 1 0", fontSize: TABLE_FONT_SIZE, minWidth: 0 }}>
                      {record.name} <span style={{ color: MUTED_COLOR }}>({record.appid})</span>
                    </span>
                  </div>
                  <div style={{ ...MUTED_TEXT_STYLE, lineHeight: "20px" }}>
                    <div>Locked: {format_time(record.locked_at)}</div>
                    <div>Refreshed: {format_time(record.refreshed_at)}</div>
                    <div>Installed: {installed ? "Yes" : "No"}</div>
                  </div>
                  {installed ? null : (
                    <div style={MUTED_TEXT_STYLE}>
                      This app is no longer installed; Unlock removes the orphaned lock record.
                    </div>
                  )}
                  <div style={ACTION_ROW_STYLE}>
                    {installed ? (
                      <div style={BUTTON_HALF_STYLE}>
                        <ActionButton
                          button_class={button_class}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await refresh_one(record.appid);
                              await reload();
                            })
                          }
                        >
                          Refresh
                        </ActionButton>
                      </div>
                    ) : null}
                    <div style={installed ? BUTTON_HALF_STYLE : BUTTON_FULL_STYLE}>
                      <ActionButton
                        button_class={button_class}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await unlock_one(record.appid);
                            await reload();
                          })
                        }
                      >
                        Unlock
                      </ActionButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SectionDivider color={divider} />

      <SectionHeader>Maintenance</SectionHeader>
      <div style={ACTION_ROW_STYLE}>
        <div style={BUTTON_FULL_STYLE}>
          <ActionButton button_class={button_class} disabled={busy} onClick={restore_all}>
            Restore All
          </ActionButton>
        </div>
      </div>

      <SectionDivider color={divider} />

      <SectionHeader>Data Directory</SectionHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <TextField
          label="Data root directory"
          value={path_draft}
          onChange={(event) => set_path_draft(event.target.value)}
        />
        <div style={ACTION_ROW_STYLE}>
          <div style={BUTTON_HALF_STYLE}>
            <ActionButton
              button_class={button_class}
              disabled={busy}
              onClick={() => apply_root(path_draft)}
            >
              Change
            </ActionButton>
          </div>
          <div style={BUTTON_HALF_STYLE}>
            <ActionButton
              button_class={button_class}
              disabled={busy}
              onClick={() => {
                set_path_draft("");
                apply_root("");
              }}
            >
              Reset to Default
            </ActionButton>
          </div>
        </div>
        <div style={ACTION_ROW_STYLE}>
          <div style={BUTTON_FULL_STYLE}>
            <ActionButton
              button_class={button_class}
              disabled={busy || !can_open_directory}
              onClick={() => {
                if (can_open_directory && roots) {
                  SteamClient.System.OpenLocalDirectoryInSystemExplorer(roots.data_root);
                }
              }}
            >
              Open Folder
            </ActionButton>
          </div>
        </div>
      </div>

      {status ? <div style={MUTED_TEXT_STYLE}>{status}</div> : null}
    </div>
  );
}
