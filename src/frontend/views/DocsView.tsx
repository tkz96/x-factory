// src/frontend/views/DocsView.tsx — In-App Documentation Route (XFM-53).

import { useState } from "react";

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

export function DocsView() {
  const [activeSection, setActiveSection] = useState<
    "least-privilege" | "azure" | "github" | "gitlab" | "jira"
  >("least-privilege");

  return (
    <section id="area-docs" className="area-view active">
      <div className="view-panel">
        <div className="section-header-flex">
          <div>
            <h2>X-Factory Documentation</h2>
            <p className="text-muted">
              Credentials, minimum required scopes, and security reference.
            </p>
          </div>
        </div>

        {/* Section Segmented Tabs */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            margin: "1rem 0 1.5rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={`btn-secondary btn-sm ${activeSection === "least-privilege" ? "active" : ""}`}
            style={
              activeSection === "least-privilege"
                ? {
                    background: "var(--accent)",
                    color: "#fff",
                    borderColor: "var(--accent)",
                  }
                : undefined
            }
            onClick={() => setActiveSection("least-privilege")}
          >
            Least Privilege
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm ${activeSection === "azure" ? "active" : ""}`}
            style={
              activeSection === "azure"
                ? {
                    background: "var(--accent)",
                    color: "#fff",
                    borderColor: "var(--accent)",
                  }
                : undefined
            }
            onClick={() => setActiveSection("azure")}
          >
            Azure DevOps
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm ${activeSection === "github" ? "active" : ""}`}
            style={
              activeSection === "github"
                ? {
                    background: "var(--accent)",
                    color: "#fff",
                    borderColor: "var(--accent)",
                  }
                : undefined
            }
            onClick={() => setActiveSection("github")}
          >
            GitHub
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm ${activeSection === "gitlab" ? "active" : ""}`}
            style={
              activeSection === "gitlab"
                ? {
                    background: "var(--accent)",
                    color: "#fff",
                    borderColor: "var(--accent)",
                  }
                : undefined
            }
            onClick={() => setActiveSection("gitlab")}
          >
            GitLab
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm ${activeSection === "jira" ? "active" : ""}`}
            style={
              activeSection === "jira"
                ? {
                    background: "var(--accent)",
                    color: "#fff",
                    borderColor: "var(--accent)",
                  }
                : undefined
            }
            onClick={() => setActiveSection("jira")}
          >
            Jira
          </button>
        </div>

        {/* Least Privilege Section */}
        {activeSection === "least-privilege" && (
          <div
            id="least-privilege"
            className="card"
            style={{ padding: "1.5rem" }}
          >
            <h3>Principle of Least Privilege</h3>
            <p className="text-muted" style={{ lineHeight: 1.6 }}>
              X-Factory runs autonomous coding agents locally in isolated git
              worktrees. To ensure safety, tokens only require the minimal
              permissions needed to:
            </p>
            <ol style={{ marginLeft: "1.5rem", lineHeight: 1.8 }}>
              <li>
                <strong>Read issue details and acceptance criteria</strong> from
                your board.
              </li>
              <li>
                <strong>Check out and branch code</strong> inside temporary
                worktrees.
              </li>
              <li>
                <strong>Push branches and create pull requests</strong> for
                human review.
              </li>
            </ol>
            <div
              style={{
                marginTop: "1.2rem",
                padding: "1rem",
                background: "var(--bg-warning-subtle)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--warning)",
              }}
            >
              <strong>Security Guardrail:</strong> Over-privileged tokens (e.g.
              Full Access PATs) trigger warnings in the onboarding wizard and
              require explicit acknowledgement.
            </div>
          </div>
        )}

        {/* Azure DevOps Section */}
        {activeSection === "azure" && (
          <div id="azure-pat" className="card" style={{ padding: "1.5rem" }}>
            <h3>Azure DevOps Token Scopes</h3>
            <p className="text-muted">
              Configure a Personal Access Token (PAT) in Azure DevOps under{" "}
              <em>User Settings → Personal Access Tokens</em>.
            </p>

            <div id="azure-code" style={{ marginTop: "1rem" }}>
              <h4>Required Scopes</h4>
              <table
                className="table"
                style={{ width: "100%", marginTop: "0.5rem" }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <th style={{ padding: "0.5rem" }}>Scope Category</th>
                    <th style={{ padding: "0.5rem" }}>Permission</th>
                    <th style={{ padding: "0.5rem" }}>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {AZURE_DOC_SCOPES.map((scope) => (
                    <tr
                      key={scope.permission}
                      style={{ borderBottom: "1px solid var(--border-subtle)" }}
                    >
                      <td style={{ padding: "0.5rem" }}>{scope.category}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <strong>{scope.permission}</strong>
                      </td>
                      <td style={{ padding: "0.5rem" }}>{scope.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* GitHub Section */}
        {activeSection === "github" && (
          <div id="github" className="card" style={{ padding: "1.5rem" }}>
            <h3>GitHub Personal Access Token</h3>
            <p className="text-muted">
              Use a fine-grained or classic token with access to target
              repositories.
            </p>
            <ul
              style={{
                marginLeft: "1.5rem",
                marginTop: "0.8rem",
                lineHeight: 1.8,
              }}
            >
              <li>
                <strong>Issues: Read &amp; write</strong> (or Read-only) to
                query labeled tickets.
              </li>
              <li>
                <strong>Contents: Read &amp; write</strong> to commit code to
                the worktree branch.
              </li>
              <li>
                <strong>Pull Requests: Read &amp; write</strong> to open the
                delivery PR.
              </li>
            </ul>
          </div>
        )}

        {/* GitLab Section */}
        {activeSection === "gitlab" && (
          <div id="gitlab" className="card" style={{ padding: "1.5rem" }}>
            <h3>GitLab Access Token</h3>
            <p className="text-muted">
              Create a Project Access Token or Personal Access Token in GitLab.
            </p>
            <ul
              style={{
                marginLeft: "1.5rem",
                marginTop: "0.8rem",
                lineHeight: 1.8,
              }}
            >
              <li>
                <code>read_api</code> — query GitLab issues with
                agentic-workflow label.
              </li>
              <li>
                <code>write_repository</code> — push factory branches and create
                merge requests.
              </li>
            </ul>
          </div>
        )}

        {/* Jira Section */}
        {activeSection === "jira" && (
          <div id="jira" className="card" style={{ padding: "1.5rem" }}>
            <h3>Atlassian Jira API Token</h3>
            <p className="text-muted">
              Generate an API Token from your Atlassian account security
              settings.
            </p>
            <ul
              style={{
                marginLeft: "1.5rem",
                marginTop: "0.8rem",
                lineHeight: 1.8,
              }}
            >
              <li>Provide your Atlassian email address and the API token.</li>
              <li>
                X-Factory uses REST API v3 to query JQL filters matching your
                project key.
              </li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
