# Design System — Apple HIG Compliance

This file governs every UI/UX decision in this codebase: layout, color, typography, iconography, motion, and component choice. It is binding, not aspirational. If you (human or agent) are about to design, build, or review any screen, component, or interaction, read this first.

**Keywords:** MUST / MUST NOT are non-negotiable. SHOULD / SHOULD NOT can be broken with a documented reason in the PR description. Silent deviation is not allowed at any level.

---

## 1. Mandate

Every interface decision here is governed by Apple's Human Interface Guidelines and Apple's official Figma libraries — not "inspired by," governed by. Before building, editing, or reviewing any screen, component, icon, animation, or piece of UI copy:

1. Check the relevant page under `developer.apple.com/design/human-interface-guidelines/` for guidance.
2. Check `figma.com/@apple`'s official kits for a matching component before inventing a new one.
3. Default to Apple's system pattern. If you deviate from a documented Apple pattern, say why in the PR — never a silent, unexplained choice.

If this file and the HIG ever disagree, **the HIG wins.** This file exists to translate the HIG into constraints an agent can execute against, not to override it.

## 2. Source of truth, in priority order

1. **`developer.apple.com/design/`** — the Human Interface Guidelines (Foundations, Patterns, Components, Inputs, Technologies)
2. **`figma.com/@apple`** — Apple's official Figma Community profile: UI kits, redlines, component anatomy, spacing specs
3. `developer.apple.com/design/resources/` — the design resources index (kits, templates, downloads)
4. `developer.apple.com/sf-symbols/` — the SF Symbols app and icon browser
5. `developer.apple.com/fonts/` — SF Pro, SF Compact, SF Mono, New York
6. `developer.apple.com/design/awards/` — apps Apple itself holds up as exemplary implementations

Do not substitute blog posts, "HIG cheat sheets," or third-party summaries as the source of truth — they drift out of date. The two URLs above are canonical; everything else in this file is a working translation of them.

## 3. Read this before you touch fonts or icons

**SF Symbols and the SF Pro / SF Compact fonts are licensed only for software that runs on Apple's own operating systems** (iOS, iPadOS, macOS, tvOS, watchOS). Apple's license text is explicit: they're for creating interfaces "to be used in software products running on Apple's iOS, iPadOS, macOS or tvOS operating systems" — not web apps, not other platforms, not logos or marketing. This holds even though Figma will happily let you apply the fonts inside a design file with a click-through agreement.

So the first question is: **is this shipping as a native app on an Apple platform (Swift/SwiftUI, built with Xcode, distributed via the App Store), or is it a web app?**

- **Native Apple platform app** → use SF Symbols and SF Pro directly, no substitution. Skip to Section 4.
- **Web app** (the default assumption for this project, given the stack) → you get the *system*, not the *shipped assets*:
  - **Typography**: use the system font stack, `-apple-system, BlinkMacSystemFont, "Inter", sans-serif`. On an Apple device this legitimately resolves to real San Francisco, because it's the OS pointing at its own installed font, not you embedding one. Everywhere else it resolves to Inter, the bundled web-licensed fallback. Do not put `system-ui` first: on Windows and Linux it gives the platform font, not Inter (spec #292, "Fonts").
  - **Icons**: don't ship literal SF Symbols glyphs in a web bundle. Use an icon set built on the same grammar instead — optically balanced, consistent stroke width, aligns to a text baseline, multiple weights. **Lucide** or **Phosphor** at "regular" weight are the closest matches. Match the *system* (stroke width, corner radius, optical sizing, alignment to text), not the individual glyph shapes.
  - **The Figma kit is still your reference** for layout, spacing, component anatomy, and redlines. You're using it to learn the system, not exporting its font/icon assets verbatim into a shipped product.

State which path you're on (native vs. web) at the top of any design-related PR. Default to the web path unless told otherwise.

## 4. Design principles

Apple's long-standing HIG themes, still the backbone of every platform-specific guideline:

- **Clarity** — text is legible at every size, icons are precise, functional elements are unambiguous. Nothing decorative competes with content.
- **Deference** — the UI helps people understand and interact with content without competing with it. Fluid motion and a crisp interface are means, not the point.
- **Depth** — distinct visual layers and realistic motion convey hierarchy and enable understanding. Transitions communicate *how* the app is organized, not just decoration.

