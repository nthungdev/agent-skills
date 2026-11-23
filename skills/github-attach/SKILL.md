---
name: github-attach
description: >-
  Puts screenshots and screen recordings on a GitHub issue or pull request — in a comment or
  the description — even when the surrounding text is written through the GitHub API or MCP,
  which cannot upload files. Prefers the official `gh --attach` flag (GitHub CLI >= 2.99);
  falls back to a headless browser that attaches files through GitHub's web composer and
  harvests the resulting `user-attachments` URLs without posting. Use after demo-capture to
  attach demo assets to a PR, or for GitHub Enterprise Server where `--attach` is unsupported.
---

# GitHub attach

GitHub has no REST/GraphQL endpoint for issue and PR attachments: the upload flow
(`POST /upload/policies/assets`) is web-UI only and needs a `user_session` cookie plus a CSRF
token. This skill gets files onto a PR/issue anyway, and hands back URLs that any markdown
body can reference — including bodies written by GitHub MCP.

## When to use

- `demo-capture` produced PNGs and WebM recordings under its resolved `$DEMO_DIR` and they belong on
  a PR (description or verification comment).
- The PR body/comment is written via GitHub MCP or the API, so the text cannot carry the
  file itself.
- GitHub Enterprise Server, or a `gh` release older than v2.99.

You do **not** need this skill when an asset already lives at a public URL — just link it.

## Choose the path

| Situation                                                    | Path                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| github.com and `gh --version` >= 2.99                        | **A: `gh --attach`** — official, simplest          |
| GHES, older `gh`, or body written by MCP/API                 | **B: browser harvest** — get URLs, then post the body |

Both paths end with a posted comment or description. Per the sibling skills, **show the
user the draft body and asset list and wait for approval before posting** unless they asked
for auto-apply.

## Media limits and prep

| Media                          | Limit                                  |
| ------------------------------ | -------------------------------------- |
| Images/GIFs (png, gif, jpg, svg) | 10 MB                                |
| Video on free plans            | 10 MB                                  |
| Video on paid plans            | 100 MB                                 |
| Other files                    | 25 MB                                  |
| `gh --attach` files per command | 50                                    |

Supported video: `.mp4`, `.mov`, `.webm`; GitHub recommends **H.264** for compatibility.
`demo-capture` emits `.webm`, so transcode with the **system ffmpeg** (Homebrew). Do not use
the Playwright-bundled `ffmpeg-mac` — it is built with `--disable-everything` (webm/vp8 only)
and cannot produce H.264 MP4.

```bash
ffmpeg -y -i $DEMO_DIR/videos/flow.webm \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -vf scale='min(1280,iw)':-2 -movflags +faststart \
  $DEMO_DIR/videos/flow.mp4
stat -f%z $DEMO_DIR/videos/flow.mp4   # under 10MB wins; raise -crf (28 -> 32 -> 36) or cut length otherwise
```

Oversized PNGs (over 10 MB): re-capture at `deviceScaleFactor: 1`, or downscale with the
same system ffmpeg (`-vf scale='min(2560,iw)':-2`).

## Image size (always set one)

`![alt](url)` renders at the image's native width up to the column, so retina and phone
captures (a 1179×2556 iPhone screenshot) fill the whole PR. GitHub strips CSS (no
`object-fit`, no `max-height`) but honors the HTML `width`/`height` attributes, so every posted
image must be an `<img>`. Never hardcode one width: that fixes portrait but leaves landscape too
tall or too small. Contain-fit instead: `scripts/fit-size.js` reads each image's real aspect
ratio and scales it to fit inside a box (default **640×480**, never upscaled), emitting both
attributes:

| Capture (native)       | Result in 640×480 box |
| ---------------------- | --------------------- |
| iPhone 1179×2556       | `width="221" height="480"` (height-limited) |
| Desktop 2560×1600      | `width="640" height="400"` (width-limited) |
| Small crop 300×200     | `300×200` (not upscaled) |

```html
<p>
  <img src="https://github.com/user-attachments/assets/<uuid>" alt="Before" width="221" height="480">
  <img src="https://github.com/user-attachments/assets/<uuid>" alt="After" width="221" height="480">
</p>
```

Keep several screenshots in one `<p>` so they sit side by side; for side-by-side landscape pairs
use a narrower box (`--box 380x480`). Videos cannot be sized: GitHub only renders a **bare**
`user-attachments` URL on its own line as a player, so leave videos as bare URLs. Path B emits
this format directly (`--image-box`); Path A uses `fit-size.js --rewrite` below because
`gh --attach` always inserts `![alt](url)`.

## Path A — `gh --attach`

Requires `gh` >= 2.99 (check with `gh --version`); unsupported on GHES.

```bash
# Comment: screenshots inline, video as an inline player
gh pr comment 42 \
  --body-file /tmp/pr-comment.md \
  --attach "$DEMO_DIR/before.png#Before" \
  --attach "$DEMO_DIR/after.png#After" \
  --attach $DEMO_DIR/videos/flow.mp4

# Description: rewrite references already present in the body, append the rest
gh pr edit 42 \
  --body-file /tmp/pr-body.md \
  --attach "$DEMO_DIR/before.png#Before" \
  --attach $DEMO_DIR/videos/flow.mp4
```

Behavior worth knowing:

