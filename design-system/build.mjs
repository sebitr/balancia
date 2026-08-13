#!/usr/bin/env node
/**
 * Composes the Claude Design bundle.
 *
 * Each file in `src/pages/` is a body fragment whose first line is the
 * `@dsCard` marker the Design System pane indexes on. This script wraps every
 * fragment in a standalone document with `src/kit.css` inlined — the pane
 * renders each page in isolation, so nothing may reference a sibling file.
 *
 *   node design-system/build.mjs
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(root, "src", "pages");
const distDir = join(root, "dist");

const kit = readFileSync(join(root, "src", "kit.css"), "utf8");

/** Shared theme + demo-interaction script. Keep it dependency-free. */
const script = `(function () {
  var root = document.documentElement;
  function apply(mode) {
    root.classList.toggle('dark', mode === 'dark');
    var b = document.querySelector('[data-theme-toggle]');
    if (b) b.textContent = mode === 'dark' ? 'Light' : 'Dark';
  }
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  apply(root.dataset.theme || (mq.matches ? 'dark' : 'light'));
  mq.addEventListener('change', function (e) {
    if (!root.dataset.themeLocked) apply(e.matches ? 'dark' : 'light');
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-theme-toggle]')) {
      root.dataset.themeLocked = '1';
      apply(root.classList.contains('dark') ? 'light' : 'dark');
      return;
    }
    var s = e.target.closest('.switch');
    if (s) s.toggleAttribute('data-checked');
    var c = e.target.closest('.checkbox');
    if (c) c.toggleAttribute('data-checked');
    var r = e.target.closest('.radio');
    if (r) {
      var group = r.closest('[data-radio-group]');
      if (group) group.querySelectorAll('.radio').forEach(function (x) { x.removeAttribute('data-checked'); });
      r.setAttribute('data-checked', '');
    }
    var choice = e.target.closest('.field-choice');
    if (choice) {
      var input = choice.querySelector('.checkbox, .radio');
      if (input && input !== e.target.closest('.checkbox, .radio')) input.click();
      choice.toggleAttribute('data-checked', !!choice.querySelector('[data-checked]'));
    }
  });
})();`;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

rmSync(distDir, { recursive: true, force: true });

const built = [];
for (const file of walk(pagesDir).sort()) {
  const source = readFileSync(file, "utf8");
  const newline = source.indexOf("\n");
  const marker = source.slice(0, newline).trim();
  const body = source.slice(newline + 1).trimEnd();

  if (!marker.startsWith("<!-- @dsCard")) {
    throw new Error(
      `${relative(root, file)}: first line must be an @dsCard marker`,
    );
  }
  const name = /name="([^"]+)"/.exec(marker)?.[1];
  if (!name) {
    throw new Error(`${relative(root, file)}: @dsCard marker needs a name="…"`);
  }

  const html = `${marker}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Balancia</title>
<style>
${kit}</style>
</head>
<body>
<button data-theme-toggle class="btn btn--outline btn--sm" style="position:fixed;top:1rem;right:1rem;z-index:50">Dark</button>
${body}
<script>${script}</script>
</body>
</html>
`;

  const out = join(distDir, relative(pagesDir, file));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  built.push(relative(distDir, out));
}

console.log(`Built ${built.length} pages into design-system/dist:`);
for (const path of built) console.log(`  ${path}`);
