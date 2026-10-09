// src/frontend/components/projects/connection-copy.ts — Resolves a derived
// connection warning to its canonical copy (#147).
//
// The domain layer reports *which* warnings hold and the human details
// (manifest field labels, the role, a provider id); this module turns them
// into sentences from the copy map. Both belong to the post-creation surfaces,
// so neither can live in `feedback/` (which imports nothing screen-specific).

import type { ConnectionWarning } from "../connections/connection-view.js";
import { CONNECTIONS_COPY } from "../feedback/copy-map.js";

/** The canonical message for one derived warning. */
function formatConnectionWarning(warning: ConnectionWarning): string {
  const details = warning.details.join(", ");

  switch (warning.kind) {
    case "ROLE_NOT_RECORDED":
      return CONNECTIONS_COPY.warningMessage.ROLE_NOT_RECORDED(
        CONNECTIONS_COPY.roleLabel[warning.role],
      );
    case "CONFIG_INCOMPLETE":
      return CONNECTIONS_COPY.warningMessage.CONFIG_INCOMPLETE(details);
    case "PROVIDER_UNKNOWN":
      return CONNECTIONS_COPY.warningMessage.PROVIDER_UNKNOWN(details);
  }
}

/** Every derived warning as canonical copy, one message per warning. */
export function formatConnectionWarnings(
  warnings: readonly ConnectionWarning[],
): string[] {
  return warnings.map((warning) => formatConnectionWarning(warning));
}
