// src/frontend/components/runs/useRunChatSend.ts — Sending a message to the Builder from the run chat: the
// reader's lines made in this view until the worker's copies arrive, the sending flag, and a refused or
// unreachable reply kept as a failure until it is retried or the run records its own error (#263).

import { useRef, useState } from "react";
import { api } from "../../lib/api-client.js";
import type { ChatItem } from "../../lib/run-chat-items.js";

/** The line the reader sees when the model could not be reached at all (no event was recorded). */
const UNREACHABLE_LINE = "Couldn't reach the model. Check Settings › Models.";

/** A failed send, kept until it is retried or the server records its own failure event (#263). */
interface SendFailure {
  /** The message to re-send on Retry. */
  text: string;
  message: string;
  /** How many error events the run had when the send started. */
  errorsBefore: number;
}

interface RunChatSend {
  /** Lines the reader made in this view, before the worker's own events arrive. */
  localItems: ChatItem[];
  addLocal: (make: (id: string, at: string) => ChatItem) => string;
  clearReworkHint: () => void;
  sending: boolean;
  /** The failure to show now, or null: it hides once the run records its own error. */
  shownFailure: SendFailure | null;
  /** Sends `text`; `echo` puts the reader's line in the chat first. */
  send: (text: string, echo: boolean) => Promise<void>;
  /** The last message sent from this view. */
  lastSent: () => string | null;
}

export function useRunChatSend(runId: string, errorCount: number): RunChatSend {
  const [localItems, setLocalItems] = useState<ChatItem[]>([]);
  const localCount = useRef(0);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);
  const errorCountRef = useRef(errorCount);
  errorCountRef.current = errorCount;
  const lastSentRef = useRef<string | null>(null);

  const addLocal = (make: (id: string, at: string) => ChatItem): string => {
    localCount.current += 1;
    const clientId = `local-${localCount.current}`;
    const item = make(clientId, new Date().toISOString());
    setLocalItems((prev) => [...prev, item]);
    return clientId;
  };

  const clearReworkHint = () => {
    setLocalItems((prev) =>
      prev.filter(
        (item) =>
          !(
            item.kind === "notice" &&
            item.text.includes("Describe the changes needed")
          ),
      ),
    );
  };

  // A refused or unreachable reply stays a system line with Retry.
  const send = async (text: string, echo: boolean) => {
    lastSentRef.current = text;
    let clientId: string | null = null;
    if (echo) {
      clientId = addLocal((id, at) => ({
        id,
        at,
        kind: "message",
        role: "user",
        text,
      }));
    }
    setFailure(null);
    const errorsBefore = errorCountRef.current;
    setSending(true);
    try {
      const reply = await api.chatWithRun(runId, text);
      if (!reply.ok) {
        setFailure({ text, message: reply.message, errorsBefore });
      } else if (clientId) {
        // Local echoes carry a client id, and they clear only when the server confirms that id (#317).
        setLocalItems((prev) => prev.filter((item) => item.id !== clientId));
      }
    } catch {
      setFailure({ text, message: UNREACHABLE_LINE, errorsBefore });
    } finally {
      setSending(false);
    }
  };

  const shownFailure =
    failure !== null && errorCount <= failure.errorsBefore ? failure : null;

  return {
    localItems,
    addLocal,
    clearReworkHint,
    sending,
    shownFailure,
    send,
    lastSent: () => lastSentRef.current,
  };
}
