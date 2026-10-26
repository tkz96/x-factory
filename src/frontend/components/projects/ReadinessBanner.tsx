// src/frontend/components/projects/ReadinessBanner.tsx — Readiness banner (XFM-48): names exactly what was checked (#283).

import "./ReadinessBanner.css";

import { useReadiness } from "../../hooks/useQueries.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Icon } from "../ui/Icon.js";

export function ReadinessBanner() {
  const { data: readiness, isLoading, refetch, isRefetching } = useReadiness();

  if (isLoading) {
    return (
      <Card className="readiness-banner">
        <span className="text-muted text-callout">
          Checking system and project readiness…
        </span>
      </Card>
    );
  }

  const checks = readiness?.checks ?? [];
  const attention = checks.filter((check) => check.status !== "pass");
  const isReady = readiness?.ready !== false && attention.length === 0;
  const checkedNames = checks.map((check) => check.name).join(", ");

  return (
    <Card
      className={`readiness-banner text-callout ${isReady ? "ready" : "warning"}`}
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
