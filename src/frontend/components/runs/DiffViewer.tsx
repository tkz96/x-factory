// src/frontend/components/runs/DiffViewer.tsx — Worktree git diff viewer (XFM-50).

interface DiffViewerProps {
  diff?: string | null | undefined;
  filesChanged?: number;
}

export function DiffViewer({ diff, filesChanged }: DiffViewerProps) {
  if (!diff && (!filesChanged || filesChanged === 0)) {
    return null;
  }

  const count =
    filesChanged ?? (diff ? diff.split(/^diff --git/m).length - 1 : 0);

  return (
    <div className="card" id="run-diff-card" style={{ marginTop: "1.2rem" }}>
      <div className="section-header">
        <h3>Worktree Git Diff</h3>
        <span id="run-diff-files" className="badge">
          {count} {count === 1 ? "file" : "files"}
        </span>
      </div>
      <pre
        id="run-diff-content"
        className="diff-viewer"
        style={{
          maxHeight: "450px",
          overflow: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "0.82rem",
          lineHeight: 1.4,
          padding: "1rem",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-sm)",
          margin: 0,
        }}
      >
        {diff || "No diff content captured yet."}
      </pre>
    </div>
  );
}
