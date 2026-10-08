# Issue Tracker Configuration

Read this before you read, create or update a GitHub issue. Labels and triage roles are in [triage-labels.md](./triage-labels.md).

## Tracker Details

- **Type**: GitHub Issues
- **Repository**: `tkz96/x-factory`
- **Tooling**: GitHub CLI (`gh`)
- **Include Pull Requests as Request Surface**: false

## Agent Commands

Use the `gh` command-line tool for every issue operation.

### List Issues
```bash
gh issue list --repo tkz96/x-factory --state open
```

### View Issue Details
```bash
gh issue view <issue-number> --repo tkz96/x-factory --comments
```

### Create Issue
```bash
gh issue create --repo tkz96/x-factory --title "<title>" --body "<body>" --label "<label>"
```

### Comment on Issue
```bash
gh issue comment <issue-number> --repo tkz96/x-factory --body "<comment>"
```

### Update Labels
```bash
gh issue edit <issue-number> --repo tkz96/x-factory --add-label "<label>" --remove-label "<old-label>"
```
