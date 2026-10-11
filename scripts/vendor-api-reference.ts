// scripts/vendor-api-reference.ts — Vendors the pinned Scalar API Reference
// viewer, so X-Factory serves the API Reference itself and never asks a CDN at
// runtime (spec #241, ticket #247).
//
//   bun run vendor:api-reference          fetch the pinned tarball, verify, write
//   bun run vendor:api-reference --check  verify the committed file, no network
//
// The pin lives in public/assets/api-reference/provenance.json: the exact
// package version, the npm integrity string, and the SHA-256 of the bytes we
// serve. This script is the only part of the repository that touches the
// network. The app, its build and its tests read the committed file, so the API
// Reference works offline.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const ASSET_DIR = path.join(ROOT, "public", "assets", "api-reference");
const PROVENANCE_PATH = path.join(ASSET_DIR, "provenance.json");
const VENDORED_PATH = path.join(ASSET_DIR, "scalar-api-reference.min.js");
const SOURCE_MAP_COMMENT = /\/\/# sourceMappingURL=\S+\n?/;

interface Provenance {
  readonly package: string;
  readonly version: string;
  readonly tarball: string;
  readonly integrity: string;
  readonly sourcePath: string;
  upstreamSha256: string | null;
  vendoredSha256: string | null;
  readonly note: string;
}

function sha256(data: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

function sha512Integrity(data: Uint8Array): string {
  return `sha512-${new Bun.CryptoHasher("sha512").update(data).digest("base64")}`;
}

/**
 * The bytes X-Factory serves: the upstream standalone build with its
 * source-map pointer removed, because we ship no map and a dangling pointer is
 * a lie. Everything else is untouched.
 */
export function vendoredBytes(upstream: string): string {
  return upstream.replace(SOURCE_MAP_COMMENT, "");
}

export function readProvenance(file = PROVENANCE_PATH): Provenance {
  return JSON.parse(readFileSync(file, "utf8")) as Provenance;
}

export class VendorError extends Error {}

function fail(message: string): never {
  throw new VendorError(message);
}

/** Verifies the committed file against the pin. No network. */
export function checkVendored(): string {
  const provenance = readProvenance();
  let bytes: string;
  try {
    bytes = readFileSync(VENDORED_PATH, "utf8");
  } catch {
    fail(
      `${path.relative(ROOT, VENDORED_PATH)} is missing. Run \`bun run vendor:api-reference\`.`,
    );
  }
  const actual = sha256(bytes);
  if (actual !== provenance.vendoredSha256) {
    fail(
      `${path.relative(ROOT, VENDORED_PATH)} does not match ${provenance.package}@${provenance.version}:\n` +
        `  expected sha256 ${provenance.vendoredSha256}\n  actual   sha256 ${actual}\n` +
        "Re-vendor with `bun run vendor:api-reference --force`, or restore the file.",
    );
  }
  return `${provenance.package}@${provenance.version} ${actual}`;
}

async function fetchPinned(): Promise<{
  upstream: string;
  upstreamSha256: string;
}> {
  const provenance = readProvenance();
  const workDir = mkdtempSync(path.join(tmpdir(), "xf-vendor-"));
  const archived = path.join(workDir, "package.tgz");
  const extracted = path.join(workDir, "extracted");
  try {
    const res = await fetch(provenance.tarball);
    if (!res.ok) {
      fail(`${provenance.tarball} returned ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const integrity = sha512Integrity(bytes);
    if (integrity !== provenance.integrity) {
      fail(
        `integrity mismatch for ${provenance.tarball}:\n` +
          `  expected ${provenance.integrity}\n  actual   ${integrity}`,
      );
    }
    writeFileSync(archived, bytes);
    mkdirSync(extracted, { recursive: true });
    const untar = Bun.spawnSync([
      "tar",
      "-xzf",
      archived,
      "-C",
      extracted,
      provenance.sourcePath,
    ]);
    if (untar.exitCode !== 0) {
      fail(`tar failed: ${untar.stderr.toString()}`);
    }
    const upstream = readFileSync(
      path.join(extracted, provenance.sourcePath),
      "utf8",
    );
    return { upstream, upstreamSha256: sha256(upstream) };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function vendor(force: boolean): Promise<string> {
  const provenance = readProvenance();
  const { upstream, upstreamSha256 } = await fetchPinned();
  const bytes = vendoredBytes(upstream);
  const vendoredSha256 = sha256(bytes);

  if (!force) {
    if (
      provenance.upstreamSha256 &&
      provenance.upstreamSha256 !== upstreamSha256
    ) {
      fail(
        `the tarball's ${provenance.sourcePath} no longer matches the recorded ` +
          `sha256 ${provenance.upstreamSha256}. Bump the version and integrity, or pass --force after reviewing the diff.`,
      );
    }
    if (
      provenance.vendoredSha256 &&
      provenance.vendoredSha256 !== vendoredSha256
    ) {
      fail(
        `the vendored bytes changed (sha256 ${vendoredSha256}, recorded ${provenance.vendoredSha256}). ` +
          "Review the change, then pass --force to record it.",
      );
    }
  }

  writeFileSync(VENDORED_PATH, bytes);
  writeFileSync(
    PROVENANCE_PATH,
    `${JSON.stringify(
      { ...provenance, upstreamSha256, vendoredSha256 },
      null,
      2,
    )}\n`,
  );
  return `${provenance.package}@${provenance.version} -> ${path.relative(ROOT, VENDORED_PATH)} (${vendoredSha256})`;
}

if (import.meta.main) {
  try {
    console.log(
      process.argv.includes("--check")
        ? checkVendored()
        : await vendor(process.argv.includes("--force")),
    );
  } catch (err) {
    console.error(
      `vendor:api-reference: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}
