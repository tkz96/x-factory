// src/frontend/components/runs/TokenUsage.tsx — A role's token use, read at a glance.
//
// Tokens in (the prompt) and out (the answer) each have a glyph and a colour, so
// the two never read as one number; the cost follows when it is known. A step
// that reported nothing is named in the tooltip rather than counted as zero.

import { formatUsd } from "../../lib/format-money.js";
import { formatTokenCount, type RoleUsage } from "../../lib/run-models.js";
import { stageDisplayLabel } from "../../lib/workflow-stages.js";
import { Icon } from "../ui/Icon.js";

export function TokenUsage({ usage }: { usage: RoleUsage }) {
  const { tokensIn, tokensOut, costUsd, unreportedSteps } = usage;
  const note =
    unreportedSteps.length > 0
      ? `Not reported for ${unreportedSteps.map(stageDisplayLabel).join(", ")}`
      : undefined;
  if (tokensIn === undefined && tokensOut === undefined) {
    return <span className="token-usage token-usage--none">{note ?? ""}</span>;
  }
  return (
    <span className="token-usage" title={note}>
      {tokensIn !== undefined && (
        <span className="token-usage-in">
          <Icon name="icon-arrow-down" size="xs" />
          {formatTokenCount(tokensIn)}
          <span className="sr-only"> tokens in</span>
        </span>
      )}
      {tokensOut !== undefined && (
        <span className="token-usage-out">
          <Icon name="icon-arrow-up" size="xs" />
          {formatTokenCount(tokensOut)}
          <span className="sr-only"> tokens out</span>
        </span>
      )}
      {costUsd !== undefined && (
        <span className="token-usage-cost">{formatUsd(costUsd)}</span>
      )}
      {note !== undefined && (
        <Icon name="icon-info" size="xs" className="token-usage-note" />
      )}
    </span>
  );
}
