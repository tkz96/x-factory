// src/frontend/components/runs/RunChat.tsx — Universal conversation view across all run stages.

import "./RunChat.css";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  canRunAction,
  runStatusLabel,
} from "../../../shared/run-status-policy.js";
import type { ImplementationContext, Run } from "../../../shared/types.js";
import { api } from "../../lib/api-client.js";
import {
  type ParsedDiffFile,
  parseDiffToFiles,
} from "../../lib/diff-parser.js";
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
  contextCard?: {
    title: string;
    items: string[];
  };
  actions?: ChatAction[];
  diffSummary?: DiffSummaryItem[];
}

export interface RunChatProps {
  run: Run;
  events: import("../../hooks/useRunSSE.js").CanonicalWireEvent[];
  onApprove?: () => void;
  onRestart?: () => void;
  onAbort?: () => void;
  onRequeue?: (notes?: string) => void;
  isTransitioning?: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusToSystemText(status: string, eventText?: string): string {
  if (eventText?.trim()) return eventText.trim();
  switch (status) {
    case "preparing":
      return "Preparing workspace and environment...";
    case "understanding":
      return "🔍 Analyzing codebase and requirements...";
    case "planning":
      return "🔄 Moving to planning phase...";
    case "executing":
      return "⚙️ Execution started — Ralph loop active";
    case "awaiting_understanding_approval":
      return "📋 Codebase analysis complete — review required";
    case "awaiting_plan_approval":
      return "📋 Implementation plan ready — review required";
    case "awaiting_review":
      return "🔍 Implementation finished — review changes";
    case "ready_for_pr":
      return "✅ Verification passed — ready for pull request";
    case "pr_created":
      return "🎉 Pull request created";
    case "stopped":
      return "⏹️ Run stopped by operator";
    case "failed":
      return "❌ Run execution failed";
    default:
      return `Status changed to ${status}`;
  }
}

function buildInitialMessages(run: Run): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const now = run.startedAt || new Date().toISOString();
  const ctx: ImplementationContext | null = run.implementationContext;

  // Run start greeting
  messages.push({
    id: "system-run-start",
    role: "system",
    text: `Starting run for #${run.ticket.id} — ${run.ticket.title}`,
    timestamp: now,
  });

  if (run.status === "queued" || run.status === "preparing") {
    messages.push({
      id: "agent-preparing",
      role: "agent",
      text: `I'm setting up the workspace and initializing branch factory/${run.ticket.id.toLowerCase()}. Give me a moment to prepare the environment.`,
      timestamp: now,
    });
    return messages;
  }

  if (run.status === "understanding") {
    messages.push({
      id: "agent-understanding",
      role: "agent",
      text: "I'm setting up the workspace and analyzing the codebase. I'll walk you through what I find when I'm done.",
      timestamp: now,
    });
    return messages;
  }

  if (run.status === "planning") {
    messages.push({
      id: "agent-planning",
      role: "agent",
      text: "I'm synthesizing our context analysis into a concrete implementation plan.",
      timestamp: now,
    });
    return messages;
  }

  if (run.status === "executing") {
    messages.push({
      id: "system-executing",
      role: "system",
      text: "⚙️ Execution started — Ralph loop running",
      timestamp: now,
    });
    messages.push({
      id: "agent-executing",
      role: "agent",
      text: "I'm actively implementing the changes in the worktree. I'll let you know as soon as the test suite verifies the work.",
      timestamp: now,
    });
    return messages;
  }

  if (run.status === "awaiting_plan_approval") {
    messages.push({
      id: "agent-intro-plan",
      role: "agent",
      text: "I've drafted a plan based on our context analysis. Let me know if the steps make sense or if you want to tweak the approach before I start coding.",
      timestamp: now,
    });
    if (run.plan) {
      messages.push({
        id: "agent-plan",
        role: "agent",
        text: run.plan,
        timestamp: now,
      });
    }
    messages.push({
      id: "agent-grill-plan",
      role: "agent",
      text: "Does this plan look correct? Are there any missing steps or edge cases?\n\nWhen you're satisfied, approve to move to execution.",
      timestamp: now,
      actions: [
        { label: "Approve Plan", action: "approve", variant: "primary" },
        { label: "Revise Plan", action: "restart", variant: "secondary" },
        { label: "Abort", action: "abort", variant: "danger" },
      ],
    });
    return messages;
  }

