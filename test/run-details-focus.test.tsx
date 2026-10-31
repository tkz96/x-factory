// test/run-details-focus.test.tsx — The run details sheet gives focus back to the
// control that opened it (#319, US20): both openers (the Details button's setter and
// a timeline line's showDetails) are remembered, and closing the sheet restores focus.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  RunDetailsProvider,
  useDetailsSheet,
  useShowDetails,
} from "../src/frontend/components/runs/RunDetailsContext.js";

afterEach(() => {
  cleanup();
});
afterAll(async () => {
  await unregisterHappyDom();
});

/** The Details button's path: the setter opens the sheet directly. */
function ButtonHarness() {
  const { sheetOpen, setSheetOpen } = useDetailsSheet();
  return (
    <div>
      <button
        type="button"
        data-testid="opener"
        onClick={() => setSheetOpen(true)}
      >
        Details
      </button>
      {sheetOpen && (
        <div data-testid="sheet">
          <button
            type="button"
            data-testid="closer"
            onClick={() => setSheetOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/** The timeline line's path: showDetails opens the sheet and reveals its section. */
function LineHarness() {
  const showDetails = useShowDetails();
  const { sheetOpen, setSheetOpen } = useDetailsSheet();
  return (
    <div>
      <button
        type="button"
        data-testid="line"
        onClick={() => showDetails?.("files")}
      >
        3 files changed
      </button>
      {sheetOpen && (
        <div data-testid="sheet">
          <h3 id="run-inspector-files">Files</h3>
          <button
            type="button"
            data-testid="closer"
            onClick={() => setSheetOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

describe("the details sheet returns focus to its opener (#319, US20)", () => {
  it("restores focus to the Details control when the sheet closes", () => {
    const { getByTestId } = render(
      <RunDetailsProvider isPhone>
        <ButtonHarness />
      </RunDetailsProvider>,
    );
    const opener = getByTestId("opener");
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    expect(getByTestId("sheet")).toBeTruthy();

    // The sheet moves focus to itself while open.
    getByTestId("closer").focus();
    fireEvent.click(getByTestId("closer"));

    expect(document.activeElement).toBe(opener);
  });

  it("restores focus to the timeline line that revealed a section", () => {
    const { getByTestId } = render(
      <RunDetailsProvider isPhone>
        <LineHarness />
      </RunDetailsProvider>,
    );
    const line = getByTestId("line");
    line.focus();
    expect(document.activeElement).toBe(line);

    fireEvent.click(line);
    // Opening reveals the section: focus steps into the sheet's heading.
    expect(getByTestId("sheet")).toBeTruthy();
    expect(document.activeElement?.id).toBe("run-inspector-files");

    fireEvent.click(getByTestId("closer"));
    expect(document.activeElement).toBe(line);
  });
});
