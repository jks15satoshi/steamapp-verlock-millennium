import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import * as millennium from "millennium";
import { format_error } from "./errors";
import { log_error, log_warn } from "./log";

export { format_error } from "./errors";

const TOAST_TITLE = "Steam App Verlock";

const NOTE_STYLE: CSSProperties = {
  color: "#8b929a",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 6px",
};

const BODY_STYLE: CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  userSelect: "text",
  height: "320px",
  overflowY: "auto",
  padding: "18px 20px",
  border: "1px solid rgb(14, 20, 27)",
  borderRadius: "2px",
  boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 4px 0px inset",
  background: "rgb(35, 38, 46)",
  color: "rgb(184, 188, 191)",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "10px 0 0",
};

let active: ReturnType<typeof millennium.showModal> | null = null;
let copy_timer: ReturnType<typeof setTimeout> | null = null;

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

function dialog_buttons(
  parent: EventTarget | undefined,
  on_found: (buttons: HTMLButtonElement[]) => void,
): void {
  try {
    const owner = (parent as Window | undefined)?.document ?? document;
    const marker = owner.querySelector("[data-verlock-dialog]");
    if (marker === null) {
      return;
    }
    let node: Element | null = marker.parentElement;
    while (node !== null) {
      const buttons = [...node.querySelectorAll("button")] as HTMLButtonElement[];
      if (buttons.length >= 2) {
        on_found(buttons);
        return;
      }
      node = node.parentElement;
    }
  } catch {
    // Dialog DOM lookups are best-effort.
  }
}

function hide_cancel(parent: EventTarget | undefined): void {
  dialog_buttons(parent, (buttons) => {
    for (const button of buttons) {
      if ((button.textContent ?? "").trim() === "Cancel") {
        button.style.display = "none";
      }
    }
  });
}

function DialogView({
  title,
  message,
  note,
  copy_label,
  copied,
  on_copy,
  on_close,
}: {
  title: string;
  message: string;
  note?: string;
  copy_label: string;
  copied: boolean;
  on_copy: () => void;
  on_close: () => void;
}): ReactNode {
  const ConfirmModal = millennium.ConfirmModal;
  if (typeof ConfirmModal === "function") {
    return (
      <ConfirmModal
        strTitle={title}
        strDescription={
          <div data-verlock-dialog="">
            {note !== undefined ? <div style={NOTE_STYLE}>{note}</div> : null}
            <div style={BODY_STYLE}>{message}</div>
          </div>
        }
        strOKButtonText={copied ? "Copied" : copy_label}
        onOK={on_copy}
        onEscKeypress={on_close}
        strMiddleButtonText="Close"
        onMiddleButton={on_close}
        strCancelButtonText="Cancel"
        onCancel={on_close}
        bAlertDialog={false}
      />
    );
  }

  const Header = millennium.DialogHeader;
  const Button = millennium.Button;
  const footer_button = (label: string, on_click: () => void): ReactNode =>
    typeof Button === "function" ? (
      <Button onClick={on_click}>{label}</Button>
    ) : (
      <button type="button" onClick={on_click}>
        {label}
      </button>
    );
  return (
    <div
      className="DialogContent_InnerWidth"
      style={{ background: "rgb(27, 31, 42)", padding: "24px" }}
    >
      {typeof Header === "function" ? (
        <Header>{title}</Header>
      ) : (
        <div style={{ fontWeight: 700 }}>{title}</div>
      )}
      <div style={{ margin: "12px 0" }}>
        {note !== undefined ? <div style={NOTE_STYLE}>{note}</div> : null}
        <div style={BODY_STYLE}>{message}</div>
      </div>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        {footer_button(copied ? "Copied" : copy_label, on_copy)}
        {footer_button("Close", on_close)}
      </div>
    </div>
  );
}

function DialogHost({
  title,
  message,
  note,
  copy_label,
  parent,
  on_close,
}: {
  title: string;
  message: string;
  note?: string;
  copy_label: string;
  parent: EventTarget | undefined;
  on_close: () => void;
}): ReactNode {
  const [copied, set_copied] = useState(false);

  useEffect(() => {
    hide_cancel(parent);
  }, [parent, copied]);

  useEffect(
    () => () => {
      if (copy_timer !== null) {
        clearTimeout(copy_timer);
        copy_timer = null;
      }
    },
    [],
  );

  const copy = (): void => {
    copy_text(message);
    set_copied(true);
    if (copy_timer !== null) {
      clearTimeout(copy_timer);
    }
    copy_timer = setTimeout(() => {
      copy_timer = null;
      set_copied(false);
    }, 1000);
  };

  return (
    <DialogView
      title={title}
      message={message}
      note={note}
      copy_label={copy_label}
      copied={copied}
      on_copy={copy}
      on_close={on_close}
    />
  );
}

function default_parent(): EventTarget | undefined {
  if (typeof window !== "undefined") {
    return window;
  }
  return undefined;
}

function open_dialog(
  title: string,
  message: string,
  parent: EventTarget | undefined,
  copy_label: string,
  note?: string,
): void {
  if (typeof millennium.showModal !== "function") {
    throw new Error("the Millennium showModal export is unavailable");
  }

  if (active !== null) {
    active.Close();
    active = null;
  }
  if (copy_timer !== null) {
    clearTimeout(copy_timer);
    copy_timer = null;
  }

  const modal_parent = parent ?? default_parent();
  active = millennium.showModal(
    <DialogHost
      title={title}
      message={message}
      note={note}
      copy_label={copy_label}
      parent={modal_parent}
      on_close={() => {
        if (copy_timer !== null) {
          clearTimeout(copy_timer);
          copy_timer = null;
        }
        active?.Close();
        active = null;
      }}
    />,
    modal_parent,
    {
      fnOnClose: () => {
        if (copy_timer !== null) {
          clearTimeout(copy_timer);
          copy_timer = null;
        }
        active = null;
      },
    },
  );
}

export function show_failure_dialog(title: string, message: string, parent?: EventTarget): void {
  try {
    open_dialog(title, message, parent, "Copy error");
    return;
  } catch (error) {
    log_error(`could not show the failure dialog: ${format_error(error)}`);
  }
  try {
    millennium.toaster.toast({ title, body: `${title}: ${message}`, critical: true });
  } catch {
    // A failed fallback never changes the operation's result.
  }
}

export function show_text_dialog(
  title: string,
  message: string,
  parent?: EventTarget,
  note?: string,
): void {
  try {
    open_dialog(title, message, parent, "Copy", note);
    return;
  } catch (error) {
    log_error(`could not show the text dialog: ${format_error(error)}`);
  }
  try {
    millennium.toaster.toast({ title, body: "could not display the file content" });
  } catch {
    // A failed fallback never changes the operation's result.
  }
}

export function report_failure(title: string, message: string, parent?: EventTarget): void {
  log_error(message);
  show_failure_dialog(title, message, parent);
}

export function report_warning(message: string, title = TOAST_TITLE): void {
  log_warn(message);
  try {
    millennium.toaster.toast({ title, body: message });
  } catch {
    // A failed toast never changes the operation's result.
  }
}

export function report_success(message: string, title = TOAST_TITLE): void {
  try {
    millennium.toaster.toast({ title, body: message });
  } catch {
    // A failed toast never changes the operation's result.
  }
}
