// src/frontend/views/DocsView.tsx — Interactive In-App Diátaxis Documentation Console (XFM-53).

import "./DocsView.css";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MarkdownViewer } from "../components/MarkdownViewer.js";
import { api } from "../lib/api-client.js";

interface AzureDocScope {
  category: string;
  permission: string;
  purpose: string;
}

const AZURE_DOC_SCOPES: AzureDocScope[] = [
  {
    category: "Work Items",
    permission: "Work Items: Read",
    purpose: "Fetch backlog tickets and acceptance criteria",
  },
  {
    category: "Code",
    permission: "Code: Read & write",
    purpose: "Clone repo, push implementation branch, open PR",
  },
  {
    category: "Code",
    permission: "Code: Status",
    purpose: "Post commit statuses and PR verification checks",
  },
];

type SecuritySection =
  | "least-privilege"
  | "azure"
  | "github"
  | "gitlab"
  | "jira";

interface TocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

function extractMarkdownHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      const text = trimmed
        .slice(3)
        .replace(/[*`_#]/g, "")
        .trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (id && text) {
        headings.push({ id, text, level: 2 });
      }
    } else if (trimmed.startsWith("### ")) {
      const text = trimmed
        .slice(4)
        .replace(/[*`_#]/g, "")
        .trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      if (id && text) {
        headings.push({ id, text, level: 3 });
      }
    }
  }
  return headings;
}

function getSecurityHeadings(section: SecuritySection): TocHeading[] {
  switch (section) {
    case "least-privilege":
      return [
        {
          id: "least-privilege-overview",
          text: "Principle of Least Privilege",
          level: 2,
        },
        {
          id: "least-privilege-guardrail",
          text: "Security Guardrail",
          level: 3,
        },
      ];
    case "azure":
      return [
        {
          id: "azure-pat-scopes",
          text: "Azure DevOps Token Scopes",
          level: 2,
        },
        { id: "azure-required-scopes", text: "Required Scopes", level: 3 },
      ];
    case "github":
      return [
        {
          id: "github-pat",
          text: "GitHub Personal Access Token",
          level: 2,
        },
      ];
    case "gitlab":
      return [
        {
          id: "gitlab-pat",
          text: "GitLab Access Token",
          level: 2,
        },
      ];
    case "jira":
      return [
        {
          id: "jira-token",
          text: "Atlassian Jira API Token",
          level: 2,
        },
      ];
  }
}

