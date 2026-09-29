import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveStatic } from "../src/http/static.js";

describe("serveStatic path traversal protection", () => {
  it("rejects path traversal to sibling directories sharing the same prefix", async () => {
    // Create a temporary directory structure
    const tmpdir = os.tmpdir();
    const base = fs.mkdtempSync(path.join(tmpdir, "x-factory-test-"));

    // Create public directory
    const publicDir = path.join(base, "public");
    fs.mkdirSync(publicDir);
    fs.writeFileSync(path.join(publicDir, "index.html"), "<h1>Public</h1>");

    // Create a sibling directory with a name that shares the same prefix
    const siblingDir = path.join(base, "public_secrets");
    fs.mkdirSync(siblingDir);
    fs.writeFileSync(path.join(siblingDir, "secret.txt"), "SENSITIVE_DATA");

    // Attempt traversal using ".." trick
    // the relPath resolution essentially allows things like `../public_secrets/secret.txt`
    const res = await serveStatic("../public_secrets/secret.txt", publicDir);

    expect(res.status).toBe(403);

    // Cleanup
    fs.rmSync(base, { recursive: true, force: true });
  });
});
