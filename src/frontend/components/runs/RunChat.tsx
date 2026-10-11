// src/frontend/components/runs/RunChat.tsx — The run chat: real run events, one clock, one status map (#261).

import "./RunChat.css";

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type { DiffFileSummary } from "../../../shared/diff-summary.js";
import { canRunAction } from "../../../shared/run-status-policy.js";
import type { Run, RunEvent, RunStatus } from "../../../shared/types.js";
import { useNow } from "../../hooks/useNow.js";
import { api } from "../../lib/api-client.js";
import {
  type ParsedDiffFile,
  parseDiffToFiles,
} from "../../lib/diff-parser.js";
import {
  type ChatItem,
  mapEventsToChatItems,
} from "../../lib/run-chat-items.js";
import { runNow } from "../../lib/run-now.js";
import { runStatusUi } from "../../lib/run-status-ui.js";
import { Button } from "../ui/Button.js";
import { DiffModal } from "./DiffModal.js";
import { RunChatRow } from "./RunChatItem.js";
import { type CheckpointAction, RunCheckpointBar } from "./RunCheckpointBar.js";
import { RunNowHeader } from "./RunNowHeader.js";

export interface RunChatProps {
  run: Run;
  events: RunEvent[];
  /** Called with the checkpoint action; a rework carries the reader's notes. */
  onAction?: (action: CheckpointAction, notes?: string) => void;
  /** The checkpoint action in flight, if any (optimistic pending label). */
  pending?: CheckpointAction | null;
  /** True when the last checkpoint action raced with the run and lost. */
  conflict?: boolean;
}

/** Runs of progress lines this long fold into one group the reader can open (#261). */
const GROUP_MIN = 3;
/** How close to the bottom still counts as following the chat. */
const AT_BOTTOM_PX = 48;

type Row =
  | { kind: "item"; item: ChatItem }
  | { kind: "group"; id: string; items: ChatItem[] };

/** Folds consecutive progress and output lines into groups; every other item is its own row. */
export function groupRows(items: readonly ChatItem[]): Row[] {
  const rows: Row[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length >= GROUP_MIN) {
      rows.push({ kind: "group", id: `group-${run[0]?.id ?? ""}`, items: run });
    } else {
      for (const item of run) rows.push({ kind: "item", item });
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === "progress" || item.kind === "output") {
      run.push(item);
    } else {
      flush();
      rows.push({ kind: "item", item });
    }
  }
  flush();
  return rows;
}

/** The line the chat shows once a button has been pressed, before the run moves on. */
function resolvedTextFor(
  action: CheckpointAction,
  status: RunStatus,
): string | null {
  switch (action) {
    case "approve":
      return status === "awaiting_review"
        ? "Changes approved — opening a pull request"
        : "Approved";
    case "restart":
      return "Changes requested";
    case "deliver":
      return "Opening a pull request";
    case "resume":
      return "Resuming the run";
    case "abandon":
      return "Abandoned";
    case "start-new-run":
    case "requeue":
    case "confirm-rework":
      return null;
  }
}

/** Keeps the scroll position while the reader is up the chat, and offers Jump to latest. */
function useScrollFollow(itemCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(false);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new items when the count changes
  useEffect(() => {
    if (atBottomRef.current) {
      scrollToBottom();
    } else {
      setUnseen(true);
    }
  }, [itemCount]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    if (atBottomRef.current) setUnseen(false);
  };

  const jumpToLatest = () => {
    atBottomRef.current = true;
    setUnseen(false);
    scrollToBottom();
  };

  return { scrollRef, onScroll, unseen, jumpToLatest };
}

/** The line the reader sees when the model could not be reached at all (no event was recorded). */
const UNREACHABLE_LINE = "Couldn't reach the model. Check Settings › Models.";

const SETTINGS_MODELS = "Settings › Models";

/** The message with its "Settings › Models" pointer made a link to that pane (#263). */
function withSettingsLink(message: string): ReactNode {
  const at = message.indexOf(SETTINGS_MODELS);
  if (at === -1) return message;
  return (
    <>
      {message.slice(0, at)}
      <Link to="/settings?tab=models">{SETTINGS_MODELS}</Link>
      {message.slice(at + SETTINGS_MODELS.length)}
    </>
  );
}

