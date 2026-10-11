// src/frontend/components/runs/RunChat.tsx — Universal conversation view across all run stages.

import "./RunChat.css";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  canRunAction,
  type RunAction,
  STATUS_TO_STAGE,
  UNSUCCESSFUL_TERMINAL_RUN_STATUSES,
} from "../../../shared/run-status-policy.js";
import type {
  ImplementationContext,
  Run,
  RunEvent,
  RunStatus,
} from "../../../shared/types.js";
import { api } from "../../lib/api-client.js";
import {
  type ParsedDiffFile,
  parseDiffToFiles,
} from "../../lib/diff-parser.js";
import { formatTimestamp } from "../../lib/format-timestamp.js";
import { runStatusText, runStatusUi } from "../../lib/run-status-ui.js";
import { DiffModal } from "./DiffModal.js";

export interface ChatAction {
  label: string;
  action:
    | "approve"
    | "restart"
    | "abort"
    | "requeue"
    | "confirm_rework"
    | string;
  variant: "primary" | "secondary" | "danger";
  notes?: string;
}

export interface DiffSummaryItem {
  file: string;
  added: number;
  removed: number;
}

export interface ChatMessage {
  id: string;
  role: "agent" | "user" | "system";
  text: string;
  timestamp: string;
  /** A system line shown as a warning (e.g. a run without a sandbox, #275). */
  warning?: boolean | undefined;
  contextCard?: {
    title: string;
    items: string[];
  };
  actions?: ChatAction[];
  diffSummary?: DiffSummaryItem[];
}

export interface RunChatProps {
  run: Run;
  events: RunEvent[];
  onApprove?: () => void;
  onRestart?: () => void;
  onAbort?: () => void;
  onRequeue?: (notes?: string) => void;
  isTransitioning?: boolean;
}

/**
 * The status's chat buttons: the one map's labels (#253) wired to the actions
 * this view knows how to send. Actions with no handler here (chat, deliver,
 * resume, abandon) keep their own controls elsewhere on the page.
 */
const CHAT_ACTION_HANDLERS: Partial<
  Record<
    RunAction,
    { action: ChatAction["action"]; variant: ChatAction["variant"] }
  >
> = {
  approve: { action: "approve", variant: "primary" },
  requeue: { action: "requeue", variant: "secondary" },
  restart: { action: "restart", variant: "secondary" },
  stop: { action: "abort", variant: "danger" },
};

function chatActionsFor(status: RunStatus): ChatAction[] {
  return runStatusUi(status).actions.flatMap(({ action, label }) => {
    const handler = CHAT_ACTION_HANDLERS[action];
    return handler && label ? [{ label, ...handler }] : [];
  });
}

/** What the run is doing, in plain words — never a raw status string (#253). */
function statusToSystemText(status: string, eventText?: string): string {
  if (eventText?.trim()) return eventText.trim();
  switch (status) {
    case "queued":
      return "⏳ Waiting to start";
    case "preparing":
      return "Preparing the workspace and environment…";
    case "understanding":
      return "🔍 Reading the ticket…";
    case "planning":
      return "🔄 Planning the changes…";
    case "executing":
      return "⚙️ Writing the code…";
    case "awaiting_understanding_approval":
      return "📋 Finished reading the ticket — your turn";
    case "awaiting_plan_approval":
      return "📋 The plan is ready — your turn";
    case "awaiting_review":
      return "🔍 The changes are ready to review";
    case "ready_for_pr":
      return "✅ Verified — ready for a pull request";
    case "pr_created":
      return "🎉 Pull request opened";
    case "recovery_required":
      return "⚠️ The run stopped and needs recovery";
    case "stopped":
      return "⏹️ Run stopped";
    case "failed":
      return "❌ Run failed";
    default:
      return runStatusText(status as RunStatus);
  }
}

/**
 * The time of the message that describes the run's current state (#242): the
 * event that moved the run into its status, not the run's start time.
 */
function stateTimestamp(run: Run, events: readonly RunEvent[]): string {
  const transition = [...events]
    .reverse()
    .find((e) => e.type === "status" && e.payload.status === run.status);
  if (transition) return transition.timestamp;
  return run.updatedAt || run.startedAt || new Date().toISOString();
}