- A local path referenced in the body (e.g. `![Before]($DEMO_DIR/before.png)`) is
  rewritten in place to the uploaded asset; anything attached but not referenced is appended.
- Alt text is `<path>#<alt>`; videos render as a player and take no alt text.
- `gh pr edit 42 --attach <file>` **without** `--body-file` keeps the current body and appends
  the attachment.
- Partial failures still update the PR; the command exits non-zero but still prints the PR URL.
- Works for issues too (`gh issue comment|create|edit --attach`).

Then apply the image size (required, see "Image size"). `gh` inserts `![alt](url)`, and
appended attachments land after everything, including any attribution footer, so rewrite
the posted body and move the assets where they belong:

```bash
gh pr view 42 --json body --jq .body > /tmp/pr-body.md
# ![alt](user-attachments url) -> <img ... width height>, contain-fit per image.
# --map alt=local file (alt is the text after # in --attach); videos (bare URLs) are left alone
node <skill-path>/scripts/fit-size.js --rewrite /tmp/pr-body.md --box 640x480 \
  --map Before=$DEMO_DIR/before.png --map After=$DEMO_DIR/after.png
# edit /tmp/pr-body.md: group the <img> lines in one <p>, move them and the video URL into
# the Demo section, keep the footer last; then:
gh pr edit 42 --body-file /tmp/pr-body.md
gh pr view 42 --json body --jq .body | grep -c 'height="'   # one per image
```

For a comment, edit it the same way (`gh api -X PATCH repos/<o>/<r>/issues/comments/<id> -F body=@/tmp/comment.md`).

## Path B — browser harvest

Drives a persistent, signed-in Chromium; attaches the files through the real composer
(hidden file input, the modern composer's "Add Files" file chooser, or a synthesized drop)
and reads the inserted `https://github.com/user-attachments/assets/<uuid>` URLs **without
posting**, then clears the draft. GitHub may insert markdown images, raw HTML media, or bare
video URLs depending on the composer; the script normalizes all of them to plain URLs plus a
markdown block. Assets inherit the repo's visibility (private-repo uploads stay auth-gated),
and the URLs can be pasted into any markdown in that repo.

### One-time setup and login

Run login using your local Node/Playwright environment or dedicated directory (e.g., `~/.demo-capture`):

```bash
node <skill-path>/scripts/upload-to-github.js --login
```

A headed browser opens; sign in (2FA included) and leave it. The session is stored in
`~/.github-attach/profile` (mode 0700) and reused headlessly afterwards.

### Harvest

```bash
node <skill-path>/scripts/upload-to-github.js \
  --pr https://github.com/<owner>/<repo>/pull/42 \
  --file $DEMO_DIR/before.png \
  --file $DEMO_DIR/videos/flow.mp4 \
  --image-box 640x480 \
  --out /tmp/gh-upload-proj-123.json
```

Prints JSON: `files[].url` (mapped by alt text, then media type, then upload order — check
`matchedBy` and `warnings`) plus a ready `markdown` block; `method` records which attach
path worked. In `markdown`, images are `<img ... width height>` grouped in one
`<p>` per run of consecutive images, contain-fit into `--image-box <WxH>` (default 640x480,
aspect preserved, never upscaled), and videos stay bare URLs. `--image-width <px>` is a legacy
width-only override (`0` for plain `![alt](url)`). Optional `--screenshot <png>` captures the composer as evidence before it is
cleared.

### Post the body

Compose the comment/description with the harvested URLs, then post it through the normal
channel — `gh pr comment`, `gh pr edit --body-file`, GitHub MCP `update_pull_request`, etc.
The browser is only needed for the upload, so the write still goes through the usual
approved tooling.

### Exit codes

| Code | Meaning                                       | Fix                                      |
| ---- | --------------------------------------------- | ---------------------------------------- |
| 2    | Usage/input (bad URL, missing file, too big)  | Fix the arguments                        |
| 3    | Not logged in or session expired              | Run `--login`                            |
| 4    | Composer not found                            | Confirm the PR/issue URL opens, retry    |
| 5    | Attach failed                                 | Retry; smaller files if the drop fallback |
| 6    | No asset URLs before timeout                  | Check size/type limits, re-run           |
| 7    | Composer already has a draft                  | Clear it, or rerun with `--force`        |
| 8    | Unexpected                                    | Read the stack trace                     |

## Verify

```bash
# The markdown landed with GitHub-hosted URLs
gh pr view 42 --json comments,body --jq '.body, (.comments[].body)' \
  | grep -o 'user-attachments/assets/[0-9a-f-]*' | sort -u

# No unsized images slipped through (expect 0)
gh pr view 42 --json body --jq .body | grep -c '!\[[^]]*\](https://github.com/user-attachments'
```

Optionally confirm rendering in the same browser profile: reopen the PR, and check that
`img[src*="user-attachments"]` / `video` elements exist for the comment anchor.

## Notes and safety

- The uploader host-gates to `https://github.com/*` issue/PR URLs: the local file is
  attached to whatever page it opens, and only GitHub mints `user-attachments` URLs.
- The profile directory holds account-equivalent session cookies — keep it 0700, never
  commit it, never point `--profile` at a repo working tree.
- The uploader never submits and never clobbers a non-empty draft without `--force`; it
  clears only the draft it created.
- Demo assets stay out of git (`$DEMO_DIR` is git-ignored or outside the repo); they live on GitHub.
