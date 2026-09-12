/**
 * BrewOS — Shared API Client v3.5.0
 * Synced with BrewOS backend v6.1.0 CLOSED-DAY LOCK + all prior modules
 *
 * หลักการ:
 *   - api.js เป็น transport layer เท่านั้น
 *   - Business / Inventory / Accounting calculation อยู่ที่ รหัส.gs เป็น source of truth
 *   - API_BASE ต้องตรงกับ BREWOS_API ใน mobile_pos.html ทุกครั้งหลัง deploy
 */

const API_BASE = 'https://script.google.com/macros/s/AKfycbxw8XBigvESVUCugH7CNUnTWel_s_oMdRrJ4Bbyeb43wF5gwrUaOXrzKIUADUsPR52Pdg/exec';

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

  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  url.searchParams.set('_ts', Date.now());

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${action}`);

  const json = await res.json();
  if (!json.success) throw new Error(json.error || ('API error: ' + action));
  return json.data;
};

const apiPost = async (action, body = {}) => {
  if (OFFLINE_MODE) {
    await new Promise(r => setTimeout(r, 180));
    throw new Error('OFFLINE_MODE เปิดอยู่ แต่ยังไม่ได้ตั้งค่า mock data สำหรับ action: ' + action);
  }

  // action จาก wrapper ต้องชนะเสมอ — ป้องกัน body.action เขียนทับ route โดยไม่ตั้งใจ
  const payload = { ...(body || {}), action };

  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} · ${action}`);

  const json = await res.json();
  if (!json.success) throw new Error(json.error || ('API error: ' + action));
  return json.data;
};

function notImplemented(featureName) {
  return async () => {
    throw new Error(`ฟีเจอร์ "${featureName}" ยังไม่มี backend route รองรับใน รหัส.gs — ต้องเพิ่ม route ก่อนใช้งานได้จริง`);
  };
}

