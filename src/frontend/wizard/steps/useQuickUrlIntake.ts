// src/frontend/wizard/steps/useQuickUrlIntake.ts — Quick URL submission and provider autofill hook.

import type React from "react";
import { useRef, useState } from "react";
import { normalizeProjectId } from "../../../shared/project-identity.js";
import type { ProviderDescriptor } from "../../connection/types.js";
import { api } from "../../lib/api-client.js";
import type { WizardConnectState } from "../types.js";

export interface UseQuickUrlIntakeProps {
  initialUrl: string;
  manifest: ProviderDescriptor[];
  currentConnect: WizardConnectState;
  basicsName: string;
  dispatch: (action: {
    type: "UPDATE_CONNECT";
    patch: Partial<WizardConnectState>;
  }) => void;
  updateBasics: (patch: { name: string; id: string }) => void;
  onResetVerifications: (roles: ("tracker" | "gitHost")[]) => void;
  parseGenRef?: React.MutableRefObject<number> | undefined;
}

function resolveRoleConfig(
  currentRole: WizardConnectState["tracker"],
  newProviderId: string,
  configDraft: Record<string, unknown>,
): Record<string, unknown> {
  return currentRole.providerId === newProviderId
    ? { ...currentRole.config, ...configDraft }
    : { ...configDraft };
}

export function useQuickUrlIntake({
  initialUrl,
  manifest,
  currentConnect,
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

      const patch: Partial<WizardConnectState> = { quickUrl: url };
      const changedRoles: ("tracker" | "gitHost")[] = [];

      if (descriptor.roles.includes("tracker")) {
        changedRoles.push("tracker");
        patch.tracker = {
          providerId: result.providerId,
          config: resolveRoleConfig(
            currentConnect.tracker,
            result.providerId,
            result.configDraft,
          ),
        };
      }
      if (descriptor.roles.includes("gitHost")) {
        changedRoles.push("gitHost");
        patch.gitHost = {
          providerId: result.providerId,
          config: resolveRoleConfig(
            currentConnect.gitHost,
            result.providerId,
            result.configDraft,
          ),
        };
      }

      if (changedRoles.length > 0) {
        onResetVerifications(changedRoles);
      }
      dispatch({ type: "UPDATE_CONNECT", patch });

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
