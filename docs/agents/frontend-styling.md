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
   - Radii: Apple squircle standard (`--radius-sm` to `--radius-xl`).
   - Typography: HIG scale (`--text-large-title` to `--text-caption-2`).
   - Colors: Functional tokens (`--text`, `--text-muted`, `--accent`, `--green`, `--red`, `--yellow`, `--orange`, `--border`, etc.) with light & dark theme definitions. Warnings always use `--orange` / `--orange-dim` — never `--yellow` (see `docs/reference/state-coverage.md`).
2. **Base (`src/frontend/styles/base.css`)**:
   - Modern CSS resets, root font configuration (Inter / SF Pro text), custom scrollbars.
3. **Shared Components (`src/frontend/styles/shared/*.css`)**:
   - `buttons.css`, `cards.css`, `forms.css`, `badges.css`, `icons.css`, `scrollbar.css`.
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

---

## 4. Color & Measurement Invariants

- **No Hardcoded Hex/RGB**: Never write `#ffffff`, `#0071e3`, `rgb(...)` outside of `tokens.css`. Always use `var(--accent)`, `var(--text)`, `var(--bg-card)`, etc.
- **No Arbitrary Spacing**: Spacing must use `--space-*` tokens or utility classes (`.mt-4`, `.mb-2`, etc.).
- **No Arbitrary Font Sizes**: Font sizes must follow HIG typography tokens (`--text-caption-1`, `--text-footnote`, `--text-headline`, etc.).

---

## 5. Motion

Motion explains a state change; it never decorates one. [`DESIGN.md`](../../DESIGN.md) (Foundations → Motion) holds the full contract; these are the rules every change under `src/frontend/` follows.

- **Every duration and easing is a token.** `transition`, `animation`, `animation-delay` and `transition-duration` take their timing from `src/frontend/styles/tokens.css` (`--duration-*`, `--ease-*`, `--transition*`, `--duration-stagger`). A raw `180ms`, `1.4s` or `cubic-bezier()` anywhere but the token file fails `bun run test:frontend-smoke`.
- **Never `transition: all`.** Name the properties, and animate `transform` and `opacity` rather than anything that re-lays-out.
- **Every keyframe has a reduced-motion path beside it.** Declare the same `@keyframes` again inside a `@media (prefers-reduced-motion: reduce)` block in the same file, with the movement dropped and the fade kept; an infinite animation stops there (`animation-iteration-count: 1`) and becomes a static indicator. The smoke gate fails when a moving keyframe has no reduced path, when a reduced path still moves, or when a loop never stops.
- **Use the motion library's vocabulary** instead of new keyframes. `src/frontend/motion/MotionProvider.tsx` mounts `LazyMotion` once, with `MotionConfig reducedMotion="user"`; `MotionEntry`, `MotionList` / `MotionListItem`, `MotionSheet` and `MotionDrag` cover entry, list reordering, sheets and drag. Use the `m` components, never `motion`, so the lazily loaded feature pack stays out of the entry chunk — exactly one file, `src/frontend/motion/motion-feature-pack.ts`, may name a feature pack.
- **Springs, not durations, for interruptible motion.** Keep bounce subtle (0.1–0.3) and parameterise springs in `src/frontend/motion/motion-springs.ts`.

---

## 6. Never load from a third party

- Do not point `src`, `href` (except a plain navigation link on `<a>`), `srcset`, `poster`, `@import` or `url()` at another host, and do not `fetch` one. `bun run test:frontend-smoke` scans the pages, the stylesheets and the frontend sources for this, and drives a browser through every screen to catch requests made from JavaScript.
- Vendored assets are served by X-Factory: the API Reference viewer is a pinned copy under `public/assets/api-reference/` (see [ci-checks.md](./ci-checks.md)).
- Everything from a CDN is a bug, however convenient: an offline laptop is a supported way to run X-Factory.

## 7. Verification Gate

Before submitting or completing any UI/frontend task, run:
```bash
bun run typecheck:frontend
bun run test:frontend-smoke
```
Both must exit with code 0.
