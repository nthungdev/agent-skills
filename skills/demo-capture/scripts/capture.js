/**
 * Demo capture: screenshots (PNG) + screen recordings (WebM) via Playwright.
 *
 * Runs browser apps in headless mode first by default, with automatic fallback
 * to headed mode if headless execution encounters issues.
 *
 * Usage:
 *   node <skill-path>/scripts/capture.js --config /abs/config.json
 *
 * See SKILL.md for the config schema and step types.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");

// Resolve `playwright` relative to cwd, standard require, or ~/.demo-capture fallback.
function loadPlaywright() {
  try {
    const cwdReq = createRequire(path.join(process.cwd(), "__demo_capture__.js"));
    return cwdReq("playwright");
  } catch {
    try {
      return require("playwright");
    } catch {
      try {
        const homeReq = createRequire(path.join(os.homedir(), ".demo-capture", "__dummy__.js"));
        return homeReq("playwright");
      } catch (err) {
        console.error("Error: 'playwright' is required but not found in the current directory or ~/.demo-capture.");
        console.error("Install it with: npm install playwright (or in ~/.demo-capture)");
        process.exit(1);
      }
    }
  }
}

const { chromium } = loadPlaywright();

const SMOOTH_SCROLL = `
window.smoothScrollTo = async function (selector, target, duration) {
  const el = document.querySelector(selector);
  if (!el) return { error: "no scroll element: " + selector };
  const start = el.scrollTop;
  const dist = target - start;
  const t0 = performance.now();
  await new Promise((resolve) => {
    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      el.scrollTop = start + dist * eased;
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
  return { ok: true };
};
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    if (argv[i]?.startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.config) {
    console.error("usage: node capture.js --config /abs/config.json");
    process.exit(2);
  }
  return args;
}

function loadConfig(configPath) {
  const abs = path.resolve(configPath);
  const cfg = JSON.parse(fs.readFileSync(abs, "utf8"));
  cfg.outputDir = path.resolve(cfg.outputDir);
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  if (cfg.scenes.some((s) => s.recordVideo !== false)) {
    fs.mkdirSync(path.join(cfg.outputDir, "videos"), { recursive: true });
  }
  return cfg;
}

async function signIn(page, auth) {
  const a = { path: "/sign-in", ...auth };
  await page.goto(`${page._baseURL}${a.path}`, { waitUntil: "networkidle" });
  await page.getByLabel(a.usernameLabel).fill(a.username);
  await page.getByLabel(a.passwordLabel).fill(a.password);
  await page.getByRole("button", { name: a.buttonName }).click();
  await page.waitForURL((url) => !url.pathname.startsWith(a.path), {
    timeout: 15000,
  });
}

async function runStep(page, step) {
  switch (step.type) {
    case "goto":
      await page.goto(`${page._baseURL}${step.url}`, {
        waitUntil: step.waitUntil ?? "networkidle",
      });
      return;
    case "waitForSelector":
      await page.waitForSelector(step.selector, {
        timeout: step.timeout ?? 15000,
      });
      return;
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
    case "screenshot":
      await page.screenshot({
        path: path.join(page._outputDir, `${step.name}.png`),
        animations: "disabled",
      });
      return;
    case "scroll":
      await page.evaluate(
        (s) => smoothScrollTo(s.selector, s.target, s.duration),
        step,
      );
      return;
    case "click":
      await page.locator(step.selector).nth(step.index ?? 0).click();
      return;
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

async function runScene(browser, scene, cfg) {
  const videoDir = path.join(cfg.outputDir, "videos");
  const before = new Set(
    fs.existsSync(videoDir)
      ? fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"))
      : [],
  );

  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.deviceScaleFactor ?? 2,
    recordVideo:
      scene.recordVideo !== false
        ? { dir: videoDir, size: cfg.viewport }
        : undefined,
  });
  const page = await context.newPage();
  page._baseURL = cfg.baseURL;
  page._outputDir = cfg.outputDir;
  await page.addInitScript(SMOOTH_SCROLL);

  try {
    if (cfg.auth) await signIn(page, cfg.auth);
    if (scene.url) {
      await page.goto(`${cfg.baseURL}${scene.url}`, { waitUntil: "networkidle" });
    }
    for (const step of scene.steps ?? []) await runStep(page, step);
  } finally {
    await context.close();
  }

  if (scene.recordVideo !== false) {
    const created = fs
      .readdirSync(videoDir)
      .filter((f) => f.endsWith(".webm") && !before.has(f));
    if (created.length !== 1) {
      throw new Error(
        `expected exactly one video for scene ${scene.name}, got: ${created.join(", ")}`,
      );
    }
    fs.renameSync(
      path.join(videoDir, created[0]),
      path.join(videoDir, `${scene.name}.webm`),
    );
  }
  console.log(`scene ${scene.name} done`);
}

async function launchBrowser(cfg) {
  const preferHeadless = cfg.headless !== false;
  const allowFallback = cfg.fallbackToHeaded !== false;

  if (preferHeadless) {
    try {
      return await chromium.launch({
        headless: true,
        args: cfg.browserArgs ?? [],
      });
    } catch (err) {
      if (allowFallback) {
        console.warn(
          `[demo-capture:Web] Headless launch failed (${err.message}). Falling back to headed mode...`,
        );
        return await chromium.launch({
          headless: false,
          args: cfg.browserArgs ?? [],
        });
      }
      throw err;
    }
  }

  return await chromium.launch({
    headless: false,
    args: cfg.browserArgs ?? [],
  });
}

async function main() {
  const { config } = parseArgs(process.argv);
  const cfg = loadConfig(config);
  const browser = await launchBrowser(cfg);
  try {
    for (const scene of cfg.scenes) await runScene(browser, scene, cfg);
  } finally {
    await browser.close();
  }
  console.log(`DONE -> ${cfg.outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
