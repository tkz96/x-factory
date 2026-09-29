# Issue Tracker Configuration

This document specifies the issue tracker configuration for AI agent skills in this repository.

## Tracker Details

- **Type**: GitHub Issues
- **Repository**: `tkz96/x-factory`
- **Tooling**: GitHub CLI (`gh`)
- **Include Pull Requests as Request Surface**: false

## Agent Commands

Agents should interact with GitHub issues using the `gh` command-line tool.

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
