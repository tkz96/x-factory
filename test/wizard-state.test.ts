// test/wizard-state.test.ts — Comprehensive unit tests for onboarding wizard state machine and URL parsing.

import { describe, expect, it } from "bun:test";
import {
  buildProjectConfig,
  canTransitionWizardStep,
  createInitialWizardState,
  WizardStateMachine,
} from "../public/js/wizard-state.js";
import { inferRepoRole, parseQuickUrl } from "../public/js/wizard-url.js";

describe("Wizard State Machine (public/js/wizard-state.ts)", () => {
  it("initializes with step 1 and maxStepReached 1", () => {
    const initial = createInitialWizardState();
    expect(initial.step).toBe(1);
    expect(initial.maxStepReached).toBe(1);
    const sm = new WizardStateMachine();
    const s = sm.getState();
    expect(s.step).toBe(1);
    expect(s.maxStepReached).toBe(1);
    expect(s.errorMessage).toBe("");
  });

  it("permits valid sequential forward transitions", () => {
    expect(canTransitionWizardStep(1, 2, 1)).toBe(true);
    expect(canTransitionWizardStep(2, 3, 2)).toBe(true);
    expect(canTransitionWizardStep(3, 4, 3)).toBe(true);
    expect(canTransitionWizardStep(4, 5, 4)).toBe(true);
    expect(canTransitionWizardStep(5, 6, 5)).toBe(true);
  });

  it("rejects illegal step skipping when step has not been reached", () => {
    expect(canTransitionWizardStep(1, 3, 1)).toBe(false);
    expect(canTransitionWizardStep(1, 4, 1)).toBe(false);
    expect(canTransitionWizardStep(1, 6, 1)).toBe(false);
    expect(canTransitionWizardStep(2, 5, 2)).toBe(false);
  });

  it("allows navigating backward to any previously reached step", () => {
    // Reached step 4
    expect(canTransitionWizardStep(4, 3, 4)).toBe(true);
    expect(canTransitionWizardStep(4, 2, 4)).toBe(true);
    expect(canTransitionWizardStep(4, 1, 4)).toBe(true);
  });

  it("updates step and maxStepReached upon successful transitions", () => {
    const sm = new WizardStateMachine();
    expect(sm.transitionTo(2)).toBe(true);
    expect(sm.getState().step).toBe(2);
    expect(sm.getState().maxStepReached).toBe(2);

    expect(sm.transitionTo(3)).toBe(true);
    expect(sm.getState().step).toBe(3);
    expect(sm.getState().maxStepReached).toBe(3);

    // Go back to step 1
    expect(sm.transitionTo(1)).toBe(true);
    expect(sm.getState().step).toBe(1);
    // maxStepReached remains 3
    expect(sm.getState().maxStepReached).toBe(3);

    // Can jump directly to step 3 since it was already reached
    expect(sm.transitionTo(3)).toBe(true);
    expect(sm.getState().step).toBe(3);
  });

  it("updates wizard state fields with update()", () => {
    const sm = new WizardStateMachine();
    sm.update({
      projectName: "New Project",
      projectId: "new-proj",
      tracker: "my-tracker",
    });
    expect(sm.getState().projectName).toBe("New Project");
    expect(sm.getState().projectId).toBe("new-proj");
    expect(sm.getState().tracker).toBe("my-tracker");
  });

  it("buildProjectConfig builds valid Project object with repositories and knowledge base", () => {
    const s = createInitialWizardState();
    s.projectId = "test-proj";
    s.projectName = "Test Project";
    s.workspacePath = "/path/to/workspace";
    s.tracker = "conn-1";
    s.trackerProject = "proj-1";
    s.primaryRepo = "repo-backend";
    s.knowledgeRepoId = "repo-docs";

    s.selectedRepos.set("repo-backend", {
      name: "repo-backend",
      remote: "https://github.com/org/repo-backend",
      path: "/path/to/workspace/repo-backend",
      defaultBranch: "main",
      role: "backend",
      commands: {
        test: "bun test",
        typecheck: "bun run typecheck",
        lint: "bun run lint",
      },
    });

    s.selectedRepos.set("repo-docs", {
      name: "repo-docs",
      role: "knowledge",
    });

    const cfg = buildProjectConfig(s);
    expect(cfg.id).toBe("test-proj");
    expect(cfg.name).toBe("Test Project");
    expect(cfg.workspacePath).toBe("/path/to/workspace");
    expect(cfg.issueTracker.connectionId).toBe("conn-1");
    expect(cfg.issueTracker.projectId).toBe("proj-1");
    expect(cfg.repositories.length).toBe(2);
    expect(cfg.knowledgeRepository?.repositoryId).toBe("repo-docs");
    expect(cfg.knowledgeRepository?.type).toBe("graphify");
    expect(cfg.repositoryPath).toBe("/path/to/workspace/repo-backend");
    expect(cfg.testCommand).toBe("bun test");
    expect(cfg.typecheckCommand).toBe("bun run typecheck");
    expect(cfg.lintCommand).toBe("bun run lint");
  });

  it("buildProjectConfig handles empty repos and defaults safely", () => {
    const s = createInitialWizardState();
    s.projectId = "empty-proj";
    s.projectName = "Empty";
    s.workspacePath = "/ws";
    const cfg = buildProjectConfig(s);
    expect(cfg.id).toBe("empty-proj");
    expect(cfg.repositories).toEqual([]);
    expect(cfg.knowledgeRepository).toBeUndefined();
    expect(cfg.repositoryPath).toBe("/ws");
    expect(cfg.defaultBranch).toBe("main");
    expect(cfg.testCommand).toBe("");
  });

  it("rejects invalid transition and keeps state unchanged", () => {
    const sm = new WizardStateMachine();
    expect(sm.transitionTo(5)).toBe(false);
    expect(sm.getState().step).toBe(1);
    expect(sm.getState().maxStepReached).toBe(1);
  });

  it("resets state back to initial", () => {
    const sm = new WizardStateMachine();
    sm.transitionTo(2);
    sm.setError("Some error");
    sm.reset();
    expect(sm.getState().step).toBe(1);
    expect(sm.getState().errorMessage).toBe("");
  });
});

