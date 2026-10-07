// Vite settings: plain HTML pages and ES modules, plus one plugin, mascotTokens, that fills {{dotted.path}} tokens in the HTML pages (in
// the dev server and in the build) so that names, colours, file paths and every word of index.html come from two files:
//
//   mascot.config.json     {{character.name}} {{page.title}} {{palette.body}} {{frame.size}} {{page.poster}} ... (any key of the file)
//   src/page/copy.js       {{copy.hello.lede}} ... (the page's words; see the notes at the top of that file)
//   src/mascot-states.js   {{states.idle.status}} ... (the ten states' labels, titles and status lines)
//
// {name}, {product} and {tagline} inside any value are filled from `character`.  {{palette.body|hex}} prints a colour without its '#', in
// capitals.  Where a token lands decides how it is written: in text it is HTML-escaped and copy markup (*words* -> <em>, ==words== ->
// <span class="mascot-colour">) becomes tags; in an attribute or the <title> it is escaped and markup is refused; inside <style> or
// <script> only plain CSS-safe values (colours, numbers, names) are allowed.  An unknown token, a value that is not a string or a number,
// a placeholder left unfilled or refused markup stops the page (dev) or the build with an error naming the token.  Paths in the config
// are relative to the project root, so pages write them as "/{{page.icon}}".
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TOKEN = /\{\{\s*([\w.-]+)(?:\s*\|\s*(\w+))?\s*\}\}/g;
const SOURCES = { config: 'mascot.config.json', copy: 'src/page/copy.js', states: 'src/mascot-states.js' };

/** A module imported afresh whenever the file changes (node caches ES modules by URL, so the URL carries the file's mtime). */
const fresh = (rel) => import(`${pathToFileURL(resolve(ROOT, rel)).href}?v=${statSync(resolve(ROOT, rel)).mtimeMs}`);

async function loadContext() {
  const config = JSON.parse(readFileSync(resolve(ROOT, SOURCES.config), 'utf8'));
  const [{ COPY, fill }, { STATES }] = await Promise.all([fresh(SOURCES.copy), fresh(SOURCES.states)]);
  const { name, product, tagline } = config.character ?? {};
  return { data: { ...config, copy: COPY, states: STATES }, fill: (s) => fill(s, { name, product, tagline }) };
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const markup = (s) => s.replace(/==(.+?)==/g, '<span class="mascot-colour">$1</span>').replace(/\*(.+?)\*/g, '<em>$1</em>');
const FILTERS = { hex: (v) => String(v).replace(/^#/, '').toUpperCase() };

/** What surrounds offset `i` of the page: a tag's attributes, the title, a style or script block, or text. */
function contextAt(html, i) {
  if (html.lastIndexOf('<', i) > html.lastIndexOf('>', i)) return 'attribute';
  const before = html.slice(0, i).toLowerCase();
  const open = (tag) => before.lastIndexOf(`<${tag}`) > before.lastIndexOf(`</${tag}`);
  if (open('style') || open('script')) return 'raw';
  if (open('title')) return 'title';
  return 'text';
}

function fillTokens(html, { data, fill }, page) {
  return html.replace(TOKEN, (token, path, filter, offset) => {
    const fail = (why) => { throw new Error(`${page}: ${token} ${why}`); };
    let value = path.split('.').reduce((node, key) => (node != null && Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined), data);
    if (value === undefined) fail(`is not a key of ${Object.values(SOURCES).join(', ')}`);
    if (typeof value !== 'string' && typeof value !== 'number') fail('is not a string or a number');
    value = fill(String(value));
    if (filter) value = FILTERS[filter] ? FILTERS[filter](value) : fail(`uses an unknown filter "${filter}" (known: ${Object.keys(FILTERS).join(', ')})`);
    const left = /\{(\w+)\}/.exec(value);
    if (left) fail(`leaves the placeholder ${left[0]} unfilled (the page can fill only {name}, {product} and {tagline})`);
    const where = contextAt(html, offset), marked = markup(value) !== value;
    if (where === 'raw') return /^[\w#%.,() -]*$/.test(value) ? value : fail('is not a plain CSS value, so it cannot go inside <style> or <script>');
    if (where !== 'text' && marked) fail(`has copy markup (*...* or ==...==), which only works in text, not in ${where === 'title' ? 'the <title>' : 'an attribute'}`);
    return where === 'text' ? markup(escapeHtml(value)) : escapeHtml(value);
  });
}

function mascotTokens() {
  return {
    name: 'mascot-tokens',
    transformIndexHtml: {
      order: 'pre',                       // before Vite reads the page's URLs, so it sees /assets/... and not a token
      async handler(html, ctx) { return fillTokens(html, await loadContext(), ctx.filename ? ctx.filename.replace(`${ROOT}/`, '') : ctx.path); },
    },
    handleHotUpdate({ file, server }) {
      // the pages are filled when they are requested, so a change to a token source only needs the browser to ask again
      if (Object.values(SOURCES).some((rel) => resolve(ROOT, rel) === file)) server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({ plugins: [mascotTokens()] });