export function DocsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL search parameters as single source of truth for deep linking
  const activeCategory = searchParams.get("cat") || "tutorials";
  const activeSlug = searchParams.get("slug") || "first-agent-run";
  const isSecurity = activeCategory === "security";
  const securitySection: SecuritySection = isSecurity
    ? (activeSlug as SecuritySection) || "least-privilege"
    : "least-privilege";

  // Fetch specific doc markdown content (when not in security section)
  const {
    data: docData,
    isLoading: isDocLoading,
    error: docError,
    refetch: refetchDoc,
  } = useQuery({
    queryKey: ["doc-content", activeCategory, activeSlug],
    queryFn: () => api.getDoc(activeCategory, activeSlug),
    enabled: !isSecurity && Boolean(activeCategory && activeSlug),
    staleTime: 30_000,
  });

  // Extract "In this page" headings dynamically
  const headings: TocHeading[] = useMemo(() => {
    if (isSecurity) {
      return getSecurityHeadings(securitySection);
    }
    if (docData?.markdown) {
      return extractMarkdownHeadings(docData.markdown);
    }
    return [];
  }, [isSecurity, securitySection, docData?.markdown]);

  const [activeHeadingId, setActiveHeadingId] = useState<string>("");

  useEffect(() => {
    if (headings.length > 0 && headings[0]) {
      setActiveHeadingId(headings[0].id);
    }
  }, [headings]);

  // Support deep-linking to #heading-id on initial load or anchor navigation
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || headings.length === 0) return;

    const timer = setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveHeadingId(hash);
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [headings]);

  // Scroll-spy active heading tracking
  useEffect(() => {
    if (headings.length === 0) return;
    const scrollContainer = document.getElementById("app-main") || null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeadingId(entry.target.id);
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: "-60px 0px -70% 0px",
        threshold: 0,
      },
    );

    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  const handleNavigateDoc = (category: string, slug: string) => {
    setSearchParams({ cat: category, slug });
  };

  const handleScrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveHeadingId(id);
    }
  };

  return (
    <section id="area-docs" className="area-view active">
      <div className="docs-page-layout">
        {/* Reading Column (Shifted slightly left for neat alignment) */}
        <div className="docs-reading-container">
          {/* Case 1: Markdown Documentation Article */}
          {!isSecurity && (
            <article className="docs-reading-pane">
              {isDocLoading && (
                <div className="docs-loading-text">Loading document…</div>
              )}

              {docError && (
                <div className="docs-error-box">
                  <p className="docs-error-msg">
                    Failed to load document:{" "}
                    {docError instanceof Error
                      ? docError.message
                      : String(docError)}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void refetchDoc()}
                  >
                    Retry
                  </button>
                </div>
              )}

              {docData && (
                <div className="docs-article-body">
                  <div className="mb-4">
                    <span className="docs-tag">{docData.category}</span>
                  </div>

                  <MarkdownViewer
                    content={docData.markdown}
                    onNavigateDoc={handleNavigateDoc}
                  />
                </div>
              )}

              <aside
                className="docs-callout-guardrail"
                aria-label="Security Guardrail"
              >
                <div className="docs-callout-guardrail-header">
                  <svg className="icon icon-sm" aria-hidden="true">
                    <use href="/assets/icons/sprite.svg#icon-lock" />
                  </svg>
                  <strong>
                    Security Guardrail &amp; Principle of Least Privilege
                  </strong>
                </div>
                <p className="text-muted docs-callout-guardrail-text">
                  X-Factory runs autonomous coding agents locally in isolated
                  git worktrees. Tokens and credentials configured in project
                  settings only require the minimal permissions needed to read
                  tickets, commit code, and open pull requests for human review.
                </p>
              </aside>
            </article>
          )}

          {/* Case 2: Security & Credentials Panes */}
          {isSecurity && (
            <article className="docs-reading-pane">
              {securitySection === "least-privilege" && (
                <div id="least-privilege">
                  <h1 id="least-privilege-overview" className="docs-pane-title">
                    Principle of Least Privilege
                  </h1>
                  <p className="text-muted docs-pane-p">
                    X-Factory runs autonomous coding agents locally in isolated
                    git worktrees. To ensure safety, tokens only require the
                    minimal permissions needed to:
                  </p>
                  <ol className="docs-list">
                    <li>
                      <strong>
                        Read issue details and acceptance criteria
                      </strong>{" "}
                      from your board.
                    </li>
                    <li>
                      <strong>Check out and branch code</strong> inside
                      temporary worktrees.
                    </li>
                    <li>
                      <strong>Push branches and create pull requests</strong>{" "}
                      for human review.
                    </li>
                  </ol>
                  <div
                    id="least-privilege-guardrail"
                    className="docs-callout-warning"
                  >
                    <strong>Security Guardrail:</strong> Over-privileged tokens
                    (e.g. Full Access PATs) trigger warnings in the onboarding
                    wizard and require explicit acknowledgement.
                  </div>
                </div>
              )}

              {securitySection === "azure" && (
                <div id="azure-pat">
                  <h1 id="azure-pat-scopes" className="docs-pane-subtitle">
                    Azure DevOps Token Scopes
                  </h1>
                  <p className="text-muted docs-pane-p">
                    Configure a Personal Access Token (PAT) in Azure DevOps
                    under <em>User Settings → Personal Access Tokens</em>.
                  </p>

                  <div id="azure-required-scopes" className="mt-6">
                    <h3 className="docs-subheading">Required Scopes</h3>
                    <table className="docs-meta-table">
                      <thead>
                        <tr>
                          <th>Scope Category</th>
                          <th>Permission</th>
                          <th>Purpose</th>
                        </tr>
                      </thead>
                      <tbody>
                        {AZURE_DOC_SCOPES.map((scope) => (
                          <tr key={scope.permission}>
                            <td>{scope.category}</td>
                            <td>
                              <strong>{scope.permission}</strong>
                            </td>
                            <td className="dimmed">{scope.purpose}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {securitySection === "github" && (
                <div id="github">
                  <h1 id="github-pat" className="docs-pane-subtitle">
                    GitHub Personal Access Token
                  </h1>
                  <p className="text-muted docs-pane-p">
                    Use a fine-grained or classic token with access to target
                    repositories.
                  </p>
                  <ul className="docs-list">
                    <li>
                      <strong>Issues: Read &amp; write</strong> (or Read-only)
                      to query labeled tickets.
                    </li>
                    <li>
                      <strong>Contents: Read &amp; write</strong> to commit code
                      to the worktree branch.
                    </li>
                    <li>
                      <strong>Pull Requests: Read &amp; write</strong> to open
                      the delivery PR.
                    </li>
                  </ul>
                </div>
              )}

              {securitySection === "gitlab" && (
                <div id="gitlab">
                  <h1 id="gitlab-pat" className="docs-pane-subtitle">
                    GitLab Access Token
                  </h1>
                  <p className="text-muted docs-pane-p">
                    Create a Project Access Token or Personal Access Token in
                    GitLab.
                  </p>
                  <ul className="docs-list">
                    <li>
                      <code className="docs-code-blue">read_api</code> — query
                      GitLab issues with agentic-workflow label.
                    </li>
                    <li>
                      <code className="docs-code-blue">write_repository</code> —
                      push factory branches and create merge requests.
                    </li>
                  </ul>
                </div>
              )}

              {securitySection === "jira" && (
                <div id="jira">
                  <h1 id="jira-token" className="docs-pane-subtitle">
                    Atlassian Jira API Token
                  </h1>
                  <p className="text-muted docs-pane-p">
                    Generate an API Token from your Atlassian account security
                    settings.
                  </p>
                  <ul className="docs-list">
                    <li>
                      Provide your Atlassian email address and the API token.
                    </li>
                    <li>
                      X-Factory uses REST API v3 to query JQL filters matching
                      your project key.
                    </li>
                  </ul>
                </div>
              )}
            </article>
          )}
        </div>

        {/* "In This Page" Table of Contents Right Rail */}
        {headings.length > 0 && (
          <aside className="docs-toc-rail" aria-label="On this page navigation">
            <div className="docs-toc-sticky-box">
              <div className="docs-toc-header">
                <svg className="icon icon-sm" aria-hidden="true">
                  <use href="/assets/icons/sprite.svg#icon-layers" />
                </svg>
                <span>In this page</span>
              </div>
              <nav className="docs-toc-nav">
                {headings.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      handleScrollToHeading(h.id);
                    }}
                    className={`docs-toc-link level-${h.level} ${
                      activeHeadingId === h.id ? "active" : ""
                    }`}
                    title={h.text}
                  >
                    <span className="docs-toc-text">{h.text}</span>
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
