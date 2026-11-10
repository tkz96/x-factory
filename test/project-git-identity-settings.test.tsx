// test/project-git-identity-settings.test.tsx — the project's git identity is
// shown on the project detail and can be edited and saved (C).

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
import { PROJECT_GIT_IDENTITY_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ProjectGitIdentity } from "../src/frontend/components/projects/ProjectGitIdentity.js";
import { api } from "../src/frontend/lib/api-client.js";
import type { GitIdentity, Project } from "../src/shared/types.js";

function renderIdentity(identity?: GitIdentity) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectGitIdentity projectId="rocket" gitIdentity={identity} />
    </QueryClientProvider>,
  );
}

function field(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as HTMLInputElement;
}

function typeInto(el: HTMLElement, value: string) {
  act(() => {
    el.focus();
    fireEvent.change(el, { target: { value } });
    fireEvent.keyUp(el);
  });
}

async function save() {
  await act(async () => {
    fireEvent.click(field("project-git-identity-save"));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("ProjectGitIdentity: project settings", () => {
  let update: ReturnType<typeof mock>;

  beforeEach(() => {
    update = mock(
      async (_id: string, gitIdentity: GitIdentity) =>
        ({ id: "rocket", gitIdentity }) as unknown as Project,
    );
    api.updateProjectGitIdentity =
      update as typeof api.updateProjectGitIdentity;
  });
  afterEach(() => cleanup());
  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("shows the stored identity", () => {
    renderIdentity({ name: "Work Me", email: "me@work.example" });
    expect(field("project-git-identity-name").value).toBe("Work Me");
    expect(field("project-git-identity-email").value).toBe("me@work.example");
  });

  it("saves an edited identity, trimmed", async () => {
    renderIdentity({ name: "Work Me", email: "me@work.example" });
    typeInto(field("project-git-identity-name"), "  New Name ");
    typeInto(field("project-git-identity-email"), "new@work.example");
    await save();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]).toEqual([
      "rocket",
      { name: "New Name", email: "new@work.example" },
    ]);
    expect(document.body.textContent).toContain(
      PROJECT_GIT_IDENTITY_COPY.saved,
    );
  });

  it("refuses an empty name or empty email without calling the API", async () => {
    renderIdentity({ name: "Work Me", email: "me@work.example" });
    typeInto(field("project-git-identity-name"), "  ");
    await save();
    expect(document.body.textContent).toContain(
      PROJECT_GIT_IDENTITY_COPY.nameRequired,
    );

    typeInto(field("project-git-identity-name"), "Work Me");
    typeInto(field("project-git-identity-email"), "");
    await save();
    expect(document.body.textContent).toContain(
      PROJECT_GIT_IDENTITY_COPY.emailRequired,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an email without @ without calling the API", async () => {
    renderIdentity();
    typeInto(field("project-git-identity-name"), "Ada");
    typeInto(field("project-git-identity-email"), "ada.work.example");
    await save();
    expect(document.body.textContent).toContain(
      PROJECT_GIT_IDENTITY_COPY.emailInvalid,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("says no identity is set for a project that has none", () => {
    renderIdentity();
    expect(document.body.textContent).toContain(
      PROJECT_GIT_IDENTITY_COPY.notSet,
    );
  });

  it("shows the server's error when saving fails", async () => {
    api.updateProjectGitIdentity = mock(async () => {
      throw new Error("Email must contain @.");
    }) as never;
    renderIdentity({ name: "Work Me", email: "me@work.example" });
    await save();
    expect(document.body.textContent).toContain("Email must contain @.");
  });
});
