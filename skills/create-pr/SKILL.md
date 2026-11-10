---
name: create-pr
description: >-
  Creates a pull request covering changes from the current git HEAD to the origin's primary branch.
  Determines the remote default branch, analyzes commits and diffs, extracts ticket IDs,
  ensures the branch is pushed, crafts a concise high-level description, and creates the PR via GitHub MCP or gh CLI.
---

# Create PR

This skill automates the creation of a GitHub Pull Request comparing the current git `HEAD` against the remote origin's primary (default) branch.

---

## Guidelines & Rules

1. **High-Level Description Only**:
   - Always keep the PR description concise and written at a high level.
   - Do NOT include tedious low-level diff breakdowns, redundant syntax explanations, or trivial line edits.
   - Summarize the business/functional intent and key architectural components impacted.
2. **Ticket ID Prefix**:
   - If the branch name (e.g., `feature/PROJ-123`, `bugfix/APP-456`) or commit history contains a ticket ID pattern (e.g., `PROJ-123`, `APP-456`), prefix the PR title with `[<TICKET-ID>] <type>(<scope>): <summary>`.
3. **Approval Before Creation**:
   - Present the proposed PR title, base branch, head branch, and description to the user before submitting, unless the user explicitly requested automatic creation (e.g., "create the PR directly", "auto-create").

---

## Workflow

### Step 1: Detect Git State & Primary Branch

1. **Identify Current Branch & Remote**:
   - Current branch: `git branch --show-current` (or `git rev-parse --abbrev-ref HEAD`).
   - Remote name: usually `origin`.
   - GitHub Repository & Owner:
     - Run `git remote get-url origin` or `gh repo view --json owner,name`.

2. **Detect Origin's Primary (Default) Branch**:
   - Try resolving `origin/HEAD`:
     ```bash
     git rev-parse --abbrev-ref origin/HEAD 2>/dev/null
     ```
     (e.g., returns `origin/main` -> strip `origin/` to get `main`).
   - If `origin/HEAD` is unset, query via GitHub CLI:
     ```bash
     gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null
     ```
   - Fallback: check `origin/main`, then `origin/master`.
   - Update remote refs for the primary branch:
     ```bash
     git fetch origin <primary-branch>
     ```

3. **Check Working Tree & Push Status**:
   - Run `git status -s`. If there are uncommitted changes, inform the user and ask if they should be committed first.
   - Ensure current branch is pushed to remote:
     ```bash
     git push -u origin <current-branch>
     ```

---

### Step 2: Analyze Commits and Diffs (HEAD vs Primary Branch)

1. **Inspect Commits**:
   ```bash
   git log origin/<primary-branch>..HEAD --oneline
   ```
   If no commits exist between `origin/<primary-branch>` and `HEAD`, notify the user that there are no new commits to create a pull request for.

2. **Inspect Changed Files & Stat**:
   ```bash
   git diff --stat origin/<primary-branch>...HEAD
   ```

---

### Step 3: Extract Ticket Key & Grounding

1. **Extract Issue Key**:
   - Check the current branch name (e.g., `feature/PROJ-123` -> `PROJ-123`).
   - Check commit messages for references like `[PROJ-123]`, `APP-456`, etc.
2. **Fetch Ticket Details (if Issue Tracker MCP available)**:
   - If an issue key like `PROJ-123` is found and an issue tracker MCP (e.g. Linear, Jira, GitHub Issues) is available, retrieve the ticket title and context to ensure accurate PR title and high-level summary.

---

### Step 4: Craft Title & High-Level Description

1. **Title**:
   - Format: `[<TICKET-ID>] <type>(<scope>): <summary>` (e.g., `[PROJ-123] feat(auth): add OAuth2 token refresh`).
   - Follow Conventional Commits format (`feat`, `fix`, `refactor`, `chore`, etc.).
2. **Description**:
   - Follow the high-level rule strictly:
     ```markdown
     ## Overview
     - Concise 1-3 bullet points describing what the change achieves and why.

     ## Key Changes
     - High-level functional or architectural adjustments.

     ## Related Issue
     - Closes / Relates to `<TICKET-ID>` (or link to Linear/GitHub issue).
     ```

---

### Step 5: Submit Pull Request

> **Demo media:** GitHub MCP and the REST API cannot upload attachments. To embed
> screenshots or a recording in the description, harvest `user-attachments` URLs with the
> **github-attach** skill (headless browser) and put them in the body before creating the
> PR; or attach them afterwards with `gh pr edit <n> --attach <file>` (gh >= 2.99).

1. **GitHub MCP (Preferred)**:
   Call `call_mcp_tool` on `github-mcp-server` with tool `create_pull_request`:
   ```json
   {
     "ServerName": "github-mcp-server",
     "ToolName": "create_pull_request",
     "Arguments": {
       "owner": "<owner>",
       "repo": "<repo>",
       "head": "<current-branch>",
       "base": "<primary-branch>",
       "title": "<title>",
       "body": "<body>"
     }
   }
   ```

2. **GitHub CLI (Fallback)**:
   If GitHub MCP is unavailable:
   ```bash
   gh pr create --base "<primary-branch>" --head "<current-branch>" --title "<title>" --body "<body>"
   ```

3. **Confirm to User**:
   - Share the created PR URL and base -> head summary.
