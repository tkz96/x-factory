# Triage Labels Configuration

Read this before you label or triage an issue. It maps the canonical triage roles that triage workflows use to the labels on `tkz96/x-factory`.

## Canonical Role Mapping

| Canonical Role | Tracker Label | Description |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Item has been reported and requires triage / review |
| `needs-info` | `needs-info` | Waiting on additional information or reproduction steps from author |
| `ready-for-agent` | `ready-for-agent` | Task is clearly specified and ready for an AI agent to execute |
| `ready-for-human` | `ready-for-human` | Task requires human decision, manual verification, or intervention |
| `wontfix` | `wontfix` | Will not be implemented or worked on |

## Tracker state

`wontfix`, `ready-for-agent` and `ready-for-human` exist on GitHub. `needs-triage` and `needs-info` do not exist yet. Create them before you use them:

```bash
gh label create needs-triage --color "#fbca04" --description "Item requires review and triage"
gh label create needs-info --color "#d93f0b" --description "Waiting on information from reporter"
```

When you create one, update this section.
