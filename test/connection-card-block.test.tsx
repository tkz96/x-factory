// test/connection-card-block.test.tsx — The role-based connection card draws
// its frame with the Card block (spec #292 "Blocks", migration row M4). The
// consumer-facing element keeps its id and data-role; inside it the block's
// connection variant carries the hairline, radius and surface, and the
// no-provider prompt renders inside the card.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { ConnectionCard } from "../src/frontend/connection/ConnectionCard.js";

afterAll(async () => {
  await unregisterHappyDom();
});

function renderCard() {
  return render(
    <ConnectionCard
      connectionRole="tracker"
      providerId={null}
      title="Tracker"
      manifest={[]}
      config={{}}
      onSelectProvider={() => {}}
      onConfigChange={() => {}}
      onVerify={() => {}}
      verificationStatus="idle"
    />,
  );
}

describe("ConnectionCard renders through the Card block", () => {
  it("wraps the card in the connection variant inside the consumer's element", () => {
    const { container } = renderCard();

    const slot = document.getElementById("connection-card-tracker");
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute("data-role")).toBe("tracker");

    const card = container.querySelector(".ui-card--connection");
    expect(card).not.toBeNull();
    expect(slot?.contains(card)).toBe(true);
    expect(card?.textContent).toContain("Tracker");
  });

  it("shows the no-provider prompt inside the card", () => {
    const { container } = renderCard();

    const card = container.querySelector(".ui-card--connection");
    expect(card?.textContent).toContain(
      "Select a provider to configure connection details.",
    );
  });
});
