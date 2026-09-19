import type { AppId, CaptureResult, CaptureSet, RequiredAppsResult } from "./index";
import * as bridge from "./bridge";
import { log_error, log_info, log_warn } from "./log";

const CAPTURE_TIME_LIMIT_MS = 2000;
const CAPTURE_SET_TIME_LIMIT_MS = 60000;
const CAPTURE_SAMPLE_INTERVAL_MS = 100;
const NUMERIC_APPID_PATTERN = /^[0-9]+$/;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function build_app_info_print_command(appid: AppId): string | null {
  if (!NUMERIC_APPID_PATTERN.test(appid)) {
    return null;
  }
  return `app_info_print ${appid}`;
}

function has_app_block(dump: string, appid: AppId): boolean {
  return dump.includes(`"${appid}"`) && dump.includes('"depots"');
}

function as_app_list(value: unknown): AppId[] | null {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return [];
  }
  return null;
}

export async function capture_build_info(appid: AppId): Promise<CaptureResult> {
  const command = build_app_info_print_command(appid);
  if (command === null) {
    log_warn(`refused to capture build info for a non-numeric appid: ${appid}`);
    return {
      ok: false,
      error: `Refusing to build a console command for a non-numeric appid: ${appid}`,
    };
  }

  const console_api = SteamClient?.Console;
  if (
    typeof console_api?.RegisterForSpewOutput !== "function" ||
    typeof console_api?.ExecCommand !== "function"
  ) {
    log_error(`capture failed for app ${appid}: Steam console is unavailable`);
    return { ok: false, error: "Steam console is unavailable" };
  }

  let captured = "";
  const handle = console_api.RegisterForSpewOutput((output) => {
    captured += output.spew;
  });

  try {
    captured = "";
    console_api.ExecCommand(command);

    const started_at = Date.now();
    while (Date.now() - started_at < CAPTURE_TIME_LIMIT_MS) {
      if (has_app_block(captured, appid)) {
        break;
      }
      await delay(CAPTURE_SAMPLE_INTERVAL_MS);
    }

    if (!has_app_block(captured, appid)) {
      log_error(`capture failed for app ${appid}: the client returned no app info`);
      return { ok: false, error: "the client returned no app info" };
    }

    log_info(`captured build info for app ${appid}`);
    return { ok: true, appid, dump: captured };
  } finally {
    handle.unregister();
  }
}

export async function capture_build_info_set(appid: AppId): Promise<CaptureSet> {
  const base = await capture_build_info(appid);
  if (!base.ok) {
    return { ok: false, error: base.error };
  }

  const dumps: Record<AppId, string> = { [appid]: base.dump };
  let required: AppId[];
  try {
    const result = parse_json(await bridge.get_required_apps(appid, base.dump)) as
      | RequiredAppsResult
      | undefined;
    const apps = result?.ok === true ? as_app_list(result.apps) : null;
    if (apps === null) {
      return {
        ok: false,
        error: result?.error ?? "the backend returned an invalid required-apps response",
      };
    }
    required = apps;
  } catch (error) {
    return { ok: false, error: `could not determine the required apps: ${String(error)}` };
  }

  const started_at = Date.now();
  for (const dlc_appid of required) {
    if (Date.now() - started_at > CAPTURE_SET_TIME_LIMIT_MS) {
      return { ok: false, error: "the build info capture exceeded its time budget" };
    }
    const captured = await capture_build_info(dlc_appid);
    if (!captured.ok) {
      return { ok: false, error: captured.error };
    }
    dumps[dlc_appid] = captured.dump;
  }
  return { ok: true, dumps };
}

export async function capture_then_refresh(appid: AppId): Promise<void> {
  const captured = await capture_build_info_set(appid);
  if (!captured.ok) {
    return;
  }
  try {
    await bridge.refresh_app(appid, captured.dumps);
  } catch {
    return;
  }
}
