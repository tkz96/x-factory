// test/review.test.ts — Read-only review data structures, criteria checks, and prompt parsing tests.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { Ticket } from "../src/types.js";

describe("Review Output & Criteria Evaluation", () => {
  const ticket: Ticket = {
    id: "PROJ-200",
    title: "Implement audit log sanitization",
    acceptanceCriteria: [
      "Sanitize passwords from audit payload",
      "Do not modify user IDs",
    ],
  };

  it("evaluates clean review output with satisfied criteria", () => {
    assert.equal(ticket.acceptanceCriteria.length, 2);
    const sampleOutput = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload
- [PASS] Do not modify user IDs

FINDINGS:
- [INFO] Audit log sanitization uses regex matching (file:src/audit.ts, line:12)

VERDICT:
PASSED - All criteria met and code is clean.
    `.trim();

    // Verify parser logic
    const lines = sampleOutput.split("\n");
    const criteriaChecked: Array<{ criterion: string; satisfied: boolean }> = [];
    const findings: Array<{ severity: string; message: string }> = [];

    for (const line of lines) {
      const critMatch = line.trim().match(/^-\s*\[(PASS|FAIL)\]\s*(.+)/i);
      if (critMatch) {
        criteriaChecked.push({ criterion: critMatch[2].trim(), satisfied: critMatch[1].toUpperCase() === "PASS" });
      }
      const findMatch = line.trim().match(/^-\s*\[(ERROR|WARNING|INFO)\]\s*(.+)/i);
      if (findMatch) {
        findings.push({ severity: findMatch[1].toLowerCase(), message: findMatch[2].trim() });
      }
    }

    assert.equal(criteriaChecked.length, 2);
    assert.equal(criteriaChecked[0].satisfied, true);
    assert.equal(criteriaChecked[1].satisfied, true);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");

    const hasBlockingError = findings.some((f) => f.severity === "error");
    const allCriteriaMet = criteriaChecked.every((c) => c.satisfied);
    assert.equal(!hasBlockingError && allCriteriaMet, true);
  });

  it("detects review failure on blocking error finding or failed criterion", () => {
    const sampleOutput = `
CRITERIA_CHECK:
- [PASS] Sanitize passwords from audit payload
- [FAIL] Do not modify user IDs

FINDINGS:
- [ERROR] User ID was stripped from audit log (file:src/audit.ts, line:45)

VERDICT:
FAILED - User IDs are erroneously removed.
    `.trim();

    const lines = sampleOutput.split("\n");
    const criteriaChecked: Array<{ criterion: string; satisfied: boolean }> = [];
    const findings: Array<{ severity: string; message: string }> = [];

    for (const line of lines) {
      const critMatch = line.trim().match(/^-\s*\[(PASS|FAIL)\]\s*(.+)/i);
      if (critMatch) {
        criteriaChecked.push({ criterion: critMatch[2].trim(), satisfied: critMatch[1].toUpperCase() === "PASS" });
      }
      const findMatch = line.trim().match(/^-\s*\[(ERROR|WARNING|INFO)\]\s*(.+)/i);
      if (findMatch) {
        findings.push({ severity: findMatch[1].toLowerCase(), message: findMatch[2].trim() });
      }
    }

    assert.equal(criteriaChecked.some((c) => !c.satisfied), true);
    assert.equal(findings.some((f) => f.severity === "error"), true);

    const hasBlockingError = findings.some((f) => f.severity === "error");
    const allCriteriaMet = criteriaChecked.every((c) => c.satisfied);
    assert.equal(!hasBlockingError && allCriteriaMet, false);
  });
});
