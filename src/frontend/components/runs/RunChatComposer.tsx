// src/frontend/components/runs/RunChatComposer.tsx — The run chat's message box: the textarea (Return
// sends, Shift-Return adds a line, Mod-Return sends), the tips tooltip, and the send button.

import { type KeyboardEvent, type RefObject, useId } from "react";
import { Tooltip, TooltipTrigger } from "../overlays/Tooltip.js";
import { IconButton } from "../ui/IconButton.js";

/** The keys the textarea responds to; its own description, so a screen reader hears them (US20, #319). */
const KEYS_HELP = "Return sends. Shift-Return adds a line.";

/** The text of the message-box info button's tooltip: the input's keys and the waiting rule. */
const TIPS_TEXT = `${KEYS_HELP} You can message the Builder while the run is waiting for you.`;

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

  const keysId = useId();

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
        aria-describedby={keysId}
        rows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inputDisabled}
      />
      <span id={keysId} className="sr-only">
        {KEYS_HELP}
      </span>
      <TooltipTrigger delay={300}>
        <IconButton
          label="Message Tips"
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
