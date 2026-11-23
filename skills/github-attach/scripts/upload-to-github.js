#!/usr/bin/env node
/**
 * github-attach: upload images/videos to a GitHub issue or pull request through the
 * web composer and print the resulting user-attachments URLs WITHOUT posting anything.
 *
 * GitHub's upload endpoint (POST /upload/policies/assets) is web-UI only: it needs the
 * `user_session` cookie plus a CSRF token, and a PAT gets 422. So this drives a real
 * Chromium with a persistent, signed-in profile and lets the live composer perform the
 * upload; we only read back the inserted `https://github.com/user-attachments/assets/...`
 * URLs and then clear the draft.
 *
 * Usage:
 *   node upload-to-github.js --login
 *   node upload-to-github.js --pr https://github.com/owner/repo/pull/42 \
 *     --file $DEMO_DIR/before.png --file $DEMO_DIR/flow.mp4 \
 *     --out /tmp/gh-upload-proj-123.json
 *
 * See SKILL.md for the workflow. Exit codes:
 *   2 usage/input error   3 not logged in      4 composer not found
 *   5 attach failed       6 upload URL timeout 7 existing draft refused
 *   8 unexpected error
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { fitFile, parseBox, DEFAULT_BOX } = require("./fit-size.js");

// Resolve `playwright` relative to cwd, standard require, or ~/.demo-capture fallback.
function loadPlaywright() {
  try {
    const cwdReq = createRequire(path.join(process.cwd(), "__github_attach__.js"));
    return cwdReq("playwright");
  } catch {
    try {
      return require("playwright");
    } catch {
      try {
        const homeReq = createRequire(path.join(os.homedir(), ".demo-capture", "__dummy__.js"));
        return homeReq("playwright");
      } catch (err) {
        console.error("Error: 'playwright' is required for Path B browser upload but was not found.");
        console.error("Install it with: npm install playwright (or in ~/.demo-capture)");
        process.exit(1);
      }
    }
  }
}

const { chromium } = loadPlaywright();

const DEFAULT_PROFILE = path.join(os.homedir(), ".github-attach", "profile");
const DEFAULT_TIMEOUT_MS = 180000;
const LOGIN_TIMEOUT_MS = 600000;
const DROP_FALLBACK_MAX_BYTES = 32 * 1024 * 1024;

// GitHub has two composer shapes and no single attribute identifies both:
//  1. the React body editor advertises "Markdown" via aria-label/placeholder;
//  2. the classic PR/issue comment box has a bare placeholder but carries
//     id="new_comment_field".
// Match on either signal; the same set is used to find and to target the composer.
const COMPOSER_SELECTOR =
  'textarea[placeholder*="Markdown" i], textarea[aria-label*="Markdown" i], textarea#new_comment_field';
const URL_G = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]+/g;
const PR_URL_RE =
  /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/(?:issues|pull)\/\d+\/?(?:[?#].*)?$/;
const MIME_BY_EXT = {
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function usage() {
  console.error(
    [
      "usage:",
      "  node upload-to-github.js --login [--profile <dir>] [--timeout <ms>]",
      "  node upload-to-github.js --pr <github issue/PR URL> --file <path> [--file <path> ...]",
      "                           [--out <json>] [--screenshot <png>] [--profile <dir>]",
      "                           [--timeout <ms>] [--image-box <WxH>] [--image-width <px>]",
      "                           [--headed] [--force]",
      "",
      "  --image-box <WxH>   contain-fit each <img> inside this box, keeping aspect ratio and",
      "                      never upscaling (default 640x480; fits portrait and landscape)",
      "  --image-width <px>  legacy: fixed width only, ignores height (0 = plain ![]())",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = { files: [], headless: true, imageBox: DEFAULT_BOX, imageWidth: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new AppError(2, `${flag} needs a value`);
      return argv[++i];
    };
    switch (flag) {
      case "--login":
        args.login = true;
        break;
      case "--headed":
        args.headless = false;
        break;
      case "--force":
        args.force = true;
        break;
      case "--pr":
        args.pr = value();
        break;
      case "--file":
        args.files.push(value());
        break;
      case "--out":
        args.out = value();
        break;
      case "--screenshot":
        args.screenshot = value();
        break;
      case "--profile":
        args.profile = value();
        break;
      case "--image-box":
        try {
          args.imageBox = parseBox(value());
        } catch (err) {
          throw new AppError(2, err.message);
        }
        break;
      case "--image-width":
        args.imageWidth = Number(value());
        if (!Number.isInteger(args.imageWidth) || args.imageWidth < 0) {
          throw new AppError(2, "--image-width must be a non-negative integer (0 disables)");
        }
        break;
      case "--timeout":
        args.timeout = Number(value());
        if (!Number.isFinite(args.timeout) || args.timeout <= 0) {
          throw new AppError(2, "--timeout must be a positive number of milliseconds");
        }
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        throw new AppError(2, `unknown argument: ${flag}`);
    }
  }
  return args;
}

function ensureProfileDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort; not fatal
  }
}

async function launchPersistentContext(profile, headless) {
  ensureProfileDir(profile);
  return chromium.launchPersistentContext(profile, {
    headless,
    viewport: { width: 1280, height: 900 },
  });
}

async function currentLogin(page) {
  return page
    .evaluate(() => (document.querySelector("meta[name=user-login]") || {}).content || "")
    .catch(() => "");
}

async function waitForLogin(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const login = await currentLogin(page);
    if (login) return login;
    if (Date.now() >= deadline) return "";
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function waitForComposer(page, timeoutMs) {
  try {
    await page.waitForSelector(COMPOSER_SELECTOR, { timeout: timeoutMs });
  } catch {
    return null;
  }
  return page.locator(COMPOSER_SELECTOR).first();
}

/**
 * Attach files to the composer, trying each shape GitHub uses:
 *   1. the classic composer's hidden `input[type=file]`;
 *   2. the modern composer's "Add Files" paperclip via Playwright's filechooser event;
 *   3. a synthesized drop (guarded to a sane payload size).
 * Each function returns true when it managed to hand the files over.
 */
