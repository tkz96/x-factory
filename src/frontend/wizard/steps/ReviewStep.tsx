// src/frontend/wizard/steps/ReviewStep.tsx — Step 5: the single gate before
// creation (spec #133, #146).
//
// Everything here is DERIVED at render time (#126): the combo line from the
// connections, the role-tagged selection, and the git identity the Inspection
// step resolved. `isReviewReady` is a pure predicate over that same state — it
// is never stored, and there is no dismissal path: only re-verification and
// re-inspection clear a blocked reason, each one explained through the copy map.
//
// The submit wires `api.createProject` with the payload #145 accepts. Secrets
// come from the IN-MEMORY wizard state (never the sanitized draft) and travel
// exactly once, in this request body.

import { useQuery } from "@tanstack/react-query";
import type { ProjectConnectionRole } from "../../../shared/types.js";
import { ConnectionComboLine } from "../../components/connections/ConnectionComboLine.js";
import {
  comboSlotFromEvidence,
  comboTone,
} from "../../components/connections/connection-state.js";
import {
  REVIEW_COPY,
  resolveFieldValidationError,
  resolveFormValidationError,
} from "../../components/feedback/copy-map.js";
import { FeedbackBanner } from "../../components/feedback/FeedbackBanner.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import { useConnectionLine } from "../../hooks/useConnectionIdentity.js";
import { ApiError, api } from "../../lib/api-client.js";
import { QUERY_POLICIES, queryKeys } from "../../lib/query-policies.js";
import { draftConnectionIdentityTargets } from "../state/connectConfig.js";
import {
  isReviewReady,
  type ReviewBlockedReason,
  reviewBlockedReasons,
} from "../state/reviewRules.js";
import { useWizard } from "../state/wizardContext.js";
import {
  buildCreationPayload,
  type DiscoveredRepositoryDetail,
} from "./reviewPayload.js";
import { useRepositoryDiscovery } from "./useRepositoryDiscovery.js";
import { isSemanticConflict, useReviewSubmit } from "./useReviewSubmit.js";
import "./ReviewStep.css";
import { ModalFooter } from "../../components/Modal.js";

interface ReviewStepProps {
  /**
   * Called once the project was created: the wizard is done. Never called on a
   * failed attempt, so a failure can not navigate the user anywhere.
   */
  onSubmit?: (() => void) | undefined;
}

/**
 * The human label of a config field named by a 409 `fieldErrors` key, taken
 * from the providers manifest descriptor. An unknown field falls back to its
 * own name — the error code itself is never what the user reads.
 */
function fieldLabel(
  field: string,
  manifest: readonly ProviderDescriptor[],
): string {
  for (const provider of manifest) {
    const descriptor = provider.configFields.find((f) => f.name === field);
    if (descriptor) return descriptor.label;
  }
  return field;
}

/** Turns a submit failure into canonical copy: a title and its detail items. */
function submitErrorView(
  error: unknown,
  manifest: readonly ProviderDescriptor[],
): { title: string; items: string[] } | null {
  if (error === null) return null;
  if (isSemanticConflict(error)) {
    const data = (error.data ?? {}) as {
      formErrors?: unknown;
      fieldErrors?: unknown;
    };
    const items: string[] = [];
    if (Array.isArray(data.formErrors)) {
      for (const code of data.formErrors) {
        if (typeof code === "string") {
          items.push(resolveFormValidationError(code));
        }
      }
    }
    if (data.fieldErrors && typeof data.fieldErrors === "object") {
      for (const [field, code] of Object.entries(
        data.fieldErrors as Record<string, unknown>,
      )) {
        if (typeof code === "string") {
          items.push(
            resolveFieldValidationError(code, fieldLabel(field, manifest)),
          );
        }
      }
    }
    return {
      title: REVIEW_COPY.conflictTitle,
      items: items.length > 0 ? items : [REVIEW_COPY.requestRejectedDetail],
    };
  }
  if (error instanceof ApiError) {
    return {
      title: REVIEW_COPY.requestRejectedTitle,
      items: [REVIEW_COPY.requestRejectedDetail],
    };
  }
  return {
    title: REVIEW_COPY.networkErrorTitle,
    items: [REVIEW_COPY.networkErrorDetail],
  };
}

