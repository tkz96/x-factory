// src/frontend/components/settings/RolesPanel.tsx — Settings › Models › Roles
// (#278): choose the Builder and Reviewer models from models on verified
// connections. A choice is saved as soon as it is made.
//
// Each role is a Settings row: the words lead, the select trails, and
// the select is the shared block rather than a native one — so it opens
// a listbox and each option is a real option.

import type { ModelConnectionView } from "../../../shared/model-connection-types.js";
import type { ModelRoleName, RoleAssignment } from "../../../shared/types.js";
import { useModelConnections } from "../../hooks/useModelConnections.js";
import { useSaveSettings, useSettings } from "../../hooks/useQueries.js";
import { MODEL_ROLES_COPY as COPY } from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import { ListGroup, ListGroupRow } from "../ui/ListGroup.js";
import { SelectField } from "../ui/SelectField.js";

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

/** The id of the option that names a model the connection no longer offers. */
const UNAVAILABLE = "unavailable";

/** The id of the "no model chosen" option. */
const NOT_SET = "";

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
    <>
      <ListGroup
        title={COPY.title}
        footer={choices.length === 0 ? COPY.noModels : COPY.subtitle}
      >
        {ROLES.map((role) => {
          const current = roles[role];
          const selected = choices.find((c) =>
            sameAssignment(c.assignment, current),
          );
          return (
            <ListGroupRow
              key={role}
              title={COPY[role]}
              subtitle={
                role === "builder" ? COPY.builderHelp : COPY.reviewerHelp
              }
              trailing={
                <SelectField
                  label={COPY[role]}
                  hideLabel
                  isDisabled={save.isPending}
                  selectedKey={
                    selected?.key ?? (current ? UNAVAILABLE : NOT_SET)
                  }
                  onSelectionChange={(key) => choose(role, String(key))}
                  options={[
                    { id: NOT_SET, label: COPY.notSet },
                    ...(current && !selected
                      ? [
                          {
                            id: UNAVAILABLE,
                            label: COPY.unavailable(current.modelId),
                          },
                        ]
                      : []),
                    ...choices.map((choice) => ({
                      id: choice.key,
                      label: choice.label,
                    })),
                  ]}
                />
              }
            />
          );
        })}
      </ListGroup>

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
    </>
  );
}
