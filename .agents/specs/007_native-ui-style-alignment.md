---
status: active
type: informational
---

# Spec 7 - Native UI Style Alignment

## Summary

This spec records how the plugin's injected UI matches the Steam desktop client's native dialog styling: the constraints the client imposes, the method the plugin uses to derive the styling at run time, and the values the method measured. The plugin reuses Valve's own components and class names where they are stable, and it samples the accent color and the button class name from the live client, with a cached value and a fallback, where the client keeps the styling in a hashed class. [Spec 4](004_app-version-lock.md) owns the user interface that applies the method, and [Spec 5](005_testing-strategy.md) owns its tests.

## Motivation

The plugin injects the `Steam App Verlock` tab into the app Properties dialog, an undocumented client internal whose DOM and CSS the plugin does not control. A plain HTML control inside that dialog reads as foreign: the wrong title size, button padding, and text colors, and a misaligned content inset.

Valve publishes brand guidelines and store-asset specifications, but no design system, component specification, or token set for the desktop client's internal UI. The client's CSS uses stable class names such as `DialogHeader`, `DialogBody`, and `DialogContent_InnerWidth` for part of the layout, and hashed CSS-module class names — which carry a control's padding and width — for the rest, and it is likely to hard-code colors. The theming documentation and community themes confirm that the client rarely exposes color variables and that class names can change across client versions.

A stylesheet the plugin authors by hand therefore cannot match the client reliably; the plugin derives the styling from the client at run time instead.

## Design

### Constraints

The client exposes two kinds of styling surface. Stable class names identify the dialog's layout elements, and the plugin can apply them to its own elements. Hashed CSS-module class names carry part of a control's appearance — most importantly the dialog button's `padding` and `width` — and the plugin cannot construct them; it can only read them from a rendered native element. Both kinds can change across client versions, and the accent color can change with the client theme.

### Method

The plugin aligns with the native styling in three steps.

1. Measure. A temporary probe logs a native element's computed style and bounding rectangle: `font-size`, `font-weight`, `line-height`, `color`, `margin`, `padding`, `display`, `flex`, `width`, and `rect`. The probe walks a native button's ancestor chain up to the content page to recover the element hierarchy. The probe is removed once the values are recorded.
2. Replicate. The plugin renders the native layout classes — `DialogContent_InnerWidth`, `DialogHeader`, and `DialogBody` — around its own rows, so the client's own CSS supplies the layout, the inset, and the spacing.
3. Sample. The plugin reads the values that live only in the live client: the accent color from a native element, and the full class name of a native dialog button. Each sampled value is cached in `localStorage` and backed by a fallback constant, so a first run that has not rendered a native button still styles correctly.

### Structure

The Properties content page nests three levels before the rows:

- `DialogContent _DialogLayout` — the page; `display: flex`, `flex: 3 1 0%`, `padding: 24px 0 0 24px`.
- `DialogContent_InnerWidth` — the width wrapper; `display: flex`, `flex: 1 1 0%`, the full content width.
- `DialogHeader` — the page title.
- `DialogBody` — the content body; `display: flex`, `flex: 1 1 0%`, `margin: 10px 0 0`, `padding: 0 12px 24px 0`.

Each dialog button renders as `button.<hash> DialogButton _DialogLayout Secondary Focusable`, where the leading hashed class carries the `padding` and the `width`.

### Recorded Values

The probe measured the following on the client. The accent color, the title, and the button class were measured in more than one dialog of the same client.

| Element | Property | Value |
|---|---|---|
| Content page | `padding` | `24px 0 0 24px` |
| Content page | `display`, `flex` | `flex`, `3 1 0%` |
| Inner width wrapper | `class`, `flex` | `DialogContent_InnerWidth`, `1 1 0%` |
| Title | `class` | `DialogHeader` |
| Title | `font-size`, `font-weight`, `line-height` | `22px`, `700`, `28px` |
| Title | `color`, `margin` | `rgb(255, 255, 255)`, `8px 0` |
| Body | `class`, `margin`, `padding` | `DialogBody`, `10px 0 0`, `0 12px 24px 0` |
| Body | `display`, `flex` | `flex`, `1 1 0%` |
| Row | `display`, `width`, `height` | `flex`, the content width, `38px` |
| Button | `class` | `<hash> DialogButton _DialogLayout Secondary Focusable` |
| Button | `font-size`, `line-height`, `color` | `13px`, `18px`, `rgb(223, 227, 230)` |
| Button | `padding`, `margin`, `height` | `8px 14px`, `2px 0`, `34px` |
| Label | `font-size`, `color` | `14px`, `rgb(139, 146, 154)` |
| Value | `font-size`, `font-weight`, `color` | `14px`, `500`, the accent color |
| Value | `margin-left` | `5px` |
| Accent color | sampled `color` | `rgb(26, 159, 255)` |
| Button class fallback | cached `class` | `_1KAp5PPYG7si-T_66zNEcU DialogButton _DialogLayout Secondary Focusable` |

The recorded values are the client's values at the time of measurement; they are a reference for the fallbacks, not a specification the client must keep.

### Application

`frontend/properties.tsx` applies the method. Its tab content renders `DialogContent_InnerWidth`, `DialogHeader`, and `DialogBody`, and its rows use the measured font size and line height. The accent color comes from `accent_color`, which samples the color of the largest blue text in the dialog and falls back to `#1a9fff`. The action buttons render as a plain `button` whose class name comes from `read_button_class`, which samples the full class name of a native dialog button, caches it in `localStorage` under `steamapp-verlock.button_class`, and falls back to the recorded class constant. A mutation observer re-samples the class when a native button appears.

## Risks

- A client update can rename or drop a hashed class, so the cached button class stops matching — prevention: the plugin re-samples the class whenever a native dialog button appears, and the fallback keeps a first run styled.
- A client update or a theme change can move a measured value, so the layout drifts — prevention: the layout uses the client's own classes where they exist, and this spec records the probe method for a re-measurement.
- `localStorage` can be unavailable or cleared, so the cached button class is lost — prevention: the recorded class constant is the fallback, and the class is re-sampled from a native button.
- No official Valve design specification exists for the client's internal UI, so the method cannot cite an authority — the recorded values document the client state the method targets.

## Alternatives Considered

- **Plain HTML with hand-authored styles** — rejected: the styles cannot match the client, and they drift with it.
- **Hardcoding every measured value** — rejected: the button's `padding` and `width` live in a hashed class the plugin cannot author, and the accent color follows the client theme.
- **Using only the SDK components without the native body structure** — rejected: a missing `DialogBody` loses the right inset and the vertical spacing.
- **Cloning a native DOM subtree as a template** — rejected: the client renders the subtree through React, so a clone couples the plugin to the rendered content and is invalidated on the next render.
- **Sampling at run time without a cache or a fallback** — rejected: a page with no native dialog button renders the wrong button on a first run.
