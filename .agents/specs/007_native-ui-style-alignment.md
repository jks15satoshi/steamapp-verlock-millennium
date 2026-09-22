---
status: active
type: informational
---

# Spec 7 - Native UI Style Alignment

## Summary

This spec records how the plugin's injected UI matches the Steam desktop client's native dialog styling: the constraints the client imposes, the method the plugin uses to derive the styling at run time, and the values the method measured.

The plugin reuses Valve's own components and class names where they are stable, and it samples the accent color and the button class name from the live client, with a cached value and a fallback, where the client keeps the styling in a hashed class.

[Spec 4](004_app-version-lock.md) owns the user interface that applies the method, and [Spec 5](005_testing-strategy.md) owns its tests.

## Motivation

The plugin injects the `Steam App Verlock` tab into the app Properties dialog, an undocumented client internal whose DOM and CSS the plugin does not control. A plain HTML control inside that dialog reads as foreign: the wrong title size, button padding, and text colors, and a misaligned content inset.

Valve publishes brand guidelines and store-asset specifications, but no design system, component specification, or token set for the desktop client's internal UI.

The client's CSS uses stable class names such as `DialogHeader`, `DialogBody`, and `DialogContent_InnerWidth` for part of the layout, and hashed CSS-module class names — which carry a control's padding and width — for the rest, and it is likely to hard-code colors. The theming documentation and community themes confirm that the client rarely exposes color variables and that class names can change across client versions.

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

- `DialogContent _DialogLayout`  
  The page; `display: flex`, `flex: 3 1 0%`, `padding: 24px 0 0 24px`.
- `DialogContent_InnerWidth`  
  The width wrapper; `display: flex`, `flex: 1 1 0%`, the full content width.
- `DialogHeader`  
  The page title.
- `DialogBody`  
  The content body; `display: flex`, `flex: 1 1 0%`, `margin: 10px 0 0`, `padding: 0 12px 24px 0`.

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
| Section heading | `class` | `SettingsDialogSubHeader` |
| Section heading | `font-size`, `font-weight`, `line-height` | `16px`, `500`, `36px` |
| Section heading | `color`, `margin` | `rgb(220, 222, 223)`, `0px 26px 0px 0px` |
| Divider | `border-top` | `1px solid rgba(59, 63, 72, 0.5)` |
| Divider | `margin`, `padding` | `20px 0px 0px`, `20px 0px 0px` |
| Text box | `class` | three hashed classes followed by `Panel` |
| Text box | `box-shadow` | `rgba(0, 0, 0, 0.25) 0px 4px 4px 0px inset` |
| Text box | `border`, `border-radius` | `1px solid rgb(14, 20, 27)`, `2px` |
| Text box | `background` | `rgb(35, 38, 46)` |
| Text box | `padding`, `margin`, `height` | `0px 20px`, `10px 0px 0px`, `320px` |
| Text box | `overflow-y`, `scrollable` | `scroll`, `true` |
| Text box content | `font-size`, `line-height`, `color` | `14px`, `22px`, `rgb(184, 188, 191)` |
| Accent color | sampled `color` | `rgb(26, 159, 255)` |
| Button class fallback | cached `class` | `_1KAp5PPYG7si-T_66zNEcU DialogButton _DialogLayout Secondary Focusable` |
| DLC table container | `display`, `background` | `grid`, `rgb(35, 38, 46)` |
| DLC table container | `margin`, `border-radius` | `20px 0px 0px`, `0px` |
| DLC header cell | `font-size`, `font-weight`, `color` | `13px`, `500`, `rgb(139, 146, 154)` |
| DLC header cell | `background`, `padding` | `rgb(61, 68, 80)`, `10px 8px` |
| DLC row | `display`, `background` | `contents`, transparent |
| DLC row cell | `margin` | `8px` |
| Dialog button in the settings sidebar | `font-size`, `height`, `line-height` | `14px`, `32px`, `32px` |
| Dialog button in the settings sidebar | `background`, `border-radius` | `rgb(61, 68, 80)`, `2px` |
| Game page badge label | `color`, `font-size`, `font-weight` | `rgba(255, 255, 255, 0.52)`, `14px`, `400` |
| Game page badge label | `letter-spacing`, `line-height`, `text-transform` | `1px`, `16px`, `uppercase` |
| Game page badge value | `color`, `font-size`, `font-weight` | `rgba(255, 255, 255, 0.32)`, `13px`, `400` |
| Game page badge icon | `color`, `width`, `height` | `rgb(150, 150, 150)`, `26px`, `26px` |

The recorded values are the client's values at the time of measurement; they are a reference for the fallbacks, not a specification the client must keep.

### Application

`frontend/properties.tsx` applies the method. Its tab content renders `DialogContent_InnerWidth`, `DialogHeader`, and `DialogBody`, and its rows use the measured font size and line height.

The accent color comes from `accent_color`, which samples the color of the largest blue text in the dialog and falls back to `#1a9fff`. The `State` value and the lock and refresh status values use the measured value style — `font-weight` `700` and the accent color — while the static values, the app id, the locked build id, the depot manifests, and the auto-update behavior, render in the body text color at the body weight, with no `font-weight` override, and an absent status value renders a gray `N/A` at `rgb(139, 146, 154)`, the measured label color.

