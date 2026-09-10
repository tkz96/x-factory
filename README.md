# X-Factory

Software engineering workbench: **ticket → implementation → tests → PR**.

X-Factory takes an approved ticket and an implementation plan, hands them to [Pi](https://pi.dev) (a coding agent), and walks the result through testing and pull request creation — with a human in the loop at every step.

## Prerequisites

- **Node.js** ≥ 22
- **GitHub CLI** (`gh`) — authenticated (`gh auth login`)
- **Pi SDK credentials** — the Pi agent needs access to its model provider (see [Pi docs](https://pi.dev))

## Setup

```bash
npm install
```

Edit `config/projects.json` to point at your repositories:

```json
{
  "projects": [
    {
      "id": "my-app",
      "name": "My App",
      "repositoryPath": "/path/to/my-app",
      "knowledgeRepositoryPath": "/path/to/my-app-knowledge",
      "defaultBranch": "main",
      "testCommand": "npm test"
    }
  ]
}
```

## Usage

```bash
npm start
```

Open [http://localhost:3777](http://localhost:3777).

1. Select a project.
2. Enter a ticket ID and title.
3. Paste the implementation plan.
4. Click **Start Implementation**.
5. Watch Pi work. Send steering instructions if needed.
6. When tests pass, click **Create Pull Request**.

## Development

```bash
npm run dev     # auto-restart on changes
npm test        # run tests
```

## Architecture

```
server/server.js   — HTTP server, static files, API router
server/runs.js     — run lifecycle, state machine, in-memory store
server/pi.js       — thin Pi SDK wrapper
server/git.js      — git + GitHub CLI operations
public/            — single-page UI (HTML + CSS + JS)
prompts/           — Pi implementation prompt template
config/            — project configuration
```

The run state machine:

```
preparing → implementing → testing → ready_for_pr → pr_created
                ↓               ↓            ↓
             stopped         failed       failed
```

All state is in-memory. Restarting the server clears run history.
