// src/frontend/components/connections/ConnectionComboLine.tsx — THE combo line
// (spec #133 stories 48–49; tickets #146/#147, collapsed into one rendering by
// #148).
//
// Presentational only. It is handed the slots to render (per role: the provider
// id, one of the three states, and — for draft evidence — whether a degraded
// result's warnings were accepted), a tone, and the providers manifest. It
// reads no wizard state, holds no provider knowledge, and never branches on a
// provider id: display names come from the manifest's `displayName`, so a
// provider added by registry registration alone renders correctly here.
//
// Both consumers render THIS component: the wizard's Review step (from draft
// verification evidence) and the post-creation surfaces (from `Project.
// connections`). There is no second rendering.

import { Fragment } from "react";
import type { ProjectConnectionRole } from "../../../shared/types.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import { CONNECTIONS_COPY } from "../feedback/copy-map.js";
import {
  type ConnectionComboSlot,
  type ConnectionComboTone,
  resolveProviderLabel,
} from "./connection-state.js";
import "./ConnectionComboLine.css";

export interface ConnectionComboLineProps {
  /** The slots to render, in the order they should read. */
  slots: readonly ConnectionComboSlot[];
  /** The providers manifest — the only source of display names. */
  descriptors: readonly ProviderDescriptor[];
  /** The line's tone, decided by the surface that knows what the line means. */
  tone: ConnectionComboTone;
  /** Restricts the rendered slots; defaults to every slot, tracker first. */
  roles?: readonly ProjectConnectionRole[];
  id?: string;
  className?: string;
}

/** The slot's state label: a degraded slot distinguishes accepted from outstanding. */
function stateLabel(slot: ConnectionComboSlot): string {
  if (slot.state === "degraded" && slot.accepted === true) {
    return CONNECTIONS_COPY.stateLabel.degradedAccepted;
  }
  return CONNECTIONS_COPY.stateLabel[slot.state];
}

function slotValue(
  slot: ConnectionComboSlot,
  descriptors: readonly ProviderDescriptor[],
): string {
  return slot.providerId
    ? resolveProviderLabel(slot.providerId, descriptors)
    : CONNECTIONS_COPY.notRecorded;
}

export function ConnectionComboLine({
  slots,
  descriptors,
  tone,
  roles,
  id,
  className,
}: ConnectionComboLineProps) {
  const rendered =
    roles === undefined
      ? slots
      : slots.filter((slot) => roles.includes(slot.role));

  return (
    <div
      id={id}
      className={`connection-combo-line connection-combo-line--${tone} ${className ?? ""}`.trim()}
    >
      {rendered.map((slot, index) => (
        <Fragment key={slot.role}>
          {index > 0 && (
            <span className="connection-combo-separator" aria-hidden="true">
              ·
            </span>
          )}
          <span
            id={`combo-${slot.role}`}
            className={`connection-combo-slot connection-combo-slot--${slot.role} connection-combo-slot--${slot.state}`}
            data-role={slot.role}
            data-state={slot.state}
          >
            <span className="connection-combo-role">
              {CONNECTIONS_COPY.roleLabel[slot.role]}
            </span>
            <span
              className="connection-combo-value"
              id={`combo-${slot.role}-name`}
            >
              {slotValue(slot, descriptors)}
            </span>
            <span
              className={`connection-combo-state connection-combo-state--${slot.state}`}
              id={`combo-${slot.role}-state`}
              data-connection-state={slot.state}
            >
              {stateLabel(slot)}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
