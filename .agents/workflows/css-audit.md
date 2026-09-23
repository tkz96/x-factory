# /css-audit — Frontend CSS & Design System Audit Workflow

Use this workflow to audit the frontend codebase for design system compliance, rogue inline styles, hardcoded colors, or unlinked stylesheets.

---

## Step 1: Inline Style Audit

Scan all TSX files for forbidden inline `style={{` blocks:

```bash
grep -rn 'style={{' src/frontend/ --include='*.tsx'
```

**Expected Result**: Zero matches (except permissible CSS custom property passthrough).
If any matches appear:
1. Locate the component.
2. Check if a utility class in `src/frontend/styles/utilities.css` or shared component CSS handles it.
3. If specific to the component, move the styling to the co-located `.css` file.

---

## Step 2: Hardcoded Hex & Color Audit

Scan all TSX files for raw hex color literals:

```bash
grep -rnE '#[0-9a-fA-F]{3,8}' src/frontend/ --include='*.tsx'
```

**Expected Result**: Zero matches outside of mock data or documentation.
If found, replace with semantic tokens (`var(--accent)`, `var(--text)`, `var(--green)`, etc.).

---

## Step 3: Co-located CSS Import Audit

Verify that all views and components with `.css` files have explicit imports:

```bash
find src/frontend -name "*.css"
```

For each `.css` file (e.g. `src/frontend/views/QueueView.css`), verify that `src/frontend/views/QueueView.tsx` includes:
```tsx
import "./QueueView.css";
```

---

## Step 4: Run Smoke Tests & Typecheck

Execute the automated CI verification gates:

```bash
bun run typecheck:frontend
bun run test:frontend-smoke
```

Both commands must pass with exit code 0.
