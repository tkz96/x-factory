// src/frontend/lib/desktop-notifications.ts — Desktop notifications ("banners") through the
// Web Notifications API (#265, spec #241). Wording never names an OS. Permission is asked
// for only from a user action; the rules for when a banner fires are pure and tested as a table.

import {
  type AppNotification,
  browserStorage,
  type NotificationStorage,
} from "./notifications.js";

/** Where desktop notifications stand in this browser. */
export type DesktopSupport = "unsupported" | "blocked" | "prompt" | "granted";

/** The slice of the Notifications API this app uses. */
export interface NotificationApi {
  permission: string;
  requestPermission?: () => Promise<string> | string;
  new (title: string, options?: { body?: string; tag?: string }): BannerHandle;
}

/** A shown banner: the click handler and a way to close it. */
export interface BannerHandle {
  onclick: ((event: unknown) => void) | null;
  close(): void;
}

/** The browser's Notification constructor, or undefined when the browser lacks it. */
export function notificationApi(): NotificationApi | undefined {
  try {
    const api = (globalThis as { Notification?: unknown }).Notification;
    return typeof api === "function" ? (api as NotificationApi) : undefined;
  } catch {
    return undefined;
  }
}

function supportFromPermission(permission: string): DesktopSupport {
  if (permission === "granted") return "granted";
  if (permission === "denied") return "blocked";
  return "prompt";
}

export function desktopSupport(
  api: NotificationApi | undefined = notificationApi(),
): DesktopSupport {
  if (!api) return "unsupported";
  return supportFromPermission(api.permission);
}

/** The one-line reason the Settings switch shows when it cannot be turned on. */
export function desktopSupportReason(support: DesktopSupport): string | null {
  if (support === "unsupported") {
    return "This browser doesn't support desktop notifications.";
  }
  if (support === "blocked") {
    return "Notifications are blocked for this site. Allow them in your browser's settings, then turn this on.";
  }
  return null;
}

/**
 * Asks the browser for permission. Call only from a user action (#265). A refused
 * or failed prompt leaves the state where the browser says it is.
 */
export async function requestDesktopPermission(
  api: NotificationApi | undefined = notificationApi(),
): Promise<DesktopSupport> {
  if (!api) return "unsupported";
  if (typeof api.requestPermission !== "function") return desktopSupport(api);
  let answer: unknown;
  try {
    answer = await api.requestPermission();
  } catch {
    return desktopSupport(api);
  }
  return supportFromPermission(
    typeof answer === "string" ? answer : api.permission,
  );
}

export interface BannerCopy {
  title: string;
  body: string;
}

/** The banner text for a notification. It names the run's own words, never an OS. */
export function bannerCopy(notification: AppNotification): BannerCopy {
  const body = [
    `${notification.ticketId} · ${notification.ticketTitle}`,
    notification.projectName,
    notification.detail,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
  return { title: `${notification.text}: ${notification.ticketId}`, body };
}

export interface BannerContext {
  /** The event arrived on a live connection (never a snapshot or a replay). */
  live: boolean;
  /** The preference is on in Settings. */
  enabled: boolean;
  support: DesktopSupport;
  /** The document has focus; no banner for a window the user is looking at. */
  documentFocused: boolean;
  /** The run the user is viewing, if any. */
  openRunId: string | null;
}

/** The banner rules (spec #241): live, switched on, not focused, and not the run on screen. */
export function shouldShowBanner(
  notification: Pick<AppNotification, "runId">,
  context: BannerContext,
): boolean {
  return (
    context.live &&
    context.enabled &&
    context.support === "granted" &&
    !context.documentFocused &&
    context.openRunId !== notification.runId
  );
}

export interface DesktopPromptContext {
  enabled: boolean;
  support: DesktopSupport;
  /** The one-time row was already answered (enabled, or dismissed) in this browser. */
  alreadyOffered: boolean;
}

/** The bell's one-time "Get desktop notifications" row: shown while permission is undecided. */
export function shouldOfferDesktopPrompt(
  context: DesktopPromptContext,
): boolean {
  return (
    !context.enabled && context.support === "prompt" && !context.alreadyOffered
  );
}

/** Shows a banner through the browser. The caller decides whether it should. */
export function showBanner(
  api: NotificationApi,
  notification: AppNotification,
  onOpen: () => void,
): void {
  const copy = bannerCopy(notification);
  const banner = new api(copy.title, {
    body: copy.body,
    tag: `run-event-${notification.id}`,
  });
  banner.onclick = () => {
    onOpen();
    banner.close();
  };
}

const PROMPT_ANSWERED_KEY = "x-factory.desktop-prompt.answered";

/** Whether the bell's one-time row was answered in this browser. Storage failures read as not answered. */
export function promptAnswered(
  storage: NotificationStorage | null = browserStorage(),
): boolean {
  try {
    return storage?.getItem(PROMPT_ANSWERED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers that the one-time row was answered. A failed write is ignored. */
export function markPromptAnswered(
  storage: NotificationStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(PROMPT_ANSWERED_KEY, "1");
  } catch {
    // Storage is optional: the row may show again in a new session.
  }
}
