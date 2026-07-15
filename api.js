/**
 * BrewOS — Shared API Client v2.0.0
 * All back-office pages import this file via <script src="api.js">
 *
 * แก้จาก v1.x:
 *   #NOAUTH   ตัด Auth/login/token ออกทั้งหมด ให้สอดคล้องกับ รหัส.gs (#NOAUTH — ใช้คนเดียว
 *             ไม่มีระบบ login แล้ว). แทนที่ด้วย Identity เบาๆ ที่อ่านชื่อ staff จาก
 *             sessionStorage/query param เพื่อแสดงผลเฉยๆ ไม่ gate การเข้าถึงใดๆ
 *   #ROUTES   แก้ action name ทุกจุดให้ตรงกับ route จริงใน รหัส.gs v4.6.0 (ของเดิมเรียก
 *             action ผิดชื่อไปกว่าครึ่ง เช่น get_inventory → ที่จริงคือ get_ingredients,
 *             get_orders → get_orders_sheet, add_loyalty_points → add_member_points ฯลฯ)
 *   #PARAMS   แก้ field name ให้ตรงกับที่ submitOrder()/createExpense()/createSupplier() ฯลฯ
 *             ใน รหัส.gs อ่านจริง (ของเดิมส่ง camelCase เช่น customerName, cartItems,
 *             rcpId ไปเฉยๆ แต่ backend อ่าน customer_name, items, receipt_id ทำให้ข้อมูล
 *             หายเงียบๆ ทุกครั้ง)
 *   #REMOVED  เอา wrapper ที่ไม่มี route จริงใน รหัส.gs ออก แทนที่ด้วยฟังก์ชันที่ throw
 *             ข้อความชัดเจนว่า "ยังไม่มี backend route รองรับ" แทนการเงียบๆ คืนข้อมูลผิด —
 *             ดูรายการที่ removed ท้ายไฟล์
 *
 * ⚠️ สำคัญ: API_BASE ต้องเป็น URL เดียวกับ BREWOS_API ใน mobile_pos.html เสมอ
 *    (ที่ผ่านมาสองไฟล์นี้ชี้ไปคนละ Apps Script deployment กัน — ถ้า deploy เวอร์ชันใหม่
 *    ให้ Web App URL แต่แก้แค่ไฟล์เดียว อีกไฟล์จะยังเรียก routes เก่าอยู่โดยไม่รู้ตัว)
 */

const API_BASE = 'https://script.google.com/macros/s/AKfycbxw8XBigvESVUCugH7CNUnTWel_s_oMdRrJ4Bbyeb43wF5gwrUaOXrzKIUADUsPR52Pdg/exec';

// ─── Identity (display-only, ไม่ gate การเข้าถึง) ──────────────────────────
// #NOAUTH — ของเดิมมี Auth.requireAuth()/login() ที่ redirect ไป login.html แต่ รหัส.gs
// ไม่มี route 'login' แล้ว ทำให้ล็อกทุกคนออกถาวร แทนที่ด้วย Identity แบบเดียวกับที่
// mobile_pos.html ใช้ — อ่านชื่อ staff จาก query param/sessionStorage เพื่อแสดงผลเท่านั้น
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

// ─── apiGet / apiPost — เรียก Apps Script Web App จริงเสมอ (ไม่มี mock fallback) ──
// หมายเหตุ: เดิมมีเงื่อนไข "ถ้า API_BASE ยังเป็นค่า placeholder ให้ใช้ MOCK_DATA" แต่ API_BASE
// เป็น URL จริงที่ deploy แล้วเสมอ เงื่อนไขนั้นเลยเป็น dead code เหมือนที่เจอใน mobile_pos.html
// ตัดออกเพื่อความสะอาด — ถ้าต้องการ demo/offline mode จริงๆ ให้ตั้ง OFFLINE_MODE = true ด้านล่าง
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
  const res = await fetch(url.toString());
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
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain เลี่ยง CORS preflight
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || ('API error: ' + action));
  return json.data;
};

