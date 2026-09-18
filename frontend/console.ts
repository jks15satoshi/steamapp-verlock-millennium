import type { AppId, CaptureResult } from "./index";
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

function build_app_info_print_command(appid: AppId): string | null {
  if (!NUMERIC_APPID_PATTERN.test(appid)) {
    return null;
  }
  return `app_info_print ${appid}`;
}

function has_app_block(dump: string, appid: AppId): boolean {
  return dump.includes(`"${appid}"`) && dump.includes('"depots"');
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

export async function capture_then_refresh(appid: AppId): Promise<void> {
  const captured = await capture_build_info(appid);
  if (!captured.ok) {
    return;
  }
  try {
    await bridge.refresh_app(appid, captured.dump);
  } catch {
    return;
  }
}
