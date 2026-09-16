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
  - **Typography**: use the system font stack — `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui`. On an Apple device this legitimately resolves to real San Francisco, because it's the OS pointing at its own installed font, not you embedding one. Pair it with a web-licensed fallback for everyone else — **Inter** is the closest optical match to SF Pro (similar x-height, similar spacing rhythm).
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

### Typography
HIG: `/design/human-interface-guidelines/typography`
Apple's default type scale (SF Pro, Dynamic Type "Large" size):

| Style | Size | Weight |
|---|---|---|
| Large Title | 34px | Regular |
| Title 1 | 28px | Regular |
| Title 2 | 22px | Regular |
| Title 3 | 20px | Regular |
| Headline | 17px | Semibold |
| Body | 17px | Regular |
| Callout | 16px | Regular |
| Subheadline | 15px | Regular |
| Footnote | 13px | Regular |
| Caption 1 | 12px | Regular |
| Caption 2 | 11px | Regular |

Use this scale exclusively — no arbitrary font sizes. On the web, implement it with `rem` so it scales with the user's browser text-size setting (the closest equivalent to Dynamic Type).

### Layout & spacing
HIG: `/design/human-interface-guidelines/layout`
Apple lays out on an **8pt grid with a 4pt sub-grid**. Standard content margins are 16–20pt. Use this instead of arbitrary pixel values — it's most of what makes an interface feel "considered" rather than assembled ad hoc.

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

### Motion
HIG: `/design/human-interface-guidelines/motion`
Apple's system animations are spring-based, not linear. Motion should be purposeful — it should *explain* a change (where did this view come from, where did it go), never decorate for its own sake. On the web, approximate the spring feel with an overshoot easing curve, and **always** respect `prefers-reduced-motion` — treat it as a hard requirement, not a nice-to-have.

### Icons
HIG: `/design/human-interface-guidelines/icons` + SF Symbols site
SF Symbols ship in 3 scales (small/medium/large) and 9 weights matching SF Pro's weight axis, and align to text baselines automatically. Whatever icon set you use (native SF Symbols or a substitute per Section 3), hold it to the same discipline: one weight per context, consistent stroke width, baseline-aligned next to text, never mixed with a second icon style.

### Accessibility
HIG: `/design/human-interface-guidelines/accessibility`
- Minimum tap/click target: **44×44pt**, even if the visible icon is smaller.
- Text contrast: minimum 4.5:1 for body text against its background (Apple's guidance and WCAG AA agree here).
- Every icon-only control needs an accessible label — `aria-label` on the web, not just a `title` attribute.
- Respect reduced-motion and (where relevant) reduced-transparency preferences.

## 6. Starter tokens

Drop-in baseline for a web implementation — adjust values only against the HIG pages above, not by eye.

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

  /* Spacing — 8pt grid, 4pt sub-grid */
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px;

  /* Type scale */
  --text-large-title: 34px; --text-title-1: 28px; --text-title-2: 22px;
  --text-title-3: 20px; --text-headline: 17px; --text-body: 17px;
  --text-callout: 16px; --text-subhead: 15px; --text-footnote: 13px;
  --text-caption-1: 12px; --text-caption-2: 11px;

  /* Radius */
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 20px;

  /* Motion */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: 150ms; --duration-standard: 250ms; --duration-slow: 400ms;

  /* Fonts — web path; see Section 3 for the licensing reasoning */
  --font-system: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", system-ui, sans-serif;
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
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms; --duration-standard: 0ms; --duration-slow: 0ms;
  }
}
```

## 7. Components & patterns

HIG: `/design/human-interface-guidelines/components` and `.../patterns`
Figma: the platform UI kit on `figma.com/@apple` (currently the iOS/iPadOS kit — pull the matching platform kit if this ever targets macOS, watchOS, etc.)

Before building any of the following, pull the matching component from the Figma kit and its HIG page rather than freehanding it: buttons (filled / tinted / gray / plain), navigation bar, tab bar, sidebar, lists (plain / grouped / inset grouped), sheets, alerts vs. action sheets, segmented controls, toggles, sliders, search fields, context menus.

For flows, check the Patterns section first: onboarding, search, feedback, data entry, notifications, undo/redo, settings. Apple has already solved most of the "how should this flow work" questions — use the solved version.

## 8. Non-negotiables

- MUST check the relevant HIG page and Figma kit before designing any new screen or component.
- MUST NOT invent a custom control (custom dropdown, custom modal, custom date picker) when Apple has a documented equivalent.
- MUST implement light and dark appearance together, from the first pass — using semantic tokens, never hardcoded hex values.
- MUST use the 8pt/4pt spacing grid. No arbitrary pixel values in layout code.
- MUST meet 44×44pt minimum tap targets on every interactive element.
- MUST respect `prefers-reduced-motion`. Motion must explain a state change, not just decorate one.
- MUST NOT apply blur/glass materials to content surfaces — chrome only (Section 5, Materials).
- MUST use the defined type scale (Section 5, Typography) — no arbitrary font sizes.
- MUST give every icon-only control an accessible label.
- MUST follow the licensing path from Section 3 — no shipping literal SF Symbols/SF Pro assets in a non-Apple-platform build.

## 9. Definition of done

Before calling any UI work finished, confirm:

- [ ] Checked against the relevant HIG Foundations/Patterns/Components page
- [ ] Matches the Apple Figma kit component, or deviates with a documented reason
- [ ] Light and dark mode both implemented and visually checked
- [ ] Type scale, spacing grid, and color tokens used — no magic numbers
- [ ] Tap targets ≥ 44×44pt
- [ ] Motion respects `prefers-reduced-motion`
- [ ] Icons are one consistent weight/style, baseline-aligned with text
- [ ] Contrast checked — 4.5:1 minimum for body text
- [ ] Every icon-only control has an accessible label

## 10. Quick reference

- HIG home: `developer.apple.com/design/`
- Apple Figma profile: `figma.com/@apple`
- Design resources index: `developer.apple.com/design/resources/`
- SF Symbols: `developer.apple.com/sf-symbols/`
- Fonts (SF Pro / SF Compact / SF Mono / New York): `developer.apple.com/fonts/`
- Apple Design Awards (reference implementations): `developer.apple.com/design/awards/`

Note: opening Apple's Figma kit for the first time will prompt a click-through license agreement for the UI kit itself, and a separate optional one for the SF Pro font inside Figma. Accepting the font license there governs use *inside Figma*, not what you're allowed to ship — see Section 3.
