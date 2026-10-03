const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pages = ['brand_editor', 'crm', 'daily_close', 'finance', 'inventory',
  'kitchen', 'monthly_control', 'orders', 'pos', 'recipe', 'reports',
  'settings', 'suppliers'];

for (const page of pages) {
  test(`${page}: one script-free home link and shared stylesheet`, () => {
    const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
    const links = [...html.matchAll(/<a\b[^>]*class="brewos-home-link"[^>]*>[\s\S]*?<\/a>/g)];
    assert.equal(links.length, 1);
    assert.match(links[0][0], /href="dashboard\.html"/);
    assert.match(links[0][0], />← หน้าหลัก<\/a>/);
    assert.doesNotMatch(links[0][0], /onclick|<button|target=/);
    assert.ok(html.indexOf(links[0][0]) < html.indexOf('<script', html.indexOf('<body')));
    assert.equal((html.match(/href="navigation\.css\?v=1"/g) || []).length, 1);
    assert.ok(fs.existsSync(path.join(root, 'dashboard.html')));
  });
}

test('all inline JavaScript still parses', () => {
  for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [index, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
      if (/\bsrc=|application\/ld\+json/.test(match[1])) continue;
      new vm.Script(match[2], { filename: `${file}:script-${index}` });
    }
  }
});

test('navigation is touch-sized, keyboard-visible and print-hidden', () => {
  const css = fs.readFileSync(path.join(root, 'navigation.css'), 'utf8');
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /position:\s*(fixed|absolute)/);
});
