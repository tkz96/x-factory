// src/frontend/context/NotificationContext.tsx — The client notification list, read
// state and activity, fed by the app-wide event stream and its snapshot (#264, spec #241).
// Every page load starts from a snapshot; nothing here is stored except read state.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppEvents } from "../hooks/useAppEvents.js";
import type { AppEventTransport } from "../lib/app-events.js";
import {
  type AppNotification,
  activeRunsOf,
  applyNotificationEnvelope,
  browserStorage,
  emptyNotificationState,
  loadReadIds,
  type NotificationState,
  needsYouCount,
  notificationFromEvent,
  saveReadIds,
  seedNotificationState,
  type TrackedRun,
  visibleNotifications,
} from "../lib/notifications.js";

/** Receives each notification that arrives live on the stream (#265). */
export type LiveNotificationListener = (notification: AppNotification) => void;

export interface NotificationListItem extends AppNotification {
  unread: boolean;
}

export interface NotificationCenterValue {
  notifications: NotificationListItem[];
  unreadCount: number;
  /** Runs in a Needs-you status: the number the Runs section shows. */
  needsYouCount: number;
  /** Runs in progress, for the toolbar activity area. Never stored. */
  activeRuns: TrackedRun[];
  markRead: (id: number) => void;
  markAllRead: () => void;
  /** Subscribes to notifications that arrive live. Returns the unsubscribe. */
  subscribeLive: (listener: LiveNotificationListener) => () => void;
}

const EMPTY: NotificationCenterValue = {
  notifications: [],
  unreadCount: 0,
  needsYouCount: 0,
  activeRuns: [],
  markRead: () => {},
  markAllRead: () => {},
  subscribeLive: () => () => {},
};

const NotificationCenterContext = createContext<NotificationCenterValue>(EMPTY);

export function useNotificationCenter(): NotificationCenterValue {
  return useContext(NotificationCenterContext);
}

export interface NotificationProviderProps {
  children: ReactNode;
  /** The stream transport; production uses the browser's EventSource. */
  transport?: AppEventTransport | undefined;
}

export function NotificationProvider({
  children,
  transport,
}: NotificationProviderProps) {
  const [storage] = useState(browserStorage);
  const [state, setState] = useState<NotificationState>(emptyNotificationState);
  const [readIds, setReadIds] = useState<Set<number>>(() =>
    loadReadIds(storage),
  );

  const liveListeners = useRef(new Set<LiveNotificationListener>());

  const onEvent = useCallback(
    (
      envelope: Parameters<typeof applyNotificationEnvelope>[1],
      delivery: { live: boolean },
    ) => {
      setState((current) => applyNotificationEnvelope(current, envelope));
      if (!delivery.live) return;
      const notification = notificationFromEvent(envelope);
      if (!notification) return;
      for (const listener of liveListeners.current) {
        // A listener that fails must not stop the stream: the event is applied already.
        try {
          listener(notification);
        } catch {
          // Ignored: a banner that cannot be shown is not a reason to replay the event.
        }
      }
    },
    [],
  );

  const subscribeLive = useCallback((listener: LiveNotificationListener) => {
    liveListeners.current.add(listener);
    return () => {
      liveListeners.current.delete(listener);
    };
  }, []);
  const { snapshot } = useAppEvents({ transport, onEvent });

  useEffect(() => {
    // A snapshot without its cursor is not a snapshot: nothing to seed.
    if (!snapshot || snapshot.cursor === undefined) return;
    setState((current) => seedNotificationState(current, snapshot));
  }, [snapshot]);

  // Persisting is a side effect, so it runs here and never inside a state updater
  // (which React may call twice). The set loaded from storage needs no write.
  const loadedIds = useRef(readIds);
  useEffect(() => {
    if (readIds === loadedIds.current) return;
    saveReadIds(storage, readIds);
  }, [readIds, storage]);

  const markRead = useCallback((id: number) => {
    setReadIds((current) =>
      current.has(id) ? current : new Set(current).add(id),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds((current) => {
      const next = new Set(current);
      for (const n of visibleNotifications(state)) next.add(n.id);
      return next;
    });
  }, [state]);

  const value = useMemo<NotificationCenterValue>(() => {
    const notifications = visibleNotifications(state).map((n) => ({
      ...n,
      unread: !readIds.has(n.id),
    }));
    return {
      notifications,
      unreadCount: notifications.filter((n) => n.unread).length,
      needsYouCount: needsYouCount(state),
      activeRuns: activeRunsOf(state),
      markRead,
      markAllRead,
      subscribeLive,
    };
  }, [state, readIds, markRead, markAllRead, subscribeLive]);

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}
