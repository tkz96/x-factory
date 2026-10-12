// src/frontend/components/settings/RolesPanel.tsx — Settings › Models › Roles
// (#278): choose the Builder and Reviewer models from models on verified
// connections. A choice is saved as soon as it is made.

import type { ModelConnectionView } from "../../../shared/model-connection-types.js";
import type { ModelRoleName, RoleAssignment } from "../../../shared/types.js";
import { useModelConnections } from "../../hooks/useModelConnections.js";
import { useSaveSettings, useSettings } from "../../hooks/useQueries.js";
import { MODEL_ROLES_COPY as COPY } from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";

interface Choice {
  key: string;
  label: string;
  assignment: RoleAssignment;
}

/** Every chosen model on a verified connection, in a stable order. */
function choicesFrom(connections: readonly ModelConnectionView[]): Choice[] {
  return connections
    .filter((c) => c.verifiedAt !== null)
    .flatMap((c) =>
      c.models.map((m, index) => ({
        key: `${c.id}#${index}`,
        label: COPY.option(m.name ?? m.modelId, c.name),
        assignment: { connectionId: c.id, modelId: m.modelId },
      })),
    );
}

const sameAssignment = (a?: RoleAssignment, b?: RoleAssignment) =>
  a !== undefined &&
  b !== undefined &&
  a.connectionId === b.connectionId &&
  a.modelId === b.modelId;

const ROLES: readonly ModelRoleName[] = ["builder", "reviewer"];

export function RolesPanel() {
  const { data: settings } = useSettings();
  const { data: connections = [] } = useModelConnections();
  const save = useSaveSettings();
  const choices = choicesFrom(connections);
  const roles = settings?.roles ?? {};

  const choose = (role: ModelRoleName, key: string) => {
    const choice = choices.find((c) => c.key === key);
    save.mutate({ roles: { [role]: choice ? choice.assignment : null } });
  };

  return (
    <section className="model-connections" aria-labelledby="model-roles-title">
      <div>
        <h3 id="model-roles-title">{COPY.title}</h3>
        <p className="text-muted">{COPY.subtitle}</p>
      </div>

      {choices.length === 0 && <p className="text-muted">{COPY.noModels}</p>}

      <div className="model-connection-grid">
        {ROLES.map((role) => {
          const current = roles[role];
          const selected = choices.find((c) =>
            sameAssignment(c.assignment, current),
          );
          return (
            <label
              key={role}
              className="model-field"
              htmlFor={`setting-role-${role}`}
            >
              <span className="model-field-label">{COPY[role]}</span>
              <select
                id={`setting-role-${role}`}
                className="form-input"
                value={selected?.key ?? (current ? "unavailable" : "")}
                disabled={save.isPending}
                onChange={(e) => choose(role, e.target.value)}
              >
                <option value="">{COPY.notSet}</option>
                {current && !selected && (
                  <option value="unavailable" disabled>
                    {COPY.unavailable(current.modelId)}
                  </option>
                )}
                {choices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <span className="text-muted text-footnote">
                {role === "builder" ? COPY.builderHelp : COPY.reviewerHelp}
              </span>
            </label>
          );
        })}
      </div>

      {sameAssignment(roles.builder, roles.reviewer) && (
        <FeedbackBanner tone="info" message={COPY.sameModel} />
      )}
      {save.isError && (
        <FeedbackBanner
          tone="error"
          message={
            save.error instanceof Error
              ? save.error.message
              : String(save.error)
          }
        />
      )}
    </section>
  );
}
