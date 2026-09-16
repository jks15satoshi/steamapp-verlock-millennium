import type { Ack, AppId, CaptureResult } from "./index";
import * as bridge from "./bridge";
import { log_error, log_info, log_warn } from "./log";

const CAPTURE_TIME_LIMIT_MS = 2000;
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

function is_ack(value: unknown): value is Ack {
  return Boolean(value) && typeof value === "object" && typeof (value as Ack).ok === "boolean";
}

function build_app_info_print_command(appid: AppId): string | null {
  if (!NUMERIC_APPID_PATTERN.test(appid)) {
    return null;
  }
  return `app_info_print ${appid}`;
}

async function store_build_info(appid: AppId, dump: string): Promise<Ack> {
  try {
    const stored = parse_json(await bridge.set_build_info(appid, dump));
    if (is_ack(stored)) {
      return stored;
    }
    return { ok: false, error: "Invalid set_build_info response" };
  } catch {
    return { ok: false, error: "Failed to store build info" };
  }
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
    console_api.ExecCommand("app_info_update 1");

    const started_at = Date.now();
    let baseline: string | null = null;
    let latest = "";

    while (Date.now() - started_at < CAPTURE_TIME_LIMIT_MS) {
      captured = "";
      console_api.ExecCommand(command);
      await delay(CAPTURE_SAMPLE_INTERVAL_MS);

      const dump = captured;
      if (dump.trim().length === 0) {
        if (Date.now() - started_at >= CAPTURE_TIME_LIMIT_MS) {
          break;
        }
        continue;
      }

      latest = dump;

      if (baseline === null) {
        baseline = dump;
        continue;
      }

      if (dump !== baseline) {
        const stored = await store_build_info(appid, dump);
        if (!stored.ok) {
          log_error(
            `capture failed for app ${appid}: ${stored.error ?? "Failed to store build info"}`,
          );
          return { ok: false, error: stored.error ?? "Failed to store build info" };
        }
        log_info(`captured build info for app ${appid}`);
        return { ok: true, appid, dump };
      }
    }

    if (latest.trim().length === 0) {
      log_warn(`capture failed for app ${appid}: Timed out waiting for app info`);
      return { ok: false, error: "Timed out waiting for app info" };
    }

    const stored = await store_build_info(appid, latest);
    if (!stored.ok) {
      log_error(`capture failed for app ${appid}: ${stored.error ?? "Failed to store build info"}`);
      return { ok: false, error: stored.error ?? "Failed to store build info" };
    }
    log_info(`captured build info for app ${appid}`);
    return { ok: true, appid, dump: latest };
  } finally {
    handle.unregister();
  }
}

export async function capture_then_refresh(appid: AppId): Promise<void> {
  const captured = await capture_build_info(appid);
  if (!captured.ok) {
    return;
  }
  try {
    await bridge.refresh_app(appid);
  } catch {
    return;
  }
}
