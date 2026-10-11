// test/diff-summary.test.ts — Unit tests for the shared unified-diff parser and its summary (#256).

import { describe, expect, it } from "bun:test";
import { parseUnifiedDiff, summarizeDiff } from "../src/shared/diff-summary.js";

const TWO_FILE_DIFF = `diff --git a/src/cart.ts b/src/cart.ts
index 1234567..89abcdef 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,1 +0,0 @@
-Old line
`;

describe("summarizeDiff (#256)", () => {
  it("returns an empty summary for an absent or blank diff", () => {
    const empty = { files: [], totalAdded: 0, totalRemoved: 0 };
    expect(summarizeDiff("")).toEqual(empty);
    expect(summarizeDiff(null)).toEqual(empty);
    expect(summarizeDiff(undefined)).toEqual(empty);
    expect(summarizeDiff("   \n  ")).toEqual(empty);
  });

  it("counts added and removed lines per file, with totals", () => {
    expect(summarizeDiff(TWO_FILE_DIFF)).toEqual({
      files: [
        { path: "src/cart.ts", added: 2, removed: 1 },
        { path: "README.md", added: 0, removed: 1 },
      ],
      totalAdded: 2,
      totalRemoved: 2,
    });
  });

  it("names a deleted file by its source path, and counts its removed lines", () => {
    const deleted = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;
    expect(summarizeDiff(deleted)).toEqual({
      files: [{ path: "src/old.ts", added: 0, removed: 2 }],
      totalAdded: 0,
      totalRemoved: 2,
    });
  });

  it("accepts a raw patch with no diff --git header", () => {
    const patch = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 keep
+added
`;
    expect(summarizeDiff(patch)).toEqual({
      files: [{ path: "src/a.ts", added: 1, removed: 0 }],
      totalAdded: 1,
      totalRemoved: 0,
    });
  });

  it("never counts the +++ and --- file headers as content", () => {
    const headerOnly = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
`;
    expect(summarizeDiff(headerOnly)).toEqual({
      files: [{ path: "src/a.ts", added: 0, removed: 0 }],
      totalAdded: 0,
      totalRemoved: 0,
    });
  });
});

describe("parseUnifiedDiff (#256)", () => {
  it("keeps each file's body so callers can render hunks", () => {
    const files = parseUnifiedDiff(TWO_FILE_DIFF);
    expect(files.map((f) => f.path)).toEqual(["src/cart.ts", "README.md"]);
    expect(files[0]?.body).toContain("@@ -1,3 +1,4 @@");
    expect(files[0]?.body).toContain("+const c = 4;");
    expect(files[1]?.body).not.toContain("@@ -1,3 +1,4 @@");
  });
});
