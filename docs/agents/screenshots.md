# Screenshots for before and after evidence

Read this before you open a screen PR for spec #241, or when a reviewer asks for evidence. The harness takes screenshots of any screen in the evidence matrix with one command. The screenshots are evidence for a human reviewer. They are not a pixel-diff gate, and no check compares them.

## The command

```bash
bun run screenshots <screen|all> [--variant a,b|all] [--label before|after] [--out <dir>]
bun run screenshots --themes --label after
```

- `<screen>` is one of `shell`, `tickets`, `runs`, `history`, `run`, `projects`, `project`, `settings`, `docs`, `reference`, or `all`. The list lives in `scripts/screenshots/matrix.ts`. Add a row there when a screen is added or renamed.
- `--variant` picks the conditions. The default is all of them:

| Variant | What it shows |
|---|---|
| `light`, `dark` | The two appearances |
| `narrow` | Phone width, 390 px |
| `contrast` | Increased contrast (`prefers-contrast: more`) |
| `motion` | Reduced motion (`prefers-reduced-motion: reduce`) |
| `forced-colors` | Forced colours (`forced-colors: active`) |

- `--themes` captures the shell in each theme (`theme-light`, `theme-dark`) and ignores the screen name. When the Default, Graphite and Sandstone themes land, extend `SHELL_THEMES` in `scripts/screenshots/matrix.ts`.
- `--label` names the folder for this capture. Capture on the integration branch with `--label before`, make your change, then capture again with `--label after`.
- Files land in `.scratch/screenshots/<label>/<screen>/<variant>.png`. That folder is git-ignored. Attach the files to the PR.
- `--viewport-only` captures the visible window instead of growing the window to the whole page. `--public-dir <dir>` serves a frontend build you already made instead of building one.

## What it runs against

The harness starts its own X-Factory instance for the capture and stops it afterwards:

- a temporary `X_FACTORY_DATA_DIR` and `X_FACTORY_CONFIG_PATH`, deleted at the end. It refuses a data dir inside `~/.x-factory`;
- a free port chosen by the operating system, never 3777 or 5173, so a running dev server is not touched;
- one demo project (`demo-app`), six demo tickets and runs in several states (needs approval, in review, running, pull request created, failed, stopped);
- a fresh frontend build from your working tree, written to the temporary directory.

No worker runs, so every run is a stored record and nothing executes. The seed is in `scripts/screenshots/instance.ts`. If a screen needs other data to show its states, extend the seed there.

The browser is headless Chromium driven by `playwright-core`. If it cannot start, install the browser once with `bunx playwright-core@1.63.0 install chromium`. Two agents that share one machine should not drive a browser at the same time. Take the lock `/tmp/x-factory-browser.lock` with `mkdir`, and remove it with `rmdir` when you finish.

## Tests

`test/screenshot-harness.test.ts` checks the matrix, the argument parsing and the isolation of the instance. It does not launch a browser.
