// src/frontend/components/ui/PageHeader.tsx — The page heading block (#298,
// spec #292 "Blocks").
//
// AppShell owns this block: it renders exactly one PageHeader per screen,
// carrying the screen's single h1, its subtitle and the trailing action
// slot. A view never renders it — a view claims the content through
// usePageHeader (src/frontend/context/PageHeaderContext.tsx). Panel headers
// inside a page (RunChatHeader, RunInspector) are not page headers and are
// built from text styles and tokens instead.

import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The screen's one h1. */
  title: string;
  /** The line beneath the title; nothing renders when it is empty. */
  subtitle?: string | undefined;
  /** The trailing action slot; empty renders nothing, so the row keeps no gap. */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="page-heading">
      <div className="page-heading-text">
        <h1 id="page-title" className="large-title">
          {title}
        </h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {/* The screen's own actions: the toolbar never carries one (DESIGN.md
          §7). The slot is empty on a screen without them. */}
      <div className="page-heading-actions">{actions}</div>
    </div>
  );
}
