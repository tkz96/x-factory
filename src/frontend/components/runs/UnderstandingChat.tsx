// src/frontend/components/runs/UnderstandingChat.tsx — iMessage-style chat for understanding approval gate.

import "./UnderstandingChat.css";

import { useEffect, useRef, useState } from "react";
import type { ImplementationContext, Run } from "../../../shared/types.js";
import { api } from "../../lib/api-client.js";

interface ChatMessage {
  id: string;
  role: "agent" | "user";
  text: string;
  timestamp: string;
  contextCard?: {
    title: string;
    items: string[];
  };
}

interface UnderstandingChatProps {
  run: Run;
  onApprove: () => void;
  onRestart: () => void;
  onAbort: () => void;
  isTransitioning: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildInitialMessages(run: Run): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const now = new Date().toISOString();
  const ctx: ImplementationContext | null = run.implementationContext;

  // Agent opens with analysis summary
  messages.push({
    id: "agent-intro",
    role: "agent",
    text: "I've finished analyzing the codebase for this ticket. Let me walk you through what I found — feel free to ask questions or challenge anything before we move forward.",
    timestamp: now,
  });

  if (ctx) {
    // Relevant files
    if (ctx.relevantFiles.length > 0) {
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

    // Constraints
    if (ctx.constraints.length > 0) {
      messages.push({
        id: "agent-constraints",
        role: "agent",
        text: "I also found some constraints and patterns to respect:",
        timestamp: now,
        contextCard: {
          title: "Constraints",
          items: ctx.constraints,
        },
      });
    }

    // Risks
    if (ctx.risks.length > 0) {
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

    // Architectural notes
    if (ctx.architecturalNotes) {
      messages.push({
        id: "agent-arch",
        role: "agent",
        text: ctx.architecturalNotes,
        timestamp: now,
      });
    }
  }

  // Closing question — the grill-me prompt
  messages.push({
    id: "agent-grill",
    role: "agent",
    text: "Does this analysis match your understanding? Is there anything I'm missing, any edge cases I should watch for, or any constraints I haven't accounted for?\n\nWhen you're satisfied, hit Approve to move to planning.",
    timestamp: now,
  });

  return messages;
}

export function UnderstandingChat({
  run,
  onApprove,
  onRestart,
  onAbort,
  isTransitioning,
}: UnderstandingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    buildInitialMessages(run),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await api.chatWithRun(run.id, text);
      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        text: res.message,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "agent",
        text: "Sorry, I couldn't process that message. Please try again or approve to continue.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="understanding-chat" id="understanding-chat">
      {/* Header */}
      <div className="understanding-chat-header">
        <div className="understanding-chat-header-info">
          <div className="understanding-chat-avatar">
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
          <div className="understanding-chat-meta">
            <strong>Context Synthesis</strong>
            <span>Understanding approval gate</span>
          </div>
        </div>
        <div className="understanding-chat-actions">
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={isTransitioning}
            onClick={onApprove}
          >
            {isTransitioning ? "Approving…" : "Approve & Continue"}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={isTransitioning}
            onClick={onRestart}
          >
            Restart
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm btn-danger-text"
            disabled={isTransitioning}
            onClick={onAbort}
          >
            Abort
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="understanding-chat-messages" ref={scrollRef}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`imsg-row ${msg.role === "agent" ? "imsg-agent" : "imsg-user"}`}
          >
            <div className="imsg-bubble">
              {msg.text}
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
            </div>
            <span className="imsg-timestamp">{formatTime(msg.timestamp)}</span>
          </div>
        ))}
        {sending && (
          <div className="imsg-typing">
            <span className="imsg-typing-dot" />
            <span className="imsg-typing-dot" />
            <span className="imsg-typing-dot" />
          </div>
        )}
      </div>

      {/* Input */}
      <form className="understanding-chat-input" onSubmit={handleSend}>
        <input
          id="input-understanding-chat"
          type="text"
          placeholder="Ask about the analysis, challenge assumptions…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending || isTransitioning}
        />
        <button
          type="submit"
          className="imsg-send-btn"
          disabled={!input.trim() || sending || isTransitioning}
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
    </div>
  );
}