// ─── Convenience wrappers ──────────────────────────────────────────────────
const API = {
  // Dashboard / Accounting analytics
  dashboardSummary: (p = {}) => apiGet('dashboard_summary', p),

  // Menu / Products / Categories
  menuData:       ()          => apiGet('get_menu_data'),
  categories:     (brand_id)  => apiGet('get_categories', { brand_id }),
  products:       (p = {})    => apiGet('get_products', p),
  createProduct:  (data)      => apiPost('create_product', data),
  updateProduct:  (data)      => apiPost('update_product', data),
  deleteProduct:  (product_id)=> apiPost('delete_product', { product_id }),
  createCategory: (data)      => apiPost('create_category', data),
  updateCategory: (data)      => apiPost('update_category', data),

  // Orders
  // Generic canonical name — รองรับ date / date_from / date_to / brand_id / limit
  orders:       (p = {}) => apiGet('get_orders_sheet', p),
  // Legacy alias เพื่อไม่ให้หน้าเก่าพัง
  ordersToday:  (p = {}) => apiGet('get_orders_sheet', p),
  submitOrder:  (data)   => apiPost('submit_order', data),
  cancelOrder:  (order_id, reason) => apiPost('cancel_order', { order_id, reason }),

  // Inventory / Ingredients / Packaging
  ingredients:      (p = {}) => apiGet('get_ingredients', p),
  inventoryStats:   ()       => apiGet('get_inventory_stats'),
  inventoryHealth:  (p = {}) => apiGet('get_inventory_health', p),
  inventoryTransactions: (p = {}) => apiGet('get_inventory_transactions', p),
  purchaseReceipts: (p = {}) => apiGet('get_purchase_receipts', p),
  purchaseReceipt:  (receipt_id) => apiGet('get_purchase_receipt', { receipt_id }),
  adjustStock:      (data)   => apiPost('adjust_stock', data),
  stocktake:        (data)   => apiPost('stocktake', data),
  receivePurchase:  (data)   => apiPost('receive_purchase', data),
  receiveStock:     (data)   => apiPost('receive_stock', data),
  createIngredient: (data)   => apiPost('create_ingredient', data),
  updateIngredient: (data)   => apiPost('update_ingredient', data),
  deleteIngredient: (ingredient_id) => apiPost('delete_ingredient', { ingredient_id }),

  // Recipes
  recipes:      (p = {}) => apiGet('get_recipes', p),
  createRecipe: (data)   => apiPost('create_recipe', data),
  getRecipe:    notImplemented('ดึงสูตรรายตัว (ใช้ recipes() แล้ว find ฝั่ง client แทนได้)'),
  updateRecipe: notImplemented('แก้ไขสูตรรายตัวโดยตรง (ใช้ createRecipe() เพื่อ overwrite ทั้งสูตรแทน)'),

  // Customers
  customers: (p = {}) => apiGet('get_customers', p),
  createCustomer: (data) => apiPost('create_customer', data),
  updateCustomer: (data) => {
    const payload = { ...(data || {}) };
    if (payload.name !== undefined && payload.full_name === undefined) {
      payload.full_name = payload.name;
      delete payload.name;
    }
    return apiPost('update_customer', payload);
  },
  addCustomerPoints: (data) => apiPost('add_customer_points', data),
  lookupCustomer: notImplemented('ค้นหาลูกค้าจากเบอร์โทร'),
  redeemPoints:   notImplemented('แลกแต้มสะสม'),

  // Assets / Depreciation
  assets:      (p = {}) => apiGet('get_assets', p),
  assetSummary:(p = {}) => apiGet('get_asset_summary', p),
  createAsset: (data)   => apiPost('create_asset', data),
  updateAsset: (data)   => apiPost('update_asset', data),
  deleteAsset: (asset_id, hard = false) => apiPost('delete_asset', { asset_id, hard }),

  // Finance
  financeSummary: (p = {}) => apiGet('get_finance_summary', p),
  expenses:       (p = {}) => apiGet('get_expenses', p),
  expenseCategories:(p = {}) => apiGet('get_expense_categories', p),
  createExpense:  (data)   => apiPost('create_expense', data),
  updateExpense:  (data)   => apiPost('update_expense', data),
  deleteExpense:  (expense_id) => apiPost('delete_expense', { expense_id }),
  suppliers:      (p = {}) => apiGet('get_suppliers', p),
  createSupplier: (data)   => apiPost('create_supplier', data),
  salesReport:     notImplemented('รายงานยอดขายแยกต่างหาก (ใช้ orders() / financeSummary() แทน)'),
  profitReport:    notImplemented('รายงานกำไรแยกต่างหาก (ใช้ financeSummary() แทน)'),
  inventoryReport: (p = {}) => apiGet('get_inventory_health', p),

  // Settings & Brands
  settings:      ()     => apiGet('get_settings'),
  updateSetting: (data) => apiPost('update_setting', data),
  brands:        ()     => apiGet('get_brands'),

  // Phase 7 — Production Guardrails
  guardrailStatus: (p = {}) => apiGet('get_guardrail_status', p),

  // Phase 8 — Daily Close & Payment Reconciliation
  dailyClosePreview: (date) => apiGet('get_daily_close_preview', date ? { date } : {}),
  dailyCloses:       (p = {}) => apiGet('get_daily_closes', p),
  closeDay:          (data) => apiPost('close_day', data),

  // Phase 9 — Closed-Day Lock & Reopen Control
  dayLockStatus:     (date) => apiGet('get_day_lock_status', date ? { date } : {}),
  reopenDay:         (data) => apiPost('reopen_day', data),

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
    if (!el) return;
    if (on) {
      el.dataset.originalText = el.textContent;
      el.disabled = true;
      el.textContent = 'Loading…';
    } else {
      el.disabled = false;
      el.textContent = el.dataset.originalText || el.textContent;
    }
  },

  baht(n) {
    return '฿' + Number(n || 0).toLocaleString('th-TH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  },

  date(d) {
    if (d === null || d === undefined || d === '') return '—';
    const raw = String(d).trim();

    // date-only ไม่ให้ browser ตีความ timezone เอง
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const value = m ? `${m[1]}-${m[2]}-${m[3]}T12:00:00+07:00` : raw;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return raw;

    return dt.toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      year: '2-digit'
    });
  },

  time(d) {
    if (d === null || d === undefined || d === '') return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleTimeString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

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
    return Array(n).fill(
      '<tr>' +
      '<td><div style="height:14px;background:#e8e4de;border-radius:4px;animation:pulse 1.5s infinite;"></div></td>'.repeat(5) +
      '</tr>'
    ).join('');
  },
};

(function injectSkeletonCSS() {
  if (document.getElementById('brewos-skeleton-css')) return;
  const s = document.createElement('style');
  s.id = 'brewos-skeleton-css';
  s.textContent = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`;
  document.head.appendChild(s);
})();
