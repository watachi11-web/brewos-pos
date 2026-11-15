'use strict';
// Independently authored QA acceptance test. No import or execution of retest-v3.cjs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const os = require('node:os');
const { chromium } = require('playwright');
const OUT = process.env.QA_OUTPUT || 'evidence';
fs.mkdirSync(OUT, { recursive: true });
const SITE = 'https://watachi11-web.github.io/brewos-pos/staging/';
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxc_Cj6fp0Ro8naiKx7Of0oH7PbGkPKfbNs1MN1BRKFR8PBajzDxQUsNwye5PdNQsTPSw/exec';
const RELEASE = '2a0e10a901712ff79912aecb23de636d64fc48c6c76c9a6bd43c98331c6a7a6b';
const DATE = '2026-11-04';
const EXPECTED = { pending: [], making: [], ready: ['RCP-E2E2-DUAL-10f2848364ca', 'RCP-QA-20261104-SMOKE01', 'RCP-QA-20261104T135119'].sort() };
const HASHES = {
  'crm.html': '2680601ec0495a7a289c0c8c9073c99dc3cfd9d9d8249dad78ba4faeada125fd',
  'pos.html': '375c622dc3d74a1d74307e74f77dbefdbafffcfa799dbd85aaeebadab582878c',
  'kitchen.html': '1b9b9416d42e3b9f520d6069a258a4470b76df801b4ad04a3a20dd395b442c6a',
  'staging-guard.js': '0645c36b88151167e859c3c9cd5e69e711f12bc8a5c2b0d3674d7f833e69c22d',
  'api.js': 'b8bb00295f3fa6e593c58173b79d950aff1a3b9e668c48010af925d7db46de90'
};
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const report = {
  schema: 'brewos-independent-qa-e04-v1', author: 'QA', startedAt: new Date().toISOString(),
  status: 'BLOCKED', fixtureDate: DATE, expectedColumns: EXPECTED, site: SITE,
  baselineTestCommit: '880c43ecc42aa72043a81db5cb0cb3a6c46e07d9',
  frontendCommit: 'ec368c4c2e046d31ecaa55f35ecf55a4fbdb5a14',
  testSha256: sha(fs.readFileSync(__filename)),
  environment: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
    playwright: require('playwright/package.json').version, runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null, headSha: process.env.GITHUB_SHA || null },
  checks: [], files: {}, cycles: [], browserRequests: [], browserFailures: [], pageErrors: [], blockedRequests: []
};
const logFile = path.join(OUT, 'test.log');
function log(message, data) {
  const line = JSON.stringify({ time: new Date().toISOString(), message, ...(data === undefined ? {} : { data }) });
  fs.appendFileSync(logFile, line + '\n'); console.log(line);
}
function check(name, fn) { fn(); report.checks.push({ name, passed: true, time: new Date().toISOString() }); log('PASS ' + name); }
function identity(probe) {
  assert.equal(probe.online, true); assert.equal(probe.httpStatus, 200); assert.equal(probe.body.success, true);
  assert.equal(probe.body.data.environment, 'staging'); assert.equal(probe.body.data.fixture, 'synthetic-v1');
  assert.equal(probe.body.data.version, '6.2.7-KITCHEN'); assert.equal(probe.body.data.recipe_release, RELEASE);
}
// Uses the application's guarded fetch, unchanged. Unique URL proves an uncached network attempt.
async function ping(page, label) {
  const url = ENDPOINT + '?action=ping&_qa_independent=' + encodeURIComponent(label + '-' + crypto.randomUUID());
  const value = await page.evaluate(async url => {
    const start = Date.now();
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      return { url, online: navigator.onLine, httpStatus: r.status, body: await r.json(), elapsedMs: Date.now() - start };
    } catch (e) { return { url, online: navigator.onLine, error: { name: e.name, message: e.message }, elapsedMs: Date.now() - start }; }
  }, url);
  log('ping ' + label, value); return value;
}
async function snapshot(page) {
  return page.evaluate(() => {
    const columns = {}, counts = {};
    for (const [name, id] of [['pending', 'pending'], ['making', 'making'], ['ready', 'done']]) {
      const column = document.getElementById('col-' + id);
      if (!column) throw Error('Missing current column: ' + id);
      columns[name] = [...column.querySelectorAll('.order-card')].map(card => {
        if (!card.id.startsWith('card-')) throw Error('Missing card identity');
        const order = card.id.slice(5);
        if (![...card.querySelectorAll('[data-order-id]')].every(b => b.dataset.orderId === order)) throw Error('Conflicting card identity');
        return order;
      }).sort();
      counts[name] = Number(document.getElementById('count-' + id).textContent);
    }
    const controls = [...document.querySelectorAll('[data-next-status]')].map(b => ({
      orderId: b.dataset.orderId, columnId: b.closest('.kds-col-body')?.id,
      disabled: b.disabled, visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length)
    }));
    return { online: navigator.onLine, date: document.getElementById('queue-date').value, columns, counts, controls,
      notice: document.getElementById('sync-notice').textContent, historicalUnrecorded: document.getElementById('unrecorded-list').textContent };
  });
}
function validSnapshot(s, offline = false) {
  assert.equal(s.date, DATE); assert.equal(s.online, !offline); assert.deepEqual(s.columns, EXPECTED);
  const all = Object.values(s.columns).flat(); assert.equal(new Set(all).size, all.length);
  for (const key of Object.keys(s.columns)) assert.equal(s.counts[key], s.columns[key].length);
  assert(s.controls.length > 0, 'Non-vacuous controls check');
  assert(s.controls.every(c => c.disabled === offline && c.visible));
  if (offline) assert.match(s.notice, /ออฟไลน์/); else assert.match(s.notice, /ซิงก์ทุก 15/);
}
async function ready(page, offline = false) {
  await page.waitForFunction(offline => {
    const buttons = [...document.querySelectorAll('[data-next-status]')];
    const notice = document.querySelector('#sync-notice')?.textContent || '';
    return navigator.onLine === !offline && buttons.length > 0 && buttons.every(b => b.disabled === offline)
      && (offline ? notice.includes('ออฟไลน์') : notice.includes('ซิงก์ทุก 15'));
  }, offline, { timeout: 90000 });
}
async function setup(browser, name, timezoneId) {
  const context = await browser.newContext({ timezoneId, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  // Safety-only routing: no response fulfillment, no simulated ping failure, no app-state injection.
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const readApi = req.url().startsWith(ENDPOINT + '?') && ['ping', 'get_kitchen_queue'].includes(u.searchParams.get('action'));
    const redirectedRead = u.hostname === 'script.googleusercontent.com' && req.redirectedFrom() !== null;
    const allowed = req.method() === 'GET' && (req.url().startsWith(SITE) || readApi || redirectedRead ||
      ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname));
    if (!allowed) { report.blockedRequests.push({ context: name, method: req.method(), url: req.url() }); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('request', r => { if (r.url().startsWith(ENDPOINT)) report.browserRequests.push({ context: name, time: new Date().toISOString(), method: r.method(), url: r.url() }); });
  page.on('requestfailed', r => report.browserFailures.push({ context: name, time: new Date().toISOString(), url: r.url(), error: r.failure()?.errorText }));
  page.on('pageerror', e => report.pageErrors.push({ context: name, message: e.message }));
  await page.goto(SITE + 'kitchen.html?qa=independent-20261115', { waitUntil: 'domcontentloaded' });
  await page.locator('#queue-date').fill(DATE);
  await page.locator('#queue-date').dispatchEvent('change');
  await ready(page);
  return { context, page, name, timezoneId };
}
let browser, phase = 'preflight';
(async () => {
  log('begin independent read-only E-04', report.environment);
  for (const [file, expected] of Object.entries(HASHES)) {
    const r = await fetch(SITE + file + '?qa_sha=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    assert.equal(r.status, 200); const actual = sha(Buffer.from(await r.arrayBuffer()));
    report.files[file] = { expected, actual }; check('live SHA256 ' + file, () => assert.equal(actual, expected));
  }
  phase = 'browser-launch'; browser = await chromium.launch({ headless: true }); report.environment.chromium = browser.version();
  phase = 'online-baseline';
  const screens = await Promise.all([setup(browser, 'A', 'UTC'), setup(browser, 'B', 'Asia/Bangkok')]);
  report.before = [];
  for (const s of screens) {
    const value = { context: s.name, timezone: s.timezoneId, ping: await ping(s.page, s.name + '-before'), snapshot: await snapshot(s.page) };
    report.before.push(value);
    check(s.name + ' online identity and current columns', () => { identity(value.ping); validSnapshot(value.snapshot); });
  }
  for (let i = 0; i < screens.length; i++) {
    const target = screens[i], peer = screens[1 - i];
    const cycle = { context: target.name, peer: peer.name, startedAt: new Date().toISOString() }; report.cycles.push(cycle);
    phase = target.name + '-offline'; await target.context.setOffline(true); await ready(target.page, true);
    cycle.offline = { ping: await ping(target.page, target.name + '-offline'), snapshot: await snapshot(target.page) };
    cycle.peerDuringOffline = { ping: await ping(peer.page, peer.name + '-peer-online'), snapshot: await snapshot(peer.page) };
    check(target.name + ' actual offline failure and disabled controls; peer remains online', () => {
      validSnapshot(cycle.offline.snapshot, true); assert.equal(cycle.offline.ping.online, false);
      assert.equal(cycle.offline.ping.error?.name, 'TypeError'); assert.match(cycle.offline.ping.error.message, /Failed to fetch|NetworkError|Load failed/);
      assert.doesNotMatch(cycle.offline.ping.error.message, /STAGING blocked|identity|timeout/i);
      assert(report.browserRequests.some(r => r.url === cycle.offline.ping.url), 'Probe must reach browser transport');
      assert(report.browserFailures.some(r => r.url === cycle.offline.ping.url && /ERR_INTERNET_DISCONNECTED/.test(r.error)), 'Browser must report actual offline transport error');
      identity(cycle.peerDuringOffline.ping); validSnapshot(cycle.peerDuringOffline.snapshot);
    });
    await target.page.screenshot({ path: path.join(OUT, i === 0 ? 'offline.png' : 'offline-B.png'), fullPage: true });
    phase = target.name + '-reconnect';
    const freshQueue = target.page.waitForResponse(r => {
      let request = r.request();
      while (request.redirectedFrom()) request = request.redirectedFrom();
      const url = new URL(request.url());
      return url.searchParams.get('action') === 'get_kitchen_queue' && url.searchParams.get('date') === DATE && r.status() === 200;
    }, { timeout: 90000 });
    freshQueue.catch(() => {});
    await target.context.setOffline(false); await ready(target.page);
    const queueResponse = await freshQueue;
    cycle.freshQueue = await queueResponse.json();
    cycle.after = { ping: await ping(target.page, target.name + '-after'), snapshot: await snapshot(target.page), peerSnapshot: await snapshot(peer.page) };
    check(target.name + ' reconnected identity, enabled controls and both current columns', () => {
      identity(cycle.after.ping); validSnapshot(cycle.after.snapshot); validSnapshot(cycle.after.peerSnapshot);
      assert.deepEqual(cycle.after.snapshot.columns, cycle.after.peerSnapshot.columns);
      assert.deepEqual(cycle.after.snapshot.columns, report.before[i].snapshot.columns);
      assert.equal(cycle.freshQueue.success, true); assert.equal(cycle.freshQueue.data.date, DATE);
      assert(Array.isArray(cycle.freshQueue.data.orders));
      for (const [column, status] of [['pending', 'pending'], ['making', 'making'], ['ready', 'done']]) {
        const ids = cycle.freshQueue.data.orders.filter(o => o.preparation_status === status && !(status === 'pending' && o.preparation_version === 0)).map(o => o.order_id).sort();
        assert.deepEqual(ids, cycle.after.snapshot.columns[column]);
      }
    });
    await target.page.screenshot({ path: path.join(OUT, i === 0 ? 'reconnected.png' : 'reconnected-B.png'), fullPage: true });
    cycle.finishedAt = new Date().toISOString();
  }
  check('no forbidden requests or uncaught page errors', () => { assert.deepEqual(report.blockedRequests, []); assert.deepEqual(report.pageErrors, []); });
  report.status = 'PASS';
})().catch(error => {
  report.status = error.code === 'ERR_ASSERTION' ? 'FAIL' : 'BLOCKED';
  report.failure = { phase, name: error.name, message: error.message, stack: error.stack };
  log(report.status, report.failure); process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(e => log('browser cleanup', e.message));
  report.finishedAt = new Date().toISOString();
  log('finished', { status: report.status, startedAt: report.startedAt, finishedAt: report.finishedAt });
  fs.writeFileSync(path.join(OUT, 'E-04.json'), JSON.stringify(report, null, 2) + '\n');
  fs.copyFileSync(__filename, path.join(OUT, 'qa-e04-independent.cjs'));
  const entries = fs.readdirSync(OUT).filter(f => f !== 'SHA256SUMS').sort();
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS'), entries.map(f => sha(fs.readFileSync(path.join(OUT, f))) + '  ' + f).join('\n') + '\n');
});
