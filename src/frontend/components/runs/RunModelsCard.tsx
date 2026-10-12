// src/frontend/components/runs/RunModelsCard.tsx — Which model did each step
// of a run (coding and its review are separate rows), with tokens and cost when
// the provider reported them (#279).

import "./RunModelsCard.css";

import type { StageModelUse } from "../../../shared/types.js";
import { formatUsage, stageLabel } from "../../lib/run-models.js";

export function RunModelsCard({
  stageModels,
}: {
  stageModels: readonly StageModelUse[];
}) {
  if (stageModels.length === 0) return null;
  return (
    // A disclosure: the rows are a detail of the run, and a phone can fold
    // them away. Open by default, so nothing is hidden from a first look.
    <details className="card run-models" open>
      <summary className="run-models-title" id="run-models-title">
        Models
      </summary>
      <ul className="run-models-list">
        {stageModels.map((use) => {
          const usage = formatUsage(use);
          return (
            <li
              key={`${use.stage}-${use.attempt}-${use.step}`}
              className="run-models-row"
            >
              <span className="run-models-stage">
                {stageLabel(use.step)}
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
    </details>
  );
}
