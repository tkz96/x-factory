// src/frontend/components/runs/RunChat.tsx — The run chat: real run events, one clock, one status map (#261).

import "./RunChat.css";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DiffFileSummary } from "../../../shared/diff-summary.js";
import {
  canRunAction,
  type RunAction,
} from "../../../shared/run-status-policy.js";
import type { Run, RunEvent, RunStatus } from "../../../shared/types.js";
import { api } from "../../lib/api-client.js";
import {
  type ParsedDiffFile,
  parseDiffToFiles,
} from "../../lib/diff-parser.js";
import {
  type ChatItem,
  mapEventsToChatItems,
} from "../../lib/run-chat-items.js";
import { runStatusUi } from "../../lib/run-status-ui.js";
import { Button } from "../ui/Button.js";
import { DiffModal } from "./DiffModal.js";
import { RunChatRow, useNow } from "./RunChatItem.js";

export interface RunChatProps {
  run: Run;
  events: RunEvent[];
  onApprove?: () => void;
  onRestart?: () => void;
  onAbort?: () => void;
  onRequeue?: (notes?: string) => void;
  isTransitioning?: boolean;
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

type ChatActionKind =
  | "approve"
  | "requeue"
  | "restart"
  | "abort"
  | "confirm_rework";

/** The chat's buttons for a status: labels from the one status map, actions the policy allows. */
const CHAT_ACTION_KINDS: Partial<
  Record<
    RunAction,
    { action: ChatActionKind; variant: "primary" | "secondary" | "danger" }
  >
> = {
  approve: { action: "approve", variant: "primary" },
  requeue: { action: "requeue", variant: "secondary" },
  restart: { action: "restart", variant: "secondary" },
  stop: { action: "abort", variant: "danger" },
};

function gateActionsFor(status: RunStatus): Array<{
  label: string;
  action: ChatActionKind;
  variant: "primary" | "secondary" | "danger";
}> {
  return runStatusUi(status).actions.flatMap(({ action, label }) => {
    const kind = CHAT_ACTION_KINDS[action];
    return kind && label ? [{ label, ...kind }] : [];
  });
}

/** The line the chat shows once a button has been pressed, before the run moves on. */
function resolvedTextFor(
  action: ChatActionKind,
  status: RunStatus,
): string | null {
  switch (action) {
    case "approve":
      return status === "awaiting_review"
        ? "Changes approved — opening a pull request"
        : "Approved";
    case "restart":
      return "Changes requested";
    case "abort":
      return "Stopped";
    case "confirm_rework":
      return "Rework confirmed";
    case "requeue":
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

export function RunChat({
  run,
  events,
  onApprove,
  onRestart,
  onAbort,
  onRequeue,
  isTransitioning,
}: RunChatProps) {
  const now = useNow();
  const realItems = useMemo(() => mapEventsToChatItems(events), [events]);

  // Lines the reader made in this view, before the worker's own events arrive.
  const [localItems, setLocalItems] = useState<ChatItem[]>([]);
  const localCount = useRef(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [reworkPrompt, setReworkPrompt] = useState(false);
  const [pendingRework, setPendingRework] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [activeDiffFile, setActiveDiffFile] = useState<ParsedDiffFile | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

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
  const canApprove = canRunAction(run.status, "approve");

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

  const handleAction = (action: ChatActionKind) => {
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
    if (action === "approve") onApprove?.();
    else if (action === "restart") onRestart?.();
    else if (action === "abort") onAbort?.();
    else if (action === "confirm_rework") {
      onRequeue?.(pendingRework ?? undefined);
      setPendingRework(null);
    }
    setResolved(resolvedTextFor(action, run.status));
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || !isApprovalGate) return;
    setInput("");
    addLocal((id, at) => ({ id, at, kind: "message", role: "user", text }));

    if (reworkPrompt) {
      setReworkPrompt(false);
      setPendingRework(text);
      return;
    }

    setSending(true);
    try {
      await api.chatWithRun(run.id, text);
    } catch {
      addLocal((id, at) => ({
        id,
        at,
        kind: "error",
        text: "Couldn't reach the model. Check Settings › Models.",
      }));
    } finally {
      setSending(false);
    }
  };

  const ui = runStatusUi(run.status);
  const placeholderText = reworkPrompt
    ? "Describe the changes needed before replanning…"
    : ui.placeholder;
  const headerSubtitle = isApprovalGate
    ? `${ui.now} · you can reply below`
    : ui.now;

  const gateActions = gateActionsFor(run.status).filter(
    (a) => a.action !== "approve" || canApprove,
  );

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

  return (
    <div className="run-chat" id="understanding-chat">
      <div className="run-chat-header">
        <div className="run-chat-meta">
          <strong>{ui.header}</strong>
          <span>{headerSubtitle}</span>
        </div>
      </div>

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
          {rows.map((row) =>
            row.kind === "item" ? (
              <RunChatRow
                key={row.item.id}
                item={row.item}
                now={now}
                onOpenFile={openDiffFile}
              />
            ) : (
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
            ),
          )}
          {resolved && (
            <div className="run-chat-system" data-kind="resolved">
              <span>{resolved}</span>
            </div>
          )}
          {!resolved && (pendingRework || gateActions.length > 0) && (
            <section className="run-chat-gate" aria-label="Next step">
              {pendingRework ? (
                <Button
                  variant="primary"
                  size="sm"
                  isDisabled={Boolean(isTransitioning)}
                  onPress={() => handleAction("confirm_rework")}
                >
                  Confirm Rework
                </Button>
              ) : (
                gateActions.map((act) => (
                  <Button
                    key={act.action}
                    variant={act.variant}
                    size="sm"
                    isDisabled={Boolean(isTransitioning)}
                    onPress={() => handleAction(act.action)}
                  >
                    {act.label}
                  </Button>
                ))
              )}
            </section>
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

      <form className="run-chat-input" onSubmit={handleSend}>
        <input
          ref={inputRef}
          id="input-understanding-chat"
          type="text"
          placeholder={placeholderText}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!isApprovalGate || sending || isTransitioning}
        />
        <button
          type="submit"
          className="run-chat-send"
          disabled={
            !isApprovalGate || !input.trim() || sending || isTransitioning
          }
          aria-label="Send message"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22 11 13 2 9l20-7Z" />
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
