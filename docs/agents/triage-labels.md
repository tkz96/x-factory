# Triage Labels Configuration

This document maps canonical triage roles used by agent skills (such as `/triage`, `/to-spec`, `/to-tickets`) to the repository's issue tracker labels.

## Canonical Role Mapping

| Canonical Role | Tracker Label | Description |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Item has been reported and requires triage / review |
| `needs-info` | `needs-info` | Waiting on additional information or reproduction steps from author |
| `ready-for-agent` | `ready-for-agent` | Task is clearly specified and ready for an AI agent to execute |
| `ready-for-human` | `ready-for-human` | Task requires human decision, manual verification, or intervention |
| `wontfix` | `wontfix` | Will not be implemented or worked on |

## Tracker State

- `wontfix` exists on the remote repository.
- `needs-triage`, `needs-info`, `ready-for-agent`, and `ready-for-human` can be created via GitHub CLI:
  ```bash
  gh label create needs-triage --color "#fbca04" --description "Item requires review and triage"
  gh label create needs-info --color "#d93f0b" --description "Waiting on information from reporter"
  gh label create ready-for-agent --color "#0e8a16" --description "Specified and ready for AI agent to execute"
  gh label create ready-for-human --color "#1d76db" --description "Requires human decision or manual intervention"
  ```
