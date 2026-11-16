/* Read-only menu metrics. No customer/order records are persisted. */
(function(root) {
  'use strict';
  function windowDates(now = new Date(), days = 90) {
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const end = new Date(today + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate()-1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate()-days+1);
    return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
  }
  function aggregate(orders, products, range) {
    if (!Array.isArray(orders) || orders.length >= 5000) throw new Error('ข้อมูลไม่ครบช่วง จึงยังไม่จัดอันดับ');
    const ids = new Set(products.map(p=>p.product_id || p.id));
    const stats = Object.create(null), seen = new Set();
    const cutoff = new Date(range.to+'T00:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate()-29);
    const from30 = cutoff.toISOString().slice(0,10);
    for (const o of orders) {
      if (!o.order_id || seen.has(o.order_id)) continue;
      seen.add(o.order_id);
      if (o.payment_status !== 'paid' || o.order_status !== 'completed') continue;
      const date = o.date_key;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < range.from || date > range.to) continue;
      const lines = new Set();
      for (const line of (o.items || [])) {
        if (line.line_id && lines.has(line.line_id)) continue;
        if (line.line_id) lines.add(line.line_id);
        const id = line.product_id, qty = Number(line.qty);
        if (!ids.has(id) || !Number.isFinite(qty) || qty <= 0) continue;
        const s = stats[id] || (stats[id] = {qty30:0,qty90:0,last:''});
        s.qty90 += qty; if (date >= from30) s.qty30 += qty;
        if (date > s.last) s.last = date;
      }
    }
    return stats;
  }
  // Rank inside existing brand/category slots, preserving category order and ties.
  function rank(items, stats) {
    if (!stats) return items.slice();
    const groups = new Map();
    const key = m=>JSON.stringify([m.brand,m.cat]);
    for (const m of items) { const k=key(m); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(m); }
    for (const group of groups.values()) group.sort((a,b)=>Number(!!b.best)-Number(!!a.best) || (stats[b.id]?.qty30||0)-(stats[a.id]?.qty30||0));
    return items.map(m=>groups.get(key(m)).shift());
  }
  async function load(api, products, now) {
    const range = windowDates(now);
    const orders = await api.orders({date_from:range.from,date_to:range.to,limit:5000});
    return {stats:aggregate(orders,products,range),range};
  }
  const api = {windowDates,aggregate,rank,load};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.MenuInsights=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
