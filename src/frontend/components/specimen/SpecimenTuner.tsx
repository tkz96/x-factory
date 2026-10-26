// The specimen's Tune panel (dev only). It overrides design tokens on the root
// element while the specimen is shown, so a change shows on every block at
// once, and it copies only the changed tokens as CSS for the maintainer to hand
// back. Overrides persist in this browser between visits and are removed when
// the specimen unmounts, so the rest of the app never sees them.

import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button.js";

type Kind = "px" | "rem" | "number" | "weight" | "color" | "superellipse";

interface TunableToken {
  name: string;
  label: string;
  kind: Kind;
  min?: number;
  max?: number;
  step?: number;
}

interface TokenGroup {
  title: string;
  note?: string;
  tokens: TunableToken[];
}

const px = (name: string, label: string, min: number, max: number, step = 1) =>
  ({ name, label, kind: "px", min, max, step }) as const;
const text = (key: string, label: string) =>
  ({
    name: `--text-${key}`,
    label,
    kind: "rem",
    min: 8,
    max: 40,
    step: 0.5,
  }) as const;
const weight = (key: string, label: string) =>
  ({
    name: `--text-${key}-weight`,
    label: `${label} weight`,
    kind: "weight",
  }) as const;

const GROUPS: TokenGroup[] = [
  {
    title: "Corner Radii",
    tokens: [
      {
        name: "--corner-shape",
        label: "Corner shape",
        kind: "superellipse",
        min: 0,
        max: 3,
        step: 0.1,
      },
      px("--radius-xs", "Radius xs", 0, 16),
      px("--radius-sm", "Radius sm", 0, 20),
      px("--radius-md", "Radius md", 0, 24),
      px("--radius-card", "Radius card", 0, 32),
      px("--radius-lg", "Radius sheet", 0, 40),
    ],
  },
  {
    title: "Lines and icons",
    tokens: [
      px("--hairline", "Hairline", 0.5, 2, 0.5),
      {
        name: "--icon-stroke",
        label: "Icon stroke",
        kind: "number",
        min: 1,
        max: 2.5,
        step: 0.25,
      },
    ],
  },
  {
    title: "Controls",
    note: "Desktop (fine pointer) values. Touch keeps 44px.",
    tokens: [
      px("--control-height-sm", "Small control", 16, 40),
      px("--control-height", "Regular control", 20, 48),
      px("--control-height-lg", "Large control", 24, 56),
      px("--header-height", "Toolbar", 36, 72),
      px("--sidebar-width", "Sidebar", 180, 360, 4),
    ],
  },
  {
    title: "Text sizes",
    note: "The active scale: macOS on desktop, iOS on touch or narrow.",
    tokens: [
      text("large-title", "Large Title"),
      text("title-1", "Title 1"),
      text("title-2", "Title 2"),
      text("title-3", "Title 3"),
      text("headline", "Headline"),
      text("body", "Body"),
      text("callout", "Callout"),
      text("subhead", "Subheadline"),
      text("footnote", "Footnote"),
      text("caption-1", "Caption 1"),
      text("caption-2", "Caption 2"),
    ],
  },
  {
    title: "Text weights",
    tokens: [
      weight("large-title", "Large Title"),
      weight("title-3", "Title 3"),
      weight("headline", "Headline"),
      weight("body", "Body"),
      weight("subhead", "Subheadline"),
      weight("caption-2", "Caption 2"),
    ],
  },
  {
    title: "Colour",
    note: "Overrides both appearances while tuning.",
    tokens: [{ name: "--accent", label: "Accent", kind: "color" }],
  },
];

const ALL_TOKENS = GROUPS.flatMap((group) => group.tokens);
const STORAGE_KEY = "xf_specimen_tune";
const WEIGHTS = [300, 400, 500, 600, 700, 800];

type Overrides = Record<string, string>;

function readStored(): Overrides {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Overrides) : {};
  } catch {
    return {};
  }
}

function writeStored(overrides: Overrides): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable: the overrides still apply for this visit.
  }
}

