// src/frontend/components/projects/ReadinessBanner.tsx — Readiness banner (XFM-48): names exactly what was checked (#283).

import "./ReadinessBanner.css";

import { useReadiness } from "../../hooks/useQueries.js";
import { readinessNeedsAttention } from "../../lib/readiness-state.js";
import { AsyncRegion } from "../feedback/AsyncRegion.js";
import { deriveAsyncState } from "../feedback/derive-async-state.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Icon } from "../ui/Icon.js";

export function ReadinessBanner() {
  const query = useReadiness();
  const { data: readiness, refetch, isRefetching } = query;
  const derived = deriveAsyncState(query);

  // A readiness check that failed is not a ready workbench: the banner says so
  // and offers the retry (#323).
  if (derived.state === "error") {
    return (
      <Card className="readiness-banner warning" padding="compact">
        <AsyncRegion derived={derived} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (derived.state === "loading") {
    return (
      <Card className="readiness-banner" padding="compact">
        <span className="text-muted text-callout">
          Checking system and project readiness…
        </span>
      </Card>
    );
  }

  const checks = readiness?.checks ?? [];
  const attention = checks.filter((check) => check.status !== "pass");
  const isReady = !readinessNeedsAttention(readiness);
  const checkedNames = checks.map((check) => check.name).join(", ");

  return (
    <Card
      className={`readiness-banner text-callout ${isReady ? "ready" : "warning"}`}
      padding="compact"
    >
      <div className="readiness-content">
        {/* A glyph, not a floating dot: the state has a shape as well as a
            colour, so it survives a monochrome look. */}
        <Icon
          name={isReady ? "icon-shield-check" : "icon-alert-circle"}
          size="lg"
          className="readiness-icon"
        />
        <div>
          <strong className="readiness-title">
            {isReady ? "Ready" : "Needs attention"}
          </strong>
          {isReady ? (
            <span className="text-muted readiness-desc text-subhead">
              {checkedNames
                ? `Checked: ${checkedNames}.`
                : "Database and background worker are running."}
            </span>
          ) : (
            <ul className="readiness-issues">
              {attention.map((check) => (
                <li key={check.name}>
                  <strong>{check.name}:</strong> {check.message}
                </li>
              ))}
              {attention.length === 0 && (
                <li>Database or background worker is unavailable.</li>
              )}
            </ul>
          )}
        </div>
      </div>

      <Button
        id="btn-recheck-readiness"
        variant="secondary"
        size="sm"
        isDisabled={isRefetching}
        onPress={() => refetch()}
      >
        <Icon
          name="icon-refresh-cw"
          size="sm"
          className={isRefetching ? "icon-spin" : undefined}
        />
        <span>{isRefetching ? "Re-checking…" : "Re-check Readiness"}</span>
      </Button>
    </Card>
  );
}