async function attachViaFormInput(composer, files) {
  const formHandle = await composer.evaluateHandle((el) => el.closest("form"));
  const form = formHandle.asElement();
  const input = form ? await form.$('input[type="file"]') : null;
  if (!input) return false;
  try {
    await input.setInputFiles(files, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/** The modern comment composer uploads through its "Add Files" paperclip button. */
async function attachViaPaperclip(page, composer, files) {
  const scopes = [
    composer.locator('xpath=ancestor::*[contains(@class,"CommentBox")][1]'),
    page,
  ];
  for (const scope of scopes) {
    const button = scope
      .locator("button")
      .filter({ has: page.locator(".octicon-paperclip") })
      .last();
    if ((await button.count()) === 0) continue;
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10000 }).catch(() => null),
      button.click({ timeout: 5000 }).catch(() => {}),
    ]);
    if (!chooser) continue;
    try {
      await chooser.setFiles(files);
      return true;
    } catch {
      // keep trying other scopes / the drop fallback
    }
  }
  return false;
}

async function attachViaDrop(page, composer, files) {
  const totalBytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  if (totalBytes > DROP_FALLBACK_MAX_BYTES) {
    throw new AppError(
      5,
      `no file input found on the composer and the drop fallback caps at ${Math.round(
        DROP_FALLBACK_MAX_BYTES / 1024 / 1024,
      )}MB total (got ${Math.round(totalBytes / 1024 / 1024)}MB) — retry with fewer/smaller files`,
    );
  }
  const payload = files.map((file) => ({
    name: path.basename(file),
    type: MIME_BY_EXT[path.extname(file).toLowerCase()] || "application/octet-stream",
    b64: fs.readFileSync(file).toString("base64"),
  }));
  const dataTransfer = await page.evaluateHandle((items) => {
    const dt = new DataTransfer();
    for (const item of items) {
      const bin = atob(item.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], item.name, { type: item.type }));
    }
    return dt;
  }, payload);
  await composer.dispatchEvent("drop", { dataTransfer });
  return true;
}

/**
 * Poll the composer until one URL per file is present. Returns `{ value }` on success,
 * `{ retry: true }` when the composer shows no reaction at all within the grace period
 * (so another attach method can be tried), or `{}` when an upload was in flight but did
 * not finish before the deadline.
 */
async function waitForUploads(page, composer, expected, baseline, timeoutMs, graceMs = 30000) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  const graceDeadline = start + graceMs;
  let changed = false;
  for (;;) {
    const value = await composer.inputValue().catch(() => "");
    if ((value.match(URL_G) || []).length >= expected) return { value };
    if (value !== baseline) changed = true;
    const now = Date.now();
    if (now >= deadline) return changed ? {} : { retry: true };
    if (!changed && now >= graceDeadline) return { retry: true };
    await page.waitForTimeout(1000);
  }
}

