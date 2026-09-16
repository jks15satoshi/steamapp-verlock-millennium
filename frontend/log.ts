import * as bridge from "./bridge";

const PREFIX = "[steamapp-verlock]";

type Level = "info" | "warn" | "error";

function relay(level: Level, message: string): void {
  try {
    void bridge.append_log(level, message).catch(() => {});
  } catch {
    // A logging failure never interrupts the caller.
  }
}

export function log_info(message: string): void {
  console.log(`${PREFIX} ${message}`);
  relay("info", message);
}

export function log_warn(message: string): void {
  console.warn(`${PREFIX} ${message}`);
  relay("warn", message);
}

export function log_error(message: string): void {
  console.error(`${PREFIX} ${message}`);
  relay("error", message);
}
