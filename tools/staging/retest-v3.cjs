const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const site = 'https://watachi11-web.github.io/brewos-pos/staging/';
const endpoint = 'https://script.google.com/macros/s/AKfycbxc_Cj6fp0Ro8naiKx7Of0oH7PbGkPKfbNs1MN1BRKFR8PBajzDxQUsNwye5PdNQsTPSw/exec';
const release = '2a0e10a901712ff79912aecb23de636d64fc48c6c76c9a6bd43c98331c6a7a6b';
const result = {date: '2026-11-04', startedAt: new Date().toISOString()};
const enabledButtons = '[data-next-status]:enabled';

async function probe(page) {
  return page.evaluate(async endpoint => {
    try {
      const response = await fetch(endpoint + '?action=ping&_qa=' + Date.now(), {cache:'no-store'});
      const body = await response.json();
      return {ok: response.ok && body.success === true, data: body.data, online: navigator.onLine};
    } catch (error) {
      return {ok:false, name:error.name, message:error.message, online:navigator.onLine};
    }
  }, endpoint);
}

function assertIdentity(response) {
  assert.equal(response.ok, true);
  assert.equal(response.online, true);
  assert.equal(response.data.environment, 'staging');
  assert.equal(response.data.fixture, 'synthetic-v1');
  assert.equal(response.data.recipe_release, release);
}

async function currentColumns(page) {
  return page.evaluate(() => Object.fromEntries(['pending','making','done'].map(status =>
    [status, Array.from(document.querySelectorAll('#col-' + status + ' .order-card'),
      card => card.id.replace(/^card-/, '')).sort()]
  )));
}

async function openKitchen(context) {
  const page = await context.newPage();
  await page.goto(site + 'kitchen.html?qa=E04-corrected', {waitUntil:'domcontentloaded'});
  await page.locator('#queue-date').fill(result.date);
  await page.locator('#queue-date').dispatchEvent('change');
  await page.locator(enabledButtons).first().waitFor({timeout:90000});
  return page;
}

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext({timezoneId:'UTC'});
    const peerContext = await browser.newContext({timezoneId:'Asia/Bangkok'});
    const [page, peer] = await Promise.all([openKitchen(context), openKitchen(peerContext)]);
    result.before = {probe: await probe(page), columns: await currentColumns(page)};
    assertIdentity(result.before.probe);
    assert(result.before.columns.done.includes('RCP-E2E2-DUAL-10f2848364ca'));
    await context.setOffline(true);
    await page.waitForFunction(() => navigator.onLine === false &&
      document.querySelector('#sync-notice').textContent.includes('ออฟไลน์') &&
      document.querySelectorAll('[data-next-status]').length > 0 &&
      !document.querySelector('[data-next-status]:enabled'));
    result.offline = {
      probe: await probe(page),
      notice: await page.locator('#sync-notice').innerText(),
      enabledButtons: await page.locator(enabledButtons).count()
    };
    assert.equal(result.offline.probe.ok, false);
    assert.equal(result.offline.probe.online, false);
    assert.equal(result.offline.probe.name, 'TypeError');
    assert.match(result.offline.probe.message, /Failed to fetch|NetworkError|Load failed/);
    assert.doesNotMatch(result.offline.probe.message, /STAGING blocked|identity/);
    assert.equal(result.offline.enabledButtons, 0);
    await page.screenshot({path:'offline.png'});
    await context.setOffline(false);
    await page.locator(enabledButtons).first().waitFor({timeout:90000});
    result.after = {probe:await probe(page), columns:await currentColumns(page), peerColumns:await currentColumns(peer)};
    assertIdentity(result.after.probe);
    assert.deepEqual(result.after.columns, result.after.peerColumns);
    assert.deepEqual(result.before.columns, result.after.columns);
    await page.screenshot({path:'reconnected.png'});
    result.passed = true;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync('E-04.json', JSON.stringify(result, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
