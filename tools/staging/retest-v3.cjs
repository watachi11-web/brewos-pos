const {chromium}=require('playwright');
const fs=require('fs'), assert=require('assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
const site='https://watachi11-web.github.io/brewos-pos/staging/',ctx=await browser.newContext({timezoneId:'UTC'}),peer=await browser.newContext({timezoneId:'Asia/Bangkok'});
const a=await ctx.newPage(),b=await peer.newPage();const go=(p,f)=>p.goto(site+f+'.html?qa=ec368c4',{waitUntil:'domcontentloaded'});await Promise.all([go(a,'kitchen'),go(b,'kitchen')]);
await Promise.all([a,b].map(async p=>{await p.locator('#queue-date').fill('2026-11-04');await p.locator('#queue-date').dispatchEvent('change')}));
const button='[data-next-status]:enabled';await Promise.all([a,b].map(p=>p.locator(button).first().waitFor({timeout:90000})));
const ids=p=>p.locator('[data-next-status]').evaluateAll(bs=>bs.map(x=>[x.dataset.orderId,x.dataset.nextStatus]).sort());
let result={before:await ids(a)};assert(result.before.length);await ctx.setOffline(true);
await a.waitForFunction(()=>navigator.onLine===false && document.querySelector('#sync-notice').textContent.includes('ออฟไลน์') && !document.querySelector('[data-next-status]:enabled'));result.offlineNotice=await a.locator('#sync-notice').innerText();result.networkDown=await a.evaluate(async()=>{try{await fetch(location.href,{cache:'no-store'});return false}catch{return true}});assert(result.networkDown);await a.screenshot({path:'offline.png'});
await ctx.setOffline(false);await a.locator(button).first().waitFor({timeout:90000});result.reconnected=await ids(a);result.peer=await ids(b);assert.deepEqual(result.reconnected,result.peer);fs.writeFileSync('E-04.json',JSON.stringify(result,null,2));await a.screenshot({path:'reconnected.png'});await peer.close();
await go(a,'crm');await a.locator('[data-customer-id="CUS-005"]').click({timeout:60000});let joined=await a.locator('#detail-body').innerText();assert(joined.includes('Joined: 2026-11-04'));fs.writeFileSync('C-04.txt',joined);await go(a,'pos');await a.keyboard.press('F4');await a.locator('#refreshMembers').click({timeout:30000});await a.locator('#mSearch').fill('0000022216');await a.locator('#mResults').getByText('QA V3 phone roundtrip',{exact:false}).first().waitFor({timeout:60000});await a.screenshot({path:'pos-phone.png'});console.log('offline/reconnect, joined day, POS full phone verified');
}finally{await browser.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
