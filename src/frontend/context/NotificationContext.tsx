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
  saveReadIds,
  seedNotificationState,
  type TrackedRun,
  visibleNotifications,
} from "../lib/notifications.js";

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
}

const EMPTY: NotificationCenterValue = {
  notifications: [],
  unreadCount: 0,
  needsYouCount: 0,
  activeRuns: [],
  markRead: () => {},
  markAllRead: () => {},
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

  const onEvent = useCallback(
    (envelope: Parameters<typeof applyNotificationEnvelope>[1]) =>
      setState((current) => applyNotificationEnvelope(current, envelope)),
    [],
  );
  const { snapshot } = useAppEvents({ transport, onEvent });

  useEffect(() => {
    // A snapshot without its cursor is not a snapshot: nothing to seed.
    if (!snapshot || snapshot.cursor === undefined) return;
    setState((current) => seedNotificationState(current, snapshot));
  }, [snapshot]);

  const markRead = useCallback(
    (id: number) => {
      setReadIds((current) => {
        if (current.has(id)) return current;
        const next = new Set(current).add(id);
        saveReadIds(storage, next);
        return next;
      });
    },
    [storage],
  );

  const markAllRead = useCallback(() => {
    setReadIds((current) => {
      const next = new Set(current);
      for (const n of visibleNotifications(state)) next.add(n.id);
      saveReadIds(storage, next);
      return next;
    });
  }, [state, storage]);

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
    };
  }, [state, readIds, markRead, markAllRead]);

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}
