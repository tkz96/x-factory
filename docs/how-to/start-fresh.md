# How to Reset X-Factory to a Clean State

This guide describes how to stop X-Factory and start again from a clean state.
A reset moves your data aside. It does not delete anything.
Follow these steps in order.

## What a Reset Replaces

- The SQLite database, settings, and model connections under the data dir.
- The projects file `config/projects.json`.
- Run worktrees and run artifacts under the data dir.

Your source repositories and git history are not changed.

## How to Stop the Dev Server

1. Open the terminal that runs `bun run dev`.
2. Press `Ctrl+C`.
   This stops the API on port 3777, the worker, and the Vite dev server on port 5173.
3. Wait until all three processes exit.

## How to Back Up the Data

1. Open your terminal in the repository root.
2. Run the backup script:

```bash
bun scripts/backup.ts
```

3. Confirm that the script reports a verified snapshot.
   It writes a database snapshot and an artifact archive to the backup dir
   (`<data dir>/backups` by default; `BACKUP_DIR` overrides it).
4. Keep the snapshot. You need it to restore the old data later.
   Read [How to Back Up and Restore the Database](./backup-and-restore-database.md).

## How to Move the Data Dir Aside

The data dir is `~/.x-factory` by default.
The `X_FACTORY_DATA_DIR` variable overrides it.

1. If you set `X_FACTORY_DATA_DIR`, use that path in place of `~/.x-factory` below.
2. Move the data dir aside:

```bash
mv ~/.x-factory ~/.x-factory.bak-$(date +%Y%m%d)
```

3. Move the projects file aside:

```bash
mv config/projects.json config/projects.json.bak
```

If you set `X_FACTORY_CONFIG_PATH`, move that file instead.

## How to Prune Run Worktrees

A run registers its worktree in the target repository.
The worktree files live under `<data dir>/projects/<projectId>/worktrees/`.
When the data dir moves away, the target repository still lists the worktree.

1. Open the local checkout of each target repository you ran a run against.
2. Run:

```bash
git worktree prune
```

3. Repeat for every target repository.

## How to Avoid the First-Launch Key Import

On the first start of an empty data dir, an `LLM_API_KEY` in `.env` is imported
once as a model connection named `<Provider> (imported)`.
`LLM_PROVIDER` names its provider (`anthropic`, `gemini`, or `openai`) when the
key's prefix does not.
A key that does not match `LLM_PROVIDER` imports the wrong connection. For
example, an OpenAI-compatible router key with `LLM_PROVIDER=gemini` imports a
Gemini connection that cannot work.

1. Open `.env`.
2. Remove `LLM_API_KEY` and `LLM_PROVIDER`, or leave them unset.
3. Plan to add your connection in **Settings › Models** after the start.

## How to Start Again

1. Run the dev server:

```bash
bun run dev
```

2. Open **http://localhost:5173** in your browser.
   The first start creates a fresh database in the new empty data dir.
3. Follow the **Welcome** checklist: **Add Project**, **Connect a Model**, then
   **Start Run**.

To restore old data instead of starting fresh, read
[How to Back Up and Restore the Database](./backup-and-restore-database.md).
