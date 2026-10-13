# Tutorial: Run Your First Agent Workflow

This tutorial guides you through launching X-Factory, onboarding a Git repository, and executing your first autonomous software engineering workflow run.

You will complete this tutorial in approximately 5 minutes.

---

## Prerequisites

Before you start, make sure that you have:
- **Bun** runtime (version 1.4.0 or newer) — [install instructions](https://bun.sh)
- **Git** CLI installed and configured, with credentials that can read the repository you will add
- **`sbx`**, the sandbox the coding stage runs the agent in — see [How to Check the Sandbox](../how-to/install-and-check-sbx.md). Without it the coding stage fails closed unless you allow running without a sandbox.
- A **provider API key** for the model connection you add in Step 4: Anthropic, Google (Gemini), or an OpenAI-compatible endpoint. X-Factory stores the key itself; you do not need it in the environment.

---

## Step 1: Install

Clone the repository and install dependencies:

```bash
git clone https://github.com/tkz96/x-factory.git
cd x-factory
bun install
```

X-Factory needs no environment configuration, and it needs no API key in the environment: you add model connections in the app. To change a path or a port, copy [`.env.example`](../.env.example) to `.env`; every variable there is optional.

Leave `LLM_API_KEY` and `LLM_PROVIDER` unset. On the first start of an empty data dir, X-Factory imports an `LLM_API_KEY` from `.env` once, as a model connection named "\<Provider\> (imported)". The import matches the key to `LLM_PROVIDER`. A mismatch — for example an OpenAI-compatible router key with `LLM_PROVIDER=gemini` — imports the wrong connection. Add your connections in **Settings › Models** instead (Step 4).

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

The first screen is the **Welcome** checklist: **Add Project**, **Connect a Model**, **Start Run**. A step gets its tick only when the app can see that it is done. Choose **I'll set up later** to skip the checklist and go straight to Tickets; the choice is remembered in this browser.

---

## Step 3: Add Your First Project

On first launch, X-Factory has no projects.

1. On the **Welcome** checklist, choose **Add Project**. (You can also open **Projects** and use **Add Project** beside the heading.)
2. Paste the **Repository** URL of the repository you want to work on. The assistant resolves it through the provider that owns that URL format, so you never pick a provider by hand.
3. In **Connect**, fill in the provider configuration: one card for the issue tracker, one for the Git host. Pass **Verify Connection** on each card.
4. In **Repositories**, select the repositories the project uses, and mark the one that holds the application.
5. In **Inspection**, review the resolved git identity for each selected repository.
6. In **Review**, read the summary and choose **Create Project**.

Your project appears in the Projects list, and its detail pane shows the repository, tracker and branch it is wired to. The run's first **Prepare** stage clones the repository when no local checkout exists yet.

---

## Step 4: Connect a Model

The worker runs two model roles, and each one needs a model before a run can start:

- **Builder** writes the understanding, the plan and the code.
- **Reviewer** reviews the diff against the acceptance criteria, inside the code stage.

1. Open **Settings**, then the **Models** tab. (The Welcome step also links here.)
2. Choose **Add Connection**. Pick Gemini, Anthropic, or an OpenAI-compatible endpoint, then paste the API key and the base URL if the endpoint is not the official one.
3. Choose **Check Connection** and wait for it to pass.
4. In the connection's models table, choose **Add** on each model you want to use.
5. In **Roles**, pick the model for **Builder** and the model for **Reviewer**.

If a connection named "\<Provider\> (imported)" already exists from the one-time key import (Step 1), check that it matches your key. Delete it when it does not.

A run refuses to start while a role has no model (`409`), and no role ever falls back to another model.

---

## Step 5: Create and Observe a Run

1. In the toolbar's **Sections** switcher, open **Tickets**. Choose **Start Run** beside the Tickets heading.
2. Fill in the form: **Ticket ID**, **Ticket Title**, **Branch (optional)**, **Acceptance criteria**, and **Implementation plan**. The run is scoped to the project you are looking at, so there is no project or repository picker.
3. Choose **Start Run**.

X-Factory opens the live run view. Watch the steps advance in real time:

- **Prepare**: Creates the branch and an isolated Git worktree outside your active branch.
- **Understand**: The Builder reads the ticket and the code it touches, then the run pauses for **Approve Understanding**.
- **Plan**: The Builder writes a task list and names the files and tests it will change, then the run pauses for **Approve Plan**.
- **Code**: The agent edits the files in the worktree, runs your test command, and self-repairs when a check fails. When verification passes, the Reviewer reads the diff against the acceptance criteria. A project with no test command records the tests as not run and says so.
- **Review**: The run pauses for **Approve Changes**. Choose **Request Changes** to send it back to planning with your feedback.
- **Deliver**: The run reaches `ready_for_pr` and waits for you.

---

## Step 6: Review & Deliver

When the run reaches `ready_for_pr`:

1. Open the diff to examine every modified line.
2. Read the verification results and the Reviewer's verdict.
3. Use the run chat during the understanding and plan checkpoints to ask questions or challenge an assumption.
4. Choose **Create Pull Request**.

X-Factory publishes the branch, opens the pull request on GitHub or Azure DevOps, and the run becomes `pr_created`. The worker checks that pull request every 5 minutes; when it is merged, the run shows **Merged**.

You have successfully run your first autonomous engineering workflow with X-Factory!
