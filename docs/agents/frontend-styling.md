# Frontend styling and CSS architecture

Read this before you change anything under `src/frontend/`. This repository follows the Apple Human Interface Guidelines (see [`DESIGN.md`](../../DESIGN.md)) and a modular, token-based vanilla CSS architecture. Everyone who changes `src/frontend/`, people and agents alike, must follow these rules. To audit existing code against them, use [css-audit.md](./css-audit.md).

---

## 1. Zero Inline Styles (`style={{...}}`) Rule

- **Strict Ban**: Do NOT write `style={{ ... }}` on JSX/TSX elements.
- **Allowed Exception**: CSS custom property passthrough only (e.g., `style={{ '--custom-delay': `${index * 50}ms` }}`), which cannot be expressed statically.
- **Enforcement**: Any inline style (`style={{`) in `src/frontend/**/*.tsx` will fail `bun run test:frontend-smoke`.

---

## 2. Design System Hierarchy & Layering

Global styles are imported once in `src/frontend/main.tsx` via `src/frontend/styles/index.css`:

1. **Tokens (`src/frontend/styles/tokens.css`)**:
   - Spacing: 8pt grid (`--space-1` to `--space-8`).
   - Radii: the six-rung ladder (`--radius-xs` 4 → `--radius-sm` 8 → `--radius-md` 12 → `--radius-card` 16 → `--radius-lg` 20 → `--radius-full`). Where the browser supports it, `--corner-shape: superellipse(1.6)` applies to every box and the ladder's top rungs step up inside `@supports`: `--radius-card` 20 and `--radius-lg` 24. Circles and capsules opt out with `corner-shape: round` (the smoke gate enforces it beside every `--radius-full` rule), and an inner shape's radius = the outer radius − the inset between them.
   - Typography: two type scales, the macOS scale for a fine primary pointer on a viewport wider than 768px and the iOS scale otherwise (`--text-large-title` to `--text-caption-2`, in `rem`). Fonts: `--font-sans` and `--font-display` start with `-apple-system`, then Inter; `--font-mono` starts with `ui-monospace`, then SF Mono. Themes change colour only, and Readable font (`data-font="readable"`) is a setting. See `DESIGN.md` §5 Typography.
   - Lines: `--hairline` (1px, 0.5px on HiDPI) and `--separator` for containers and dividers; `--border-control` (3:1) for fields and other controls that need a boundary; `--fill-control` for a button's bezel. See `DESIGN.md` §5 Lines and borders.
   - Colors: Functional tokens (`--text`, `--text-muted`, `--accent`, `--green`, `--red`, `--yellow`, `--orange`, `--border`, etc.) with light & dark theme definitions. Warnings always use `--orange` / `--orange-dim` — never `--yellow` (see `docs/reference/state-coverage.md`).
2. **Base (`src/frontend/styles/base.css`)**:
   - Modern CSS resets, root font configuration (the system stack, Inter as the fallback), custom scrollbars.
3. **Shared Components (`src/frontend/styles/shared/*.css`)**:
   - `controls.css` (the shared layer for the blocks in `components/ui/`), `forms.css`, `icons.css`, `scrollbar.css`.
   - `buttons.css`, `cards.css` and `badges.css` are **transitional legacy styles**. New code must not use them. See section 9.
4. **Utilities (`src/frontend/styles/utilities.css`)**:
   - Spacing (`.mb-1` to `.mb-8`, `.mt-*`, `.p-*`, `.gap-*`).
   - Typography (`.text-headline`, `.text-footnote`, etc.).
   - Layout (`.flex-between`, `.flex-center`, `.flex-col`, `.stack`, `.col-span-full`, `.d-none`, `.m-0`).
   - Colors (`.text-muted`, `.text-dim`, `.text-accent`, `.text-success`, `.text-danger`, `.text-warning`).

---

## 3. Component & View Co-location

- Every React component or view that requires custom styles must have a co-located `.css` file in the same directory:
  - Component: `src/frontend/components/<Name>.tsx` $\rightarrow$ `src/frontend/components/<Name>.css`.
  - View: `src/frontend/views/<Name>.tsx` $\rightarrow$ `src/frontend/views/<Name>.css`.
- The TSX file must explicitly import its co-located CSS:
  ```tsx
  import "./MyComponent.css";
  ```
