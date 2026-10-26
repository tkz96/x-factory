// src/frontend/components/runs/RunChatComposer.tsx — The run chat's message box: the textarea (Return
// sends, Shift-Return adds a line, Mod-Return sends), the tips tooltip, and the send button.

import type { KeyboardEvent, RefObject } from "react";
import { Tooltip, TooltipTrigger } from "../overlays/Tooltip.js";
import { IconButton } from "../ui/IconButton.js";

/** The text of the message-box info button's tooltip: the input's keys and the waiting rule. */
const TIPS_TEXT =
  "Return sends. Shift-Return adds a line. You can message the Builder while the run is waiting for you.";

interface RunChatComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  /** Sends the message (from the form submit or from the keyboard). */
  onSend: () => void;
  placeholder: string;
  inputDisabled: boolean;
  sendDisabled: boolean;
}

export function RunChatComposer({
  inputRef,
  value,
  onChange,
  onSend,
  placeholder,
  inputDisabled,
  sendDisabled,
}: RunChatComposerProps) {
  // Return and Mod-Enter send; Shift-Return is a new line.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const withMod = e.metaKey || e.ctrlKey;
    if (e.shiftKey && !withMod) return;
    e.preventDefault();
    onSend();
  };

  return (
    <form
      className="run-chat-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <textarea
        ref={inputRef}
        className="text-body"
        id="input-understanding-chat"
        aria-label="Message"
        rows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inputDisabled}
      />
      <TooltipTrigger delay={300}>
        <IconButton
          label="Message tips"
          icon="icon-info"
          variant="plain"
          className="run-chat-tips"
        />
        <Tooltip placement="top" className="run-chat-tips-tooltip">
          {TIPS_TEXT}
        </Tooltip>
      </TooltipTrigger>
      <IconButton
        type="submit"
        className="run-chat-send"
        label="Send"
        icon="icon-send"
        isDisabled={sendDisabled}
      />
    </form>
  );
}