async function clearComposer(composer) {
  await composer.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const USER_ATTACHMENT_URL = "https:\\/\\/github\\.com\\/user-attachments\\/assets\\/[0-9a-fA-F-]+";
// The composer may insert markdown images, raw HTML media, or bare video URLs
// (classic composer). Match all three shapes in document order.
const ASSET_RE = new RegExp(
  `!\\[([^\\]]*)\\]\\((${USER_ATTACHMENT_URL})\\)` +
    `|<(img)\\b([^>]*)>` +
    `|<(video|source)\\b([^>]*)>` +
    `|(${USER_ATTACHMENT_URL})`,
  "gi",
);
const HTML_SRC_RE = new RegExp(`src="(${USER_ATTACHMENT_URL})"`, "i");

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Images become `<img width height>` because GitHub strips CSS but honors those attributes.
 * The pair is computed by contain-fit into a box (fit-size.js), so portrait captures are
 * height-limited and landscape captures width-limited.
 * Consecutive images share one `<p>` so they sit side by side. Videos stay bare URLs:
 * GitHub only turns a bare user-attachments URL into a player, and the player can't be sized.
 */
function buildMarkdown(entries, { imageBox, imageWidth }) {
  const plain = imageWidth === 0;
  const sizeAttrs = (file) => {
    if (imageWidth) return `width="${imageWidth}"`;
    try {
      const { width, height } = fitFile(file, imageBox);
      return `width="${width}" height="${height}"`;
    } catch {
      return `width="${imageBox.w}"`;
    }
  };
  const alt = (file) =>
    path.basename(file).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  if (plain) {
    return entries
      .map((e) => (e.kind === "image" ? `![${alt(e.file)}](${e.url})` : e.url))
      .join("\n\n");
  }
  const blocks = [];
  let row = [];
  const flush = () => {
    if (row.length) blocks.push(`<p>\n${row.join("\n")}\n</p>`);
    row = [];
  };
  for (const e of entries) {
    if (e.kind === "image") {
      row.push(`  <img src="${e.url}" alt="${escapeAttr(alt(e.file))}" ${sizeAttrs(e.file)}>`);
    } else {
      flush();
      blocks.push(e.url);
    }
  }
  flush();
  return blocks.join("\n\n");
}

/** Parse inserted assets — markdown, HTML, or bare — in document order. */
function harvest(value) {
  const entries = [];
  for (const m of value.matchAll(ASSET_RE)) {
    if (m[2]) {
      entries.push({ kind: "image", alt: m[1], url: m[2] });
      continue;
    }
    if (m[3] || m[5]) {
      const attrs = (m[3] ? m[4] : m[6]) || "";
      const src = HTML_SRC_RE.exec(attrs);
      if (!src) continue;
      const alt = /\balt="([^"]*)"/i.exec(attrs);
      entries.push({ kind: m[3] ? "image" : "video", alt: alt ? alt[1] : null, url: src[1] });
      continue;
    }
    if (m[7]) entries.push({ kind: "video", alt: null, url: m[7] });
  }
  return entries;
}

/** Map harvested entries back to files: alt text, then media kind, then upload order. */
function mapFiles(entries, files) {
  const remaining = [...files];
  const fileKind = (file) =>
    [".mp4", ".mov", ".webm"].includes(path.extname(file).toLowerCase())
      ? "video"
      : "image";

  for (const entry of entries) {
    if (entry.alt === null) continue;
    const index = remaining.findIndex((file) => {
      const base = path.basename(file);
      return entry.alt === base || entry.alt === base.replace(/\.[^.]+$/, "");
    });
    if (index !== -1) {
      entry.file = remaining.splice(index, 1)[0];
      entry.matchedBy = "alt";
    }
  }

  for (const entry of entries.filter((e) => !e.file)) {
    const index = remaining.findIndex((file) => fileKind(file) === entry.kind);
    if (index !== -1) {
      entry.file = remaining.splice(index, 1)[0];
      entry.matchedBy = "type";
    }
  }

  const warnings = [];
  let matchedByPosition = false;
  for (const entry of entries.filter((e) => !e.file)) {
    entry.file = remaining.shift() ?? null;
    entry.matchedBy = "position";
    matchedByPosition = matchedByPosition || entry.file !== null;
  }
  if (matchedByPosition) {
    warnings.push(
      "some assets were matched by upload order, not filename — verify the mapping",
    );
  }
  if (remaining.length) {
    warnings.push(`no URL returned for: ${remaining.map((f) => path.basename(f)).join(", ")}`);
  }
  return warnings;
}

