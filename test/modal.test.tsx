// test/modal.test.tsx — Reusable application modal contract (#159).
//
// Every dialog composes <Modal> instead of re-implementing backdrop, dialog
// semantics, dismissal and background scroll lock. Content goes in through
// slots: a title, an optional subheader (e.g. step navigation), the scrolling
// body (children) and a fixed footer that body content can fill with
// <ModalFooter>.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Modal, ModalFooter } from "../src/frontend/components/Modal.js";

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

function renderModal(onClose = mock(() => {})) {
  render(
    <Modal
      id="test-modal"
      title="Test Dialog"
      onClose={onClose}
      subheader={<nav id="test-subheader">Steps</nav>}
    >
      <p id="test-body-content">Body</p>
      <ModalFooter>
        <button type="button" id="test-primary-action">
          Continue
        </button>
      </ModalFooter>
    </Modal>,
  );
  return onClose;
}

describe("Modal (#159)", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("exposes dialog semantics labelled by its title", () => {
    renderModal();
    const overlay = getEl("test-modal-overlay");
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    const title = getEl(overlay.getAttribute("aria-labelledby") as string);
    expect(title.textContent).toBe("Test Dialog");
  });

  it("orders the slots header, subheader, scrolling body, footer", () => {
    renderModal();
    const dialog = getEl("test-modal");
    const regions = Array.from(dialog.children).map(
      (child) => child.id || child.className,
    );
    expect(regions).toEqual([
      "modal-header",
      "test-subheader",
      "modal-body",
      "modal-footer",
    ]);
  });

  it("renders <ModalFooter> content in the fixed footer, outside the scrolling body", () => {
    renderModal();
    const action = getEl("test-primary-action");
    expect(action.closest(".modal-footer")).not.toBeNull();
    expect(action.closest(".modal-body")).toBeNull();
    expect(getEl("test-body-content").closest(".modal-body")).not.toBeNull();
  });

  it("closes on Escape, the close button and a backdrop click, but not a click inside", () => {
    const onClose = renderModal();
    fireEvent.click(getEl("test-body-content"));
    expect(onClose).toHaveBeenCalledTimes(0);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(getEl("test-modal-close"));
    fireEvent.click(getEl("test-modal-overlay"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("locks background scroll while mounted and restores it on unmount", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <Modal id="lock-modal" title="Lock" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("renders <ModalFooter> in place when there is no surrounding modal", () => {
    render(
      <div id="standalone">
        <ModalFooter>
          <button type="button" id="standalone-action">
            Go
          </button>
        </ModalFooter>
      </div>,
    );
    const action = getEl("standalone-action");
    expect(action.closest("#standalone")).not.toBeNull();
    expect(action.closest(".modal-actions")).not.toBeNull();
  });
});
