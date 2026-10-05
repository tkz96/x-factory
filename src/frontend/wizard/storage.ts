// src/frontend/wizard/storage.ts — Versioned client draft persistence and secret-sanitization (spec #131, #142).

import {
  WIZARD_SCHEMA_VERSION,
  type WizardDraftEnvelope,
  type WizardSourceState,
} from "./types.js";

const WIZARD_DRAFT_STORAGE_KEY = "xf_wizard_draft_v1";

const SENSITIVE_KEY_PATTERN =
  /(token|pat|secret|password|key|auth|credential|envkey)/i;

function sanitizeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (val && typeof val === "object" && !Array.isArray(val)) {
      clean[key] = sanitizeConfig(val as Record<string, unknown>);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

function sanitizeStateForDraft(state: WizardSourceState): WizardSourceState {
  return {
    ...state,
    connect: {
      ...state.connect,
      tracker: {
        providerId: state.connect.tracker.providerId,
        config: sanitizeConfig(state.connect.tracker.config || {}),
        verified: false,
      },
      gitHost: {
        providerId: state.connect.gitHost.providerId,
        config: sanitizeConfig(state.connect.gitHost.config || {}),
        verified: false,
      },
    },
    inspection: {
      acknowledged: false,
    },
    review: {
      confirmed: false,
    },
  };
}

export function saveWizardDraft(state: WizardSourceState): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    const safeState = sanitizeStateForDraft(state);
    const envelope: WizardDraftEnvelope = {
      version: WIZARD_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      state: safeState,
    };
    window.localStorage.setItem(
      WIZARD_DRAFT_STORAGE_KEY,
      JSON.stringify(envelope),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadWizardDraft(): WizardSourceState | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const envelope = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== "object" ||
      envelope.version !== WIZARD_SCHEMA_VERSION
    ) {
      window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
      return null;
    }
    const state = envelope.state;
    if (
      !state ||
      typeof state !== "object" ||
      !state.basics ||
      typeof state.basics !== "object" ||
      typeof state.basics.name !== "string"
    ) {
      window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
      return null;
    }
    return sanitizeStateForDraft(state);
  } catch {
    window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
    return null;
  }
}

export function clearWizardDraft(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
