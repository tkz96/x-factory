// src/frontend/components/runs/DiffViewer.tsx — Worktree git diff viewer (XFM-50).

import "./DiffViewer.css";

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
    <div className="card mt-5" id="run-diff-card">
      <div className="section-header">
        <h3>Worktree Git Diff</h3>
        <span id="run-diff-files" className="badge">
          {count} {count === 1 ? "file" : "files"}
        </span>
      </div>
      <pre id="run-diff-content" className="diff-viewer">
        {diff || "No diff content captured yet."}
      </pre>
    </div>
  );
}