- Use BEM or semantic component prefixing (`.my-component`, `.my-component-header`, `.my-component-title`).
- **One exception, and it is the design system itself**: the building blocks in `src/frontend/components/ui/` (section 7) carry no co-located stylesheet. Their styles live in `src/frontend/styles/shared/controls.css`, the shared layer, exactly as `.form-input`, `.card` and `.filter-pill` do. A block is a primitive of the system, not a component of a screen.

---

## 4. Color & Measurement Invariants

- **No Hardcoded Hex/RGB**: Never write `#ffffff`, `#0071e3`, `rgb(...)` outside of `tokens.css`. Always use `var(--accent)`, `var(--text)`, `var(--bg-card)`, etc.
- **No Arbitrary Spacing**: Spacing must use `--space-*` tokens or utility classes (`.mt-4`, `.mb-2`, etc.).
- **No Arbitrary Font Sizes**: Font sizes must follow HIG typography tokens (`--text-caption-1`, `--text-footnote`, `--text-headline`, etc.). No text token is below 10px (gate G2).
- **Shapes are tokens**: a `box-shadow` or `border-radius` value is a token, a `calc()` of tokens, or `none` (gate G1). Rings and the square corner (`--radius-none`) are tokens too.
- **The Theme and Appearance are applied before first paint.** The server puts the saved values from `settings.json` on `<html>` (`data-saved-theme`, `data-saved-appearance`) when it serves `index.html` (`src/http/static.ts`, `injectSavedTheme`), so a fresh browser profile paints the saved choice. The pre-paint script in `index.html` prefers those attributes and falls back to localStorage. Vite dev serves no injected attributes, so there the localStorage values apply.

---

## 5. Motion

Motion explains a state change; it never decorates one. [`DESIGN.md`](../../DESIGN.md) (Foundations → Motion) holds the full contract; these are the rules every change under `src/frontend/` follows.

- **Every duration and easing is a token.** `transition`, `animation`, `animation-delay` and `transition-duration` take their timing from `src/frontend/styles/tokens.css` (`--duration-*`, `--ease-*`, `--transition*`, `--duration-typing-offset`). A raw `180ms`, `1.4s` or `cubic-bezier()` anywhere but the token file fails `bun run test:frontend-smoke`.
- **Never `transition: all`.** Name the properties, and animate `transform` and `opacity` rather than anything that re-lays-out.
- **Every keyframe has a reduced-motion path beside it.** Declare the same `@keyframes` again inside a `@media (prefers-reduced-motion: reduce)` block in the same file, with the movement dropped and the fade kept; an infinite animation stops there (`animation-iteration-count: 1`) and becomes a static indicator. The smoke gate fails when a moving keyframe has no reduced path, when a reduced path still moves, or when a loop never stops.
- **Use the motion library's vocabulary** instead of new keyframes. `src/frontend/motion/MotionProvider.tsx` mounts `LazyMotion` once, with `MotionConfig reducedMotion="user"`; `MotionEntry` and `MotionList` / `MotionListItem` cover entry and list reordering. Sheets animate with the CSS motion tokens, and no surface is dragged, so there is no drag component. Use the `m` components, never `motion`, so the lazily loaded feature pack stays out of the entry chunk — exactly one file, `src/frontend/motion/motion-feature-pack.ts`, may name a feature pack.
- **Springs, not durations, for interruptible motion.** Keep bounce subtle (0.1–0.3) and parameterise springs in `src/frontend/motion/motion-springs.ts`.

---

## 6. Never load from a third party

- Do not point `src`, `href` (except a plain navigation link on `<a>`), `srcset`, `poster`, `@import` or `url()` at another host, and do not `fetch` one. `bun run test:frontend-smoke` scans the pages, the stylesheets and the frontend sources for this, and drives a browser through every screen to catch requests made from JavaScript.
- Vendored assets are served by X-Factory: the API Reference viewer is a pinned copy under `public/assets/api-reference/` (see [ci-checks.md](./ci-checks.md)).
- Everything from a CDN is a bug, however convenient: an offline laptop is a supported way to run X-Factory.

## 7. Building blocks (React Aria)

Screens are built from one vocabulary of controls, in `src/frontend/components/ui/`:

