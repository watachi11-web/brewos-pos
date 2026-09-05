/**
 * BrewOS — Shared API Client v3.0.0
 * แก้จาก v2.1.0 (#SIMPLIFY รอบรื้อระบบ):
 *   - ตัด wrapper staff/attendance/production/members ทิ้งทั้งหมด (backend ไม่มี route
 *     พวกนี้แล้ว — ดู รหัส.gs v5.0.0)
 *   - เพิ่ม wrapper สำหรับ assets (อุปกรณ์ + ค่าเสื่อมราคา) ใหม่
 *   - Identity เดิมที่อ่านชื่อ staff จาก sessionStorage/query param (display-only) ยังคงไว้ได้
 *     เพราะไม่ได้ gate อะไร แค่โชว์ชื่อบนจอเฉยๆ ไม่ผูกกับชีท staff ที่ถูกลบไปแล้ว
 *
 * ⚠️ #DEPLOYFIX สำคัญที่สุด: API_BASE ต้องเป็น URL เดียวกับ BREWOS_API ใน mobile_pos.html
 * เป๊ะๆ เสมอ — หลังดีพลอย Web App ใหม่ ก็อปปี้ URL เดียวมาแปะทั้งสองไฟล์นี้
 */

const API_BASE = 'PASTE_NEW_WEB_APP_URL_HERE_AFTER_DEPLOY';

// ─── Identity (display-only, ไม่ gate การเข้าถึง) ──────────────────────────
const Identity = {
  getName() {
    const urlParams = new URLSearchParams(window.location.search);
    const raw = urlParams.get('staff') || sessionStorage.getItem('brewos_user');
    if (!raw) return 'Staff';
    try { return JSON.parse(raw).name || raw; } catch (e) { return raw; }
  },
  getBrand() {
    return sessionStorage.getItem('brewos_brand') || 'ALL';
  },
  setBrand(brand) {
    sessionStorage.setItem('brewos_brand', brand);
  },
};

const OFFLINE_MODE = false;

const apiGet = async (action, params = {}) => {
  if (OFFLINE_MODE) {
    await new Promise(r => setTimeout(r, 120));
    throw new Error('OFFLINE_MODE เปิดอยู่ แต่ยังไม่ได้ตั้งค่า mock data สำหรับ action: ' + action);
  }
  const url = new URL(API_BASE);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('_ts', Date.now());
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || ('API error: ' + action));
  return json.data;
};

const apiPost = async (action, body = {}) => {
  if (OFFLINE_MODE) {
    await new Promise(r => setTimeout(r, 180));
    throw new Error('OFFLINE_MODE เปิดอยู่ แต่ยังไม่ได้ตั้งค่า mock data สำหรับ action: ' + action);
  }
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || ('API error: ' + action));
  return json.data;
};

function notImplemented(featureName) {
  return async () => {
    throw new Error(`ฟีเจอร์ "${featureName}" ยังไม่มี backend route รองรับใน รหัส.gs — ต้องเพิ่ม route ก่อนใช้งานได้จริง`);
  };
}

