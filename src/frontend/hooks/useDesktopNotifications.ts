// src/frontend/hooks/useDesktopNotifications.ts — The desktop notifications preference and
// the browser's permission, as one hook (#265, spec #241). The preference lives in settings;
// permission is the browser's, and is requested only by enable(), which a user click calls.

import { useState } from "react";
import {
  type DesktopSupport,
  desktopSupport,
  requestDesktopPermission,
} from "../lib/desktop-notifications.js";
import { useSaveSettings, useSettings } from "./useQueries.js";

export interface DesktopNotifications {
  /** Settings have loaded, so `enabled` is the saved value. */
  ready: boolean;
  /** The saved preference. */
  enabled: boolean;
  /** Where the browser stands. */
  support: DesktopSupport;
  /** Asks the browser for permission (from a click) and, if granted, turns the preference on. */
  enable: () => Promise<DesktopSupport>;
  /** Turns the preference off. Permission stays as the browser has it. */
  disable: () => void;
}

export function useDesktopNotifications(): DesktopNotifications {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const [support, setSupport] = useState<DesktopSupport>(() =>
    desktopSupport(),
  );

  const enable = async (): Promise<DesktopSupport> => {
    const next = await requestDesktopPermission();
    setSupport(next);
    if (next === "granted") {
      save.mutate({ desktopNotifications: true });
    }
    return next;
  };

  // mutate, not mutateAsync: a failed save is reported by the mutation state, not thrown into a click.
  const disable = () => save.mutate({ desktopNotifications: false });

  return {
    ready: settings !== undefined,
    enabled: settings?.desktopNotifications === true,
    support,
    enable,
    disable,
  };
}