export function ReviewStep({ onSubmit }: ReviewStepProps) {
  const { state, prevStep } = useWizard();
  const { rows } = useRepositoryDiscovery();
  const manifestQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.providers.getManifest(),
    ...QUERY_POLICIES.providers,
  });
  const manifest = manifestQuery.data ?? [];

  const blockedReasons = reviewBlockedReasons(state, manifest);
  const ready = isReviewReady(state, manifest);
  const identity = state.inspection.gitIdentity;
  const submitState = useReviewSubmit(() => onSubmit?.());
  const errorView = submitErrorView(submitState.error, manifest);

  const { name, id: projectId, description, workspacePath } = state.basics;
  const { selectedRepoIds, repoConfigs, primaryRepoId } = state.repositories;

  const discovered: DiscoveredRepositoryDetail[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    remote: row.remote,
    defaultBranch: row.defaultBranch,
  }));

  // The combo line reads the SAME draft evidence the gate reads (#148): one
  // model, one rendering, one tone rule, shared with the post-creation
  // surfaces. Review is the creation gate, so BOTH roles are required here —
  // a role with no verified connection is an error, never a warning (#133).
  //
  // The identity is the provider's own (#133 story 34), read from the
  // configuration the draft holds (`connect.providerConfigs`) — its non-secret
  // fields only, so the credentials the user typed stay in the draft — through
  // the ONE wiring call every surface uses.
  const comboSlots = useConnectionLine(
    [
      comboSlotFromEvidence("tracker", state.connect.tracker),
      comboSlotFromEvidence("gitHost", state.connect.gitHost),
    ],
    draftConnectionIdentityTargets(state.connect, manifest),
  );
  const requiredRoles: ProjectConnectionRole[] = ["tracker", "gitHost"];

  const handleSubmit = () => {
    if (!ready || !identity || submitState.isSubmitting) return;
    submitState.submit(buildCreationPayload(state, discovered, identity));
  };

  const blockedItems: string[] = blockedReasons.map(
    (reason: ReviewBlockedReason) => REVIEW_COPY.blocked[reason],
  );
  const unresolvedNames = (state.inspection.unresolvedRepoIds ?? []).map(
    (repoId) => rows.find((row) => row.id === repoId)?.name ?? repoId,
  );
  if (
    blockedReasons.includes("identityPartial") &&
    unresolvedNames.length > 0
  ) {
    blockedItems.push(unresolvedNames.join(", "));
  }

  return (
    <div id="onboard-step-5" className="wizard-step-pane review-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">{REVIEW_COPY.title}</h2>
        <p className="wizard-step-subtitle">{REVIEW_COPY.subtitle}</p>
      </div>

      <ConnectionComboLine
        id="combo-summary"
        slots={comboSlots}
        tone={comboTone(comboSlots, requiredRoles)}
        descriptors={manifest}
      />

      <div className="review-summary-card">
        <div className="review-row">
          <span className="review-label">{REVIEW_COPY.nameLabel}</span>
          <span className="review-value" id="review-proj-name">
            {name || REVIEW_COPY.unsetName}
          </span>
        </div>

        <div className="review-row">
          <span className="review-label">{REVIEW_COPY.identifierLabel}</span>
          <span className="review-value code-font" id="review-proj-id">
            {projectId || REVIEW_COPY.unsetValue}
          </span>
        </div>

        <div className="review-row">
          <span className="review-label">{REVIEW_COPY.workspacePathLabel}</span>
          <span className="review-value code-font" id="review-workspace-path">
            {workspacePath || REVIEW_COPY.defaultWorkspacePath}
          </span>
        </div>

        {description.trim() && (
          <div className="review-row">
            <span className="review-label">{REVIEW_COPY.descriptionLabel}</span>
            <span className="review-value" id="review-proj-description">
              {description}
            </span>
          </div>
        )}

        {identity && (
          <>
            <div className="review-row">
              <span className="review-label">
                {REVIEW_COPY.identitySectionTitle}
              </span>
              <span className="review-value" id="review-identity-name">
                {identity.name}
              </span>
            </div>
            <div className="review-row">
              <span className="review-label">
                {REVIEW_COPY.identityEmailLabel}
              </span>
              <span
                className="review-value code-font"
                id="review-identity-email"
              >
                {identity.email}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="review-repositories">
        <h3 className="review-section-title">
          {REVIEW_COPY.repositoriesSectionTitle}
        </h3>
        <ul className="review-repository-list" id="review-repositories">
          {selectedRepoIds.map((repoId) => {
            const config = repoConfigs[repoId];
            const roles = config?.roles?.join(", ") ?? config?.role ?? "";
            return (
              <li
                key={repoId}
                className="review-repository-row"
                id={`review-repository-${repoId}`}
              >
                <span className="review-repository-name">
                  {rows.find((row) => row.id === repoId)?.name ?? repoId}
                </span>
                {roles !== "" && (
                  <span className="review-repository-role">{roles}</span>
                )}
                {repoId === primaryRepoId && (
                  <span
                    className="review-repository-primary"
                    id={`review-repository-${repoId}-primary`}
                  >
                    {REVIEW_COPY.primaryBadge}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {!ready && (
        <div id="review-blocked">
          <FeedbackBanner
            tone="warning"
            message={REVIEW_COPY.blockedTitle}
            items={blockedItems}
          />
        </div>
      )}

      {errorView && (
        <div id="review-submit-error">
          <FeedbackBanner
            tone="error"
            message={errorView.title}
            items={errorView.items}
            onRetry={ready ? handleSubmit : undefined}
          />
        </div>
      )}

      <ModalFooter>
        <button
          type="button"
          id="btn-step-5-back"
          className="btn-secondary"
          onClick={prevStep}
          disabled={submitState.isSubmitting}
        >
          ← {REVIEW_COPY.previous}
        </button>
        <button
          type="button"
          id="btn-step-5-submit"
          className="btn-primary"
          onClick={handleSubmit}
          disabled={!ready || submitState.isSubmitting}
        >
          {submitState.isSubmitting
            ? REVIEW_COPY.submitting
            : REVIEW_COPY.submit}
        </button>
      </ModalFooter>
    </div>
  );
}