/** A token's value as the page resolves it now, in the unit the control uses. */
function resolvedValue(token: TunableToken): string {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(token.name).trim();
  if (token.kind === "color") {
    // The probe class paints in var(--accent), the one colour token tuned here.
    const probe = document.createElement("span");
    probe.className = "specimen-tuner-probe";
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const parts = rgb.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  if (token.kind === "rem") {
    const rem = Number.parseFloat(raw);
    return String(raw.endsWith("rem") ? rem * 16 : rem);
  }
  if (token.kind === "superellipse") {
    if (raw === "round") return "1";
    const match = raw.match(/superellipse\(([-\d.]+)\)/);
    return match?.[1] ?? "1";
  }
  return String(Number.parseFloat(raw));
}

/** The CSS value written to the root for a control value. */
function cssValue(token: TunableToken, value: string): string {
  switch (token.kind) {
    case "px":
      return `${value}px`;
    case "rem":
      return `${Number(value) / 16}rem`;
    case "superellipse":
      return `superellipse(${value})`;
    default:
      return value;
  }
}

/** Shows the value with its unit, and px beside rem for text sizes. */
function display(token: TunableToken, value: string): string {
  if (token.kind === "px") return `${value}px`;
  if (token.kind === "rem") return `${value}px`;
  return value;
}

export function SpecimenTuner() {
  const [open, setOpen] = useState(true);
  const [overrides, setOverrides] = useState<Overrides>(readStored);
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  // Read the page's own values once, before any override is applied.
  useEffect(() => {
    const root = document.documentElement;
    for (const token of ALL_TOKENS) root.style.removeProperty(token.name);
    setBaseline(
      Object.fromEntries(ALL_TOKENS.map((t) => [t.name, resolvedValue(t)])),
    );
  }, []);

  // Apply the overrides to the root while the specimen is shown.
  useEffect(() => {
    const root = document.documentElement;
    for (const token of ALL_TOKENS) {
      const value = overrides[token.name];
      if (value === undefined) root.style.removeProperty(token.name);
      else root.style.setProperty(token.name, cssValue(token, value));
    }
    writeStored(overrides);
  }, [overrides]);

  useEffect(
    () => () => {
      for (const token of ALL_TOKENS) {
        document.documentElement.style.removeProperty(token.name);
      }
    },
    [],
  );

  const changed = useMemo(
    () =>
      ALL_TOKENS.filter(
        (t) =>
          overrides[t.name] !== undefined &&
          overrides[t.name] !== baseline[t.name],
      ),
    [overrides, baseline],
  );

  const set = (name: string, value: string) =>
    setOverrides((current) => ({ ...current, [name]: value }));
  const reset = (name: string) =>
    setOverrides((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });

  const summary = () => {
    const root = document.documentElement.dataset;
    const desktop = globalThis.matchMedia?.(
      "(pointer: fine) and (min-width: 769px)",
    ).matches;
    const lines = changed.map((token) => {
      const before = baseline[token.name] ?? "";
      const value = overrides[token.name] ?? "";
      return `${token.name}: ${cssValue(token, value)}; /* was ${cssValue(token, before)} */`;
    });
    return [
      `/* Specimen tune — ${changed.length} change(s). Scale: ${desktop ? "macOS (desktop)" : "iOS (touch/narrow)"}; appearance: ${root.appearance ?? "?"}; theme: ${root.theme ?? "?"}. */`,
      ...lines,
    ].join("\n");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!open) {
    return (
      <div className="specimen-tuner specimen-tuner--closed">
        <Button variant="secondary" size="sm" onPress={() => setOpen(true)}>
          Tune{changed.length > 0 ? ` (${changed.length})` : ""}
        </Button>
      </div>
    );
  }

  return (
    <aside className="specimen-tuner" aria-label="Tune design tokens">
      <div className="specimen-tuner-header">
        <h2 className="text-headline specimen-heading">Tune</h2>
        <Button variant="quiet" size="sm" onPress={() => setOpen(false)}>
          Hide
        </Button>
      </div>
      <p className="text-subhead specimen-tuner-note">
        Changes apply to this page only. Copy them and paste them to Claude.
      </p>
      <div className="specimen-tuner-actions">
        <Button
          variant="primary"
          size="sm"
          isDisabled={changed.length === 0}
          onPress={copy}
        >
          {copied ? "Copied" : `Copy Changes (${changed.length})`}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={Object.keys(overrides).length === 0}
          onPress={() => setOverrides({})}
        >
          Reset All
        </Button>
      </div>
      {GROUPS.map((group) => (
        <section key={group.title} className="specimen-tuner-group">
          <h3 className="text-subhead specimen-subheading">{group.title}</h3>
          {group.note !== undefined && (
            <p className="text-footnote specimen-tuner-note">{group.note}</p>
          )}
          {group.tokens.map((token) => {
            const value = overrides[token.name] ?? baseline[token.name] ?? "";
            const isChanged =
              overrides[token.name] !== undefined &&
              overrides[token.name] !== baseline[token.name];
            const id = `tune${token.name}`;
            return (
              <div
                key={token.name}
                className={
                  isChanged
                    ? "specimen-tuner-row specimen-tuner-row--changed"
                    : "specimen-tuner-row"
                }
              >
                <label htmlFor={id} className="text-callout">
                  {token.label}
                </label>
                <span className="text-footnote specimen-tuner-value">
                  {display(token, value)}
                </span>
                {token.kind === "color" ? (
                  <input
                    id={id}
                    type="color"
                    value={value}
                    onChange={(e) => set(token.name, e.target.value)}
                  />
                ) : token.kind === "weight" ? (
                  <select
                    id={id}
                    className="text-callout"
                    value={value}
                    onChange={(e) => set(token.name, e.target.value)}
                  >
                    {WEIGHTS.map((w) => (
                      <option key={w} value={String(w)}>
                        {w}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type="range"
                    min={token.min}
                    max={token.max}
                    step={token.step}
                    value={value}
                    onChange={(e) => set(token.name, e.target.value)}
                  />
                )}
                {isChanged && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onPress={() => reset(token.name)}
                  >
                    Undo
                  </Button>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