| Block | Module | Notes |
|---|---|---|
| Button | `Button.tsx` | `variant` (primary/secondary/danger/quiet), `size` (sm/md/lg), optional sprite `icon` |
| Icon button | `IconButton.tsx` | icon-only, `label` is required — an icon-only control always has an accessible name |
| Text field, text area | `TextField.tsx` | label, description, an inline `feedback` slot (a `FieldFeedback` node) |
| Select | `SelectField.tsx` | options are data; the list opens in a popover as a listbox |
| Segmented control | `SegmentedControl.tsx` | one control, mutually exclusive options; arrow keys move between segments; opt-in `collapseBelow` renders the same options through the Select block below that viewport width (the pop-up button for too many segments); one thumb per control slides to a pointer choice on the default spring from `MotionProvider` and moves at once for a keyboard, route or resize change |
| Switch | `SwitchControl.tsx` | track and thumb are tokens; the platform keeps the switch semantics |
| Badge | `Badge.tsx` | a short state word, never an emoji |
| Grouped list, list row | `ListGroup.tsx`, `ListRow.tsx` | the inset grouped list every list is built from; the group is a size container, and below a 30rem list the row wraps — title on its own line, trailing accessory under it; `PlaceholderRows` is its static loading shape |
| Table | `Table.tsx` | the one table style: a native table drawn as an inset group, sortable headers (`aria-sort`), numbers right-aligned in tabular figures, a full-width detail row; its frame is a size container, and below 30rem the rows re-flow into labelled stacks |
| Spinner | `Spinner.tsx` | the one inline wait indicator |

Rules:

- **React Aria owns behaviour, tokens own every visual value.** The blocks wrap React Aria's unstyled primitives and React Aria's own stylesheet is never imported. State comes from its data attributes (`data-hovered`, `data-pressed`, `data-selected`, `data-disabled`, `data-focus-visible`) — style those, not `:hover`.
- **Style them in `src/frontend/styles/shared/controls.css`**, the shared layer (section 3). Never inline a style, and never over-define a block from a screen: a screen composes blocks, it does not repaint them.
- **A list is a block, not a class string.** Screens compose `ListGroup`/`ListGroupRow` (and `ListRow` for a list of records, `Table` for columns of data) and pass no box classes of their own; the grouped-list rules — one card-shaped group, inset hairlines, one hover rule — live in `controls.css` and are described in `DESIGN.md` §7.
- **Every block a finger can hit is at least `--tap-min` tall.** `--tap-min` is 44px where a touch input is present or the viewport is 768px or less, and a 24px hit area otherwise (`test/frontend-token-measurements.test.ts` measures both). `test/ui-loading-states.test.tsx` fails if the 44px default changes.
- **Buttons have a filled bezel and no border.** Fields, switches and other controls keep `--border-control`. `test/theme-contrast.test.ts` proves that pair at 3:1 in every theme, appearance and contrast setting.
- **One focus ring, one definition.** `controls.css` draws it from `--border-width-indicator` and `--border-focus` for every interactive block; the twelve-set contrast gate proves that pair at 3:1 or better.
- **Lists load as static placeholder rows; everything else waits behind the one spinner.** Placeholder rows reserve `--list-row-height`, so the loaded list cannot jump, and they never animate. A shimmer is banned, in markup and in CSS (`test/frontend-smoke.test.ts`).
- **Errors are announced as alerts.** `AsyncRegion`'s error state, an error-tone `FeedbackBanner` and an invalid `FieldFeedback` use `role="alert"`; informational and partial states stay polite.
- `src/frontend/components/feedback/` renders through these blocks. `components/ui` and `src/shared` are its only escapes, and the smoke gate holds `components/ui` to the same screen-agnostic rule.

---

## 8. Verification Gate

Before submitting or completing any UI/frontend task, run:
```bash
bun run typecheck:frontend
bun run test:frontend-smoke
```
Both must exit with code 0.

---

## 9. Transition state (spec #292)

The design system is being migrated to the blocks. Until M8 lands, the code has two layers, and this section says which is which.

**For new code:**

