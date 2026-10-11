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
  disable: () => Promise<unknown>;
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
      await save.mutateAsync({ desktopNotifications: true });
    }
    return next;
  };

  const disable = () => save.mutateAsync({ desktopNotifications: false });

  return {
    ready: settings !== undefined,
    enabled: settings?.desktopNotifications === true,
    support,
    enable,
    disable,
  };
}
