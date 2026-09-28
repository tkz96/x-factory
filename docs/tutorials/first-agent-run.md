# Tutorial: Run Your First Agent Workflow

This tutorial guides you through launching X-Factory, onboarding a Git repository, and executing your first autonomous software engineering workflow run.

You will complete this tutorial in approximately 5 minutes.

---

## Prerequisites

Before you start, make sure that you have:
- **Bun** runtime (version 1.4.0 or newer) — [install instructions](https://bun.sh)
- **Git** CLI installed and configured
- An **LLM API key** from Anthropic, Google (Gemini), or OpenAI

---

## Step 1: Install & Configure

Clone the repository and install dependencies:

```bash
git clone https://github.com/tkz96/x-factory.git
cd x-factory
bun install
```

Copy the environment template and add your API key:

```bash
cp .env.example .env
```

Open `.env` in your editor and paste your API key:

```bash
LLM_API_KEY=your-api-key-here
```

> **Tip**: X-Factory automatically detects the model provider based on key prefix (`sk-ant-*` for Anthropic Claude, `AIzaSy*` for Google Gemini, `sk-*` for OpenAI).

---

## Step 2: Launch X-Factory

Start the unified development environment:

```bash
bun run dev
```

This single command launches:
1. **API Server** on port 3777
2. **Background Worker** process polling SQLite for pipeline tasks
3. **Vite Frontend** with instant Hot Module Replacement on port 5173

Open your browser to:

```text
http://localhost:5173
```

---

## Step 3: Onboard Your First Project

On first launch, X-Factory starts with an empty workspace.

1. Navigate to **Projects** in the left sidebar (or click the **"Onboard Project"** button on the home view).
2. Click **"+ Onboard Project"** to open the wizard modal.
3. Provide a project name and select or input the absolute path to a local Git repository on your machine.
4. Optionally configure your issue tracker connection (GitHub Issues, Azure DevOps, or Jira).
5. Click **"Save Project"**.

Your project card will appear in the workspace with repository readiness indicators.

---

## Step 4: Create and Observe a Run

1. In the top navigation bar, click **"+ New Run"**.
2. Select your newly onboarded project and primary repository.
3. Enter a ticket title and prompt or task description (for example: `"Add health check endpoint and test"`).
4. Click **"Start Run"**.

X-Factory redirects you directly to the live Run Detail view. Watch the pipeline advance across sequential stages in real time:

- **Prepare**: Allocates an isolated, ephemeral Git worktree outside your active branch.
- **Understand**: Pi agent reads the codebase, gathers context, and forms an execution plan.
- **Implement**: Agent edits files, applies changes, and executes self-repair against compiler errors.
- **Verify**: Executes test suites and deterministic verification checks inside the worktree.
- **Review**: A fresh, independent read-only reviewer evaluates the diff against acceptance criteria.
- **Deliver**: Presents the final human-in-the-loop checkpoint.

---

## Step 5: Review & Deliver

When the run transitions to `ready_for_pr` (the Deliver stage):

1. Inspect the interactive **Diff Viewer** modal to examine every modified line.
2. Review the automated verification logs, test results, and reviewer scorecards.
3. Chat with the agent directly in the Run Detail view if you want to request revisions or steer further changes.
4. Click **"Approve & Create PR"** to commit, push the branch, and open a pull request on your remote repository.

You have successfully run your first autonomous engineering workflow with X-Factory!
