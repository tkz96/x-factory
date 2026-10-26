// src/frontend/components/ui/useCopyToClipboard.ts — The one clipboard write (run page plan).
//
// Copies text and reports it as copied for a short time, so a control can show
// the change and then return to its resting state. A failed write (no clipboard
// permission) leaves the control as it was.

import { useEffect, useRef, useState } from "react";

const COPIED_MS = 2000;

export function useCopyToClipboard(): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return { copied, copy };
}
