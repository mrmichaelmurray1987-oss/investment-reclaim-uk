/*
 * Pulls the human-readable copy out of a page's <script data-dc-script> block.
 *
 * Why: support.js renders these pages client-side, and a lot of the copy (FAQ
 * answers, claim types, guides, the how-it-works steps) lives inside that script
 * as JavaScript data. A crawler that does not run JS sees {{ placeholders }}.
 * This evaluates the component's renderVals() against stubs and prints the plain
 * text it produces, as JSON, so prerender.py can bake it into the page.
 *
 * Usage: node tools/extract-content.js site/faq.dc.html
 */
const fs = require('fs');

const src = fs.readFileSync(process.argv[2], 'utf8');
const m = src.match(/<script[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/);
if (!m) { process.stdout.write('null'); process.exit(0); }

// Stubs standing in for the browser + React the real runtime provides.
const React = { createElement: () => ({ __element: true }) };
class DCLogic {
  constructor() { this.state = {}; }
  setState() {}
}
const window = { matchMedia: () => ({ matches: true }) };
const document = { querySelectorAll: () => [], getElementById: () => null };
function IntersectionObserver() { this.observe = () => {}; this.disconnect = () => {}; }

let vals;
try {
  const Component = eval(m[1] + '\n; Component');
  const instance = new Component();
  if (instance.state === undefined) instance.state = {};
  vals = typeof instance.renderVals === 'function' ? instance.renderVals() : null;
} catch (err) {
  process.stderr.write('extract failed: ' + err.message + '\n');
  process.exit(1);
}

// Keys that hold styling or icons rather than copy.
const SKIP = /^(icon|iconstyle|style|styles|onclick|ontoggle|onselect|href|src|id|key|color|background|transform|isopen|open|num)$/i;

function clean(node) {
  if (node == null) return null;
  if (typeof node === 'string') {
    const s = node.trim();
    // discard CSS-ish leftovers: no spaces, or obvious units/functions
    if (!s || /^[\d.]+(px|em|rem|%|deg|s|ms)$/.test(s) || /^(#|rgba?\(|var\()/.test(s)) return null;
    return s;
  }
  if (typeof node !== 'object') return null;
  if (node.__element) return null;
  if (Array.isArray(node)) {
    const out = node.map(clean).filter(Boolean);
    return out.length ? out : null;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (SKIP.test(k) || typeof v === 'function') continue;
    const c = clean(v);
    if (c !== null) out[k] = c;
  }
  return Object.keys(out).length ? out : null;
}

process.stdout.write(JSON.stringify(clean(vals), null, 1));
