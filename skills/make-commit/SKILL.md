---
name: make-commit
description: >-
  Inspects current git changes (staged and unstaged), breaks them down into granular, atomic commits,
  drafts standardized Conventional Commit messages, runs relevant project checks, and commits changes safely.
---

# Make Commit

This skill automates inspecting the current git working tree changes, structuring them into granular, atomic commits following the [Conventional Commits](https://www.conventionalcommits.org/) specification, and safely committing them.

---

## Guidelines & Rules

1. **Conventional Commits Standard**:
   - Format: `<type>(<scope>): <subject>` (e.g., `docs(db): document DB_SCHEMA compile-time and runtime behavior`).
   - Allowed Types:
     - `feat`: New feature or user-facing capability.
     - `fix`: Bug fix.
     - `docs`: Documentation or docstring changes only.
     - `style`: Formatting, missing semi-colons, white-space changes (no production code change).
     - `refactor`: Code change that neither fixes a bug nor adds a feature.
     - `perf`: Performance improvement.
     - `test`: Adding or correcting tests.
     - `build`: Changes affecting build system or external dependencies (npm, vite, pnpm, cargo, spm).
     - `ci`: CI configuration files and scripts.
     - `chore`: Maintenance tasks, repo configs, tool updates.
   - Use the imperative, present tense: "add", "fix", "update", "refactor" (not "added", "fixing", "updates").
   - Breaking changes must include `!` before `:` (e.g., `feat(api)!: change response structure`) or a `BREAKING CHANGE:` footer.

2. **Ticket ID Prefix**:
   - If the current branch name (e.g., `feature/PROJ-123`, `bugfix/APP-456`) or repo conventions specify ticket prefixes, include it when appropriate: `[<TICKET-ID>] <type>(<scope>): <subject>`.

3. **Strong Bias Toward Granularity (Atomic Commits)**:
   - **One logical change per commit**: Do not lump unrelated or loosely related changes together. If a set of changes can be meaningfully isolated while keeping each commit working and buildable, split them into separate commits.
   - **Never mix refactoring/formatting with functional changes**: Always isolate pure refactors, renames, or lint fixes from behavioral changes (`feat` or `fix`).
   - **Isolate dependencies, data models, logic, UI, and tests**: Whenever possible, commit foundational changes (dependencies, types, schema migrations) before consuming logic, followed by UI changes, test suites, and documentation.
   - **Hunk-level separation**: When a single file contains both unrelated cleanups (or formatting) and a functional change, stage them separately using hunk/patch staging (`git add -p`) or by committing changes incrementally.

4. **Approval Before Mutation**:
   - Present the staged files and proposed commit message(s) to the user before running `git commit`, unless the user explicitly requested direct execution (e.g., *"commit these changes"*, *"auto-commit"*).

---

## Granular Commit Decomposition Examples

### Example 1: Full-Stack Feature Addition
❌ **Monolithic (Avoid)**:
`feat(auth): add google oauth login, database schema, buttons, and tests`

✅ **Granular Sequence (Preferred)**:
1. `build(deps): add @auth/core and oauth packages` (dependency updates)
2. `feat(db): define user oauth credentials schema and migration` (schema / types)
3. `feat(auth): implement google oauth exchange handler` (core business logic)
4. `feat(ui): add google sign-in button to login view` (UI / presentation)
5. `test(auth): add integration tests for oauth callback` (tests)
6. `docs(auth): document required google client env variables` (documentation)

### Example 2: Bug Fix with Preparatory Refactoring
❌ **Monolithic (Avoid)**:
`fix(cart): clean up discount calculation and fix negative price bug with tests`

✅ **Granular Sequence (Preferred)**:
1. `refactor(cart): extract discount computation into pure helper function` (safe refactor)
2. `fix(cart): prevent negative total when discount exceeds subtotal` (the actual fix)
3. `test(cart): add unit tests for zero and negative discount edge cases` (regression tests)

### Example 3: Mixed Formatting and Functional Changes in Same Area
❌ **Monolithic (Avoid)**:
`fix(api): format controller and add validation for page limit`

✅ **Granular Sequence (Preferred)**:
1. `style(api): reformat user controller according to prettier/linter rules`
2. `fix(api): enforce maximum limit of 100 on pagination query parameter`

---

## Workflow

### Step 1: Inspect Working Tree Changes

1. **Check Status & Diffs**:
   - Run `git status -s` to view modified, untracked, and staged files.
   - Run `git diff` to inspect unstaged changes.
   - Run `git diff --cached` to inspect already staged changes.
2. **Check for Empty State**:
   - If there are no modified or staged files, inform the user that the working tree is clean.

---

### Step 2: Plan Granular Commits

1. **Analyze File & Hunk Boundaries**:
   - Break changes down into the smallest logical, self-contained units.
   - Order commits logically so that dependencies/foundations come first:
     1. Dependencies / build scripts (`build` or `chore`)
     2. Types, schemas, constants, or migrations (`feat` or `refactor`)
     3. Backend / services / core algorithms (`feat` or `fix`)
     4. UI components / client views (`feat` or `fix`)
     5. Tests (`test`)
     6. Documentation (`docs`)
2. **Handle Intertwined Files**:
   - If a single file contains both styling/refactor and functional logic, stage only the relevant hunks (e.g. with `git add -p` or selective staging) for each step.
3. **Avoid Unwanted Artifacts**:
   - Never stage temporary files, scratch scripts, local environment files (`.env.local`), or build artifacts (`.next/`, `dist/`).

---

### Step 3: Run Pre-Commit Quality Checks

If project rules or repository instructions require pre-commit validation:
- Run formatters/linters (e.g., `pnpm format`, `pnpm lint`, `pnpm typecheck`).
- Run affected unit tests (e.g., `pnpm test` or `pnpm test:staged`).
- Ensure each intermediate commit leaves the project in a buildable/testable state without breaking compilation.

---

### Step 4: Draft Conventional Commit Message for Each Granular Step

1. **Determine Scope & Subject**:
   - Scope: Specific module or directory affected (e.g., `db`, `auth`, `ui`, `adapter`, `jobs`).
   - Subject: Concise summary (under 72 characters) focusing strictly on this granular unit.
2. **Optional Body & Footer**:
   - Add a body when the rationale or non-obvious design decision warrants explanation.
   - Reference issues in footer if relevant (e.g., `Refs: PROJ-123`).

---

### Step 5: Present & Execute Commits Sequentially

1. **Present Granular Plan to User**:
   - List the sequence of proposed commits with target files and messages.
2. **Execute Iteratively**:
   - For each planned commit:
     ```bash
     git add <target-files-for-this-step>
     git commit -m "<type>(<scope>): <subject>"
     ```
3. **Verify Result**:
   - Run `git log -n <count> --stat` to verify each commit was created cleanly.
   - Report the commit sequence and summaries to the user.
