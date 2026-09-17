import type { ReactNode } from "react";
import * as millennium from "millennium";
import { format_error } from "./errors";
import { log_error, log_warn } from "./log";

export { format_error } from "./errors";

const TOAST_TITLE = "Steam App Verlock";

let active: ReturnType<typeof millennium.showModal> | null = null;

function fallback_copy(text: string): void {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  } catch {
    // Copying is best-effort; the text stays selectable in the dialog.
  }
}

function copy_text(text: string): void {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard !== undefined && typeof clipboard.writeText === "function") {
      void Promise.resolve(clipboard.writeText(text)).catch(() => {
        fallback_copy(text);
      });
      return;
    }
  } catch {
    // Fall through to the legacy path.
  }
  fallback_copy(text);
}

export function show_failure_dialog(title: string, message: string): void {
  try {
    open_failure_dialog(title, message);
  } catch (error) {
    log_error(`could not show the failure dialog: ${format_error(error)}`);
    try {
      millennium.toaster.toast({ title, body: `${title}: ${message}`, critical: true });
    } catch {
      // A failed fallback never changes the operation's result.
    }
  }
}

function dialog_content(
  title: string,
  message: string,
  copied: boolean,
  on_copy: () => void,
  on_close: () => void,
): ReactNode {
  const ConfirmModal = millennium.ConfirmModal;
  if (typeof ConfirmModal === "function") {
    return (
      <ConfirmModal
        strTitle={title}
        strDescription={
          <div
            style={{
              whiteSpace: "pre-wrap",
              userSelect: "text",
              maxHeight: "240px",
              overflowY: "auto",
            }}
          >
            {message}
          </div>
        }
        strOKButtonText="Close"
        onOK={on_close}
        onCancel={on_close}
        strMiddleButtonText={copied ? "Copied" : "Copy error"}
        bMiddleDisabled={copied}
        onMiddleButton={on_copy}
        bAlertDialog
      />
    );
  }
  const Header = millennium.DialogHeader;
  return (
    <div className="DialogContent_InnerWidth">
      {typeof Header === "function" ? (
        <Header>{title}</Header>
      ) : (
        <div style={{ padding: "12px", fontWeight: 700 }}>{title}</div>
      )}
      <div
        style={{
          whiteSpace: "pre-wrap",
          userSelect: "text",
          maxHeight: "240px",
          overflowY: "auto",
          padding: "12px",
        }}
      >
        {message}
      </div>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", padding: "12px" }}>
        <button type="button" onClick={on_copy} disabled={copied}>
          {copied ? "Copied" : "Copy error"}
        </button>
        <button type="button" onClick={on_close}>
          Close
        </button>
      </div>
    </div>
  );
}

function open_failure_dialog(title: string, message: string): void {
  if (typeof millennium.showModal !== "function") {
    throw new Error("the Millennium showModal export is unavailable");
  }

  let copied = false;

  function close(): void {
    active?.Close();
    active = null;
  }

  function copy(): void {
    copy_text(message);
    copied = true;
    active?.Update(render());
  }

  function render(): ReactNode {
    return dialog_content(title, message, copied, copy, close);
  }

  if (active !== null) {
    active.Update(render());
    return;
  }
  active = millennium.showModal(render(), undefined, {
    fnOnClose: () => {
      active = null;
    },
  });
}

export function report_failure(title: string, message: string): void {
  log_error(message);
  show_failure_dialog(title, message);
}

export function report_warning(message: string, title = TOAST_TITLE): void {
  log_warn(message);
  try {
    millennium.toaster.toast({ title, body: message });
  } catch {
    // A failed toast never changes the operation's result.
  }
}
