# Frontend Styling & CSS Architecture Rule

This repository strictly enforces Apple Human Interface Guidelines (HIG) and a modular, token-based Vanilla CSS architecture. All AI coding agents operating on `src/frontend` must comply with the following invariants without exception.

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
   - Colors: Functional tokens (`--text`, `--text-muted`, `--accent`, `--green`, `--red`, `--yellow`, `--border`, etc.) with light & dark theme definitions.
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
  - Component: `src/frontend/components/MyComponent.tsx` $\rightarrow$ `src/frontend/components/MyComponent.css`.
  - View: `src/frontend/views/MyView.tsx` $\rightarrow$ `src/frontend/views/MyView.css`.
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

## 5. Verification Gate

Before submitting or completing any UI/frontend task, run:
```bash
bun run typecheck:frontend
bun run test:frontend-smoke
```
Both must exit with code 0.
