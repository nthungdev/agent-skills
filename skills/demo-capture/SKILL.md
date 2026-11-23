---
name: demo-capture
description: Capture screenshots (PNG) and screen recordings (WebM/MP4) across Web, iOS, Android, and other app platforms. Attempts headless execution first (Playwright headless Chromium, headless iOS Simulator via simctl, headless Android emulator via -no-window/adb) before falling back to headed/GUI mode if needed. Use for demo screenshots, walkthrough videos, product captures, or PR/ticket demo assets.
---

# Demo capture

Record high-resolution screenshots and smooth screen recordings across **Web, iOS,
Android, and desktop platforms** without stealing macOS window focus or interrupting
the user.

## Core Rule: Headless-First Execution

**Always attempt to run the application, simulator, emulator, or browser in headless mode first.**

- **Why:** Headless mode boots faster, uses fewer system resources, avoids focus-stealing
  window popups, and operates reliably in background agent sessions without needing
  display permissions.
- **Graceful Fallback:** If headless execution fails (e.g. headless simulator rendering
  fails, GPU/OpenGL shaders fail in headless Android emulator, or a test runner strictly
  demands a display server), fall back to headed / visible window mode, and log the reason.

## When to use

- "Capture a screenshot of this page / screen", "record this flow", "make a demo video of the feature".
- Producing demo assets for a PR, ticket, or review across web or mobile apps.
- Getting those assets onto a GitHub PR (hand off to **github-attach**) or Linear ticket (hand off to **linear-ticket-e2e**).

---

## Output Directory (resolve first)

Resolve the output directory once, before any capture, and use the printed **absolute** path
everywhere `$DEMO_DIR` appears below (shell variables do not persist between agent tool calls):

```bash
TICKET=<ticket-or-branch>
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$ROOT" ] && git -C "$ROOT" check-ignore -q "tmp/demos/$TICKET/x.png"; then
  DEMO_DIR="$ROOT/tmp/demos/$TICKET"          # repo tmp/ is git-ignored
else
  BASE="${TMPDIR:-/tmp}"
  DEMO_DIR="${BASE%/}/demos/$(basename "${ROOT:-$PWD}")/$TICKET"   # user's temp dir
fi
mkdir -p "$DEMO_DIR/videos" && echo "$DEMO_DIR"
```

- Use the repo's `tmp/demos/` only when git already ignores it. Never edit `.gitignore` to make it fit.
- Otherwise use the user's temp dir (`$TMPDIR`, falling back to `/tmp`), namespaced by repo name.

---

## 1. Web Apps (Playwright)

Targets browser apps (React, Next.js, Vite, Vue, Svelte, static localhost servers, etc.).

### Prerequisites
- **Node.js**: v18 or later
- **Playwright**: Installed in your project (`npm i -D playwright`) or globally/in a scratch directory:
  ```bash
  mkdir -p ~/.demo-capture && cd ~/.demo-capture && npm init -y && npm i playwright
  ```

### Workflow

1. **Start the app** if not running, and confirm the port (`pnpm dev`, `npm run dev`, etc.).
2. **Seed demo data** if required.
3. **Write a capture config** (see `examples/demo.config.json`).
4. **Run capture** (runs headless Chromium first by default):
   ```bash
   # Run using local playwright or from ~/.demo-capture:
   node <skill-path>/scripts/capture.js --config /abs/path/config.json
   ```
   If headless launch fails or `headless: false` is configured, `capture.js` automatically falls back to headed mode.

### Config schema

```jsonc
{
  "baseURL": "http://localhost:3000",
  "headless": true,                // default: true (attempt headless first)
  "fallbackToHeaded": true,        // default: true (fall back if headless fails)
  "viewport": { "width": 1280, "height": 800 },
  "deviceScaleFactor": 2,          // 2 = retina PNGs at 2560x1600
  "outputDir": "<absolute $DEMO_DIR>",
  "auth": {                        // optional
    "path": "/sign-in",
    "username": "admin",
    "password": "password",
    "usernameLabel": "Username",
    "passwordLabel": "Password",
    "buttonName": "Sign in"
  },
  "scenes": [
    {
      "name": "feature-scroll",
      "url": "/listing/products",
      "recordVideo": true,
      "steps": [
        { "type": "waitForSelector", "selector": "tbody tr[data-index]" },
        { "type": "screenshot", "name": "feature-top" },
        { "type": "scroll", "selector": "div.overflow-auto", "target": 10000, "duration": 9000 },
        { "type": "screenshot", "name": "feature-bottom" }
      ]
    }
  ]
}
```

### Step types

| `type`            | fields                                    | notes |
| ----------------- | ----------------------------------------- | ----- |
| `goto`            | `url`, `waitUntil?` (default `networkidle`) | navigate within a scene |
| `waitForSelector` | `selector`, `timeout?` (default 15000)    | waits for a row/element |
| `wait`            | `ms`                                       | fixed pause |
| `screenshot`      | `name`                                     | saves `outputDir/<name>.png` |
| `scroll`          | `selector`, `target`, `duration`           | eased smooth scroll (good for video) |
| `click`           | `selector`, `index?` (default 0)           | `page.locator(sel).nth(i).click()` |

---

## 2. iOS Apps (Simulator & simctl)

Targets iOS applications (Swift, SwiftUI, React Native, Expo, Flutter).

### Headless-First Strategy

1. **Boot simulator headlessly (no `Simulator.app` window):**
   ```bash
   # Find target device UDID or name
   xcrun simctl list devices available | grep "iPhone"
   # Boot headlessly in background daemon mode
   xcrun simctl boot <device_udid_or_name>
   ```
2. **Install & Launch App:**
   ```bash
   xcrun simctl install <device_udid> /path/to/App.app
   xcrun simctl launch <device_udid> <bundle_id>
   ```
