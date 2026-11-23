---
name: create-pr
description: >-
  Use whenever the user asks to create, open, raise, submit, or push a pull request (PR), or when finished
  work on a branch should become a PR. ALWAYS use this instead of calling `gh pr create` or GitHub MCP
  `create_pull_request` directly. Creates a PR from the current HEAD to the origin's primary branch: detects
  the default branch, analyzes commits and diffs, extracts ticket IDs, pushes the branch, captures demo
  screenshots/recordings for user-visible changes via demo-capture, writes a concise high-level description
  (how to test, review focus, optional flow diagram, risks), and attaches demo media via github-attach.
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
3. **Demo Media for User-Visible Changes**:
   - If the diff changes anything a user can see or interact with (web UI, mobile screens, CLI/TUI output), capture demo assets with the **demo-capture** skill (Step 4) and attach them with **github-attach** (Step 6).
   - Skip for non-visible changes (backend-only, config, docs, tests, refactors without UI impact), or when the user says no demo / `--no-demo`. Say "no demo: <reason>" in one line.
   - Never commit demo assets. Never block PR creation on a failed capture: report the failure and continue without media.
4. **Reviewer-Aid Sections (conditional)**:
   - Add a section only when its condition holds; omit it entirely otherwise. Never write "N/A".
   - **How to test**: any behavior change. 3-6 numbered steps with expected results. Reuse these as the demo capture script.
   - **Review focus**: diff touches more than ~5 files or contains a non-obvious decision. 1-3 bullets.
   - **Flow** (Mermaid `flowchart`, `sequenceDiagram`, or `stateDiagram`): change alters a multi-step flow, state machine, cross-service calls, or the data model. Skip for simple UI or logic tweaks.
   - **Risk / Rollout**: only when a migration, feature flag, breaking change, or new env var is involved.
   - No per-file changelog and no before/after section (the diff and demo media cover those).
   - Section order: Overview, Key Changes, Demo, How to test, Review focus, Flow, Risk / Rollout, Related Issue.
5. **Readable Bullets**:
   - If a bullet point would enumerate more than 2 distinct items, break them into nested sub-bullets instead of comma-separating them on one line.
   - Each sub-bullet should describe one artifact or concept.

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

### Step 4: Capture Demo Media (user-visible changes only)

1. **Decide**: from `git diff --stat` and the changed files, classify the change as visible (components, pages, styles, screens, CLI output) or not. If not visible, skip to Step 5.
2. **Capture** with the **demo-capture** skill (headless first, headed fallback), output to its resolved `$DEMO_DIR` (repo `tmp/demos/<ticket-or-branch>/` if git-ignored, else the user's temp dir):
   - Web: write a capture config, run `capture.js` (start the dev server first if needed).
   - iOS / Android: `capture-ios.sh` / `capture-android.sh`.
   - Capture as many screenshots and recordings as it takes to show every changed flow and state; no fixed count. Add a before shot from the base branch when the change is a visual fix.
   - Add captions per demo-capture's "Captions in recordings" when the recording needs context.
3. **Verify**: OCR the PNGs and check video durations as described in demo-capture. Fix and re-capture once; if it still fails, continue without media and tell the user.
4. **Prep for upload**: transcode `.webm` to H.264 `.mp4` with system ffmpeg and keep files under GitHub's size limits (see github-attach "Media limits and prep").

---

### Step 5: Craft Title & High-Level Description

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

     ## Demo
     - Only when demo media exists (Step 4 / github-attach); omit otherwise.

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

---

### Step 6: Submit Pull Request & Attach Demo Media

> GitHub MCP and the REST API cannot upload attachments, and github-attach's browser path
> needs an existing PR URL. So: create the PR first (with the `## Demo` section as a
> placeholder if media exists), then attach.

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

3. **Attach Demo Media** (only if Step 4 produced assets), using the **github-attach** skill:
   - `gh --version` >= 2.99 on github.com: Path A (`gh pr edit <n> --attach ...`), then apply image sizing per github-attach.
   - Otherwise: Path B (browser harvest against the new PR URL), then update the body with `gh pr edit --body-file` or GitHub MCP `update_pull_request`.
   - Put the media under `## Demo`, keep any attribution footer last, then run github-attach's Verify checks.
   - If upload fails (e.g. exit code 3, not logged in), leave the PR as created, tell the user the exact fix (`--login`), and list the local asset paths.

4. **Confirm to User**:
   - Share the created PR URL, base -> head summary, and whether demo media was attached, skipped (with reason), or failed.
