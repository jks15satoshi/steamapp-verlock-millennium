import { DialogCheckbox, Spinner, TextField } from "millennium";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AppId, DataRoots, LockedAppRecord, MigrateResult } from "./index";
import { capture_build_info_set } from "./console";
import { app_name, reapply_all, unwatch_all_then_restore, unwatch_then_unlock } from "./watch";
import { as_record_list, sync_locked_ids } from "./locked";
import * as bridge from "./bridge";
import { log_error, log_warn } from "./log";
import { current_locale_tag, refresh_locale, resolve_error, t } from "./i18n";
import { format_error, report_failure, report_success, show_failure_dialog } from "./notify";
import { is_ack, parse_json } from "./shared";
import { current_clock_format, format_time, subscribe_clock_format } from "./time";
import type { ClockFormat } from "./time";
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
  const [clock, set_clock] = useState<ClockFormat>(() => current_clock_format());
  const page_ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribe_clock_format(() => set_clock(current_clock_format())), []);

  useEffect(() => {
    void refresh_locale();
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = parse_json(await bridge.list_locked());
      const loaded_records = as_record_list(list);
      if (is_ack(list) && !list.ok) {
        log_warn(`could not load the lock state: ${list.error ?? "unavailable"}`);
        set_status(t("settings.status.load_unavailable"));
      } else {
        set_records(loaded_records ?? []);
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
      set_status(t("settings.status.load_failed"));
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
      set_status(t("settings.status.operation_failed"));
      report_failure(t("settings.status.operation_failed"), format_error(error));
    } finally {
      set_busy(false);
    }
  }

  async function refresh_one(appid: AppId): Promise<boolean> {
    const title = t("settings.dialog.refresh_failed", { appid });
    const captured = await capture_build_info_set(appid);
    if (!captured.ok) {
      const message = resolve_error(captured);
      set_status(message);
      show_failure_dialog(title, message);
      return false;
    }

    const refreshed = parse_json(await bridge.refresh_app(appid, captured.dumps));
    if (is_ack(refreshed) && !refreshed.ok) {
      const message = resolve_error(refreshed);
      set_status(message);
      show_failure_dialog(title, message);
      return false;
    }
    return true;
  }

  async function unlock_one(appid: AppId): Promise<boolean> {
    const result = await unwatch_then_unlock(appid);
    if (!result.ok) {
      const message = resolve_error(result);
      set_status(message);
      show_failure_dialog(t("settings.dialog.unlock_failed", { appid }), message);
      return false;
    }
    if (result.auto_update_restored === false) {
      set_status(t("settings.status.unlocked_auto_update_failed", { appid }));
      return false;
    }
    return true;
  }

  function batch_refresh(): void {
    const targets = records.filter((record) => selected.has(record.appid));
    void run(async () => {
      let count = 0;
      for (const record of targets) {
        if (await refresh_one(record.appid)) {
          count += 1;
        }
      }
      if (count > 0) {
        report_success(t("settings.status.refreshed_count", { count }));
      }
      await reload();
    });
  }

  function batch_unlock(): void {
    const targets = records.filter((record) => selected.has(record.appid));
    void run(async () => {
      let count = 0;
      for (const record of targets) {
        if (await unlock_one(record.appid)) {
          count += 1;
        }
      }
      if (count > 0) {
        report_success(t("settings.status.unlocked_count", { count }));
      }
      await reload();
    });
  }

  function restore_all(): void {
    const snapshot = records;
    void run(async () => {
      const restore = await unwatch_all_then_restore(snapshot.map((record) => record.appid));
      if (restore.ok) {
        const failed = Array.isArray(restore.failed) ? restore.failed : [];
        const auto_update_failed = Array.isArray(restore.auto_update_failed)
          ? restore.auto_update_failed
          : [];
        const notes: string[] = [];
        if (failed.length > 0) {
          notes.push(
            t("settings.status.restore_failed_count", {
              appids: failed.join(", "),
              count: failed.length,
            }),
          );
        }
        if (auto_update_failed.length > 0) {
          notes.push(
            t("settings.status.auto_update_restore_failed", {
              appids: auto_update_failed.join(", "),
            }),
          );
        }
        if (notes.length > 0) {
          set_status(
            t("settings.status.restored_partial", {
              count: restore.restored ?? 0,
              notes: notes.join("; "),
            }),
          );
        } else {
          set_status(t("settings.status.restored_all"));
        }
      } else {
        const message = resolve_error(restore);
        set_status(message);
        show_failure_dialog(t("settings.dialog.restore_failed"), message);
      }
      await reload();
    });
  }

  function apply_root(next_path: string): void {
    void run(async () => {
      const result = parse_json(await bridge.set_data_root(next_path));
      if (is_ack(result) && !result.ok) {
        const message = resolve_error(result);
        set_status(message);
        show_failure_dialog(t("settings.dialog.data_root_failed"), message);
        return;
      }
      const migrated = result as MigrateResult | undefined;
      await reload();
      set_status(
        migrated?.data_root
          ? t("settings.status.data_root_set", { path: migrated.data_root })
          : t("settings.status.data_root_updated"),
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
      <SectionHeader>{t("settings.locked_apps")}</SectionHeader>
      {records.length === 0 ? (
        <div style={MUTED_TEXT_STYLE}>{t("settings.no_locked_apps")}</div>
      ) : (
        <>
          <div style={ACTION_ROW_STYLE}>
            <div style={BUTTON_HALF_STYLE}>
              <ActionButton button_class={button_class} disabled={busy} onClick={batch_refresh}>
                {t("settings.refresh_selected")}
              </ActionButton>
            </div>
            <div style={BUTTON_HALF_STYLE}>
              <ActionButton button_class={button_class} disabled={busy} onClick={batch_unlock}>
                {t("settings.unlock_selected")}
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
                  tooltip={t("settings.select_all")}
                />
              </div>
              <div style={HEADER_CELL_STYLE}>{t("settings.name_column")}</div>
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
                    <div>
                      {t("settings.locked_at")}{" "}
                      {format_time(record.locked_at, clock, {
                        locale: current_locale_tag(),
                        fallback: t("common.never"),
                      })}
                    </div>
                    <div>
                      {t("settings.refreshed_at")}{" "}
                      {format_time(record.refreshed_at, clock, {
                        locale: current_locale_tag(),
                        fallback: t("common.never"),
                      })}
                    </div>
                    <div>
                      {t("settings.installed")} {installed ? t("common.yes") : t("common.no")}
                    </div>
                  </div>
                  {installed ? null : <div style={MUTED_TEXT_STYLE}>{t("settings.orphaned")}</div>}
                  <div style={ACTION_ROW_STYLE}>
                    {installed ? (
                      <div style={BUTTON_HALF_STYLE}>
                        <ActionButton
                          button_class={button_class}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (await refresh_one(record.appid)) {
                                report_success(
                                  t("actions.refreshed_success", {
                                    name: app_name(record.appid, record.name),
                                  }),
                                );
                              }
                              await reload();
                            })
                          }
                        >
                          {t("menu.refresh")}
                        </ActionButton>
                      </div>
                    ) : null}
                    <div style={installed ? BUTTON_HALF_STYLE : BUTTON_FULL_STYLE}>
                      <ActionButton
                        button_class={button_class}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (await unlock_one(record.appid)) {
                              report_success(
                                t("actions.unlocked_success", {
                                  name: app_name(record.appid, record.name),
                                }),
                              );
                            }
                            await reload();
                          })
                        }
                      >
                        {t("menu.unlock")}
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

      <SectionHeader>{t("settings.maintenance")}</SectionHeader>
      <div style={ACTION_ROW_STYLE}>
        <div style={BUTTON_FULL_STYLE}>
          <ActionButton button_class={button_class} disabled={busy} onClick={restore_all}>
            {t("settings.restore_all")}
          </ActionButton>
        </div>
      </div>

      <SectionDivider color={divider} />

      <SectionHeader>{t("settings.data_directory")}</SectionHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <TextField
          label={t("settings.data_root_label")}
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
              {t("settings.change")}
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
              {t("settings.reset_to_default")}
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
              {t("settings.open_folder")}
            </ActionButton>
          </div>
        </div>
      </div>

      {status ? <div style={MUTED_TEXT_STYLE}>{status}</div> : null}
    </div>
  );
}