describe("Wizard URL Parsing & Role Inference (public/js/wizard-url.ts)", () => {
  it("parses Azure DevOps dev.azure.com URL", () => {
    const res = parseQuickUrl("https://dev.azure.com/my-org/my-project");
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("azure");
    if (res?.provider === "azure") {
      expect(res.org).toBe("my-org");
      expect(res.project).toBe("my-project");
      expect(res.orgUrl).toBe("https://dev.azure.com/my-org");
    }
  });

  it("parses Azure DevOps visualstudio.com URL and strips .git", () => {
    const res = parseQuickUrl("my-org.visualstudio.com/cool-project.git");
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("azure");
    if (res?.provider === "azure") {
      expect(res.org).toBe("my-org");
      expect(res.project).toBe("cool-project");
    }
  });

  it("parses GitHub repository URL and strips .git", () => {
    const res = parseQuickUrl("https://github.com/my-company/web-frontend.git");
    expect(res).not.toBeNull();
    expect(res?.provider).toBe("github");
    if (res?.provider === "github") {
      expect(res.owner).toBe("my-company");
      expect(res.repo).toBe("web-frontend");
    }
  });

  it("returns null for non-matching URLs or empty input", () => {
    expect(parseQuickUrl("")).toBeNull();
    expect(parseQuickUrl("https://google.com")).toBeNull();
    expect(parseQuickUrl("just-some-random-text")).toBeNull();
  });

  it("infers repository role correctly based on keywords", () => {
    expect(inferRepoRole("app-frontend")).toBe("frontend");
    expect(inferRepoRole("web-portal")).toBe("frontend");
    expect(inferRepoRole("core-api")).toBe("backend");
    expect(inferRepoRole("data-worker")).toBe("worker");
    expect(inferRepoRole("cloud-infra")).toBe("infrastructure");
    expect(inferRepoRole("docs-knowledge")).toBe("knowledge");
    expect(inferRepoRole("graph-store")).toBe("knowledge");
    expect(inferRepoRole("utilities")).toBe("other");
  });
});
