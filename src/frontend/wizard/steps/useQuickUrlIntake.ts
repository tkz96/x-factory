// src/frontend/wizard/steps/useQuickUrlIntake.ts — Quick URL submission and provider autofill hook.

import type React from "react";
import { useRef, useState } from "react";
import { normalizeProjectId } from "../../../shared/project-identity.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import { CONNECTION_ROLES } from "../state/connectConfig.js";
import type { WizardAction, WizardConnectionRole } from "../types.js";

export interface UseQuickUrlIntakeProps {
  initialUrl: string;
  manifest: ProviderDescriptor[];
  basicsName: string;
  dispatch: (action: WizardAction) => void;
  updateBasics: (patch: { name: string; id: string }) => void;
  onResetVerifications: (roles: WizardConnectionRole[]) => void;
  parseGenRef?: React.MutableRefObject<number> | undefined;
}

export function useQuickUrlIntake({
  initialUrl,
  manifest,
  basicsName,
  dispatch,
  updateBasics,
  onResetVerifications,
  parseGenRef,
}: UseQuickUrlIntakeProps) {
  const [quickUrl, setQuickUrl] = useState(initialUrl);
  const [isParsingUrl, setIsParsingUrl] = useState(false);
  const [quickUrlMissMessage, setQuickUrlMissMessage] = useState<string | null>(
    null,
  );
  const internalGenRef = useRef(0);
  const activeGenRef = parseGenRef ?? internalGenRef;

  const bumpParseGeneration = () => {
    activeGenRef.current += 1;
  };

  const handleQuickUrlSubmit = async (url: string) => {
    const currentParseGen = ++activeGenRef.current;
    setIsParsingUrl(true);
    setQuickUrlMissMessage(null);
    try {
      const result = await api.providers.parseUrl(url);
      if (currentParseGen !== activeGenRef.current) {
        return;
      }
      if (!result.matched) {
        setQuickUrlMissMessage(
          "URL was not recognized by any registered provider.",
        );
        return;
      }

      const descriptor = manifest.find((p) => p.id === result.providerId);
      if (!descriptor) {
        setQuickUrlMissMessage(
          "URL was not recognized by any registered provider.",
        );
        return;
      }

      // Role targeting is unchanged: every role the descriptor serves is
      // pointed at the matched provider. The transition itself lives in the
      // state model, so the draft config is merged into the PROVIDER's one
      // configuration and every role naming that provider loses its
      // verification — the credentials on record have changed.
      const changedRoles = CONNECTION_ROLES.filter((role) =>
        descriptor.roles.includes(role),
      );

      if (changedRoles.length > 0) {
        onResetVerifications(changedRoles);
      }
      dispatch({
        type: "APPLY_PROVIDER_MATCH",
        providerId: result.providerId,
        config: result.configDraft,
        roles: [...changedRoles],
        url,
      });

      if (
        result.inferredName &&
        (!basicsName || basicsName.trim().length === 0)
      ) {
        updateBasics({
          name: result.inferredName,
          id: normalizeProjectId(result.inferredName),
        });
      }
    } catch {
      if (currentParseGen !== activeGenRef.current) {
        return;
      }
      setQuickUrlMissMessage(
        "Failed to parse URL. Enter credentials manually below.",
      );
    } finally {
      setIsParsingUrl(false);
    }
  };

  return {
    quickUrl,
    setQuickUrl,
    isParsingUrl,
    quickUrlMissMessage,
    handleQuickUrlSubmit,
    bumpParseGeneration,
  };
}
