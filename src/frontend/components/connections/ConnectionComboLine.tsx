// src/frontend/components/connections/ConnectionComboLine.tsx — THE combo line
// (spec #133 stories 48–49; tickets #146/#147, collapsed into one rendering by
// #148).
//
// Presentational only. It is handed the slots to render (per role: the provider
// id and one of the three states), a tone, and the providers manifest. It reads
// no wizard state, holds no provider knowledge, and never branches on a
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
  /** The line's text size: metadata in a list (footnote), or a fact on a detail
   *  page (subheadline), where the line sits beside the other facts. */
  size?: "footnote" | "subhead";
  id?: string;
  className?: string;
}

/** The slot's state label — one label per state, for every producer. */
function stateLabel(slot: ConnectionComboSlot): string {
  return CONNECTIONS_COPY.stateLabel[slot.state];
}

/**
 * The slot's value: the manifest display name, with the provider's own identity
 * in parentheses when one was handed to the line (#133 story 34) —
 * `"Generic Git Host Service (octo-org/rocket)"`. A slot with no provider id is
 * `notRecorded`; a slot with no identity is the plain display name. The
 * component never derives an identity and never branches on a provider id: it
 * formats the string the surface gave it.
 */
function slotValue(
  slot: ConnectionComboSlot,
  descriptors: readonly ProviderDescriptor[],
): string {
  if (!slot.providerId) {
    return CONNECTIONS_COPY.notRecorded;
  }
  const displayName = resolveProviderLabel(slot.providerId, descriptors);
  const identity = slot.identity?.trim() ?? "";
  return identity === "" ? displayName : `${displayName} (${identity})`;
}

export function ConnectionComboLine({
  slots,
  descriptors,
  tone,
  roles,
  size = "footnote",
  id,
  className,
}: ConnectionComboLineProps) {
  const roleSet = roles !== undefined ? new Set(roles) : undefined;
  const rendered =
    roleSet === undefined
      ? slots
      : slots.filter((slot) => roleSet.has(slot.role));

  return (
    <div
      id={id}
      /* The line's type comes from the .text-footnote or .text-subhead style. */
      className={`connection-combo-line connection-combo-line--${tone} text-${size} ${className ?? ""}`.trim()}
    >
      {rendered.map((slot) => (
        <Fragment key={slot.role}>
          <span
            id={`combo-${slot.role}`}
            className={`connection-combo-slot connection-combo-slot--${slot.role} connection-combo-slot--${slot.state}`}
            data-role={slot.role}
            data-state={slot.state}
          >
            {/* The role leads at medium weight; the value at semibold. */}
            <span className="connection-combo-role font-medium">
              {CONNECTIONS_COPY.roleLabel[slot.role]}
            </span>
            <span
              className="connection-combo-value font-semibold"
              id={`combo-${slot.role}-name`}
            >
              {slotValue(slot, descriptors)}
            </span>
            {/* The state label is the badge-sized .text-caption-1 style. */}
            <span
              className={`connection-combo-state connection-combo-state--${slot.state} text-caption-1`}
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