function buildInitialMessages(
  run: Run,
  events: readonly RunEvent[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // The greeting is about the start, so it keeps the run's own start time.
  const runStart = run.startedAt || run.updatedAt || new Date().toISOString();
  const at = stateTimestamp(run, events);
  const ctx: ImplementationContext | null = run.implementationContext;

  // Run start greeting
  messages.push({
    id: "system-run-start",
    role: "system",
    text: `Starting run for #${run.ticket.id} — ${run.ticket.title}`,
    timestamp: runStart,
  });

  if (STATUS_TO_STAGE[run.status] === "prepare") {
    messages.push({
      id: "agent-preparing",
      role: "agent",
      text: "I'm setting up the workspace and creating this run's branch. Give me a moment to prepare the environment.",
      timestamp: at,
    });
    return messages;
  }

  if (run.status === "understanding") {
    messages.push({
      id: "agent-understanding",
      role: "agent",
      text: "I'm setting up the workspace and analyzing the codebase. I'll walk you through what I find when I'm done.",
      timestamp: at,
    });
    return messages;
  }

  if (run.status === "planning") {
    messages.push({
      id: "agent-planning",
      role: "agent",
      text: "I'm synthesizing our context analysis into a concrete implementation plan.",
      timestamp: at,
    });
    return messages;
  }

  if (run.status === "executing") {
    messages.push({
      id: "system-executing",
      role: "system",
      text: statusToSystemText("executing"),
      timestamp: at,
    });
    messages.push({
      id: "agent-executing",
      role: "agent",
      text: "I'm actively implementing the changes in the worktree. I'll let you know as soon as the test suite verifies the work.",
      timestamp: at,
    });
    return messages;
  }

  if (run.status === "awaiting_plan_approval") {
    messages.push({
      id: "agent-intro-plan",
      role: "agent",
      text: "I've drafted a plan based on our context analysis. Let me know if the steps make sense or if you want to tweak the approach before I start coding.",
      timestamp: at,
    });
    if (run.plan) {
      messages.push({
        id: "agent-plan",
        role: "agent",
        text: run.plan,
        timestamp: at,
      });
    }
    messages.push({
      id: "agent-grill-plan",
      role: "agent",
      text: "Does this plan look correct? Are there any missing steps or edge cases?\n\nWhen you're satisfied, approve to move to execution.",
      timestamp: at,
      actions: chatActionsFor(run.status),
    });
    return messages;
  }

  if (run.status === "awaiting_review") {
    messages.push({
      id: "agent-intro-review",
      role: "agent",
      text: "I've finished implementing the changes and test verification passed. Let's review the changes before opening a pull request.",
      timestamp: at,
    });

    const parsedDiff = parseDiffToFiles(run.diff);
    if (parsedDiff.length > 0) {
      messages.push({
        id: "agent-diff-summary",
        role: "agent",
        text: `Here is a summary of ${parsedDiff.length} modified file${parsedDiff.length === 1 ? "" : "s"}. Click any file to view line-by-line diffs:`,
        timestamp: at,
        diffSummary: parsedDiff.map((f) => ({
          file: f.file,
          added: f.added,
          removed: f.removed,
        })),
      });
    }

    messages.push({
      id: "agent-review-actions",
      role: "agent",
      text: "Does the implementation look ready to open a pull request, or does anything need rework?",
      timestamp: at,
      actions: chatActionsFor(run.status),
    });
    return messages;
  }

  if (run.status === "ready_for_pr") {
    messages.push({
      id: "agent-ready-for-pr",
      role: "agent",
      text: "Verification passed and the changes are approved. The pull request is ready to be opened.",
      timestamp: at,
    });
    return messages;
  }

  if (run.status === "pr_created") {
    messages.push({
      id: "agent-pr-created",
      role: "agent",
      text: "The pull request has been created. This run is complete.",
      timestamp: at,
    });
    return messages;
  }

  if (UNSUCCESSFUL_TERMINAL_RUN_STATUSES.has(run.status)) {
    messages.push({
      id: "agent-run-ended",
      role: "agent",
      text:
        run.status === "failed"
          ? "This run failed and can't continue."
          : "This run was stopped and can't continue.",
      timestamp: at,
    });
    return messages;
  }

  if (run.status !== "awaiting_understanding_approval") {
    // recovery_required and any other status with no approval action: say what
    // the run is doing and offer nothing to approve (#242).
    messages.push({
      id: "agent-waiting",
      role: "agent",
      text:
        run.status === "recovery_required"
          ? "This run stopped before it finished and needs you. Resume it to carry on, or abandon it."
          : `This run is ${runStatusText(run.status)}.`,
      timestamp: at,
    });
    return messages;
  }

  // Understanding approval gate messages
  messages.push({
    id: "agent-intro",
    role: "agent",
    text: "I've finished analyzing the codebase for this ticket. Let me walk you through what I found — feel free to ask questions or challenge anything before we move forward.",
    timestamp: at,
  });

  if (ctx) {
    if (ctx.relevantFiles && ctx.relevantFiles.length > 0) {
      messages.push({
        id: "agent-files",
        role: "agent",
        text: `I identified ${ctx.relevantFiles.length} relevant file${ctx.relevantFiles.length === 1 ? "" : "s"} that will likely need changes:`,
        timestamp: at,
        contextCard: {
          title: "Relevant Files",
          items: ctx.relevantFiles.slice(0, 12),
        },
      });
    }

    if (ctx.constraints && ctx.constraints.length > 0) {
      const filteredConstraints = ctx.constraints.filter((c) => {
        if (!c?.trim()) return false;
        const trimmed = c.trim();
        if (/^Criterion:\s*[-–—]?\s*$/.test(trimmed)) return false;
        if (/^Test command must pass:\s*["']\s*["']$/.test(trimmed))
          return false;
        if (/^Typecheck command must pass:\s*["']\s*["']$/.test(trimmed))
          return false;
        if (/^Lint command must pass:\s*["']\s*["']$/.test(trimmed))
          return false;
        return true;
      });

      if (filteredConstraints.length > 0) {
        messages.push({
          id: "agent-constraints",
          role: "agent",
          text: "I also found some constraints and patterns to respect:",
          timestamp: at,
          contextCard: {
            title: "Constraints",
            items: filteredConstraints,
          },
        });
      }
    }

    if (ctx.risks && ctx.risks.length > 0) {
      messages.push({
        id: "agent-risks",
        role: "agent",
        text: "A few risks I want to flag:",
        timestamp: at,
        contextCard: {
          title: "Risks",
          items: ctx.risks,
        },
      });
    }

    if (ctx.architecturalNotes) {
      messages.push({
        id: "agent-arch",
        role: "agent",
        text: ctx.architecturalNotes,
        timestamp: at,
      });
    }
  }

  messages.push({
    id: "agent-grill",
    role: "agent",
    text: "Does this analysis match your understanding? Is there anything I'm missing, any edge cases I should watch for, or any constraints I haven't accounted for?\n\nWhen you're satisfied, approve to move to planning.",
    timestamp: at,
    actions: chatActionsFor(run.status),
  });

  return messages;
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
  // A status's screens are pure functions of the run and its events (#242):
  // nothing here is stored, so the times always match the events they came from.
  const initialMessages = useMemo(
    () => buildInitialMessages(run, events),
    [run, events],
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hasStartedChat, setHasStartedChat] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>(
    [],
  );
  const [resolvedActions, setResolvedActions] = useState<
    Record<string, string>
  >({});
  const [activeDiffFile, setActiveDiffFile] = useState<ParsedDiffFile | null>(
    null,
  );
  const [reworkPromptActive, setReworkPromptActive] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsedDiffFiles = useMemo(() => parseDiffToFiles(run.diff), [run.diff]);

  // A new status starts the chat over: fresh gate banner, fresh rework prompt.
  const lastStatusRef = useRef(run.status);
  useEffect(() => {
    if (lastStatusRef.current !== run.status) {
      lastStatusRef.current = run.status;
      setHasStartedChat(false);
      setReworkPromptActive(false);
    }
  }, [run.status]);

  // The server only accepts chat during approval gates; the shared policy
  // gates the input on the same action guard.
  const isApprovalGate = canRunAction(run.status, "chat");
  const canApprove = canRunAction(run.status, "approve");

  // Conversation turns and status transitions, read straight from the typed event union.
  const historyMessages: ChatMessage[] = events.flatMap((e): ChatMessage[] => {
    switch (e.type) {
      case "status":
        return [
          {
            id: `status-${e.id}`,
            role: "system",
            text: statusToSystemText(e.payload.status, e.payload.text),
            timestamp: e.timestamp,
          },
        ];
      case "chat_user":
      case "chat_agent":
        return [
          {
            id: String(e.id),
            role: e.type === "chat_user" ? "user" : "agent",
            text: e.payload.text,
            timestamp: e.timestamp,
          },
        ];
      case "info":
        if (e.payload.warning === "unsandboxed") {
          return [
            {
              id: `info-${e.id}`,
              role: "system",
              text: e.payload.text,
              warning: true,
              timestamp: e.timestamp,
            },
          ];
        }
        return [];
      default:
        return [];
    }
  });

  // Combine static intro + db history + optimistic
  const combinedMessages = [...initialMessages, ...historyMessages];
  const historyTexts = new Set(historyMessages.map((m) => m.text));
  const finalMessages = [
    ...combinedMessages,
    ...optimisticMessages.filter((m) => !historyTexts.has(m.text)),
  ];

  // Auto-scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [finalMessages.length]);

  const handleActionClick = (msgId: string, actionItem: ChatAction) => {
    if (actionItem.action === "approve") {
      setResolvedActions((prev) => ({
        ...prev,
        [msgId]:
          run.status === "awaiting_review"
            ? "Changes approved — opening a pull request"
            : "Approved",
      }));
      onApprove?.();
    } else if (actionItem.action === "restart") {
      setResolvedActions((prev) => ({
        ...prev,
        [msgId]: "Restart requested",
      }));
      onRestart?.();
    } else if (actionItem.action === "abort") {
      setResolvedActions((prev) => ({
        ...prev,
        [msgId]: "Aborted",
      }));
      onAbort?.();
    } else if (actionItem.action === "requeue") {
      setReworkPromptActive(true);
      const reworkMsg: ChatMessage = {
        id: `agent-rework-ask-${Date.now()}`,
        role: "agent",
        text: "What specifically needs to change? Type your notes below and submit to confirm rework.",
        timestamp: new Date().toISOString(),
      };
      setOptimisticMessages((prev) => [...prev, reworkMsg]);
      setHasStartedChat(true);
      setTimeout(() => {
        inputRef.current?.focus();
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 50);
    } else if (actionItem.action === "confirm_rework") {
      setResolvedActions((prev) => ({
        ...prev,
        [msgId]: "Rework confirmed",
      }));
      onRequeue?.(actionItem.notes);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || !isApprovalGate) return;

    setHasStartedChat(true);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setOptimisticMessages((prev) => [...prev, userMsg]);
    setInput("");

    // If rework prompt was active, offer confirmation button
    if (reworkPromptActive) {
      setReworkPromptActive(false);
      const confirmMsg: ChatMessage = {
        id: `agent-confirm-rework-${Date.now()}`,
        role: "agent",
        text: `I've noted your rework feedback:\n\n"${text}"\n\nReady to send this run back to planning?`,
        timestamp: new Date().toISOString(),
        actions: [
          {
            label: "Confirm Rework",
            action: "confirm_rework",
            variant: "primary",
            notes: text,
          },
        ],
      };
      setOptimisticMessages((prev) => [...prev, confirmMsg]);
      return;
    }

    setSending(true);
    try {
      await api.chatWithRun(run.id, text);
    } catch {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "agent",
        text: "Sorry, I couldn't process that message. Please try again or approve to continue.",
        timestamp: new Date().toISOString(),
      };
      setOptimisticMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  // One map owns the chat's words for every status (#253): placeholder, header
  // title and subtitle all come from `run-status-ui`, never a local cascade.
  const ui = runStatusUi(run.status);

  const placeholderText = reworkPromptActive
    ? "Describe the changes needed before replanning…"
    : ui.placeholder;

  // Say what the run is doing, and say when the reader can reply (#253).
  const headerSubtitle = isApprovalGate
    ? `${ui.now} · you can reply below`
    : ui.now;

  return (
    <div className="run-chat" id="understanding-chat">
      {/* Header — Clean, title and status only */}
      <div className="run-chat-header" id="understanding-chat-header">
        <div className="run-chat-header-info">
          <div className="run-chat-avatar">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5Z" />
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            </svg>
          </div>
          <div className="run-chat-meta">
            <strong>{ui.header}</strong>
            <span>{headerSubtitle}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="run-chat-messages" ref={scrollRef}>
        {finalMessages.map((msg) => {
          if (msg.role === "system") {
            const isWarning = msg.warning === true;
            return (
              <div
                key={msg.id}
                className={`imsg-system-divider ${isWarning ? "imsg-system-divider-warning" : ""}`}
              >
                <div className="imsg-system-line" />
                <div
                  className={`imsg-system-pill ${isWarning ? "imsg-system-pill-warning" : ""}`}
                >
                  <span>{msg.text}</span>
                  <span className="imsg-system-time">
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>
                <div className="imsg-system-line" />
              </div>
            );
          }

          // Never offer an approval the shared policy doesn't allow on this status.
          const actions = msg.actions?.filter(
            (act) => act.action !== "approve" || canApprove,
          );

          return (
            <div
              key={msg.id}
              className={`imsg-row ${msg.role === "agent" ? "imsg-agent" : "imsg-user"}`}
            >
              <div className="imsg-bubble">
                {msg.text}

                {/* Context Card */}
                {msg.contextCard && (
                  <div className="imsg-context-card">
                    <h5>{msg.contextCard.title}</h5>
                    <ul>
                      {msg.contextCard.items.map((item) => (
                        <li key={item}>
                          <code>{item}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Diff Summary File List */}
                {msg.diffSummary && msg.diffSummary.length > 0 && (
                  <div className="imsg-diff-summary">
                    {msg.diffSummary.map((item) => (
                      <button
                        key={item.file}
                        type="button"
                        className="diff-file-row"
                        onClick={() => {
                          const found = parsedDiffFiles.find(
                            (f) => f.file === item.file,
                          );
                          setActiveDiffFile(
                            found || {
                              file: item.file,
                              added: item.added,
                              removed: item.removed,
                              hunks: "",
                            },
                          );
                        }}
                      >
                        <div className="diff-file-info">
                          <span className="diff-file-icon">📄</span>
                          <span className="diff-file-name">{item.file}</span>
                        </div>
                        <div className="diff-file-stats">
                          <span className="diff-file-add">{`+${item.added}`}</span>
                          <span className="diff-file-remove">{`−${item.removed}`}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Inline Actions */}
                {actions && actions.length > 0 && (
                  <div className="imsg-actions">
                    {resolvedActions[msg.id] ? (
                      <div className="imsg-action-resolved">
                        <span className="imsg-action-resolved-check">✓</span>
                        <span>{resolvedActions[msg.id]}</span>
                      </div>
                    ) : (
                      actions.map((act) => (
                        <button
                          key={act.action}
                          type="button"
                          className={`imsg-action-btn imsg-action-${act.variant}`}
                          disabled={isTransitioning}
                          onClick={() => handleActionClick(msg.id, act)}
                        >
                          {act.label}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <span className="imsg-timestamp">
                {formatTimestamp(msg.timestamp)}
              </span>
            </div>
          );
        })}
        {sending && (
          <div className="imsg-typing">
            <span className="imsg-typing-dot" />
            <span className="imsg-typing-dot" />
            <span className="imsg-typing-dot" />
          </div>
        )}
      </div>

      {/* Breathing room "Start Chat" banner when gate first arrives */}
      {isApprovalGate && !hasStartedChat && (
        <div className="runchat-gate-banner" id="runchat-gate-banner">
          <div className="runchat-gate-text">
            <strong>Stage ready for review</strong>
            <span>
              Take your time to review. When ready, click Start Chat to drill
              in.
            </span>
          </div>
          <button
            type="button"
            id="btn-start-chat"
            className="btn-primary btn-sm"
            onClick={() => {
              setHasStartedChat(true);
              setTimeout(() => {
                inputRef.current?.focus();
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }, 50);
            }}
          >
            Start Chat
          </button>
        </div>
      )}

      {/* Chat Input */}
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
          className="imsg-send-btn"
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

      {/* Diff Modal */}
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
