// src/frontend/components/runs/RunModelsCard.tsx — Which model did each stage
// of a run, with tokens and cost when the provider reported them (#279).

import "./RunModelsCard.css";

import type { StageModelUse } from "../../../shared/types.js";
import {
  formatUsage,
  latestModelFor,
  stageLabel,
} from "../../lib/run-models.js";

const ROLE_LABELS = { builder: "Builder", reviewer: "Reviewer" } as const;

export function RunModelsCard({
  stageModels,
}: {
  stageModels: readonly StageModelUse[];
}) {
  if (stageModels.length === 0) return null;
  return (
    <section className="card run-models" aria-labelledby="run-models-title">
      <h3 id="run-models-title" className="run-models-title">
        Models
      </h3>
      <p className="run-models-summary">
        {(["builder", "reviewer"] as const)
          .map((role) => {
            const latest = latestModelFor(stageModels, role);
            return latest
              ? `${ROLE_LABELS[role]}: ${latest.modelId} (${latest.connectionName})`
              : null;
          })
          .filter(Boolean)
          .join(" · ")}
      </p>
      <ul className="run-models-list">
        {stageModels.map((use) => {
          const usage = formatUsage(use);
          return (
            <li key={`${use.stage}-${use.attempt}`} className="run-models-row">
              <span className="run-models-stage">
                {stageLabel(use.stage)}
                {use.attempt > 1 ? ` (attempt ${use.attempt})` : ""}
              </span>
              <span className="run-models-model">
                {use.modelId}
                <span className="run-models-connection">
                  {" "}
                  via {use.connectionName}
                </span>
              </span>
              {usage && <span className="run-models-usage">{usage}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
