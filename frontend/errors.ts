export function format_error(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === undefined || error === null) {
    return "Unknown error";
  }
  if (typeof error === "object") {
    try {
      const text = JSON.stringify(error);
      if (text !== undefined) {
        return text;
      }
    } catch {
      // Fall through to the base object form.
    }
    return "[object Object]";
  }
  if (typeof error === "symbol" || typeof error === "function") {
    return error.toString();
  }
  return String(error as string);
}