The static section's `Lock Snapshot` heading reuses the stable `SettingsDialogSubHeader` class, and its divider color comes from `divider_color`, which samples the `border-top` color of a native one-sided divider and falls back to `rgba(59, 63, 72, 0.5)`. The action buttons render as a plain `button` whose class name comes from `read_button_class`, which samples the full class name of a native dialog button from the dialog's content root, accepts only a class that carries `Secondary` and not `Primary`, caches it in `localStorage` under `steamapp-verlock.button_class`, and falls back to the recorded class constant.

A mutation observer watches that content root and re-samples the class when a native button appears; scoping the sampler and the observer to the content root and rejecting a primary class keep a modal's buttons from changing the tab's button style.

`frontend/notify.tsx` builds its failure and file content dialogs from the SDK's `ConfirmModal`, and its plain-HTML fallback from `DialogHeader`, so the dialogs inherit the native dialog styling without a hand-authored stylesheet. The file content box uses the recorded text-box values above as a constant, because the reference box lives in the System Information window and carries only hashed classes the plugin cannot author. The content dialog hides the modal's `Cancel` button after it renders and does not pass `closeModal`, so its `Copy` button (the OK button) keeps the dialog open; `Close` and the escape key dismiss it, and React state toggles the `Copy` label to `Copied`.

`frontend/native.tsx` hosts the sampling helpers the two surfaces share — `accent_color`, `divider_color`, `native_button_class`, `read_button_class`, the `ActionButton` component, and their fallback constants — and `frontend/properties.tsx` imports them from there.

`frontend/settings.tsx` applies the method to the plugin's settings panel: its section headings reuse the stable `SettingsDialogSubHeader` class, its section dividers reuse `divider_color`, its checkbox controls are the SDK's `DialogCheckbox` component, and its buttons render through the shared `ActionButton` with a class sampled once when the panel mounts, backed by the same cache and fallback.

The locked-apps list replicates the look of the client's DLC table — the install list in the Properties dialog — through recorded constants in `frontend/settings.tsx`, following the text-box precedent, because the reference table renders in the Properties dialog's document while the settings panel renders in Millennium's settings page. The probe measured the table's container, header cells, and row cells, and the constants record those values: the list sits on a `rgb(35, 38, 46)` container under a `rgb(61, 68, 80)` header band, and the header cells reuse the measured `13px`, `500`, `rgb(139, 146, 154)` type at `10px 8px` padding.

The panel's buttons render at their native full width in the sidebar, so paired actions split the row in half. The panel's layout budget is the width of Millennium's own settings page; the plugin measures that width only as a design-time value and records no native constant for it.

`frontend/gamepage.tsx` applies the method to the library game page badge. The badge renders its own flex structure and samples the computed `color`, `font-size`, `font-weight`, `letter-spacing`, `line-height`, and `text-transform` of the page's `PLAY TIME` label and value, and the pixel `width` and `height`, the computed `color`, and the `opacity` of its icon, through `sample_badge_style`.

The icon's `color` comes from the native icon svg rather than the label, so the badge icon matches the row's other icons instead of the label's brighter tint; the badge draws an outline lock to match the row's line icons. `merge_style` merges each sampled field over the fallback constants in `FALLBACK_BADGE_STYLE`, so a field the sample lacks keeps the recorded value.

The badge does not reuse the cell's hashed layout class, because that class carries the cell's own size and wrap behavior, which misplaces an appended sibling on a play bar that carries more cells; it copies the sampled values only.

## Risks

- A client update can rename or drop a hashed class, so the cached button class stops matching  
  Prevention: the plugin re-samples the class whenever a native dialog button appears, and the fallback keeps a first run styled.
- A client update or a theme change can move a measured value, so the layout drifts  
  Prevention: the layout uses the client's own classes where they exist, and this spec records the probe method for a re-measurement.
- `localStorage` can be unavailable or cleared, so the cached button class is lost  
  Prevention: the recorded class constant is the fallback, and the class is re-sampled from a native button.
- No official Valve design specification exists for the client's internal UI, so the method cannot cite an authority  
  The recorded values document the client state the method targets.

## Alternatives Considered

- **Plain HTML with hand-authored styles**  
  Rejected: the styles cannot match the client, and they drift with it.
- **Hardcoding every measured value**  
  Rejected: the button's `padding` and `width` live in a hashed class the plugin cannot author, and the accent color follows the client theme.
- **Using only the SDK components without the native body structure**  
  Rejected: a missing `DialogBody` loses the right inset and the vertical spacing.
- **Cloning a native DOM subtree as a template**  
  Rejected: the client renders the subtree through React, so a clone couples the plugin to the rendered content and is invalidated on the next render.
- **Sampling at run time without a cache or a fallback**  
  Rejected: a page with no native dialog button renders the wrong button on a first run.
- **Sampling the DLC table's classes across windows**  
  Rejected: the reference table renders in the Properties dialog's document and the settings panel renders in Millennium's settings page, so a cross-window sample couples the panel to a tab that may not be mounted, for values the recorded constants already carry.
