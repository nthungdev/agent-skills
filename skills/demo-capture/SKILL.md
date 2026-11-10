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
  "outputDir": "/abs/path/demos/<ticket>",
  "auth": {                        // optional
    "path": "/sign-in",
    "username": "superadmin",
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
     xcrun simctl io <device_udid> screenshot demos/<ticket>/<name>.png
     ```
   - **Video Recording:**
     ```bash
     xcrun simctl io <device_udid> recordVideo demos/<ticket>/videos/<name>.mp4 &
     REC_PID=$!
     # ... run flow or sleep ...
     kill -2 $REC_PID
     ```
4. **Automated Helper Script:**
   ```bash
   # Screenshot:
   <skill-path>/scripts/capture-ios.sh \
     --device "iPhone 16" \
     --output-dir demos/<ticket> \
     --screenshot feature-home

   # Video recording (e.g. 8 seconds):
   <skill-path>/scripts/capture-ios.sh \
     --device "iPhone 16" \
     --bundle-id com.example.app \
     --output-dir demos/<ticket> \
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
     adb exec-out screencap -p > demos/<ticket>/<name>.png
     ```
   - **Video Recording:**
     ```bash
     adb shell screenrecord /sdcard/demo.mp4 &
     # ... run flow or sleep ...
     adb shell pkill -2 screenrecord
     adb pull /sdcard/demo.mp4 demos/<ticket>/videos/<name>.mp4
     adb shell rm -f /sdcard/demo.mp4
     ```
4. **Automated Helper Script:**
   ```bash
   # Screenshot:
   <skill-path>/scripts/capture-android.sh \
     --output-dir demos/<ticket> \
     --screenshot feature-home

   # Video recording (e.g. 8 seconds):
   <skill-path>/scripts/capture-android.sh \
     --package com.example.app \
     --output-dir demos/<ticket> \
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

## Verification

### OCR Verification (macOS Vision)
The agent cannot view images directly, so verify that captured screenshots contain expected text and labels:
```bash
swiftc -o /tmp/ocr <skill-path>/scripts/ocr.swift
/tmp/ocr demos/<ticket>/*.png
```
Confirm the OCR text contains expected rows, buttons, or headers.

### Video Duration Verification
Verify recording lengths with bundled or system `ffmpeg`:
```bash
for f in demos/<ticket>/videos/*; do ffmpeg -i "$f" 2>&1 | grep Duration; done
```

---

## Output Organization & Hand-off

Save all outputs into `demos/<ticket>/`:
```
demos/<ticket>/
  ├── <feature>-top.png
  ├── <feature>-bottom.png
  └── videos/
      └── <feature>-walkthrough.webm (or .mp4)
```

- **`demos/` is untracked:** Never commit captured assets into git.
- **Hand-off to PR:** Use the **github-attach** skill to upload assets to GitHub and obtain clean image links.
- **Hand-off to Linear:** Use the **linear-ticket-e2e** skill to upload assets to Linear tickets.
