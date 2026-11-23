---
name: update-pr
description: >-
  Use whenever the user asks to update, refresh, edit, retitle, re-describe, or retarget an existing pull
  request (PR), or after pushing new commits to a branch that already has an open PR. ALWAYS use this instead
  of calling `gh pr edit` or GitHub MCP `update_pull_request` directly. Identifies the open PR, inspects new
  commits and diffs against the base branch, refreshes demo screenshots/recordings for user-visible changes
  via demo-capture, updates the title and high-level description (how to test, review focus, optional flow
  diagram, risks), handles base branch retargeting, and attaches demo media via github-attach.
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
   - Present proposed title, description, and demo asset updates to the user for confirmation prior to calling update tools, unless the user explicitly requested automatic updates (e.g., *"update PR directly"*, *"auto-apply"*).
4. **Demo Media for User-Visible Changes**:
   - If commits added since the last description (or since the existing demo) change anything a user can see or interact with, re-capture affected flows with the **demo-capture** skill (Step 4) and attach them with **github-attach** (Step 6).
   - Keep existing media for flows that did not change. Replace media only for flows that did. Capture as many screenshots and recordings as it takes; no fixed count.
   - Skip for non-visible changes, or when the user says no demo / `--no-demo`. Say "no demo: <reason>" in one line.
   - Never commit `demos/`. Never block the update on a failed capture: report the failure and continue.
5. **Reviewer-Aid Sections (conditional)**:
   - Add a section only when its condition holds; omit it entirely otherwise. Never write "N/A".
   - **How to test**: any behavior change. 3-6 numbered steps with expected results. Reuse these as the demo capture script.
   - **Review focus**: diff touches more than ~5 files or contains a non-obvious decision. 1-3 bullets.
   - **Flow** (Mermaid `flowchart`, `sequenceDiagram`, or `stateDiagram`): change alters a multi-step flow, state machine, cross-service calls, or the data model. Skip for simple UI or logic tweaks.
   - **Risk / Rollout**: only when a migration, feature flag, breaking change, or new env var is involved.
   - No per-file changelog and no before/after section (the diff and demo media cover those).
   - Section order: Overview, Key Changes, Demo, How to test, Review focus, Flow, Risk / Rollout, Related Issue.
   - When updating, refresh these sections to match the full PR state; drop any that no longer apply.

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
   - If a related issue ticket exists (e.g., `PROJ-123`), check if new acceptance criteria or scope changes were introduced.

---

### Step 4: Capture Demo Media (user-visible changes only)

1. **Decide**: compare the delta commits and the PR's current `## Demo` section. If no visible flow changed, skip to Step 5.
2. **Capture** with the **demo-capture** skill (headless first, headed fallback) into `demos/<ticket-or-branch>/`, covering only changed or new flows. Add captions per demo-capture's "Captions in recordings" when a recording needs context.
3. **Verify**: OCR the PNGs and check video durations as described in demo-capture. Re-capture once on failure; if it still fails, continue without new media and tell the user.
4. **Prep for upload**: transcode `.webm` to H.264 `.mp4` with system ffmpeg and keep files under GitHub's size limits (see github-attach "Media limits and prep").

---

### Step 5: Craft Updated Title & High-Level Description

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

     ## Demo
     - Only when demo media exists (see note below); omit otherwise.

     ## How to test
     1. Numbered steps a reviewer can follow, each with the expected result.

     ## Review focus
     - 1-3 bullets: risky files or decisions to look at first, and what is intentionally out of scope.

     ## Flow
     ```mermaid
     flowchart LR
       A[Trigger] --> B[Step] --> C[Result]
     ```

     ## Risk / Rollout
     - Migrations, feature flags, breaking changes, new env vars.

     ## Related Issue
     - Closes / Relates to `<TICKET-ID>` (or link to Linear/GitHub issue).
     ```

> **Demo media:** GitHub MCP and the REST API cannot upload attachments, so new assets are
> attached after the description is applied (Step 6). Keep the existing `## Demo` content for
> unchanged flows and leave a placeholder for new assets.

---

### Step 6: Present Proposal, Apply Updates & Attach Demo Media

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

4. **Attach Demo Media** (only if Step 4 produced assets), using the **github-attach** skill:
   - `gh --version` >= 2.99 on github.com: Path A (`gh pr edit <n> --attach ...`), then apply image sizing per github-attach.
   - Otherwise: Path B (browser harvest against the PR URL), then update the body with `gh pr edit --body-file` or GitHub MCP `update_pull_request`.
   - Place new media under `## Demo` (replacing media for re-captured flows), keep any attribution footer last, then run github-attach's Verify checks.
   - If upload fails (e.g. exit code 3, not logged in), leave the PR as updated, tell the user the exact fix (`--login`), and list the local asset paths.

5. **Confirm Update**:
   - Provide the PR URL and state whether the PR was updated and whether demo media was attached, skipped (with reason), or failed.