The current era (Liquid Glass, introduced 2025 and now default across iOS/iPadOS/macOS) adds one more: **content-first material.** Chrome (navigation, controls) is allowed to be translucent, dynamic, and expressive; content underneath stays opaque, stable, and legible. Don't blur what people came to read.

## 5. Foundations → how they map to this project

### Color
HIG: `/design/human-interface-guidelines/color`
Use Apple's semantic system colors as the base palette — they're accessible by design and already solve light/dark adaptation:

| Token | Light | Dark | Use |
|---|---|---|---|
| systemBlue | `#007AFF` | `#0A84FF` | primary actions, links |
| systemGreen | `#34C759` | `#30D158` | success, confirmation |
| systemRed | `#FF3B30` | `#FF453A` | destructive actions, errors |
| systemOrange | `#FF9500` | `#FF9F0A` | warnings |

Never hardcode a hex value for a semantic role. Use `label` / `secondaryLabel` / `tertiaryLabel` for text, and `systemBackground` / `secondarySystemBackground` for surfaces — these are the tokens that make dark mode free instead of a rewrite.

**Warnings are always `var(--orange)` (`systemOrange`) and its `--orange-dim` tint — never `var(--yellow)`.** `--yellow` is reserved for non-warning accents only (favorites/stars, in-progress status pills and badges, event-type accents). The full state-coverage contract behind this lives in `docs/reference/state-coverage.md`.

### Typography
HIG: `/design/human-interface-guidelines/typography`