3. **Capture:**
   - **Screenshot:**
     ```bash
     xcrun simctl io <device_udid> screenshot $DEMO_DIR/<name>.png
     ```
   - **Video Recording:**
     ```bash
     xcrun simctl io <device_udid> recordVideo $DEMO_DIR/videos/<name>.mp4 &
     REC_PID=$!
     # ... run flow or sleep ...
     kill -2 $REC_PID
     ```
4. **Automated Helper Script:**
   ```bash
   # Screenshot:
   <skill-path>/scripts/capture-ios.sh \
     --device "iPhone 16" \
     --output-dir $DEMO_DIR \
     --screenshot feature-home

   # Video recording (e.g. 8 seconds):
   <skill-path>/scripts/capture-ios.sh \
     --device "iPhone 16" \
     --bundle-id com.example.app \
     --output-dir $DEMO_DIR \
     --record feature-walkthrough \
     --duration 8
   ```
5. **Fallback to Headed:**
   If `simctl io` or headless boot fails (e.g. rendering failure), launch the GUI:
   ```bash
   open -a Simulator --args -CurrentDeviceUDID <device_udid>
   ```
6. **Teardown:**
   ```bash
   xcrun simctl shutdown <device_udid>
   ```

---

## 3. Android Apps (Emulator & ADB)

Targets Android applications (Kotlin, Compose, React Native, Expo, Flutter).

### Headless-First Strategy

1. **Boot emulator headlessly (`-no-window`):**
   ```bash
   # List available AVDs
   emulator -list-avds
   # Boot emulator in headless mode with software GPU
   emulator -avd <avd_name> -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
   # Wait for boot completion
   adb wait-for-device
   while [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" != "1" ]; do sleep 2; done
   ```
2. **Install & Launch App:**
   ```bash
   adb install -r /path/to/app.apk
   adb shell am start -n <package_name>/<activity_name>
   ```
3. **Capture:**
   - **Screenshot:**
     ```bash
     adb exec-out screencap -p > $DEMO_DIR/<name>.png
     ```
   - **Video Recording:**
     ```bash
     adb shell screenrecord /sdcard/demo.mp4 &
     # ... run flow or sleep ...
     adb shell pkill -2 screenrecord
     adb pull /sdcard/demo.mp4 $DEMO_DIR/videos/<name>.mp4
     adb shell rm -f /sdcard/demo.mp4
     ```
4. **Automated Helper Script:**
   ```bash
   # Screenshot:
   <skill-path>/scripts/capture-android.sh \
     --output-dir $DEMO_DIR \
     --screenshot feature-home

   # Video recording (e.g. 8 seconds):
   <skill-path>/scripts/capture-android.sh \
     --package com.example.app \
     --output-dir $DEMO_DIR \
     --record feature-walkthrough \
     --duration 8
   ```
5. **Fallback to Headed:**
   If headless emulator fails to start or GPU emulation crashes, kill the background process and start headed:
   ```bash
   emulator -avd <avd_name> &
   adb wait-for-device
   ```
6. **Teardown:**
   ```bash
   adb emu kill
   ```

---

## 4. Other Platforms (Desktop / CLI)

- **Electron / Desktop Webviews:** Attempt `--headless=new` or run with a virtual display (`xvfb-run` on Linux or headless runner). Fall back to windowed mode if required.
- **Terminal / CLI tools:** Use `vhs` (which generates headless recordings) or `asciinema`.

---

## Captions in recordings

When a recording needs burned-in captions (what is being done, what was wrong, what is right now), inject them into the page; `capture.js` has no caption step.

- **Place the caption bar at the top of the frame.** Video players draw their controls (HUD) over the bottom of the video, which hides a bottom caption. Never use `bottom: 0`.
- Keep the BEFORE / AFTER badge inside the same bar (a chip at its left edge), not in a separate corner, so nothing else competes for the top-right or bottom of the frame.
- Use a fixed bar, font >= 18px, high contrast, `pointer-events: none`, and hold each caption >= 2.5 s. Inject it before `page.screenshot` too, so PNGs match the video.
- The bar covers the top of the app. Capture flows that need the app's top bar with the bar hidden for that step, or add top padding to the page body while the bar shows.

```js
await page.evaluate((text) => {
  let bar = document.getElementById("demo-caption");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "demo-caption";
    bar.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;gap:12px;align-items:center;" +
      "padding:12px 20px;font:600 18px/1.35 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.8);pointer-events:none";
    document.body.appendChild(bar);
  }
  bar.textContent = text;
}, "AFTER (this PR): the toggle announces its state");
```

## Verification

### OCR Verification (macOS Vision)
The agent cannot view images directly, so verify that captured screenshots contain expected text and labels:
```bash
swiftc -o /tmp/ocr <skill-path>/scripts/ocr.swift
/tmp/ocr $DEMO_DIR/*.png
```
Confirm the OCR text contains expected rows, buttons, or headers.

### Video Duration Verification
Verify recording lengths with bundled or system `ffmpeg`:
```bash
for f in $DEMO_DIR/videos/*; do ffmpeg -i "$f" 2>&1 | grep Duration; done
```

---

## Output Organization & Hand-off

Save all outputs into `$DEMO_DIR/`:
```
$DEMO_DIR/
  ├── <feature>-top.png
  ├── <feature>-bottom.png
  └── videos/
      └── <feature>-walkthrough.webm (or .mp4)
```

- **Never commit captured assets:** `$DEMO_DIR` is either git-ignored or outside the repo.
- **Hand-off to PR:** Use the **github-attach** skill to upload assets to GitHub and obtain clean image links.
- **Hand-off to Linear:** Use the **linear-ticket-e2e** skill to upload assets to Linear tickets.
