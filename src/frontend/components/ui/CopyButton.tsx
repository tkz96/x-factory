// src/frontend/components/ui/CopyButton.tsx — The icon button that copies text (run page plan).
//
// A plain icon button: the copy glyph at rest, a check and the name "Copied"
// for a moment after a copy. The change is announced, so a screen reader hears
// that the copy worked.

import { IconButton } from "./IconButton.js";
import { useCopyToClipboard } from "./useCopyToClipboard.js";

export interface CopyButtonProps {
  /** The text written to the clipboard. */
  text: string;
  /** What is copied, for the accessible name: "Copy Plan". Default "Copy". */
  label?: string;
  className?: string | undefined;
}

export function CopyButton({
  text,
  label = "Copy",
  className,
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <>
      <IconButton
        variant="plain"
        icon={copied ? "icon-check" : "icon-copy"}
        label={copied ? "Copied" : label}
        className={className}
        onPress={() => void copy(text)}
      />
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
