import type { Ack } from "./index";

export const NUMERIC_APPID_PATTERN = /^[0-9]+$/;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parse_json(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

export function is_ack(value: unknown): value is Ack {
  return Boolean(value) && typeof value === "object" && typeof (value as Ack).ok === "boolean";
}