**Fonts** (spec #292, "Fonts"):

- Sans and display: `--font-sans` and `--font-display` are `-apple-system, BlinkMacSystemFont, "Inter", sans-serif`. Mac shows SF Pro. Other platforms show Inter.
- Monospace: `--font-mono` is `ui-monospace, "SF Mono", Menlo, "IBM Plex Mono", monospace`. Mac shows SF Mono.
- **Themes change colour only.** Graphite and Sandstone set no font. IBM Plex Sans is not shipped.
- **Readable font** is a setting (Settings > Accessibility, off by default). When it is on, `data-font="readable"` is set on the root element and the sans and mono tokens use Atkinson Hyperlegible Next and Mono. Its font files download only when it is on.

**Two type scales** (spec #292, "Type scale and density"). Pick the scale by the primary pointer and the width:

- **macOS scale** when `(pointer: fine)` and the viewport is wider than 768px. A mouse or trackpad gets the macOS sizes.
- **iOS scale** otherwise: a coarse primary pointer, or a viewport of 768px or less.

Both scales are written in `rem`, so the browser's font-size setting scales every text style (computed px at the default 16px root).

| Style | macOS (fine pointer, wide) | iOS (coarse pointer or narrow) |
|---|---|---|
| Large Title | 26px Regular | 34px Regular |
| Title 1 | 22px Regular | 28px Regular |
| Title 2 | 17px Regular | 22px Regular |
| Title 3 | 15px Regular | 20px Regular |
| Headline | 13px Bold | 17px Semibold |
| Body | 13px Regular | 17px Regular |
| Callout | 12px Regular | 16px Regular |
| Subheadline | 11px Regular | 15px Regular |
| Footnote | 10px Regular | 13px Regular |
| Caption 1 | 10px Regular | 12px Regular |
| Caption 2 | 10px Medium | 11px Regular |

On macOS, Footnote and Caption (10px) are only for metadata: timestamps, counts, badges, keyboard hints. Descriptions and secondary text use Subheadline (11) or Callout (12). No running text is smaller than 11px.

Use these styles exclusively. No arbitrary font sizes, and no token below 10px (gate G2). Badges and tags use Caption 1 or Footnote. Text styles set font-size, font-weight, line-height and letter-spacing together. The classes are `.text-large-title`, `.text-title-1`, `.text-title-2`, `.text-title-3`, `.text-headline`, `.text-body`, `.text-callout`, `.text-subhead`, `.text-footnote`, `.text-caption-1` and `.text-caption-2`. Each reads its size, weight, leading and tracking tokens (`--text-<style>`, `--text-<style>-weight`, `--text-<style>-leading`, `--text-<style>-tracking`), so it follows the active scale with no media query of its own. Components must use these classes instead of setting `font-size` or `font-weight` directly. Gate G4 (M7) enforces this; until then the design reviewer checks it. Headline is Semibold on iOS and Bold on macOS; Caption 2 is Regular on iOS and Medium on macOS.

**Control metrics** (computed px). The macOS metrics apply with the macOS scale: regular control 28px tall, small 22px, large 32px, toolbar 52px, sidebar row 28px. The iOS scale keeps the iOS header of 56px.

### Layout & spacing
HIG: `/design/human-interface-guidelines/layout`
Apple lays out on an **8pt grid with a 4pt sub-grid**. Standard content margins are 16–20pt. Use this instead of arbitrary pixel values — it's most of what makes an interface feel "considered" rather than assembled ad hoc.

### Lines and borders
Lines follow the macOS model (spec #292, "Lines and borders"):

- **Hairline.** `--hairline` is 1px, and 0.5px on screens of 2 device pixels per CSS pixel or more. Containers, lists, section dividers and card edges draw the hairline in `--separator`, a low-alpha colour for each appearance.
- **Buttons have a filled bezel and no border.** A secondary button fills with `--fill-control`. An icon-only button keeps its own fill.
- **Fields, checkboxes, radios and switches keep a boundary** in `--border-control`, which holds 3:1 contrast against the background in every theme, appearance and contrast setting (`test/theme-contrast.test.ts`).
- **Increase Contrast** (`data-contrast="more"`) sets `--hairline` to the solid strong border and `--separator` to `--border` everywhere.

### Materials (Liquid Glass)
HIG: `/design/human-interface-guidelines/materials`
Liquid Glass is translucent, reacts to the content behind it, and adapts between light and dark. The rule that matters most for implementation is the **three-layer model**:

```
┌─────────────────────────────────────┐
│  GLASS  — nav bars, tab bars,        │  ← translucency/blur lives here only
│  toolbars, sheets, floating controls │
├─────────────────────────────────────┤
│  CONTENT — everything else           │  ← stays opaque, stable, legible
└─────────────────────────────────────┘
```
Glass/blur is for chrome, never for primary content surfaces (cards, list rows, body text backgrounds). If you're tempted to blur something people are trying to read, don't.

**What the glass covers in this app** (spec #292, "Materials and Reduce Transparency"):

- The glass material is a token. It applies to the **sidebar and the toolbar only**. Content stays opaque.
- The material is keyed on the `data-transparency` attribute on the root element, never on the media query in a component stylesheet. `data-transparency="full"` is glass. `data-transparency="reduced"` is opaque chrome: the sidebar and toolbar take `--bg-sidebar` and drop the blur.
- **Reduce Transparency** is a setting in Settings > Accessibility with three values. **Automatic** (the default) follows `(prefers-reduced-transparency: reduce)` where the browser reports it. **On** always uses opaque chrome. **Off** always uses glass.
- Safari does not report the system setting, and in Firefox the query is off by default. In those browsers Automatic gives glass. The setting's help text tells people to choose On when the system setting is on.

### Motion
HIG: `/design/human-interface-guidelines/motion`
Apple's system animations are spring-based, not linear. Motion should be purposeful — it should *explain* a change (where did this view come from, where did it go), never decorate for its own sake. On the web, approximate the spring feel with a decelerating curve that settles — `--ease-spring`, `cubic-bezier(0.16, 1, 0.3, 1)` — which reaches its target without overshooting, and **always** respect `prefers-reduced-motion` — treat it as a hard requirement, not a nice-to-have.

How that translates into this codebase (ticket #252):

- **Durations and easings are tokens.** Every `transition`, `animation`, `animation-delay` and `transition-duration` takes its timing from `src/frontend/styles/tokens.css` (`--duration-*`, `--ease-*`, `--transition*`). No stylesheet writes a raw `180ms`, `1.4s` or `cubic-bezier()`. The smoke gate fails on one that does.
- **The ladder collapses, it does not vanish.** Under `prefers-reduced-motion: reduce` the `--duration-*` tokens become one short crossfade (120 ms), `--duration-typing-offset` becomes `0ms`, and `--transition*` follow them. Reduced motion means gentler motion, not simply none.
- **Every keyframe has a reduced-motion path beside it.** A keyframe that moves (`transform`, `translate`, `top`, `width`, …) declares the same keyframe again inside a `@media (prefers-reduced-motion: reduce)` block in the same file, with the movement removed and the fade kept. An infinite animation (a spinner, a pulse, a typing indicator) stops in that block — `animation-iteration-count: 1` — and reads as a static indicator. The smoke gate fails on a keyframe that moves without a reduced path, or on a loop that never stops.
- **GPU properties only.** Animate `transform` and `opacity`. Resizing (`width`, `height`), offsets (`top`, `left`) and shadows that re-layout are findings; a progress bar scales with `transform: scaleX()`, it does not animate `width`.
- **Never `transition: all`**, and never `scale(0)`: content arrives from `scale(0.9–0.97)` plus `opacity: 0`, so nothing appears from nothing.
- **Windows settle; side and bottom sheets travel.** Every centred window — a sheet, a dialog, an alert — is one surface (`--sheet-width`, `--radius-lg`) and arrives from `scale(0.96)` with a fade over `--duration-modal` (280 ms) on `--ease-spring`. Nothing animates `backdrop-filter`: a blurred backdrop that sharpens is the one effect this system bans. A side or bottom sheet travels along the edge it is docked to on `--ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`), which leaves the edge at once because a sheet is leaving the screen. The step inside the assistant's sheet arrives from the side the reader moved towards — enter only, never animating height.
- **The `motion` library is mounted once and loaded on demand.** `MotionProvider` (`src/frontend/motion/MotionProvider.tsx`) wraps the app in `LazyMotion` with `MotionConfig reducedMotion="user"`, and reaches the feature pack through the dynamic import in `motion-features.ts`. Components use the `m` components, never `motion`, so the pack stays out of the entry chunk; only `motion-feature-pack.ts` may name one. Springs have no fixed duration, so they are parameterised in `src/frontend/motion/motion-springs.ts`.
- **The vocabulary lives in `src/frontend/motion/`.** `MotionEntry` (a chat row arriving) and `MotionList` / `MotionListItem` (reordering) are what screens build their motion from, rather than each screen hand-rolling keyframes. Sheets rise with the CSS motion tokens, not a component, and no surface follows a drag: the motion library has no drag feature in use.
- **Blocks carry their own named motion.** Only a pointer press slides the segmented control's thumb on the spring from `MotionProvider`; a keyboard choice, a route change or a resize moves it at once (`SegmentedControl.tsx`). `AsyncRegion` fades content in only after a real wait and delays its spinner by `--duration-slow`, the notification bell's count rolls to the new number, and a phone's tab bar dips under the finger (`AsyncRegion.css`, `NotificationBell.tsx`, `AppShell.css`).

### Icons & Anti-Drift Architecture
HIG: `/design/human-interface-guidelines/icons` + SF Symbols site
SF Symbols ship in 3 scales (small/medium/large) and 9 weights matching SF Pro's weight axis, and align to text baselines automatically. In this web app, we standardize on **Lucide 24×24 geometry** with strict anti-drift governance:

1. **Centralized SVG Sprite Sheet**:
   - All icons are served from a single, centralized sprite sheet at `/assets/icons/sprite.svg` via `<svg class="icon icon-{size}"><use href="/assets/icons/sprite.svg#icon-{name}"></use></svg>`.
   - Individual standalone SVGs live cleanly in `public/assets/icons/ui/` and `public/assets/icons/brands/` for documentation, asset inspection, and maintenance.
   - **Zero Inline SVGs**: Views, HTML files, and TypeScript UI generators MUST NOT inline raw SVG `<path>` or `<polygon>` tags. All icons MUST reference the sprite sheet through a block in `src/frontend/components/ui/`.

2. **Strict Geometry & Geometry Spec**:
   - ViewBox: `0 0 24 24`.
   - Stroke width: `1.5px` (`stroke-width="1.5"`), matching SF Symbols Regular, `fill="none"`, `stroke="currentColor"`. The sprite symbols and `styles/shared/icons.css` both use 1.5 (spec #292, "Icons").
   - Line cap and join: `stroke-linecap="round"` and `stroke-linejoin="round"`.
   - Brand icons (GitHub, Azure DevOps, GitLab, Jira, Bitbucket) strictly conform to the same 24×24 bounding box, line aesthetics, and `currentColor` responsiveness.

3. **Standardized Sizing Tokens**:
   - `.icon-xs` — `12px × 12px` (micro badges, inline tags)
   - `.icon-sm` — `14px × 14px` (button icons, table cells, secondary UI)
   - `.icon-md` — `16px × 16px` (navigation items, primary headers, inputs)
   - `.icon-lg` — `20px × 20px` (modal headers, hero icons)
   - `.icon-xl` — `32px × 32px` (empty states, banners)
   - `.icon-spin` — standard 1s linear infinite rotation (for `loader-2` / loading spinners).

4. **Status Diagnostics vs. Emojis**:
   - **Zero Raw Emojis**: Raw emojis (e.g. `✅`, `❌`, `⏳`, `⚠️`) MUST NOT be used for status indicators, badges, or connection diagnostics.
   - Use semantic status classes: `.icon-status-passed` (`var(--green)`), `.icon-status-failed` (`var(--red)`), `.icon-status-warning` (`var(--orange)`), `.icon-status-pending` (`var(--text-muted)`).

5. **Draw icons through the blocks**:
   - A control that shows an icon takes the icon id as a prop: `icon` on `Button` and `IconButton`, `leadingIcon` on `ListRow` (`src/frontend/components/ui/`).
   - The block draws `<svg class="icon icon-{size}"><use href="/assets/icons/sprite.svg#icon-{name}"></use></svg>`. There is no `renderIcon` or `createIconSvg` helper to call: a screen passes the id, and the block draws it.
   - To add an icon, add its symbol to `public/assets/icons/sprite.svg` and pass the new id. The smoke gate checks that every referenced id exists as an `icon-*` symbol.

6. **Anti-Drift Automated CI Gates**:
   - `test/frontend-smoke.test.ts` enforces zero inline SVGs in HTML files, valid sprite `#icon-*` symbol IDs, zero raw emojis in UI code, and presence of all size modifier classes.


### Accessibility
HIG: `/design/human-interface-guidelines/accessibility`
- Minimum target: **44px** wherever a touch input is present (`(any-pointer: coarse)`) or the viewport is 768px or less, from `--tap-min`. With a mouse or trackpad alone the target is a hit area of at least **24×24px** (WCAG 2.5.8), even if the visible control is smaller (spec #292).
- Text contrast: minimum 4.5:1 for body text against its background (Apple's guidance and WCAG AA agree here).
- Every icon-only control needs an accessible label — `aria-label` on the web, not just a `title` attribute.
- Respect reduced-motion and reduced-transparency preferences: the media query, and the app's Reduce Transparency setting (see Materials).

## 6. Starter tokens (illustrative)

Drop-in baseline for a web implementation — adjust values only against the HIG pages above, not by eye.

**These names are illustrative, not the app's names.** The tokens this app ships are in `src/frontend/styles/tokens.css`, which groups them by `[data-theme]`, `[data-appearance]` and `[data-contrast]` and names colors by role (`--text`, `--bg-card`, `--border`, `--accent`). Read this section for the shape of each scale, and `tokens.css` for the real names. Under `prefers-reduced-motion: reduce`, every duration collapses to 120 ms.

```css
:root {
  /* Color — light */
  --color-label: #000000;
  --color-label-secondary: rgba(60, 60, 67, 0.6);
  --color-label-tertiary: rgba(60, 60, 67, 0.3);
  --color-background: #ffffff;
  --color-background-secondary: #f2f2f7;
  --color-separator: rgba(60, 60, 67, 0.29);
  --color-accent: #007aff;
  --color-destructive: #ff3b30;
  --color-success: #34c759;
  --color-warning: #ff9500;
  --color-warning-dim: rgba(255, 149, 0, 0.14);

  /* Spacing — 8pt grid, 4pt sub-grid */
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px;

  /* Type scale. The iOS values are the default: a touch input or a viewport of
     768px or less. On a fine primary pointer wider than 768px, the macOS values
     below replace them (spec #292, "Type scale and density"). Written in rem in
     tokens.css, so the browser's text-size setting scales them. */
  --text-large-title: 34px; --text-title-1: 28px; --text-title-2: 22px;
  --text-title-3: 20px; --text-headline: 17px; --text-body: 17px;
  --text-callout: 16px; --text-subhead: 15px; --text-footnote: 13px;
  --text-caption-1: 12px; --text-caption-2: 11px;

  /* macOS values (fine primary pointer, wider than 768px), in Section 5:
     26 22 17 15 13 13 12 11 10 10 10 */

  /* Radius — one ladder, six rungs. A control's radius comes from its size, not
     from the screen it sits on; an inner shape's radius is the outer radius
     minus the inset between them (segmented thumb 12/4/8, menu items 12/4/8,
     code inside a card 16/4/12). Capsules are for tags, status and count badges
     and progress tracks only; circles stay circles. */
  --radius-xs: 4px; --radius-sm: 8px; --radius-md: 12px;
  --radius-card: 16px; --radius-lg: 20px; --radius-full: 9999px;

  /* Continuous corners. Apple's corners are superellipses (continuous
     curvature), not circular arcs. Where the browser supports `corner-shape`,
     every box gets `corner-shape: var(--corner-shape)` (superellipse(1.6))
     through a zero-specificity `:where(*)` rule, and the two large rungs grow
     (--radius-card 20px, --radius-lg 24px), because a superellipse reads tighter
     than an arc of the same radius. Elsewhere the ladder above applies as
     written. Circles and capsules opt out: every rule that uses --radius-full
     also sets `corner-shape: round` (the smoke gate enforces it). A nested
     shape writes its radius as the pair's math —
     `calc(var(--radius-md) - var(--space-1))` — so it stays concentric if the
     ladder moves. */
  --corner-shape: superellipse(1.6);

  /* Motion — the implemented ladder: 160 / 220 / 300 ms on the spring curve,
     which decelerates and settles without overshooting. A window arrives over
     --duration-modal; a side or bottom sheet travels on the drawer curve */
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --spring: var(--ease-spring);
  --transition-fast: 160ms var(--spring);
  --transition: 220ms var(--spring);
  --transition-slow: 300ms var(--spring);
  --duration-modal: 280ms;

  /* The one window (SYS-13): every sheet and dialog — New Run, the add-project
     assistant, the diff and the Settings confirmation — is this wide and
     --radius-lg at every width */
  --sheet-width: 560px;

  /* Fonts — web path; see Section 3 for the licensing reasoning */
  --font-system: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
}

[data-theme="dark"] {
  --color-label: #ffffff;
  --color-label-secondary: rgba(235, 235, 245, 0.6);
  --color-label-tertiary: rgba(235, 235, 245, 0.3);
  --color-background: #000000;
  --color-background-secondary: #1c1c1e;
  --color-separator: rgba(84, 84, 88, 0.6);
  --color-accent: #0a84ff;
  --color-destructive: #ff453a;
  --color-success: #30d158;
  --color-warning: #ff9f0a;
  --color-warning-dim: rgba(255, 159, 10, 0.15);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    /* Reduced motion is gentler motion, not none: every duration collapses to
       one short 120 ms crossfade and each keyframe's reduced path keeps its
       opacity change. Nothing travels, resizes or loops. */
    --transition-fast: 120ms; --transition: 120ms; --transition-slow: 120ms;
  }
}
```

## 7. Components & patterns

HIG: `/design/human-interface-guidelines/components` and `.../patterns`
Figma: the platform UI kit on `figma.com/@apple` (currently the iOS/iPadOS kit — pull the matching platform kit if this ever targets macOS, watchOS, etc.)

Before building any of the following, pull the matching component from the Figma kit and its HIG page rather than freehanding it: buttons (filled / tinted / gray / plain), navigation bar, tab bar, sidebar, lists (plain / grouped / inset grouped), sheets, alerts vs. action sheets, segmented controls, toggles, sliders, search fields, context menus.

For flows, check the Patterns section first: onboarding, search, feedback, data entry, notifications, undo/redo, settings. Apple has already solved most of the "how should this flow work" questions — use the solved version.

### Building blocks (the control vocabulary)

A screen composes blocks; it never hand-rolls a control. The vocabulary lives in `src/frontend/components/ui/` and is built on React Aria's unstyled primitives — React Aria owns behaviour (keyboard, press, focus visibility, disabled and touch semantics) and the tokens own every visual value. The one stylesheet is `src/frontend/styles/shared/controls.css`; see [docs/agents/frontend-styling.md](./docs/agents/frontend-styling.md) for the rules and the gate that enforces them.

- button, icon button, text field, text area, select, segmented control, switch, badge, grouped list, list row, table, spinner, empty state.
- **Tap targets.** Every block a finger can hit is at least `--tap-min` tall: 44px where a touch input is present or the viewport is 768px or less, otherwise a 24px hit area (spec #292).
- **Focus.** One ring definition, drawn from `--border-width-indicator` and `--border-focus`, proved at 3:1 or better by the twelve-set contrast gate.
- **Feedback.** The feedback family in `src/frontend/components/feedback/` renders through these blocks. Errors are announced as alerts; informational and partial states stay polite.
- **Loading.** A list reserves static placeholder rows at the height the loaded rows will have (`--list-row-height`) — no layout shift and no shimmer, ever. Every other wait is the one standard spinner, for small inline waits only.
- **Icon-only controls** always carry an accessible name, and no status is ever an emoji.

### Loading, empty and error

Every async region renders through `AsyncRegion` (`components/feedback/`). A screen derives the state with `deriveAsyncState` and never writes its own empty or error markup.

- **Loading.** Lists reserve placeholder rows. Every other wait is the one standard spinner.
- **Empty.** `AsyncRegion` renders the `EmptyState` block: a glyph, a title that names what is missing (Title 3), one line of guidance in the secondary label colour, and an optional action (a `Button`). It is centred, with no card or box around it. A screen with no data load, such as no search results, renders `EmptyState` directly.
- **Error.** Normalized copy from `components/feedback/copy-map.ts`, a retry action, and an alert role. A raw payload is never shown.
- **Wording.** Titles and guidance are sentence case, name what is missing, and say the next step. No emoji.

### Lists, headers and sizes

- **Grouped inset lists.** Settings panes, the Welcome checklist, the Runs list,
  the Projects list and the Connections registry are one shape: a `--radius-card`
  group on `--bg-card`, rows at least `--tap-min` tall with the title on the leading
  edge and the accessory trailing, and an inset hairline between rows that
  starts where the row's content starts — never a bordered box per row. The
  block is `ListGroup` (`components/ui/ListGroup.tsx`); a screen composes it and
  never names its classes.
- **A row's height follows the list it is in.** A record row (Runs, Projects)
  reserves `--list-row-height` so its static placeholders match; a compact row
  (Settings, Welcome) is `--tap-min`. The compact row is
  `.ui-list-row--compact`.
- **Column data uses the Table block.** Where a screen needs columns —
  Settings › Models (one table per connection, sortable) and a project's
  Repositories — it builds on `Table` (`components/ui/Table.tsx`), drawn as the
  same inset group as a list.
- **Control sizes.** Each control takes its height from a metric token, so the
  heights follow the scale. On the macOS scale (fine primary pointer, wider than
  768px) a regular control is `--control-height` (28px), `size="sm"` is
  `--control-height-sm` (22px): a row accessory (Add, Copy, Mark all as read) and
  `size="lg"` is `--control-height-lg` (32px). On the iOS scale the metrics are
  44px, 32px and 50px. Wherever a touch input is present (`any-pointer: coarse`)
  or the viewport is 768px or less, every control is at least `--tap-min` (44px).
  An icon-only control is a circle as tall as the control, and it never stretches;
  `plain` draws no circle of its own.
- **Badges.** A status or tag badge is a capsule (`--radius-full`), sans,
  caption 1, weight 600, sentence case (the copy is written that way — never
  `text-transform`), a tint fill and no border, about a line of caption tall. A
  literal id, keycap or command is the mono `variant="id"` badge at
  `--radius-xs`. One badge block, five tones.
- **Section headers.** A header inside a card, panel or list group is footnote
  sized, weight 600, `--text-secondary`, in the case it was written in — no
  small caps, no `text-transform`, no letter-spacing, no colon.
- **Page actions live in the page heading.** The toolbar carries the project
  picker, the section switch, search, the bell and the gear — never the screen's
  own action. A screen's one action (Start Run, Add Project) sits in the
  large-title row, and at phone width it drops its label and keeps its
  accessible name.
- **Empty states name what is missing.** A fitting glyph, a headline, one
  guidance line (max 48ch) and the action that ends the state — no dashed box.

### Phone widths

- **Every route fits a 290px viewport.** `--app-min-width` (290px, `tokens.css`) is the floor; below it the page scrolls instead of overflowing. `test/responsive-browser.test.ts` drives every route at 290, 320, 360 and 390px and fails on horizontal overflow, a squeezed row title or colliding text.
- **Grouped rows and the table re-flow by container, not window.** Below a 30rem container the row wraps — title on its own line, accessory under it — and the table becomes labelled stacks (`shared/controls.css`).
- **The Runs filter collapses to a select below 400px.** The same SegmentedControl re-renders through the Select block (`collapseBelow="(max-width: 400px)"`).
- **The run page pins its stepper strip above the phone tab bar** at one exact height, and below 480px only the current step keeps its label (`WorkflowStepper.css`, `RunDetailView.css`).

## 8. Non-negotiables

- MUST check the relevant HIG page and Figma kit before designing any new screen or component.
- MUST NOT invent a custom control (custom dropdown, custom modal, custom date picker) when Apple has a documented equivalent.
- MUST implement light and dark appearance together, from the first pass — using semantic tokens, never hardcoded hex values.
- MUST use the 8pt/4pt spacing grid. No arbitrary pixel values in layout code.
- MUST meet the tap target for the input in use: `--tap-min` (44px) where a touch input is present or the viewport is 768px or less, and a 24×24px hit area otherwise (Section 5, Accessibility).
- MUST respect `prefers-reduced-motion`. Motion must explain a state change, not just decorate one.
- MUST NOT apply blur/glass materials to content surfaces — chrome only (Section 5, Materials).
- MUST use the defined type scale (Section 5, Typography) — no arbitrary font sizes.
- MUST give every icon-only control an accessible label.
- MUST follow the licensing path from Section 3 — no shipping literal SF Symbols/SF Pro assets in a non-Apple-platform build.
- MUST use the centralized SVG sprite sheet (`/assets/icons/sprite.svg`) through the blocks in `src/frontend/components/ui/` — never new icon helper functions.
- MUST NOT write inline SVG shapes (`<path>`, `<polygon>`, `<polyline>`) in HTML, templates, or view modules.
- MUST NOT use raw emojis (e.g. `✅`, `❌`, `⏳`) for status badges, test results, or diagnostic states.
- MUST NOT write inline `style={{...}}` blocks in TSX/JSX components. All styling must use semantic tokens, co-located component CSS (`./ComponentName.css`), or utility classes (`src/frontend/styles/utilities.css`).
- MUST co-locate component and view stylesheets (`ComponentName.css` alongside `ComponentName.tsx`) and import them explicitly.
- MUST adhere to the layered CSS architecture (`src/frontend/styles/index.css` = tokens → base → shared → utilities).
- MUST build controls from the vocabulary in `src/frontend/components/ui/` (React Aria, tokens-only, `shared/controls.css`) instead of hand-rolling a button, field, switch or badge.
- MUST keep lists' loading shape static: placeholder rows at the row height, never an animated shimmer. Small inline waits use the one spinner.
- MUST announce errors as alerts, and MUST NOT exceed one wait indicator per view region.

## 9. Definition of done

Before calling any UI work finished, confirm:

- [ ] Checked against the relevant HIG Foundations/Patterns/Components page
- [ ] Matches the Apple Figma kit component, or deviates with a documented reason
- [ ] Light and dark mode both implemented and visually checked
- [ ] Type scale, spacing grid, and color tokens used — no magic numbers
- [ ] Zero inline styles (`style={{...}}`) in any TSX file
- [ ] Co-located `.css` file imported for any component/view with custom styles
- [ ] Tap targets: `--tap-min` where a touch input is present or the viewport is 768px or less, otherwise a 24×24px hit area
- [ ] Motion respects `prefers-reduced-motion`
- [ ] Icons are one consistent weight/style, baseline-aligned with text
- [ ] Icons use `/assets/icons/sprite.svg` through a block in `src/frontend/components/ui/` (zero inline SVGs)
- [ ] Zero raw emojis used for status or diagnostics
- [ ] Anti-drift & Design System tests pass (`bun test test/frontend-smoke.test.ts`)
- [ ] Contrast checked — 4.5:1 minimum for body text
- [ ] Loading states use the blocks: static placeholder rows for a list, the one spinner for an inline wait — no shimmer
- [ ] Every icon-only control has an accessible label


## 10. Quick reference

- HIG home: `developer.apple.com/design/`
- Apple Figma profile: `figma.com/@apple`
- Design resources index: `developer.apple.com/design/resources/`
- SF Symbols: `developer.apple.com/sf-symbols/`
- Fonts (SF Pro / SF Compact / SF Mono / New York): `developer.apple.com/fonts/`
- Apple Design Awards (reference implementations): `developer.apple.com/design/awards/`

Note: opening Apple's Figma kit for the first time will prompt a click-through license agreement for the UI kit itself, and a separate optional one for the SF Pro font inside Figma. Accepting the font license there governs use *inside Figma*, not what you're allowed to ship — see Section 3.
