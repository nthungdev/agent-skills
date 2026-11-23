#!/usr/bin/env node
/**
 * Contain-fit sizing for GitHub-hosted images. GitHub strips CSS (no object-fit/max-height)
 * but honors the HTML width/height attributes, so "contain" is computed here from the
 * image's real aspect ratio: scale to fit inside a W×H box, never upscale.
 *
 *   node fit-size.js [--box 640x480] <image>...                    # JSON: width/height per file
 *   node fit-size.js --rewrite <body.md> [--box 640x480] \
 *        --map "Before=$DEMO_DIR/before.png" --map "After=$DEMO_DIR/after.png"
 *       # rewrites ![alt](user-attachments url) into <img ... width height> in place
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_BOX = { w: 640, h: 480 };

function readHeader(file, bytes = 65536) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** Native pixel size of a PNG, JPEG, GIF or WebP; throws on anything else. */
function imageSize(file) {
  const b = readHeader(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length > 10 && b.toString("latin1", 0, 3) === "GIF") {
    return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  }
  if (b.length > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8L") {
      const v = b.readUInt32LE(21);
      return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
    }
    if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  throw new Error(`unsupported or unreadable image: ${file}`);
}

/** Contain-fit `{w,h}` into `box`; scale = min(box.w/w, box.h/h, 1). */
function fit(size, box = DEFAULT_BOX) {
  const scale = Math.min(box.w / size.w, box.h / size.h, 1);
  return { width: Math.max(1, Math.round(size.w * scale)), height: Math.max(1, Math.round(size.h * scale)) };
}

function fitFile(file, box = DEFAULT_BOX) {
  return fit(imageSize(file), box);
}

function parseBox(text) {
  const m = /^(\d+)x(\d+)$/i.exec(text || "");
  if (!m || +m[1] === 0 || +m[2] === 0) throw new Error(`--box must look like 640x480, got "${text}"`);
  return { w: +m[1], h: +m[2] };
}

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function rewrite(bodyFile, map, box) {
  const urlRe = /!\[([^\]]*)\]\((https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+)\)/gi;
  const missing = [];
  const out = fs.readFileSync(bodyFile, "utf8").replace(urlRe, (whole, alt, url) => {
    const file = map.get(alt);
    if (!file) {
      missing.push(alt);
      return whole;
    }
    const { width, height } = fitFile(file, box);
    return `<img src="${url}" alt="${escapeAttr(alt)}" width="${width}" height="${height}">`;
  });
  fs.writeFileSync(bodyFile, out);
  return missing;
}

function main(argv) {
  let box = DEFAULT_BOX;
  let body = null;
  const map = new Map();
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Error(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === "--box") box = parseBox(value());
    else if (flag === "--rewrite") body = value();
    else if (flag === "--map") {
      const v = value();
      const eq = v.indexOf("=");
      if (eq < 1) throw new Error(`--map needs alt=path, got "${v}"`);
      map.set(v.slice(0, eq), v.slice(eq + 1));
    } else files.push(flag);
  }
  if (body) {
    const missing = rewrite(body, map, box);
    for (const alt of missing) console.error(`fit-size: no --map for image alt "${alt}"; left unchanged`);
    process.exit(missing.length ? 1 : 0);
  }
  if (!files.length) throw new Error("usage: fit-size.js [--box WxH] <image>... | --rewrite <body.md> --map alt=path ...");
  const result = files.map((f) => ({ file: path.basename(f), ...imageSizeObj(f), ...fitFile(f, box) }));
  console.log(JSON.stringify(result, null, 2));
}

function imageSizeObj(file) {
  const { w, h } = imageSize(file);
  return { nativeWidth: w, nativeHeight: h };
}

module.exports = { imageSize, fit, fitFile, parseBox, DEFAULT_BOX };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`fit-size: ${err.message}`);
    process.exit(2);
  }
}
