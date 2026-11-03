// scripts/screenshots/matrix.ts — The evidence matrix: which screens, in which
// conditions, and what a command line asks for.
//
// Screen PRs of spec #241 carry before/after screenshots. This module is the
// single list of both axes, plus the parser for `bun run screenshots`. It is
// pure (no browser, no server) so it can be tested directly.

import path from "node:path";

/** Where a screen lives. `run` is filled in with the seeded run's id. */
export interface ScreenDef {
  readonly name: string;
  readonly path: string;
  readonly description: string;
}

/** Every screen of the evidence matrix. Add a row when a screen is added. */
export const SCREENS: readonly ScreenDef[] = [
  {
    name: "welcome",
    path: "/welcome",
    description: "The first-run welcome and its checklist",
  },
  { name: "shell", path: "/runs", description: "The app chrome around Runs" },
  { name: "tickets", path: "/tickets", description: "Tickets" },
  { name: "runs", path: "/runs", description: "The Runs list" },
  {
    name: "history",
    path: "/runs?filter=done",
    description: "Done runs (History folds into Runs)",
  },
  { name: "run", path: "/runs/{runId}", description: "A run that needs you" },
  {
    name: "run-failed",
    path: "/runs/{failedRunId}",
    description: "A failed run, with its failure cause",
  },
  {
    name: "run-reworked",
    path: "/runs/{reworkedRunId}",
    description: "A run sent back from review: two attempts",
  },
  { name: "projects", path: "/projects", description: "The Projects list" },
  {
    name: "project",
    path: "/projects/{projectId}",
    description: "One project's detail",
  },
  { name: "settings", path: "/settings", description: "Settings" },
  { name: "docs", path: "/docs", description: "Documentation" },
  { name: "reference", path: "/reference", description: "API Reference" },
];

export interface VariantDef {
  readonly name: string;
  readonly description: string;
  readonly viewport: { readonly width: number; readonly height: number };
  /** The app's own appearance setting (localStorage `xf_theme`). */
  readonly appearance: "light" | "dark";
  readonly colorScheme: "light" | "dark";
  readonly contrast?: "more";
  readonly reducedMotion?: "reduce";
  readonly forcedColors?: "active";
}

const DESKTOP = { width: 1280, height: 800 } as const;