/** A failed send, kept until it is retried or the server records its own failure event (#263). */
interface SendFailure {
  /** The message to re-send on Retry. */
  text: string;
  message: string;
  /** How many error events the run had when the send started. */
  errorsBefore: number;
}

/** The text of the nearest message the reader sent before `index`, or null. */
function messageBefore(
  items: readonly ChatItem[],
  index: number,
): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.kind === "message" && item.role === "user") return item.text;
  }
  return null;
}

export function RunChat({
  run,
  events,
  onAction,
  pending = null,
  conflict = false,
}: RunChatProps) {
  const now = useNow();
  const realItems = useMemo(() => mapEventsToChatItems(events), [events]);
  const errorCount = realItems.filter((i) => i.kind === "error").length;
  const errorCountRef = useRef(errorCount);
  errorCountRef.current = errorCount;

  // Lines the reader made in this view, before the worker's own events arrive.
  const [localItems, setLocalItems] = useState<ChatItem[]>([]);
  const localCount = useRef(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SendFailure | null>(null);
  const [reworkPrompt, setReworkPrompt] = useState(false);
  const [pendingRework, setPendingRework] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [activeDiffFile, setActiveDiffFile] = useState<ParsedDiffFile | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The last message sent from this view: what Retry re-sends when no earlier message is in the chat.
  const lastSentRef = useRef<string | null>(null);

  const parsedDiffFiles = useMemo(() => parseDiffToFiles(run.diff), [run.diff]);

  // A new status starts the chat's pending steps over: they answered the old status.
  const lastStatusRef = useRef(run.status);
  useEffect(() => {
    if (lastStatusRef.current !== run.status) {
      lastStatusRef.current = run.status;
      setReworkPrompt(false);
      setPendingRework(null);
      setResolved(null);
    }
  }, [run.status]);

  const isApprovalGate = canRunAction(run.status, "chat");

  const addLocal = (make: (id: string, at: string) => ChatItem) => {
    localCount.current += 1;
    const item = make(`local-${localCount.current}`, new Date().toISOString());
    setLocalItems((prev) => [...prev, item]);
  };

  // A reader's own message stays here only until the worker's copy of it arrives.
  const realUserTexts = new Set(
    realItems.flatMap((i) =>
      i.kind === "message" && i.role === "user" ? [i.text] : [],
    ),
  );
  const items: ChatItem[] = [
    ...realItems,
    ...localItems.filter(
      (i) => !(i.kind === "message" && realUserTexts.has(i.text)),
    ),
  ];
  const rows = groupRows(items);

  const scroll = useScrollFollow(items.length);

  // Sends a message to the Builder. A refused or unreachable reply stays a system line with Retry.
  const send = async (text: string, echo: boolean) => {
    lastSentRef.current = text;
    if (echo)
      addLocal((id, at) => ({ id, at, kind: "message", role: "user", text }));
    setFailure(null);
    const errorsBefore = errorCountRef.current;
    setSending(true);
    try {
      const reply = await api.chatWithRun(run.id, text);
      if (!reply.ok) {
        setFailure({ text, message: reply.message, errorsBefore });
      }
    } catch {
      setFailure({ text, message: UNREACHABLE_LINE, errorsBefore });
    } finally {
      setSending(false);
    }
  };

  const handleAction = (action: CheckpointAction) => {
    if (action === "requeue") {
      setReworkPrompt(true);
      addLocal((id, at) => ({
        id,
        at,
        kind: "notice",
        text: "Describe the changes needed. Your next message goes back to planning.",
        warning: false,
      }));
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    if (action === "confirm-rework") {
      onAction?.("requeue", pendingRework ?? undefined);
      setPendingRework(null);
      setResolved(resolvedTextFor("requeue", run.status));
      return;
    }
    onAction?.(action);
    setResolved(resolvedTextFor(action, run.status));
  };

  // Return and Mod-Enter send; Shift-Return is a new line.
  const submitInput = () => {
    const text = input.trim();
    if (!text || sending || !isApprovalGate || pending !== null) return;
    setInput("");

    if (reworkPrompt) {
      addLocal((id, at) => ({ id, at, kind: "message", role: "user", text }));
      setReworkPrompt(false);
      setPendingRework(text);
      return;
    }

    void send(text, true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitInput();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const withMod = e.metaKey || e.ctrlKey;
    if (e.shiftKey && !withMod) return;
    e.preventDefault();
    submitInput();
  };

  const ui = runStatusUi(run.status);
  const nowFacts = runNow(run, events);
  const placeholderText = reworkPrompt
    ? "Describe the changes needed before replanning…"
    : ui.placeholder;
  // The failure line shows until the run records its own error for it, which then takes its place.
  const showFailure = failure !== null && errorCount <= failure.errorsBefore;
  const canRetry = isApprovalGate && !sending && pending === null;

  const openDiffFile = (file: DiffFileSummary) => {
    const found = parsedDiffFiles.find((f) => f.file === file.path);
    setActiveDiffFile(
      found ?? {
        file: file.path,
        added: file.added,
        removed: file.removed,
        hunks: "",
      },
    );
  };

  // A trailing error can be retried. Lines the reader just made here do not count as coming
  // after it (the worker's own copy has not arrived yet), and when no earlier message is in the
  // chat the message sent from this view goes again.
  const lastRealIndex = realItems.length - 1;
  const retryTextFor = (item: ChatItem): string | null =>
    canRetry && item.kind === "error" && item.id === items[lastRealIndex]?.id
      ? (messageBefore(items, lastRealIndex) ?? lastSentRef.current)
      : null;

  return (
    <div className="run-chat" id="understanding-chat">
      <RunNowHeader run={run} now={nowFacts} />

      <div className="run-chat-timeline">
        <div
          className="run-chat-messages"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          ref={scroll.scrollRef}
          onScroll={scroll.onScroll}
        >
          {rows.length === 0 && (
            <p className="run-chat-empty">Waiting for the first update…</p>
          )}
          {rows.map((row) => {
            if (row.kind === "item") {
              const retryText = retryTextFor(row.item);
              return (
                <RunChatRow
                  key={row.item.id}
                  item={row.item}
                  now={now}
                  onOpenFile={openDiffFile}
                  onRetry={
                    retryText === null
                      ? undefined
                      : () => void send(retryText, false)
                  }
                />
              );
            }
            return (
              <details key={row.id} className="run-chat-group">
                <summary>{`${row.items.length} progress updates`}</summary>
                {row.items.map((item) => (
                  <RunChatRow
                    key={item.id}
                    item={item}
                    now={now}
                    onOpenFile={openDiffFile}
                  />
                ))}
              </details>
            );
          })}
          {showFailure && failure && (
            <div className="run-chat-system run-chat-system-error" role="alert">
              <span>{withSettingsLink(failure.message)}</span>
              {canRetry && (
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => void send(failure.text, false)}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {resolved && (
            <div className="run-chat-system" data-kind="resolved">
              <span>{resolved}</span>
            </div>
          )}
          {sending && (
            <div
              className="run-chat-typing"
              role="status"
              aria-label="The agent is replying"
            >
              <span className="run-chat-typing-dot" />
              <span className="run-chat-typing-dot" />
              <span className="run-chat-typing-dot" />
            </div>
          )}
        </div>
        {scroll.unseen && (
          <div className="run-chat-jump">
            <Button variant="secondary" size="sm" onPress={scroll.jumpToLatest}>
              Jump to latest
            </Button>
          </div>
        )}
      </div>

      <RunCheckpointBar
        status={run.status}
        pending={pending}
        conflict={conflict}
        reworkReady={pendingRework !== null}
        onAction={handleAction}
      />

      <form className="run-chat-input" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          id="input-understanding-chat"
          aria-label="Message"
          rows={1}
          placeholder={placeholderText}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isApprovalGate || pending !== null}
        />
        <button
          type="submit"
          className="run-chat-send"
          disabled={
            !isApprovalGate || !input.trim() || sending || pending !== null
          }
          aria-label="Send"
        >
          <svg className="icon icon-md" aria-hidden="true">
            <use href="/assets/icons/sprite.svg#icon-send" />
          </svg>
        </button>
      </form>

      <DiffModal
        isOpen={activeDiffFile !== null}
        file={activeDiffFile?.file || null}
        added={activeDiffFile?.added || 0}
        removed={activeDiffFile?.removed || 0}
        hunks={activeDiffFile?.hunks || ""}
        onClose={() => setActiveDiffFile(null)}
      />
    </div>
  );
}