// ─── ฟังก์ชันสำหรับ action ที่ รหัส.gs ยังไม่มี route รองรับ ──────────────
// #REMOVED — เรียกแล้วจะ throw ข้อความชัดเจนแทนการคืนค่าผิดแบบเงียบๆ
function notImplemented(featureName) {
  return async () => {
    throw new Error(`ฟีเจอร์ "${featureName}" ยังไม่มี backend route รองรับใน รหัส.gs — ต้องเพิ่ม route ก่อนใช้งานได้จริง`);
  };
}

// ─── Convenience wrappers — ตรงกับ route จริงใน รหัส.gs v4.6.0 เท่านั้น ────
const API = {
  // Dashboard
  dashboardSummary: (p = {}) => apiGet('dashboard_summary', p),

  // Menu / Products / Categories (read-only ใน รหัส.gs ปัจจุบัน)
  menuData:    ()      => apiGet('get_menu_data'),
  categories:  (brand_id) => apiGet('get_categories', { brand_id }),
  products:    (p = {})   => apiGet('get_products', p),
  // #REMOVED — ไม่มี route create_product/update_product/delete_product ใน รหัส.gs
  // (products sheet เป็น read-only จาก backend ปัจจุบัน ต้องแก้ไขตรงใน Google Sheet เอง
  //  หรือแจ้งทีมพัฒนาให้เพิ่ม route เหล่านี้ถ้าต้องการจัดการเมนูผ่านหน้าเว็บ)
  createProduct: notImplemented('เพิ่มเมนูใหม่ผ่านหน้าเว็บ'),
  updateProduct: notImplemented('แก้ไขเมนูผ่านหน้าเว็บ'),
  deleteProduct: notImplemented('ลบเมนูผ่านหน้าเว็บ'),

  // Orders
  ordersToday: (p = {}) => apiGet('get_orders_sheet', p),
  submitOrder: (data) => apiPost('submit_order', data), // ดู field ที่ต้องส่งใน submitOrderDirect() ของ รหัส.gs
  cancelOrder: (order_id, reason) => apiPost('cancel_order', { order_id, reason }),

  // Inventory / Ingredients
  ingredients:     (p = {}) => apiGet('get_ingredients', p),
  inventoryStats:  ()       => apiGet('get_inventory_stats'),
  adjustStock:     (data)   => apiPost('adjust_stock', data), // { ingredient_id, adjust_type: 'add'|'subtract'|'set', amount }
  createIngredient:(data)   => apiPost('create_ingredient', data),
  updateIngredient:(data)   => apiPost('update_ingredient', data),
  deleteIngredient:(ingredient_id) => apiPost('delete_ingredient', { ingredient_id }),
  // #REMOVED — ไม่มี route get_low_stock/update_stock/record_wastage แยกต่างหาก
  // ใช้ ingredients() แล้ว filter is_low ฝั่ง client แทน, และใช้ adjustStock() สำหรับทุกกรณี
  // (receive/deduct/waste ล้วนแปลงเป็น add หรือ subtract ก่อนส่งเข้า adjustStock)

  // Recipes (list-only ใน รหัส.gs ปัจจุบัน — ไม่มี route ดึง/แก้ recipe รายตัว)
  recipes:      (p = {}) => apiGet('get_recipes', p),
  createRecipe: (data)   => apiPost('create_recipe', data), // ดู field ที่ createRecipeLines() ต้องการ
  getRecipe:    notImplemented('ดึงสูตรรายตัว (ใช้ recipes() แล้ว find ฝั่ง client แทนได้)'),
  updateRecipe: notImplemented('แก้ไขสูตรรายตัวโดยตรง (ใช้ createRecipe() เพื่อ overwrite ทั้งสูตรแทน)'),

  // Customers (read-only ใน รหัส.gs ปัจจุบัน)
  customers: (p = {}) => apiGet('get_customers', p),
  // #REMOVED — ไม่มี route create_customer/lookup_customer/redeem_points ใน รหัส.gs
  createCustomer: notImplemented('เพิ่มลูกค้าใหม่ผ่านหน้าเว็บ'),
  lookupCustomer: notImplemented('ค้นหาลูกค้าจากเบอร์โทร'),
  redeemPoints:   notImplemented('แลกแต้มสะสม'),

  // Members (loyalty program — แยกจาก customers)
  members:        (p = {}) => apiGet('get_members', p),
  createMember:   (data)   => apiPost('create_member', data),
  updateMember:   (data)   => apiPost('update_member', data),
  addMemberPoints:(data)   => apiPost('add_member_points', data),

  // Staff & Attendance
  staff:       (p = {}) => apiGet('get_staff', p),
  attendance:  (p = {}) => apiGet('get_attendance', p),
  createStaff: (data)   => apiPost('create_staff', data),
  clockIn:     (data)   => apiPost('clock_in', data),
  clockOut:    (data)   => apiPost('clock_out', data),

  // Finance
  financeSummary: (p = {}) => apiGet('get_finance_summary', p), // { month: 'YYYY-MM' }
  expenses:       (p = {}) => apiGet('get_expenses', p),
  createExpense:  (data)   => apiPost('create_expense', data), // { date, category, description, amount, brand_id, payment_method, note }
  suppliers:      (p = {}) => apiGet('get_suppliers', p),
  createSupplier: (data)   => apiPost('create_supplier', data), // { brand_id, company_name, contact_name, phone, email, payment_terms, category, rating, notes }
  // #REMOVED — ไม่มี route get_sales_report/get_profit_report/get_inventory_report แยกต่างหาก
  // ใช้ financeSummary() (มี revenue/cogs/gross_profit/net_profit ให้แล้ว) และ inventoryStats() แทน
  salesReport:     notImplemented('รายงานยอดขายแยกต่างหาก (ใช้ financeSummary() แทน)'),
  profitReport:    notImplemented('รายงานกำไรแยกต่างหาก (ใช้ financeSummary() แทน)'),
  inventoryReport: notImplemented('รายงานสต๊อกแยกต่างหาก (ใช้ inventoryStats() + ingredients() แทน)'),

  // Production
  production:       (p = {}) => apiGet('get_production', p),
  createProduction: (data)   => apiPost('create_production', data),
  updateProduction: (data)   => apiPost('update_production', data),

  // Settings & Brands
  settings:     ()     => apiGet('get_settings'),
  updateSetting:(data) => apiPost('update_setting', data),
  brands:       ()     => apiGet('get_brands'),

  // Utility
  ping: () => apiGet('ping'),
};

// ─── UI Utilities ────────────────────────────────────────────────────────────
const UI = {
  /** Show a transient toast notification */
  toast(msg, type = 'success') {
    const colors = { success: '#1B4332', error: '#dc2626', warning: '#d97706', info: '#2563eb' };
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${colors[type]||colors.success};color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:opacity 0.3s;`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
  },

  /** Show a loading state on a button-like element */
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

  /** Format a number as Thai Baht */
  baht(n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); },

  /** Format a Date or ISO string */
  date(d) { return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); },
  time(d) { return new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); },

  /** Show/hide a modal (works with both .open and .show class conventions used across pages) */
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

  /** Skeleton loading shimmer row (5 cols) */
  skeleton(n = 5) {
    return Array(n).fill('<tr>' + '<td><div style="height:14px;background:#e8e4de;border-radius:4px;animation:pulse 1.5s infinite;"></div></td>'.repeat(5) + '</tr>').join('');
  },
};

// CSS pulse animation for skeletons
(function injectSkeletonCSS() {
  if (document.getElementById('brewos-skeleton-css')) return;
  const s = document.createElement('style');
  s.id = 'brewos-skeleton-css';
  s.textContent = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`;
  document.head.appendChild(s);
})();