/** Every condition a screen is shown in. */
export const VARIANTS: readonly VariantDef[] = [
  {
    name: "light",
    description: "Light appearance",
    viewport: DESKTOP,
    appearance: "light",
    colorScheme: "light",
  },
  {
    name: "dark",
    description: "Dark appearance",
    viewport: DESKTOP,
    appearance: "dark",
    colorScheme: "dark",
  },
  {
    name: "narrow",
    description: "Phone width, 390 px",
    viewport: { width: 390, height: 844 },
    appearance: "light",
    colorScheme: "light",
  },
  {
    name: "contrast",
    description: "Increased contrast (prefers-contrast: more)",
    viewport: DESKTOP,
    appearance: "light",
    colorScheme: "light",
    contrast: "more",
  },
  {
    name: "motion",
    description: "Reduced motion (prefers-reduced-motion: reduce)",
    viewport: DESKTOP,
    appearance: "light",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  {
    name: "forced-colors",
    description: "Forced colours (forced-colors: active)",
    viewport: DESKTOP,
    appearance: "light",
    colorScheme: "light",
    forcedColors: "active",
  },
];

/** The appearances the shell can be captured in with `--themes`. */
export const SHELL_THEMES = ["light", "dark"] as const;

export interface ScreenshotRequest {
  readonly screens: readonly ScreenDef[];
  readonly variants: readonly VariantDef[];
  /** A theme-by-theme capture of the shell instead of the variant sweep. */
  readonly shellThemes: boolean;
  readonly outDir: string;
  readonly fullPage: boolean;
  readonly label: string;
  /** Reuse an existing frontend build instead of building one. */
  readonly publicDir: string | null;
  readonly help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const names = (items: readonly { name: string }[]) =>
  items.map((item) => item.name).join(", ");

export const USAGE = `Usage: bun run screenshots <screen|all> [options]

Captures a screen of X-Factory from an isolated instance (temporary data dir,
seeded demo data). Evidence for review, not a pixel-diff gate.

Screens:   ${names(SCREENS)}
Variants:  ${names(VARIANTS)}

Options:
  --variant <a,b|all>  Conditions to capture (default: all)
  --themes             Capture the shell in each theme (${SHELL_THEMES.join(", ")}); ignores <screen>
  --label <name>       Subfolder for this capture, e.g. before or after (default: current)
  --out <dir>          Output folder (default: .scratch/screenshots)
  --viewport-only      Capture the visible window instead of the full page
  --public-dir <dir>   Serve this frontend build instead of building one
  -h, --help           Show this text
`;

function pick<T extends { name: string }>(
  all: readonly T[],
  wanted: string,
  kind: string,
): T[] {
  if (wanted === "all") return [...all];
  return wanted.split(",").map((raw) => {
    const found = all.find((item) => item.name === raw.trim());
    if (!found) {
      throw new UsageError(
        `Unknown ${kind} "${raw}". Choose from: ${names(all)}.`,
      );
    }
    return found;
  });
}

/** Parses argv (without the runtime and script) into a request. */
export function parseArgs(argv: readonly string[]): ScreenshotRequest {
  let screenArg: string | null = null;
  let variantArg = "all";
  let shellThemes = false;
  let label = "current";
  let outDir = path.join(process.cwd(), ".scratch", "screenshots");
  let fullPage = true;
  let publicDir: string | null = null;
  let help = false;

  const value = (index: number, flag: string): string => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`${flag} needs a value.`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-h" || arg === "--help") help = true;
    else if (arg === "--themes") shellThemes = true;
    else if (arg === "--viewport-only") fullPage = false;
    else if (arg === "--variant") variantArg = value(i++, arg);
    else if (arg === "--label") label = value(i++, arg);
    else if (arg === "--out") outDir = path.resolve(value(i++, arg));
    else if (arg === "--public-dir") publicDir = path.resolve(value(i++, arg));
    else if (arg.startsWith("-"))
      throw new UsageError(`Unknown option "${arg}".`);
    else if (screenArg === null) screenArg = arg;
    else throw new UsageError(`Unexpected argument "${arg}".`);
  }

  if (!/^[\w.-]+$/.test(label)) {
    throw new UsageError(
      `--label may only contain letters, digits, ".", "_" and "-".`,
    );
  }
  const base = { shellThemes, outDir, fullPage, label, publicDir, help };
  if (help) return { screens: [], variants: [], ...base };

  if (shellThemes) {
    const shell = SCREENS.find(
      (screen) => screen.name === "shell",
    ) as ScreenDef;
    return { screens: [shell], variants: pickThemes(), ...base };
  }
  if (screenArg === null) {
    throw new UsageError(`Name a screen (${names(SCREENS)}) or "all".`);
  }
  return {
    screens: pick(SCREENS, screenArg, "screen"),
    variants: pick(VARIANTS, variantArg, "variant"),
    ...base,
  };
}

function pickThemes(): VariantDef[] {
  return SHELL_THEMES.map((theme) => {
    const variant = VARIANTS.find((v) => v.name === theme) as VariantDef;
    return { ...variant, name: `theme-${theme}` };
  });
}

/** `<out>/<label>/<screen>/<variant>.png` */
export function screenshotPath(
  request: Pick<ScreenshotRequest, "outDir" | "label">,
  screen: string,
  variant: string,
): string {
  return path.join(request.outDir, request.label, screen, `${variant}.png`);
}

/** Fills `{runId}`, `{failedRunId}`, `{reworkedRunId}` and `{projectId}` in a screen's path. */
export function resolveScreenPath(
  screen: ScreenDef,
  ids: {
    runId: string;
    projectId: string;
    failedRunId: string;
    reworkedRunId: string;
  },
): string {
  return screen.path
    .replace("{runId}", ids.runId)
    .replace("{failedRunId}", ids.failedRunId)
    .replace("{reworkedRunId}", ids.reworkedRunId)
    .replace("{projectId}", ids.projectId);
}
