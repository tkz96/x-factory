// src/frontend/components/projects/ConnectionComboLine.tsx — The git host +
// tracker combo line persisted across the project header, settings, and
// project cards (spec #133 story 48; ticket #147).
//
// Presentational only: it takes the derived integrity and the provider
// descriptors and renders the three distinctions — connected (ideal),
// degraded (warnings present, warning tone), disconnected (error tone).
// Display names come from the manifest through `resolveProviderLabel`; there
// is no provider id branch and no hardcoded id→name map, so a provider added
// by registry registration alone renders correctly here.

import { Fragment } from "react";
import type { ProjectConnectionRole } from "../../../shared/types.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import { CONNECTIONS_COPY } from "../feedback/copy-map.js";
import {
  type ConnectionIntegrity,
  type ConnectionSlot,
  resolveProviderLabel,
} from "./connection-integrity.js";
import "./ConnectionComboLine.css";

export interface ConnectionComboLineProps {
  /** From `deriveConnectionIntegrity`. */
  integrity: ConnectionIntegrity;
  /** The providers manifest — the only source of display names. */
  descriptors: readonly ProviderDescriptor[];
  /** Restricts the rendered slots; defaults to every slot, tracker first. */
  roles?: readonly ProjectConnectionRole[];
  id?: string;
  className?: string;
}

/** The line's tone is the worst slot state, with warnings never the error tone. */
function lineTone(integrity: ConnectionIntegrity): string {
  if (integrity.hasIntegrityFailure) {
    return "error";
  }
  return integrity.isDegraded ? "warning" : "connected";
}

function slotValue(
  slot: ConnectionSlot,
  descriptors: readonly ProviderDescriptor[],
): string {
  return slot.providerId
    ? resolveProviderLabel(slot.providerId, descriptors)
    : CONNECTIONS_COPY.notRecorded;
}

export function ConnectionComboLine({
  integrity,
  descriptors,
  roles,
  id,
  className,
}: ConnectionComboLineProps) {
  const slots =
    roles === undefined
      ? integrity.slots
      : integrity.slots.filter((slot) => roles.includes(slot.role));

  return (
    <div
      id={id}
      className={`connection-combo-line connection-combo-line--${lineTone(integrity)} ${className ?? ""}`.trim()}
    >
      {slots.map((slot, index) => (
        <Fragment key={slot.role}>
          {index > 0 && (
            <span className="connection-combo-separator" aria-hidden="true">
              ·
            </span>
          )}
          <span
            className={`connection-combo-slot connection-combo-slot--${slot.role} connection-combo-slot--${slot.state}`}
            data-role={slot.role}
            data-state={slot.state}
          >
            <span className="connection-combo-role">
              {CONNECTIONS_COPY.roleLabel[slot.role]}
            </span>
            <span className="connection-combo-value">
              {slotValue(slot, descriptors)}
            </span>
            <span className="connection-combo-state">
              {CONNECTIONS_COPY.stateLabel[slot.state]}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