- Use the blocks in `src/frontend/components/ui/` and the shared layer `styles/shared/controls.css`. Once a block exists for a need (Card, EmptyState and PageHeader are the next ones, see spec #292 "Blocks"), use it.
- Do not use `buttons.css`, `cards.css` or `badges.css`. They are transitional legacy styles that an old screen still needs. `buttons.css` sets the default style for a bare `button` (`font-size: 0.88rem`), so a new bare `<button>` is a finding.

**Gates.** Active gates are in `test/frontend-smoke.test.ts`. A gate lands in the PR that clears its last finding.

| Gate | Rule | Status | Lands in |
|---|---|---|---|
| G1 | No raw `box-shadow` or `border-radius` value outside `tokens.css` | active | step 1 |
| G2 | No text token below 10px; `--text-micro`, `--text-badge`, `--text-tag` do not exist | active | step 1 |
| G3 | No raw rem/em spacing (`margin`, `padding`, `gap`, `inset`, offsets) outside `tokens.css` | inactive | M7 files clean; gate lands with the activation step (part 2) |
| G4 | No `font-size` or `font-weight` in a component stylesheet; text styles only | inactive | M7 files clean; gate lands with the activation step (part 2). The shared layer keeps text-style tokens, see below |
| G5 | No raw `<button>` outside `components/ui/` | inactive | M7 files clean; gate lands with the activation step (part 2) |
| G6 | No `sprite.svg#` reference outside `components/ui/` | inactive | M7 files clean; gate lands with the activation step (part 2) |
| G7 | No page `<header>` or page-heading class in `views/*.tsx`; PageHeader only | inactive | M7 files clean; gate lands with the activation step (part 2) |
| G8 | No empty-state markup outside `AsyncRegion` or EmptyState | inactive | M7 files clean; gate lands with the activation step (part 2) |
| G9 | No card class outside the Card block, except diagram node cards | inactive | M7 files clean; gate lands with the activation step (part 2) |
| G10 | Button and menu-item labels use Title Case | inactive | step 5 |
| G11 | `buttons.css`, `cards.css` and `badges.css` do not exist; no bare `button` style | inactive | M8 |

**Migration matrix** (spec #292, "Migration matrix"). Order M1 to M8. Each row removes every finding of the gates in its column from the files it owns:

- M1 Shell and shared layer (AppShell, notifications, palette, overlays, feedback, Markdown, Modal, forms, controls, utilities, NotFound, Welcome, SetupChecklist)
- M2 Tickets (QueueView, queue, NewRunModal). Cleared: every G3 to G9 finding in its files; the gates still land in M7 with the rest of the matrix.
- M3 Projects (ProjectsView, ProjectDetailView, projects). Cleared: every G3 to G9 finding in its files; the gates still land in M7 with the rest of the matrix.
- M4 Settings and connections. Cleared: every G3 to G9 finding in its files; the gates still land in M7 with the rest of the matrix.
- M5 Wizard
- M6 Runs (RunsView, RunDetailView, runs). Its files have no G3 to G9 findings. G3 to G9 stay inactive until M7 clears the other areas.
- M7 Docs and diagrams (DocsView, DocsSidebarNav, diagrams, specimen). Its files print clean for G3 to G9. The gates still wait for the activation step.
- M8 Legacy CSS removal (`buttons.css`, `cards.css`, `badges.css`). G11 lands here.

Migration progress: M7 (Docs and diagrams) is done. Its files (`views/DocsView`, `components/docs/`, `components/diagrams/`, and the specimen page with `components/specimen/`) print clean for G3 to G9, and the diagram node cards use tokens and text styles. M5 (Wizard) is done. `src/frontend/wizard/` has no G3 to G9 finding. Its G3 to G9 gates still wait for M7 because other areas have findings.

Between step 3 and M7, drift in migrated areas is caught by the design-reviewer check, not by a gate. M7 closes that gap.

**M1 (shell and shared layer) is done.** Its files print clean for G3, G5, G6 and G8, and their component stylesheets have no `font-size` or `font-weight`. Three kinds of declaration remain on purpose, and M7 must treat them as allowed before G4 lands:

- `styles/utilities.css` defines the `.text-*` text styles and the `.font-*` weight utilities, so it holds the only `font-size` that is a text style itself.
- `styles/shared/controls.css` keeps `font-size: var(--text-*)` with its weight token where a block sets its own text style.
- `styles/shared/forms.css` sets the bare `label`, input and `.form-*` text with text-style tokens, because its classes are used by every screen.

Each migration PR updates the gate table. M8 deletes this section.
