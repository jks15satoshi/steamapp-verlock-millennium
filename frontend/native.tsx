import type { ReactNode } from "react";

const ACCENT_FALLBACK = "#1a9fff";

export function accent_color(document_ref: Document): string {
  const view = document_ref.defaultView;
  if (!view) {
    return ACCENT_FALLBACK;
  }
  let best: { color: string; size: number } | null = null;
  let scanned = 0;
  for (const element of document_ref.querySelectorAll("div, span, a")) {
    scanned += 1;
    if (scanned > 4000) {
      break;
    }
    const style = view.getComputedStyle(element);
    const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(style.color);
    if (!match) {
      continue;
    }
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (b - r <= 30 || b <= 120) {
      continue;
    }
    const size = Number.parseFloat(style.fontSize) || 0;
    if (best === null || size > best.size) {
      best = { color: `rgb(${r}, ${g}, ${b})`, size };
    }
  }
  return best?.color ?? ACCENT_FALLBACK;
}

export const DIVIDER_FALLBACK = "rgba(59, 63, 72, 0.5)";

export function divider_color(document_ref: Document): string {
  const view = document_ref.defaultView;
  if (!view) {
    return DIVIDER_FALLBACK;
  }
  let scanned = 0;
  for (const element of document_ref.querySelectorAll("div")) {
    scanned += 1;
    if (scanned > 4000) {
      break;
    }
    const style = view.getComputedStyle(element);
    if (
      style.borderTopStyle === "solid" &&
      style.borderTopWidth !== "0px" &&
      style.borderLeftWidth === "0px" &&
      style.borderRightWidth === "0px" &&
      style.borderBottomWidth === "0px"
    ) {
      return style.borderTopColor;
    }
  }
  return DIVIDER_FALLBACK;
}

export const MUTED_COLOR = "#8b929a";

const BUTTON_CLASS_KEY = "steamapp-verlock.button_class";

export const BUTTON_CLASS_FALLBACK =
  "_1KAp5PPYG7si-T_66zNEcU DialogButton _DialogLayout Secondary Focusable";

export function native_button_class(root: ParentNode, our_page: Element): string | undefined {
  for (const button of root.querySelectorAll("button")) {
    if (our_page.contains(button)) {
      continue;
    }
    const name = button.getAttribute("class") ?? "";
    if (
      name.includes("DialogButton") &&
      name.includes("Secondary") &&
      !name.includes("Primary") &&
      name.split(/\s+/).some((part) => part.startsWith("_"))
    ) {
      return name;
    }
  }
  return undefined;
}

export function read_button_class(root: ParentNode, our_page: Element): string {
  const sampled = native_button_class(root, our_page);
  if (sampled !== undefined) {
    try {
      window.localStorage.setItem(BUTTON_CLASS_KEY, sampled);
    } catch {
      // A storage failure only costs the cached class.
    }
    return sampled;
  }
  try {
    const stored = window.localStorage.getItem(BUTTON_CLASS_KEY);
    if (stored !== null && stored.includes("Secondary") && !stored.includes("Primary")) {
      return stored;
    }
  } catch {
    // A storage failure only costs the cached class.
  }
  return BUTTON_CLASS_FALLBACK;
}

export function ActionButton({
  button_class,
  disabled,
  onClick,
  children,
}: {
  button_class: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={button_class} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