  if (run.status === "awaiting_review") {
    messages.push({
      id: "agent-intro-review",
      role: "agent",
      text: "I've finished implementing the changes and test verification passed. Let's review the changes before opening a pull request.",
      timestamp: now,
    });

    const parsedDiff = parseDiffToFiles(run.diff);
    if (parsedDiff.length > 0) {
      messages.push({
        id: "agent-diff-summary",
        role: "agent",
        text: `Here is a summary of ${parsedDiff.length} modified file${parsedDiff.length === 1 ? "" : "s"}. Click any file to view line-by-line diffs:`,
        timestamp: now,
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
      timestamp: now,
      actions: [
        { label: "Approve → PR", action: "approve", variant: "primary" },
        { label: "Request Rework", action: "requeue", variant: "secondary" },
      ],
    });
    return messages;
  }

  // Default: understanding approval gate messages
  messages.push({
    id: "agent-intro",
    role: "agent",
    text: "I've finished analyzing the codebase for this ticket. Let me walk you through what I found — feel free to ask questions or challenge anything before we move forward.",
    timestamp: now,
  });

  if (ctx) {
    if (ctx.relevantFiles && ctx.relevantFiles.length > 0) {
      messages.push({
        id: "agent-files",
        role: "agent",
        text: `I identified ${ctx.relevantFiles.length} relevant file${ctx.relevantFiles.length === 1 ? "" : "s"} that will likely need changes:`,
        timestamp: now,
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
          timestamp: now,
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
        timestamp: now,
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
        timestamp: now,
      });
    }
  }

  messages.push({
    id: "agent-grill",
    role: "agent",
    text: "Does this analysis match your understanding? Is there anything I'm missing, any edge cases I should watch for, or any constraints I haven't accounted for?\n\nWhen you're satisfied, approve to move to planning.",
    timestamp: now,
    actions: [
      { label: "Approve & Continue", action: "approve", variant: "primary" },
      { label: "Restart Analysis", action: "restart", variant: "secondary" },
      { label: "Abort", action: "abort", variant: "danger" },
    ],
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
  const [initialMessages, setInitialMessages] = useState<ChatMessage[]>(() =>
    buildInitialMessages(run),
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

  // Update initial messages when run status advances
  const lastStatusRef = useRef(run.status);
  useEffect(() => {
    if (lastStatusRef.current !== run.status) {
      lastStatusRef.current = run.status;
      setInitialMessages(buildInitialMessages(run));
      setHasStartedChat(false);
      setReworkPromptActive(false);
    }
  }, [run]);

  // The server only accepts chat during approval gates; the shared policy
  // gates the input on the same action guard.
  const isApprovalGate = canRunAction(run.status, "chat");

  // Filter events for chat: conversation (chat_user, chat_agent) and status transitions
  const historyMessages: ChatMessage[] = events
    .filter(
      (e) =>
        e.type === "chat_user" ||
        e.type === "chat_agent" ||
        e.type === "status",
    )
    .map((e) => {
      if (e.type === "status") {
        const payload = e.payload as
          | { status?: string; text?: string }
          | null
          | undefined;
        return {
          id: `status-${e.id}`,
          role: "system" as const,
          text: statusToSystemText(payload?.status || "", payload?.text),
          timestamp: e.timestamp,
        };
      }
      const payload = e.payload as { text?: string } | null | undefined;
      return {
        id: String(e.id),
        role: (e.type === "chat_user" ? "user" : "agent") as "user" | "agent",
        text: payload?.text || "",
        timestamp: e.timestamp,
      };
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
        [msgId]: actionItem.label.includes("PR")
          ? "Implementation approved → PR"
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

  const getPlaceholderText = () => {
    if (reworkPromptActive) {
      return "Describe the changes needed before replanning…";
    }
    if (run.status === "awaiting_understanding_approval") {
      return "Ask about the analysis, challenge assumptions…";
    }
    if (run.status === "awaiting_plan_approval") {
      return "Ask about the plan, challenge steps…";
    }
    if (run.status === "awaiting_review") {
      return "Ask about modified files or request rework…";
    }
    if (run.status === "executing") {
      return "Waiting for agent to finish executing changes…";
    }
    if (run.status === "planning") {
      return "Waiting for agent to finish drafting plan…";
    }
    if (run.status === "understanding") {
      return "Waiting for agent to finish codebase analysis…";
    }

    if (run.status === "pr_created" || run.status === "ready_for_pr") {
      return "Pull request stage reached.";
    }
    if (run.status === "stopped" || run.status === "failed") {
      return "Run execution ended.";
    }
    return `Waiting for agent (${run.status})…`;
  };

  const getHeaderTitle = () => {
    if (run.status === "awaiting_plan_approval") return "Plan Review";
    if (run.status === "awaiting_understanding_approval")
      return "Context Synthesis";
    if (run.status === "awaiting_review") return "Implementation Review";
    if (run.status === "executing") return "Implementation Execution";
    if (run.status === "planning") return "Plan Drafting";
    if (run.status === "understanding") return "Codebase Understanding";

    return "Agent Workspace";
  };

  const getHeaderSubtitle = () => {
    if (isApprovalGate) return "Approval gate · input active";
    return `Phase: ${runStatusLabel(run.status)}`;
  };

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
            <strong>{getHeaderTitle()}</strong>
            <span>{getHeaderSubtitle()}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="run-chat-messages" ref={scrollRef}>
        {finalMessages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div key={msg.id} className="imsg-system-divider">
                <div className="imsg-system-line" />
                <div className="imsg-system-pill">
                  <span>{msg.text}</span>
                  <span className="imsg-system-time">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div className="imsg-system-line" />
              </div>
            );
          }

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
                {msg.actions && msg.actions.length > 0 && (
                  <div className="imsg-actions">
                    {resolvedActions[msg.id] ? (
                      <div className="imsg-action-resolved">
                        <span className="imsg-action-resolved-check">✓</span>
                        <span>{resolvedActions[msg.id]}</span>
                      </div>
                    ) : (
                      msg.actions.map((act) => (
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
                {formatTime(msg.timestamp)}
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
          placeholder={getPlaceholderText()}
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
