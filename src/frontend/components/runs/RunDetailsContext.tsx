// src/frontend/components/runs/RunDetailsContext.tsx — "Show in Run details" for the timeline.
//
// The timeline names a result in one line (3 files changed, Review passed); the
// Run details pane holds the full list. A line asks this context to bring its
// section into view: on a wide screen it scrolls the pane, at phone width it
// opens the details sheet first. Without a provider a line stays plain text.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { scrollBehavior } from "../../hooks/scroll-behavior.js";

/** The Run details sections a timeline line can point at, by heading id. */
const SECTION_HEADINGS = {
  files: "run-inspector-files",
  evidence: "run-inspector-evidence",
} as const;

export type RunDetailsSection = keyof typeof SECTION_HEADINGS;

interface RunDetailsContextValue {
  showDetails: (section: RunDetailsSection) => void;
  /** The details sheet at phone width. */
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
}

const RunDetailsContext = createContext<RunDetailsContextValue | null>(null);

function reveal(section: RunDetailsSection): boolean {
  const heading = document.getElementById(SECTION_HEADINGS[section]);
  if (!heading) return false;
  heading.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
  return true;
}

export function RunDetailsProvider({
  isPhone,
  children,
}: {
  isPhone: boolean;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState<RunDetailsSection | null>(null);
  /** The control that asked for the sheet, remembered while it is open (US20, #319). */
  const openerRef = useRef<HTMLElement | null>(null);

  // At phone width the section exists only once the sheet has rendered.
  useEffect(() => {
    if (pending && reveal(pending)) setPending(null);
  }, [pending]);

  // Closing the sheet hands focus back to the control that opened it.
  useEffect(() => {
    if (sheetOpen) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [sheetOpen]);

  // Opened from a press: the active element is that press's control, captured
  // before any effect moves focus into the sheet. Closing leaves the opener for
  // the restore effect above to hand focus back.
  const openSheet = useCallback((open: boolean) => {
    if (open && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    setSheetOpen(open);
  }, []);

  const showDetails = useCallback(
    (section: RunDetailsSection) => {
      if (isPhone) {
        openSheet(true);
        setPending(section);
      } else {
        reveal(section);
      }
    },
    [isPhone, openSheet],
  );

  const value = useMemo(
    () => ({ showDetails, sheetOpen, setSheetOpen: openSheet }),
    [showDetails, sheetOpen, openSheet],
  );
  return (
    <RunDetailsContext.Provider value={value}>
      {children}
    </RunDetailsContext.Provider>
  );
}

/** The provider's action, or undefined outside a run page. */
export function useShowDetails():
  | ((section: RunDetailsSection) => void)
  | undefined {
  return useContext(RunDetailsContext)?.showDetails;
}

/** The phone sheet's open state, shared with the lines that open it. */
export function useDetailsSheet(): {
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
} {
  const context = useContext(RunDetailsContext);
  const [localOpen, setLocalOpen] = useState(false);
  return context ?? { sheetOpen: localOpen, setSheetOpen: setLocalOpen };
}
