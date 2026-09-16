import { Button, PanelSection, PanelSectionRow, Spinner, TextField } from "millennium";
import { useCallback, useEffect, useState } from "react";
import type { Ack, AppId, DataRoots, LockedAppRecord, MigrateResult } from "./index";
import { capture_build_info } from "./console";
import { reapply_all, unwatch_all_then_restore, unwatch_then_unlock } from "./watch";
import { as_record_list, sync_locked_ids } from "./locked";
import * as bridge from "./bridge";

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
  return new Date(value * 1000).toLocaleString();
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

  const reload = useCallback(async () => {
    try {
      const list = parse_json(await bridge.list_locked());
      const records = as_record_list(list);
      if (is_ack(list) && !list.ok) {
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
    } catch {
      set_status("Failed to load lock state");
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
    } catch {
      set_status("Operation failed");
    } finally {
      set_busy(false);
    }
  }

  async function refresh_one(appid: AppId): Promise<void> {
    const captured = await capture_build_info(appid);
    if (!captured.ok) {
      set_status(captured.error);
      return;
    }

    const refreshed = parse_json(await bridge.refresh_app(appid));
    if (is_ack(refreshed) && !refreshed.ok) {
      set_status(refreshed.error ?? "Refresh failed");
    }
  }

  async function unlock_one(appid: AppId): Promise<void> {
    const result = await unwatch_then_unlock(appid);
    if (!result.ok) {
      set_status(result.error ?? "Unlock failed");
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
        set_status(restore.error ?? "Restore All failed");
      }
      await reload();
    });
  }

  function apply_root(next_path: string): void {
    void run(async () => {
      const result = parse_json(await bridge.set_data_root(next_path));
      if (is_ack(result) && !result.ok) {
        set_status(result.error ?? "Data directory change failed");
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
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "8px" }}>
      <PanelSection title="Locked Apps">
        {records.length === 0 ? (
          <PanelSectionRow>
            <div>No locked apps.</div>
          </PanelSectionRow>
        ) : (
          <>
            <PanelSectionRow>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="checkbox"
                    checked={all_selected}
                    onChange={(event) => toggle_all(event.target.checked)}
                  />
                  Select all
                </label>
                <Button disabled={busy} onClick={batch_refresh}>
                  Refresh selected
                </Button>
                <Button disabled={busy} onClick={batch_unlock}>
                  Unlock selected
                </Button>
                {busy ? <Spinner /> : null}
              </div>
            </PanelSectionRow>

            {records.map((record) => {
              const installed = is_installed(record.appid);
              return (
                <PanelSectionRow key={record.appid}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      padding: "8px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "4px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(record.appid)}
                        onChange={(event) => toggle_selected(record.appid, event.target.checked)}
                      />
                      <strong>{record.name}</strong>
                      <span>({record.appid})</span>
                    </div>
                    <div>Locked: {format_time(record.locked_at)}</div>
                    <div>Refreshed: {format_time(record.refreshed_at)}</div>
                    <div>Installed: {installed ? "Yes" : "No"}</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {installed ? (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await refresh_one(record.appid);
                              await reload();
                            })
                          }
                        >
                          Refresh
                        </Button>
                      ) : null}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await unlock_one(record.appid);
                            await reload();
                          })
                        }
                      >
                        Unlock
                      </Button>
                    </div>
                    {installed ? null : (
                      <div>
                        This app is no longer installed; Unlock removes the orphaned lock record.
                      </div>
                    )}
                  </div>
                </PanelSectionRow>
              );
            })}
          </>
        )}
      </PanelSection>

      <PanelSection title="Maintenance">
        <PanelSectionRow>
          <Button disabled={busy} onClick={restore_all}>
            Restore All
          </Button>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Data Directory">
        <PanelSectionRow>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <TextField
              label="Data root directory"
              value={path_draft}
              onChange={(event) => set_path_draft(event.target.value)}
            />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Button disabled={busy} onClick={() => apply_root(path_draft)}>
                Change
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  set_path_draft("");
                  apply_root("");
                }}
              >
                Reset to Default
              </Button>
              <Button
                disabled={busy || !can_open_directory}
                onClick={() => {
                  if (can_open_directory && roots) {
                    SteamClient.System.OpenLocalDirectoryInSystemExplorer(roots.data_root);
                  }
                }}
              >
                Open Folder
              </Button>
            </div>
            <div>Cache: {roots?.cache_root ?? "Unknown"}</div>
          </div>
        </PanelSectionRow>
      </PanelSection>

      {status ? <PanelSectionRow>{status}</PanelSectionRow> : null}
    </div>
  );
}
