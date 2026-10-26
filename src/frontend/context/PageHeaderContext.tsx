// src/frontend/context/PageHeaderContext.tsx — The page heading's slot (#298,
// spec #292 "Blocks").
//
// The AppShell owns the PageHeader block, so a view never renders its own
// page heading (G7 lands in M7). A view claims the shell's heading through
// this slot instead: usePageHeader hands the title, subtitle and actions up
// while the view is mounted, and the shell draws them in the page heading
// and in the compact toolbar title. A panel header inside a page (for
// example RunChatHeader or RunInspector) is not a page header and never
// touches this slot.
//
// Two contexts keep the slot loop-free:
//   - ClaimsContext carries the claim functions and is stable for the life of
//     the shell, so a view re-renders only from its own state, never from the
//     slot it feeds.
//   - ContentContext carries what the mounted view claimed; only the shell's
//     heading readers consume it, so a claim change never re-renders the
//     claiming view again.
//
// Outside a shell — a view rendered on its own in a test — the hook is a
// no-op, so a view never needs the shell to render.

import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

/** What a view contributes to the shell's page heading. */
export interface PageHeaderContent {
  /** The screen's one h1, replacing the shell's own title while claimed. */
  title: string;
  /** The line under the title. Omitted keeps the shell's subtitle;
   *  an empty string says the screen has none. */
  subtitle?: string | undefined;
  /** The heading's trailing actions. Omitted keeps the shell's page action
   *  (Start Run, Add Project); null says the screen has none. */
  actions?: ReactNode;
}

interface PageHeaderClaim {
  /** The claiming view's useId: a cleanup releases only its own claim. */
  id: string;
  content: PageHeaderContent;
}

interface PageHeaderClaims {
  /** Publishes the view's content as the heading the shell renders. */
  claim: (claim: PageHeaderClaim) => void;
  /** Releases a claim; a stale view never clears the one that replaced it. */
  release: (id: string) => void;
}

const ClaimsContext = createContext<PageHeaderClaims | null>(null);

const ContentContext = createContext<PageHeaderContent | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [claim, setClaim] = useState<PageHeaderClaim | null>(null);
  // The claims value never changes identity after mount: the claiming view
  // consumes it, and a value change would re-render the view, re-claim, and
  // loop.
  const claims = useMemo<PageHeaderClaims>(
    () => ({
      claim: (next) => setClaim(next),
      release: (id) =>
        setClaim((current) => (current?.id === id ? null : current)),
    }),
    [],
  );

  return (
    <ClaimsContext.Provider value={claims}>
      <ContentContext.Provider value={claim?.content ?? null}>
        {children}
      </ContentContext.Provider>
    </ClaimsContext.Provider>
  );
}

/**
 * Claims the shell's page heading for the calling view while it is mounted.
 * The shell renders the content in the page heading and the compact toolbar
 * title at every width. A no-op when there is no shell around.
 */
export function usePageHeader(content: PageHeaderContent): void {
  const claims = useContext(ClaimsContext);
  const id = useId();
  // The content object is new on every render of the claiming view, so this
  // re-claims the latest copy (a title that arrives with the data, a button
  // that appears with the state) before the frame paints.
  useLayoutEffect(() => {
    claims?.claim({ id, content });
  }, [claims, id, content]);
  // The claim is released only when the view unmounts, never between the
  // re-claims above. A route change unmounts the old view after the new one
  // claims, and release() ignores a claim it does not own.
  useLayoutEffect(() => {
    if (!claims) return;
    return () => claims.release(id);
  }, [claims, id]);
}

/** What the mounted view claimed, or null when the shell's own heading stands. */
export function usePageHeaderContent(): PageHeaderContent | null {
  return useContext(ContentContext);
}
