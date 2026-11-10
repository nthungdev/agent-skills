---
name: update-pr
description: >-
  Updates an existing GitHub pull request for the current branch.
  Identifies the open PR, inspects new commits and diff changes against the base branch,
  updates the PR title and/or high-level description, handles base branch retargeting,
  and applies updates via GitHub MCP or gh CLI.
---

# Update PR

This skill automates updating an existing GitHub Pull Request associated with the current git branch.

---

## Guidelines & Rules

1. **High-Level Description Only**:
   - Keep PR descriptions concise, structured, and strictly high-level.
   - Do NOT include low-level line diff details or obvious code syntax regurgitation.
   - Summarize the business/functional intent and key architectural components impacted by both initial and newly added commits.
2. **Ticket ID Prefix**:
   - Maintain the ticket ID prefix in the PR title: `[<TICKET-ID>] <type>(<scope>): <summary>` (e.g., `[PROJ-123] feat(auth): add OAuth2 token refresh`).
3. **Approval Before Mutation**:
   - Present proposed title and description updates to the user for confirmation prior to calling update tools, unless the user explicitly requested automatic updates (e.g., *"update PR directly"*, *"auto-apply"*).

---

## Workflow

### Step 1: Identify Current Branch & Existing Pull Request

1. **Get Current Branch & Remote Repo**:
   - Current branch: `git branch --show-current` (or `git rev-parse --abbrev-ref HEAD`).
   - If detached HEAD or no branch, stop and inform the user.
   - Determine repo owner and name:
     - Run `git remote get-url origin` or `gh repo view --json owner,name`.

2. **Retrieve Open PR for the Branch**:
   - **Via GitHub MCP (Preferred)**:
     Call `call_mcp_tool` on `github-mcp-server` with tool `list_pull_requests`:
     ```json
     {
       "ServerName": "github-mcp-server",
       "ToolName": "list_pull_requests",
       "Arguments": {
         "owner": "<owner>",
         "repo": "<repo>",
         "head": "<owner>:<current-branch>",
         "state": "open"
       }
     }
     ```
   - **Via GitHub CLI (Fallback)**:
     ```bash
     gh pr view --json number,title,body,baseRefName,headRefName,url,state
     ```
   - **If no open PR exists**:
     Inform the user that no open pull request was found for the current branch and suggest running `/create-pr` to create one.

---

### Step 2: Check Local Changes & Ensure Push

1. **Check Working Tree**:
   - Run `git status -s`.
   - If there are uncommitted changes, notify the user and ask if they should be committed before updating the PR.
2. **Push Recent Commits to Origin**:
   - Check if local branch is ahead of `origin/<current-branch>`:
     ```bash
     git status -uno
     ```
   - If there are unpushed commits:
     ```bash
     git push origin <current-branch>
     ```

---

### Step 3: Analyze Commits & Diffs against PR Base Branch

1. **Identify Base Branch**:
   - Use the `baseRefName` or `base.ref` from the existing PR (e.g., `main`, or another branch if stacked).
2. **Fetch and Compare Commits**:
   ```bash
   git fetch origin <base-branch>
   git log origin/<base-branch>..HEAD --oneline
   ```
3. **Inspect Overall Changes**:
   ```bash
   git diff --stat origin/<base-branch>...HEAD
   ```
4. **Identify New / Delta Changes**:
   - Check which commits or features were added since the last PR description was written.
   - If related issue ticket exists (e.g., `PROJ-123`), check if new acceptance criteria or scope changes were introduced.

---

### Step 4: Craft Updated Title & High-Level Description

1. **Title Review**:
   - Retain ticket ID prefix `[<TICKET-ID>]`.
   - If the scope of the PR expanded significantly, update the Conventional Commits summary to accurately reflect the full scope.
2. **High-Level Description**:
   - Update the description to reflect the full, up-to-date state of the PR:
     ```markdown
     ## Overview
     - High-level summary of what the pull request delivers and why.

     ## Key Changes
     - Bullet points summarizing the functional components, APIs, database, or UI changes.
     - Include any follow-up improvements or bug bash fixes added in recent commits.

     ## Related Issue
     - Closes / Relates to `<TICKET-ID>` (or link to Linear/GitHub issue).
     ```

> **Demo media:** GitHub MCP and the REST API cannot upload attachments. To add or refresh
> screenshots/recordings in the description, harvest `user-attachments` URLs with the
> **github-attach** skill (headless browser), or attach them with
> `gh pr edit <n> --attach <file>` (gh >= 2.99), then include the returned URLs above.

---

### Step 5: Present Proposal & Apply Updates

1. **Present Proposal**:
   - Show PR number, link, proposed title, and proposed markdown description.
   - Wait for user confirmation unless auto-apply was requested.

2. **Apply Update via GitHub MCP (Preferred)**:
   Call `call_mcp_tool` on `github-mcp-server` with tool `update_pull_request`:
   ```json
   {
     "ServerName": "github-mcp-server",
     "ToolName": "update_pull_request",
     "Arguments": {
       "owner": "<owner>",
       "repo": "<repo>",
       "pullNumber": <PR_NUMBER>,
       "title": "<NEW_TITLE>",
       "body": "<NEW_DESCRIPTION>"
     }
   }
   ```

3. **Apply Update via GitHub CLI (Fallback)**:
   If MCP is unavailable:
   ```bash
   gh pr edit <PR_NUMBER> --title "<NEW_TITLE>" --body "<NEW_DESCRIPTION>"
   ```

4. **Confirm Update**:
   - Provide the PR URL and confirm that the pull request has been updated.
