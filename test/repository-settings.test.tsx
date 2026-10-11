// test/repository-settings.test.tsx — editing a repository's checkout path and
// its test / typecheck / lint commands from the project detail (#283).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { RepositorySettings } from "../src/frontend/components/projects/RepositorySettings.js";
import { api } from "../src/frontend/lib/api-client.js";
import type { Project, ProjectRepository } from "../src/shared/types.js";

const REPOS: ProjectRepository[] = [
  {
    id: "web",
    name: "web",
    remote: "https://github.com/acme/web.git",
    path: "/work/root/web",
    defaultBranch: "main",
    role: "frontend",
  },
  {
    id: "api",
    name: "api",
    path: "/work/root/api",
    defaultBranch: "main",
    commands: { test: "bun test" },
  },
];

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RepositorySettings projectId="rocket" repositories={REPOS} />
    </QueryClientProvider>,
  );
}

function field(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as HTMLInputElement;
}

/**
 * Types like a user: focus, change the value, release a key. react-dom loads
 * before happy-dom registers (imports are hoisted), so React falls back to its
 * key-event value watcher for text inputs; the keyup is what it listens for.
 */
function typeInto(el: HTMLElement, value: string) {
  act(() => {
    el.focus();
    fireEvent.change(el, { target: { value } });
    fireEvent.keyUp(el);
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("RepositorySettings (#283)", () => {
  let update: ReturnType<typeof mock>;

  beforeEach(() => {
    update = mock(
      async (_id: string, repositories: ProjectRepository[]) =>
        ({
          id: "rocket",
          repositories,
        }) as unknown as Project,
    );
    api.updateProjectRepositories =
      update as typeof api.updateProjectRepositories;
  });

  afterEach(() => cleanup());

  it("shows each repository's current path and commands", () => {
    renderSettings();
    expect(field("repo-settings-web-path").value).toBe("/work/root/web");
    expect(field("repo-settings-web-test").value).toBe("");
    expect(field("repo-settings-api-test").value).toBe("bun test");
  });

  it("saves an edited path and commands for one repository, leaving the others untouched", async () => {
    renderSettings();
    typeInto(field("repo-settings-web-path"), "  /work/root  ");
    typeInto(field("repo-settings-web-test"), "bun run typecheck");
    typeInto(field("repo-settings-web-lint"), "bun run lint");

    await act(async () => {
      fireEvent.click(field("repo-settings-web-save"));
    });
    await flush();

    expect(update).toHaveBeenCalledTimes(1);
    const [projectId, repositories] = update.mock.calls[0] as [
      string,
      ProjectRepository[],
    ];
    expect(projectId).toBe("rocket");
    expect(repositories).toEqual([
      {
        ...REPOS[0],
        path: "/work/root",
        commands: { test: "bun run typecheck", lint: "bun run lint" },
      },
      REPOS[1],
    ] as ProjectRepository[]);
    expect(document.body.textContent).toContain("Saved");
  });

  it("refuses an empty path without calling the API", async () => {
    renderSettings();
    typeInto(field("repo-settings-web-path"), "   ");
    await act(async () => {
      fireEvent.click(field("repo-settings-web-save"));
    });
    expect(update).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter the folder");
  });

  it("shows the server's error when saving fails", async () => {
    api.updateProjectRepositories = mock(async () => {
      throw new Error("Repository path is invalid.");
    }) as typeof api.updateProjectRepositories;
    renderSettings();
    await act(async () => {
      fireEvent.click(field("repo-settings-api-save"));
    });
    await flush();
    expect(document.body.textContent).toContain("Repository path is invalid.");
  });
});

afterAll(async () => {
  await unregisterHappyDom();
});
