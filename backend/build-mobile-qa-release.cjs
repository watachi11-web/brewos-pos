// Private hosted HTML must stay outside git. Publish only this builder and synthetic tests.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const BASELINE_SHA='b663953b55ddbb98485ee086947fdbe5335bd988c8d01f80b183cdef6fe38819';
function once(s,a,b){if(s.split(a).length!==2)throw Error('Anchor changed: '+a);return s.replace(a,b);}
function build(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==BASELINE_SHA)throw Error('Mobile baseline changed; inspect before patching');
 source=once(source,', maximum-scale=1.0, user-scalable=no','');
 // Capture all receipt fields before the first await. The payload and receipt share this snapshot.
 source=once(source,"    const result = await sendOrderToBackend(",`    const snapshot = JSON.parse(JSON.stringify({pickup:document.getElementById('pickupTime').value,note:orderNote,discount:discountPayload,payment:payMethod,groups}));
    const result = await sendOrderToBackend(`);
 source=once(source,"      name, room, document.getElementById('pickupTime').value,\n      orderNote, cartItemsToSend, grand, rcpId, dateTimeStr,\n      discountPayload, payMethod","      name, room, snapshot.pickup,\n      snapshot.note, cartItemsToSend, grand, rcpId, dateTimeStr,\n      snapshot.discount, snapshot.payment");
 source=once(source,"document.getElementById('rcpPickup').textContent = document.getElementById('pickupTime').value || '—';","document.getElementById('rcpPickup').textContent = snapshot.pickup || '—';");
 source=once(source,"(discType==='pct' ? discValue+'%' : '฿'+discValue) + ' = -฿' + discAmt","(snapshot.discount.type==='pct' ? snapshot.discount.value+'%' : '฿'+snapshot.discount.value) + ' = -฿' + discAmt");
 source=once(source,'Object.entries(groups).forEach(([cat, items]) => {','Object.entries(snapshot.groups).forEach(([cat, items]) => {');
 source=once(source,"if (orderNote) { noteEl.textContent = '📝 ' + orderNote;","if (snapshot.note) { noteEl.textContent = '📝 ' + snapshot.note;");
 source=once(source,"${catMap[cat]||cat}","${escHtml(catMap[cat]||cat)}");
 source=once(source,"  mobileSaleBusy=true;\n  btnPay.textContent", "  mobileSaleBusy=true;\n  syncMobileControls();\n  btnPay.textContent");
 source=once(source,"    clearCart();\n    document.getElementById('rcptOverlay')", "    mobileInternal(() => clearCart());\n    document.getElementById('rcptOverlay')");
 source=once(source,'    resetForm();\n    document.getElementById(\'saleVerified\')', '    mobileInternal(() => resetForm());\n    document.getElementById(\'saleVerified\')');
 // Do not clear another tab's unsent basket when a different tab finishes its sale.
 source=once(source,"resetForm();showToast('บิลยืนยันแล้วจากอีกแท็บ เริ่มบิลใหม่ได้');","showToast('บิลยืนยันแล้วจากอีกแท็บ ตรวจตะกร้าของหน้านี้ก่อนรับบิลต่อ');");
 source=once(source,"(err.message || '') + '</div>'", "escHtml(err.message || '') + '</div>'");
 const start=source.indexOf('async function doCancelOrder() {'),end=source.indexOf('async function loadDashboard()',start);
 if(start<0||end<0)throw Error('Missing legacy cancel boundary');
 source=source.slice(0,start)+"async function doCancelOrder() { closeCancelModal(); showToast('กรุณาใช้หน้ารายการออเดอร์บนเว็บหลักเพื่อคืนสินค้า'); }\n"+source.slice(end);
 const runtime=fs.readFileSync(path.join(__dirname,'mobile-qa-runtime.js'),'utf8');
 const insights=fs.readFileSync(path.join(__dirname,'../menu-insights.js'),'utf8');
 source=once(source,'initMenus();\n</script>',insights+'\n'+runtime+'\ninitMenus();\n</script>');
 source=once(source,'</head>',`<style>
.ms-btn,.ci-btn,.ci-del,.mod-pick-btn{min-width:44px!important;min-height:44px!important}
.sheet,.rcpt-sheet{max-height:90dvh!important;overflow-y:auto!important;overscroll-behavior:contain}
.cust-wrap{min-width:0!important}.cust-input{width:100%;min-width:0;box-sizing:border-box}.cust-bar .room-input{flex-shrink:0}#backdateBar{flex-wrap:wrap}
@media(max-height:650px){.topbar{min-height:54px!important;padding:6px 10px!important}.total-pill,.brand-tagline{display:none!important}.topbar-row{margin-bottom:0!important}.menu-section-head{display:none!important}}
.cart-head:focus-visible,button:focus-visible{outline:3px solid #ffb457;outline-offset:2px}
@media(max-width:480px){.menu-card{display:grid!important;grid-template-columns:42px minmax(0,1fr) auto;flex:0 0 auto!important;height:auto!important;min-height:100px!important}.mc-stepper{grid-column:2 / 4;justify-self:end;height:46px!important;margin:0!important}.mc-info{min-width:0!important}}
@media(max-height:450px){.cart-col.expanded{min-height:0!important;max-height:55dvh!important;overflow-y:auto!important}.cart-col.expanded .cart-head{min-height:44px!important}}
</style></head>`);
 for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
 return source;
}
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('Distinct paths required');fs.writeFileSync(output,build(fs.readFileSync(input,'utf8')),{flag:'wx'});}
module.exports={build,BASELINE_SHA};
