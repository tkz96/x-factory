// test/run-tap-targets.test.ts — Summary lines and row actions are finger-sized at phone
// width or under a touch pointer (#319, US21). The co-located stylesheets zero their
// min-height to sit flush in the row, so each has to grow back to --tap-min where a
// finger reaches, the way the file rows already do.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const runChatCss = readFileSync(
  path.join(process.cwd(), "src/frontend/components/runs/RunChat.css"),
  "utf-8",
);
const runInspectorCss = readFileSync(
  path.join(process.cwd(), "src/frontend/components/runs/RunInspector.css"),
  "utf-8",
);

/** Every @media block whose header matches, braces balanced, header included. */
function mediaBlocks(css: string, condition: RegExp): string[] {
  const blocks: string[] = [];
  let i = 0;
  for (;;) {
    const start = css.indexOf("@media", i);
    if (start === -1) break;
    const open = css.indexOf("{", start);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    if (condition.test(css.slice(start, open)))
      blocks.push(css.slice(start, j));
    i = j;
  }
  return blocks;
}

/** True when a phone-width media block holds `selector { … declaration … }`. */
function hasPhoneRule(
  css: string,
  selector: string,
  declaration: string,
): boolean {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(
    `(?:^|[\\s,])${escaped}\\s*\\{[^}]*${declaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^}]*\\}`,
  );
  return mediaBlocks(css, /max-width:\s*768px/).some((block) =>
    rule.test(block),
  );
}

describe("summary lines and row actions reach --tap-min at phone width (#319, US21)", () => {
  it("the timeline's summary line button grows back to --tap-min", () => {
    expect(
      hasPhoneRule(runChatCss, ".ui-button.run-chat-summary", "--tap-min"),
    ).toBe(true);
  });

  it("the timeline's plain summary line is --tap-min tall", () => {
    expect(hasPhoneRule(runChatCss, ".run-chat-summary", "--tap-min")).toBe(
      true,
    );
  });

  it("the Run details copy row action grows back to --tap-min", () => {
    expect(
      hasPhoneRule(
        runInspectorCss,
        ".ui-button.run-inspector-copy",
        "--tap-min",
      ),
    ).toBe(true);
  });

  it("the Run details link row action grows back to --tap-min", () => {
    expect(
      hasPhoneRule(
        runInspectorCss,
        ".run-inspector-link.run-inspector-stretch",
        "--tap-min",
      ),
    ).toBe(true);
  });
});