async function runUpload(args) {
  const profile = args.profile ?? DEFAULT_PROFILE;
  const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;

  if (!args.pr) throw new AppError(2, "--pr is required (or use --login)");
  if (!args.files.length) throw new AppError(2, "at least one --file is required");
  if (!PR_URL_RE.test(args.pr)) {
    throw new AppError(
      2,
      `--pr must be a github.com issue or pull request URL (got: ${args.pr})`,
    );
  }

  const files = args.files.map((file) => path.resolve(file));
  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new AppError(2, `file not found: ${file}`);
    }
    const { size } = fs.statSync(file);
    const ext = path.extname(file).toLowerCase();
    const isImage = [".png", ".gif", ".jpg", ".jpeg", ".svg", ".webp"].includes(ext);
    const isVideo = [".mp4", ".mov", ".webm"].includes(ext);
    if (isImage && size > 10 * 1024 * 1024) {
      throw new AppError(
        2,
        `image exceeds GitHub's 10MB limit: ${file} (${Math.round(size / 1024 / 1024)}MB) — downscale it first`,
      );
    }
    if (isVideo && size > 100 * 1024 * 1024) {
      throw new AppError(
        2,
        `video exceeds GitHub's 100MB limit: ${file} (${Math.round(size / 1024 / 1024)}MB) — compress it first`,
      );
    }
    if (isVideo && size > 10 * 1024 * 1024) {
      console.error(
        `github-attach: note: ${path.basename(file)} is ${Math.round(
          size / 1024 / 1024,
        )}MB; over 10MB only works on paid GitHub plans`,
      );
    }
  }

  const context = await launchPersistentContext(profile, args.headless);
  const page = context.pages()[0] ?? (await context.newPage());
  let mutated = false;
  let composer = null;
  try {
    await page.goto(args.pr, { waitUntil: "domcontentloaded", timeout: 60000 });

    const login = await waitForLogin(page, 20000);
    if (!login) {
      throw new AppError(
        3,
        "not logged in (or the session expired) — run: node upload-to-github.js --login",
      );
    }

    composer = await waitForComposer(page, 30000);
    if (!composer) {
      throw new AppError(4, `no comment composer found on ${args.pr}`);
    }

    const initial = await composer.inputValue().catch(() => "");
    if (initial.trim() && !args.force) {
      throw new AppError(
        7,
        "the composer already contains a draft; refusing to clobber it (rerun with --force to clear)",
      );
    }
    if (initial.trim()) await clearComposer(composer);
    const baseline = await composer.inputValue().catch(() => "");

    const attempts = [
      ["file-input", () => attachViaFormInput(composer, files)],
      ["file-chooser", () => attachViaPaperclip(page, composer, files)],
      ["drop", () => attachViaDrop(page, composer, files)],
    ];
    let method = null;
    let value = "";
    for (const [name, run] of attempts) {
      let started = false;
      try {
        started = await run();
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
      if (!started) continue;
      mutated = true;
      const outcome = await waitForUploads(page, composer, files.length, baseline, timeout);
      if (outcome.value) {
        method = name;
        value = outcome.value;
        break;
      }
      if (!outcome.retry) break; // upload in flight but timed out; don't duplicate it
    }
    if (!value) {
      throw new AppError(
        6,
        "upload did not yield user-attachments URLs before the timeout — check the size/type limits and the page state",
      );
    }

    const entries = harvest(value);
    if (entries.length < files.length) {
      throw new AppError(6, `expected ${files.length} asset URLs, found ${entries.length}`);
    }

    if (args.screenshot) {
      await composer.screenshot({ path: path.resolve(args.screenshot) }).catch(() => {});
    }

    const warnings = mapFiles(entries, files);
    const result = {
      pr: args.pr,
      account: login,
      method,
      files: entries.map((entry) => ({
        file: entry.file ? path.relative(process.cwd(), entry.file) || entry.file : null,
        name: entry.file ? path.basename(entry.file) : entry.alt,
        url: entry.url,
        matchedBy: entry.matchedBy ?? "position",
      })),
      markdown: buildMarkdown(entries.filter((entry) => entry.file), args),
      warnings,
    };

    for (const warning of warnings) console.error(`github-attach: warning: ${warning}`);
    for (const entry of result.files) {
      console.error(`github-attach: uploaded ${entry.name} -> ${entry.url}`);
    }
    return result;
  } finally {
    if (mutated && composer) {
      await clearComposer(composer).catch(() => {});
    }
    await context.close().catch(() => {});
  }
}

async function runLogin(args) {
  const profile = args.profile ?? DEFAULT_PROFILE;
  const context = await launchPersistentContext(profile, false);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto("https://github.com/login", { waitUntil: "domcontentloaded" });

    const existing = await currentLogin(page);
    if (existing) {
      console.error(`github-attach: already logged in as ${existing}`);
      return;
    }

    console.error(
      "github-attach: sign in to GitHub in the opened window (2FA included); waiting…",
    );
    const login = await waitForLogin(page, args.timeout ?? LOGIN_TIMEOUT_MS);
    if (!login) {
      throw new AppError(3, "sign-in was not completed before the timeout");
    }
    console.error(`github-attach: logged in as ${login}; session saved to ${profile}`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }
  if (!args.login && !args.pr) {
    usage();
    throw new AppError(2, "specify --login or --pr");
  }
  if (args.login) {
    await runLogin(args);
    return;
  }
  const result = await runUpload(args);
  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    const out = path.resolve(args.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${json}\n`);
    console.error(`github-attach: wrote ${out}`);
  }
  console.log(json);
}

main().catch((error) => {
  if (error instanceof AppError) {
    console.error(`github-attach: ${error.message}`);
    process.exit(error.code);
  }
  console.error(error);
  process.exit(8);
});