// ─── Convenience wrappers — ตรงกับ route จริงใน รหัส.gs v5.0.0 เท่านั้น ────
const API = {
  // Dashboard
  dashboardSummary: (p = {}) => apiGet('dashboard_summary', p),

  // Menu / Products / Categories
  menuData:    ()      => apiGet('get_menu_data'),
  categories:  (brand_id) => apiGet('get_categories', { brand_id }),
  products:    (p = {})   => apiGet('get_products', p),
  createProduct: (data) => apiPost('create_product', data),
  updateProduct: (data) => apiPost('update_product', data),
  deleteProduct: (product_id) => apiPost('delete_product', { product_id }),
  createCategory: (data) => apiPost('create_category', data),
  updateCategory: (data) => apiPost('update_category', data),

  // Orders
  ordersToday: (p = {}) => apiGet('get_orders_sheet', p),
  submitOrder: (data) => apiPost('submit_order', data),
  cancelOrder: (order_id, reason) => apiPost('cancel_order', { order_id, reason }),

  // Inventory / Ingredients (แพ็กเกจจิ้งก็อยู่ในนี้ — ดู #INGCRUD ใน รหัส.gs)
  ingredients:     (p = {}) => apiGet('get_ingredients', p),
  inventoryStats:  ()       => apiGet('get_inventory_stats'),
  adjustStock:     (data)   => apiPost('adjust_stock', data), // { ingredient_id, adjust_type: 'add'|'subtract'|'set', amount } — ไม่แตะ unit_cost
  receiveStock:    (data)   => apiPost('receive_stock', data), // #WAC — { ingredient_id, qty, unit_price, brand_id?, payment_method?, date? } — คำนวณ unit_cost ถัวเฉลี่ยใหม่ + log รายจ่ายอัตโนมัติ
  createIngredient:(data)   => apiPost('create_ingredient', data),
  updateIngredient:(data)   => apiPost('update_ingredient', data),
  deleteIngredient:(ingredient_id) => apiPost('delete_ingredient', { ingredient_id }),

  // Recipes (รวม sub-recipe cost อัตโนมัติแล้ว — ดู #SUBCOST ใน รหัส.gs)
  recipes:      (p = {}) => apiGet('get_recipes', p),
  createRecipe: (data)   => apiPost('create_recipe', data), // { product_id, product_name, lines:[{ingredient_id, ingredient_name, qty_used, unit}] }
  getRecipe:    notImplemented('ดึงสูตรรายตัว (ใช้ recipes() แล้ว find ฝั่ง client แทนได้)'),
  updateRecipe: notImplemented('แก้ไขสูตรรายตัวโดยตรง (ใช้ createRecipe() เพื่อ overwrite ทั้งสูตรแทน)'),

  // Customers
  customers: (p = {}) => apiGet('get_customers', p),
  createCustomer: notImplemented('เพิ่มลูกค้าใหม่ผ่านหน้าเว็บ (แก้ตรงใน Google Sheet ชีท customers เอง)'),
  lookupCustomer: notImplemented('ค้นหาลูกค้าจากเบอร์โทร'),
  redeemPoints:   notImplemented('แลกแต้มสะสม'),

  // #ASSETS — อุปกรณ์/ครุภัณฑ์ + ค่าเสื่อมราคารายเดือน (ใหม่)
  assets:       (p = {}) => apiGet('get_assets', p), // p: { brand_id?, status? } — แต่ละแถวมี monthly_depreciation คำนวณมาให้แล้ว
  createAsset:  (data)   => apiPost('create_asset', data), // { name, price, lifespan_months, brand_id?, category?, purchase_date?, payment_method?, notes? } — บันทึกลง expenses อัตโนมัติด้วย
  updateAsset:  (data)   => apiPost('update_asset', data), // { asset_id, ...fields }
  deleteAsset:  (asset_id, hard = false) => apiPost('delete_asset', { asset_id, hard }), // default = soft delete (status: retired)

  // Finance (รวมค่าเสื่อมราคาอุปกรณ์เข้าไปในกำไรสุทธิแล้ว — ดู field depreciation)
  financeSummary: (p = {}) => apiGet('get_finance_summary', p), // { month: 'YYYY-MM' } → { ..., depreciation, depreciation_by_asset, net_profit }
  expenses:       (p = {}) => apiGet('get_expenses', p),
  createExpense:  (data)   => apiPost('create_expense', data), // { date, category, description, amount, brand_id, payment_method, note }
  suppliers:      (p = {}) => apiGet('get_suppliers', p),
  createSupplier: (data)   => apiPost('create_supplier', data),
  salesReport:     notImplemented('รายงานยอดขายแยกต่างหาก (ใช้ financeSummary() แทน)'),
  profitReport:    notImplemented('รายงานกำไรแยกต่างหาก (ใช้ financeSummary() แทน)'),
  inventoryReport: notImplemented('รายงานสต๊อกแยกต่างหาก (ใช้ inventoryStats() + ingredients() แทน)'),

  // Settings & Brands
  settings:     ()     => apiGet('get_settings'),
  updateSetting:(data) => apiPost('update_setting', data),
  brands:       ()     => apiGet('get_brands'),

  // Utility
  ping: () => apiGet('ping'),
};

// ─── UI Utilities ────────────────────────────────────────────────────────────
const UI = {
  toast(msg, type = 'success') {
    const colors = { success: '#1B4332', error: '#dc2626', warning: '#d97706', info: '#2563eb' };
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${colors[type]||colors.success};color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:opacity 0.3s;`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
  },

  loading(el, on) {
    if (on) {
      el.dataset.originalText = el.textContent;
      el.disabled = true;
      el.textContent = 'Loading…';
    } else {
      el.disabled = false;
      el.textContent = el.dataset.originalText || el.textContent;
    }
  },

  baht(n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); },
  date(d) { return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); },
  time(d) { return new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); },

  openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.classList.add('show');
  },
  closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.classList.remove('show');
  },

  skeleton(n = 5) {
    return Array(n).fill('<tr>' + '<td><div style="height:14px;background:#e8e4de;border-radius:4px;animation:pulse 1.5s infinite;"></div></td>'.repeat(5) + '</tr>').join('');
  },
};

(function injectSkeletonCSS() {
  if (document.getElementById('brewos-skeleton-css')) return;
  const s = document.createElement('style');
  s.id = 'brewos-skeleton-css';
  s.textContent = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`;
  document.head.appendChild(s);
})();
