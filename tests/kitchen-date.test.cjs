const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require.resolve('../kitchen.html'), 'utf8');
test('an old refresh cannot enable actions after a date change or failed new load', async () => {
  const picker = {value:'2026-11-03'}, requests = [], button = {};
  const context = vm.createContext({
    document: {getElementById: id => id === 'queue-date' ? picker : {}, querySelectorAll: () => [button]},
    localStorage: {getItem: () => null},
    apiGet: () => new Promise((resolve, reject) => requests.push({resolve,reject})),
    renderAll() {}
  });
  vm.runInContext(src.slice(src.indexOf('const kitchenState'),src.indexOf('function getDisplayOrders')),context);
  const first = context.loadOrders();
  requests[0].resolve({date:picker.value,orders:[{order_id:'OLD',preparation_status:'pending'}]});
  await first;
  assert.equal(button.disabled,false);
  const old = context.loadOrders();
  picker.value = '2026-11-04';
  const next = context.loadOrders();
  requests[1].resolve({date:'2026-11-03',orders:[]});
  await old;
  assert.equal(button.disabled,true);
  assert.equal(vm.runInContext('ALL_ORDERS.length',context),0);
  requests[2].reject(Error('offline'));
  await next;
  assert.equal(button.disabled,true);
  const late = context.loadOrders();
  picker.value = '2026-11-05';
  const latest = context.loadOrders();
  requests[4].resolve({date:picker.value,orders:[]});
  await latest;
  requests[3].reject(Error('late failure'));
  await late;
  assert.equal(button.disabled,false);
  assert.equal(vm.runInContext('loadedDate',context),picker.value);
});
