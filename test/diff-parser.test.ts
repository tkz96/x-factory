// test/diff-parser.test.ts — Unit tests for unified git diff parsing utility.

import { describe, expect, it } from "bun:test";
import { parseDiffToFiles } from "../src/frontend/lib/diff-parser.js";

describe("diff-parser", () => {
  it("returns empty array for empty or null diff", () => {
    expect(parseDiffToFiles("")).toEqual([]);
    expect(parseDiffToFiles(null)).toEqual([]);
    expect(parseDiffToFiles(undefined)).toEqual([]);
    expect(parseDiffToFiles("   \n  ")).toEqual([]);
  });

  it("parses single file unified diff", () => {
    const diff = `diff --git a/src/cart.ts b/src/cart.ts
index 1234567..89abcdef 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,5 +1,6 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

    const result = parseDiffToFiles(diff);
    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe("src/cart.ts");
    expect(result[0]?.added).toBe(2);
    expect(result[0]?.removed).toBe(1);
    expect(result[0]?.hunks).toContain("const b = 3;");
  });

  it("parses multiple files in unified diff", () => {
    const diff = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,2 +1,3 @@
-old
+new1
+new2
diff --git a/test/cart.test.ts b/test/cart.test.ts
--- a/test/cart.test.ts
+++ b/test/cart.test.ts
@@ -1,2 +1,1 @@
-removed
`;

    const result = parseDiffToFiles(diff);
    expect(result).toHaveLength(2);
    expect(result[0]?.file).toBe("src/cart.ts");
    expect(result[0]?.added).toBe(2);
    expect(result[0]?.removed).toBe(1);

    expect(result[1]?.file).toBe("test/cart.test.ts");
    expect(result[1]?.added).toBe(0);
    expect(result[1]?.removed).toBe(1);
  });

  it("handles deleted files correctly", () => {
    const diff = `diff --git a/old.ts b/dev/null
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
`;

    const result = parseDiffToFiles(diff);
    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe("old.ts");
    expect(result[0]?.removed).toBe(2);
    expect(result[0]?.added).toBe(0);
  });

  it("handles non-git diff with +++ b/ headers and fallback formats", () => {
    const rawDiff = `--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,2 @@
 line
+line2
`;
    const res = parseDiffToFiles(rawDiff);
    expect(res).toHaveLength(1);
    expect(res[0]?.file).toBe("file1.ts");
    expect(res[0]?.added).toBe(1);

    const fallbackDiff = `diff --git some-weird-header
+++ b/weird.ts
+hello
`;
    const resFallback = parseDiffToFiles(fallbackDiff);
    expect(resFallback).toHaveLength(1);
    expect(resFallback[0]?.added).toBe(1);
  });
});
