# Agent Skills

A collection of high-productivity AI agent skills following the open [Agent Skills](https://skills.sh) standard. These skills extend AI coding agents (such as Claude Code, Gemini CLI, Cursor, Codex, Windsurf, OpenCode, and others) with specialized workflows for git automation, pull request management, visual demo capture, and GitHub media attachments.

---

## Skills Included

| Skill | Description | Key Tools / Dependencies |
| :--- | :--- | :--- |
| [`demo-capture`](skills/demo-capture/SKILL.md) | Capture retina screenshots (PNG) and video recordings across Web, iOS Simulator, and Android Emulator headlessly. | Playwright, `xcrun simctl`, `adb`, `ffmpeg` |
| [`github-attach`](skills/github-attach/SKILL.md) | Upload images and video assets to GitHub issues/PRs via `gh --attach` or headless browser composer harvest. | GitHub CLI (`gh >= 2.99`) or Playwright |
| [`create-pr`](skills/create-pr/SKILL.md) | Analyzes branch commits/diffs, extracts ticket identifiers, and crafts structured, high-level pull requests. | GitHub MCP or `gh` CLI |
| [`make-commit`](skills/make-commit/SKILL.md) | Breaks down working tree changes into granular, atomic Conventional Commits with clean scope separation. | `git` |
| [`update-pr`](skills/update-pr/SKILL.md) | Inspects incremental delta changes against an existing PR and updates the title and high-level summary. | GitHub MCP or `gh` CLI |

---

## Installation

You can install any skill directly using the [`skills` CLI](https://skills.sh):

### 1. Install All Skills
```bash
# Add to current project
npx skills add nthungdev/agent-skills

# Or install globally across all coding agents on your machine
npx skills add nthungdev/agent-skills -g
```

### 2. Install a Specific Skill
```bash
# Install only make-commit
npx skills add nthungdev/agent-skills@make-commit -g

# Install demo-capture and github-attach
npx skills add nthungdev/agent-skills@demo-capture -g
npx skills add nthungdev/agent-skills@github-attach -g
```

### 3. Updating Installed Skills
Keep your skills up to date with the latest improvements:
```bash
npx skills update -g
```

---

## Prerequisites & Setup

### Environment Variables & Authentication

1. **GitHub CLI / MCP**:
   - For `create-pr`, `update-pr`, and `github-attach` (Path A):
     - Authenticate GitHub CLI: `gh auth login`
     - Verify with: `gh auth status`
   - Or configure your agent's GitHub MCP server with `GITHUB_PERSONAL_ACCESS_TOKEN`.

2. **Playwright (for `demo-capture` & `github-attach` web fallback)**:
   - Requires Node.js (v18+) and Playwright.
   - You can install Playwright in your project or in a dedicated scratch directory:
     ```bash
     mkdir -p ~/.demo-capture && cd ~/.demo-capture && npm init -y && npm install playwright
     ```

3. **FFmpeg (for video transcoding)**:
   - Recommended for web/iOS video conversion to compatible H.264 MP4:
     ```bash
     brew install ffmpeg
     ```

---

## Directory Structure

```text
agent-skills/
├── LICENSE
├── README.md
└── skills/
    ├── create-pr/
    │   └── SKILL.md
    ├── demo-capture/
    │   ├── SKILL.md
    │   ├── examples/
    │   │   └── demo.config.json
    │   └── scripts/
    │       ├── capture-android.sh
    │       ├── capture-ios.sh
    │       ├── capture.js
    │       └── ocr.swift
    ├── github-attach/
    │   ├── SKILL.md
    │   └── scripts/
    │       └── upload-to-github.js
    ├── make-commit/
    │   └── SKILL.md
    └── update-pr/
        └── SKILL.md
```

---

## License

[MIT](LICENSE) © Hung Nguyen
