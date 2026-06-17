/**
 * BrewOS — Shared API Client
 * All pages import this file via <script src="api.js">
 * Replace API_BASE with your deployed Apps Script Web App URL.
 */

const API_BASE = 'https://script.google.com/macros/s/AKfycbxw8XBigvESVUCugH7CNUnTWel_s_oMdRrJ4Bbyeb43wF5gwrUaOXrzKIUADUsPR52Pdg/exec';

// ─── Auth helpers ────────────────────────────────────────────────────────────
const Auth = {
  getToken:  () => sessionStorage.getItem('brewos_token') || '',
  getUser:   () => JSON.parse(sessionStorage.getItem('brewos_user') || 'null'),
  getBrand:  () => sessionStorage.getItem('brewos_brand') || 'BB',
  setSession(token, user, brand) {
    sessionStorage.setItem('brewos_token', token);
    sessionStorage.setItem('brewos_user', JSON.stringify(user));
    sessionStorage.setItem('brewos_brand', brand);
  },
  clearSession() {
    sessionStorage.removeItem('brewos_token');
    sessionStorage.removeItem('brewos_user');
    sessionStorage.removeItem('brewos_brand');
  },
  requireAuth() {
    if (!this.getToken()) { window.location.href = 'login.html'; return false; }
    return true;
  },
};

// ─── Offline / demo mode fallback ────────────────────────────────────────────
// When API_BASE is not yet configured, every call falls back to MOCK_DATA.
// Remove this block once deployed.

const MOCK_DATA = {
  dashboard_summary: {
    today: { revenue: 18420, orders: 147, avg_order: 125.3, new_members: 8 },
    brand_bb: { revenue: 11200, orders: 88 },
    brand_hh: { revenue: 7220, orders: 59 },
    best_sellers: [
      { name: 'Neuron Latte', qty: 42, revenue: 3780 },
      { name: 'Basque Cheesecake', qty: 28, revenue: 2240 },
      { name: 'Cortex Espresso', qty: 38, revenue: 2280 },
      { name: 'Butter Croissant', qty: 35, revenue: 1750 },
      { name: 'Synapse Matcha', qty: 24, revenue: 1920 },
    ],
    low_stock: [
      { name: 'Oat Milk', current: 4, unit: 'L', par: 20 },
      { name: 'Cream Cheese', current: 0.5, unit: 'kg', par: 5 },
      { name: 'Espresso Beans', current: 1.2, unit: 'kg', par: 8 },
    ],
    recent_orders: [
      { id: 'BB-270001', time: '13:42', customer: 'Kru Sunisa', total: 287, status: 'paid' },
      { id: 'HH-270012', time: '13:38', customer: 'Walk-in', total: 145, status: 'paid' },
      { id: 'BB-270000', time: '13:25', customer: 'Khun Prae', total: 420, status: 'paid' },
    ],
    revenue_trend: [14200, 16800, 15400, 18200, 19600, 17800, 21400, 18420],
    revenue_labels: ['May 1','May 5','May 8','May 12','May 15','May 19','May 22','May 27'],
  },
  get_categories: [
    { id: 'cat_01', name: 'Espresso', brand_id: 'BB', emoji: '☕' },
    { id: 'cat_02', name: 'Specialty', brand_id: 'BB', emoji: '🌿' },
    { id: 'cat_03', name: 'Cold Brew', brand_id: 'BB', emoji: '🧊' },
    { id: 'cat_04', name: 'Pastry', brand_id: 'HH', emoji: '🥐' },
    { id: 'cat_05', name: 'Cakes', brand_id: 'HH', emoji: '🎂' },
    { id: 'cat_06', name: 'Snacks', brand_id: 'HH', emoji: '🍪' },
  ],
  get_products: [
    { id: 'p001', name: 'Neuron Latte', category_id: 'cat_02', price: 95, brand_id: 'BB', emoji: '🧠', available: true },
    { id: 'p002', name: 'Cortex Espresso', category_id: 'cat_01', price: 60, brand_id: 'BB', emoji: '⚡', available: true },
    { id: 'p003', name: 'Synapse Matcha', category_id: 'cat_02', price: 90, brand_id: 'BB', emoji: '🍵', available: true },
    { id: 'p004', name: 'Axon Americano', category_id: 'cat_01', price: 65, brand_id: 'BB', emoji: '☕', available: true },
    { id: 'p005', name: 'Dendrite Cold Brew', category_id: 'cat_03', price: 95, brand_id: 'BB', emoji: '🧊', available: true },
    { id: 'p006', name: 'Myelin Oat Latte', category_id: 'cat_02', price: 100, brand_id: 'BB', emoji: '🌾', available: true },
    { id: 'p007', name: 'Butter Croissant', category_id: 'cat_04', price: 65, brand_id: 'HH', emoji: '🥐', available: true },
    { id: 'p008', name: 'Basque Cheesecake', category_id: 'cat_05', price: 95, brand_id: 'HH', emoji: '🍰', available: true },
    { id: 'p009', name: 'Chocolate Chip Cookie', category_id: 'cat_06', price: 45, brand_id: 'HH', emoji: '🍪', available: true },
    { id: 'p010', name: 'Mango Layer Cake', category_id: 'cat_05', price: 120, brand_id: 'HH', emoji: '🍰', available: true },
    { id: 'p011', name: 'Taro Swiss Roll', category_id: 'cat_05', price: 85, brand_id: 'HH', emoji: '🍥', available: true },
    { id: 'p012', name: 'Matcha Financier', category_id: 'cat_06', price: 55, brand_id: 'HH', emoji: '🌿', available: true },
  ],
  get_modifiers: [
    { id: 'mod_01', name: 'Size', product_ids: ['p001','p003','p004','p006'], options: [
      { id: 'o01', name: 'Regular (12oz)', price_delta: 0 },
      { id: 'o02', name: 'Large (16oz)', price_delta: 15 },
    ]},
    { id: 'mod_02', name: 'Milk', product_ids: ['p001','p003','p006'], options: [
      { id: 'o03', name: 'Full Cream', price_delta: 0 },
      { id: 'o04', name: 'Oat Milk', price_delta: 20 },
      { id: 'o05', name: 'Almond Milk', price_delta: 20 },
      { id: 'o06', name: 'Skim Milk', price_delta: 0 },
    ]},
    { id: 'mod_03', name: 'Sugar', product_ids: ['p001','p002','p003','p004','p006'], options: [
      { id: 'o07', name: 'Normal Sugar', price_delta: 0 },
      { id: 'o08', name: 'Less Sugar', price_delta: 0 },
      { id: 'o09', name: 'No Sugar', price_delta: 0 },
      { id: 'o10', name: 'Extra Sweet', price_delta: 0 },
    ]},
    { id: 'mod_04', name: 'Temperature', product_ids: ['p001','p002','p003','p004','p006'], options: [
      { id: 'o11', name: 'Hot', price_delta: 0 },
      { id: 'o12', name: 'Iced', price_delta: 0 },
    ]},
  ],
  get_orders: Array.from({ length: 30 }, (_, i) => ({
    id: `BB-27${String(i).padStart(4,'0')}`,
    time: `${8 + Math.floor(i/4)}:${String((i*7)%60).padStart(2,'0')}`,
    customer_name: ['Kru Sunisa','Walk-in','Khun Prae','Khun Wut','Khun Fah'][i%5],
    brand_id: i%3===0 ? 'HH' : 'BB',
    order_type: ['Dine In','Takeaway','Delivery'][i%3],
    items_count: (i%4)+1,
    total: 85 + (i*37)%400,
    payment_method: ['QR','Cash','Card','Transfer'][i%4],
    status: i%8===0 ? 'refund' : i%12===0 ? 'pending' : 'paid',
    staff_name: ['Nong','Pan','Bank','Nam'][i%4],
  })),
  get_inventory: Array.from({ length: 20 }, (_, i) => ({
    id: `ing_${i+1}`,
    name: ['Espresso Beans','Oat Milk','Full Cream Milk','Cream Cheese','Butter','All-Purpose Flour','Sugar','Eggs','Matcha Powder','Chocolate','Taro Paste','Mango Puree','Almond Milk','Heavy Cream','Vanilla Extract','Baking Powder','Salt','Brown Sugar','Yeast','Almond Flour'][i],
    unit: ['kg','L','L','kg','kg','kg','kg','pcs','kg','kg','kg','kg','L','L','ml','g','g','kg','g','kg'][i],
    current_stock: [1.2, 4, 12, 0.5, 2.8, 8, 5, 120, 0.8, 1.5, 2, 3, 6, 2, 500, 200, 300, 4, 150, 1.5][i],
    par_level: [8, 20, 30, 5, 5, 20, 10, 300, 3, 5, 5, 8, 15, 5, 1000, 500, 500, 10, 500, 5][i],
    cost_per_unit: [800, 65, 45, 280, 180, 25, 30, 5, 1200, 320, 180, 120, 85, 95, 8, 2, 1, 35, 3, 350][i],
    brand_id: i < 6 ? 'BB' : i < 12 ? 'HH' : 'BOTH',
    low_stock: [1.2, 4, 12, 0.5, 2.8, 8, 5, 120, 0.8, 1.5, 2, 3, 6, 2, 500, 200, 300, 4, 150, 1.5][i] / [8, 20, 30, 5, 5, 20, 10, 300, 3, 5, 5, 8, 15, 5, 1000, 500, 500, 10, 500, 5][i] < 0.25,
  })),
  get_customers: Array.from({ length: 15 }, (_, i) => ({
    id: `cust_${i+1}`,
    name: ['Kru Sunisa','Khun Prae','Khun Wut','Khun Fah','Khun Bot','Khun Joy','Khun Mild','Khun Aim','Khun Nan','Khun Far','Khun Tae','Khun Sam','Khun Lin','Khun Art','Khun Bee'][i],
    phone: `08${i+1}-234-${5678+i}`,
    email: `customer${i+1}@email.com`,
    tier: ['Bronze','Silver','Gold','Platinum','Gold','Silver','Bronze','Gold','Silver','Bronze','Platinum','Silver','Bronze','Gold','Silver'][i],
    points: [120, 840, 2400, 8200, 1840, 560, 90, 3200, 720, 45, 12400, 680, 30, 2800, 440][i],
    total_spend: [1200, 8400, 24000, 82000, 18400, 5600, 900, 32000, 7200, 450, 124000, 6800, 300, 28000, 4400][i],
    visit_count: [3, 24, 86, 210, 52, 18, 4, 92, 22, 2, 340, 20, 1, 88, 14][i],
    last_visit: '2026-05-27',
    brand_id: i%2===0 ? 'BB' : 'HH',
  })),
  get_staff: [
    { id: 'staff_01', name: 'Nong Saowalak', role: 'Head Barista', brand_id: 'BB', status: 'on', phone: '081-234-5678', salary: 18000, contract: 'Full-time', start_date: '2025-01-15' },
    { id: 'staff_02', name: 'Khun Arthit', role: 'Baker', brand_id: 'HH', status: 'on', phone: '082-345-6789', salary: 16000, contract: 'Full-time', start_date: '2024-03-01' },
    { id: 'staff_03', name: 'Mint Chanida', role: 'Baker', brand_id: 'HH', status: 'on', phone: '083-456-7890', salary: 15500, contract: 'Full-time', start_date: '2024-06-12' },
    { id: 'staff_04', name: 'Pan Siriporn', role: 'Cashier', brand_id: 'BB', status: 'on', phone: '084-567-8901', salary: 14000, contract: 'Full-time', start_date: '2025-09-05' },
    { id: 'staff_05', name: 'Bank Wittawat', role: 'Barista', brand_id: 'BB', status: 'on', phone: '085-678-9012', salary: 15000, contract: 'Full-time', start_date: '2024-11-20' },
    { id: 'staff_06', name: 'Nam Suphansa', role: 'Cashier', brand_id: 'HH', status: 'off', phone: '086-789-0123', salary: 13500, contract: 'Part-time', start_date: '2026-02-10' },
    { id: 'staff_07', name: 'Fon Kanokporn', role: 'Manager', brand_id: 'BOTH', status: 'off', phone: '087-890-1234', salary: 28000, contract: 'Full-time', start_date: '2024-01-01' },
  ],
  get_expenses: Array.from({ length: 20 }, (_, i) => ({
    id: `exp_${i+1}`,
    date: `2026-05-${String(27-i).padStart(2,'0')}`,
    category: ['Ingredients','Utilities','Rent','Packaging','Staff','Marketing','Equipment','Maintenance'][i%8],
    description: ['Ingredient restock','Electricity bill','Monthly rent','Packaging materials','Staff overtime','Social media ads','Coffee grinder repair','Deep cleaning'][i%8],
    amount: [8400, 3200, 45000, 1200, 2800, 4500, 6800, 1500][i%8],
    brand_id: i%2===0 ? 'BB' : 'HH',
    paid_by: ['Owner','Manager','Owner','Staff','Manager','Owner','Owner','Staff'][i%8],
  })),
  get_settings: {
    tax_rate: 7,
    service_charge: 10,
    points_per_baht: 1,
    min_redeem_points: 100,
    points_value: 10,
    receipt_header: 'Brain Brew Coffee\nSpecialty Since 2024',
    receipt_footer: 'Thank you! @brainbrew.bkk',
    low_stock_threshold: 20,
  },
  get_recipes: [
    { id: 'rec_01', name: 'Neuron Latte', product_id: 'p001', cost: 28.5, selling_price: 95, gp_pct: 70, servings: 1 },
    { id: 'rec_02', name: 'Cortex Espresso', product_id: 'p002', cost: 18, selling_price: 60, gp_pct: 70, servings: 1 },
    { id: 'rec_03', name: 'Synapse Matcha', product_id: 'p003', cost: 32, selling_price: 90, gp_pct: 64.4, servings: 1 },
    { id: 'rec_04', name: 'Butter Croissant', product_id: 'p007', cost: 22, selling_price: 65, gp_pct: 66.2, servings: 1 },
    { id: 'rec_05', name: 'Basque Cheesecake', product_id: 'p008', cost: 38, selling_price: 95, gp_pct: 60, servings: 1 },
  ],
  login: { token: 'demo_token_123', user: { id: 'user_01', name: 'Admin', role: 'owner', brand_id: 'BOTH' } },
};

// ─── Smart dispatcher — demo fallback or real API ────────────────────────────
// Uses arrow functions (not hoisted) to avoid call stack overflow

const apiGet = async (action, params = {}) => {
  if (API_BASE === 'YOUR_APPS_SCRIPT_WEB_APP_URL') {
    await new Promise(r => setTimeout(r, 120));
    let data = MOCK_DATA[action];
    if (data === undefined) data = {};
    if (params.brand_id && Array.isArray(data)) {
      data = data.filter(d => !d.brand_id || d.brand_id === params.brand_id || d.brand_id === 'BOTH');
    }
    return JSON.parse(JSON.stringify(data));
  }
  // Real API call
  const url = new URL(API_BASE);
  url.searchParams.set('action', action);
  url.searchParams.set('token', Auth.getToken());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res  = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data;
};

const apiPost = async (action, body = {}) => {
  if (API_BASE === 'YOUR_APPS_SCRIPT_WEB_APP_URL') {
    await new Promise(r => setTimeout(r, 180));
    if (action === 'login') {
      const found = MOCK_DATA.login;
      Auth.setSession(found.token, found.user, body.brand || 'BB');
      return found;
    }
    return { ...body, id: 'new_' + Date.now(), created_at: new Date().toISOString() };
  }
  // Login ใช้ GET เพื่อหลีกเลี่ยง CORS preflight
  if (action === 'login') {
    const url = new URL(API_BASE);
    url.searchParams.set('action', 'login');
    url.searchParams.set('email',  body.email    || '');
    url.searchParams.set('password', body.password || '');
    url.searchParams.set('brand',  body.brand    || 'BB');
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Login failed');
    Auth.setSession(json.data.token, json.data.user, body.brand || 'BB');
    return json.data;
  }
  // Other POST requests — ใช้ no-cors mode พร้อม GET fallback
  const url = new URL(API_BASE);
  url.searchParams.set('action', action);
  url.searchParams.set('token', Auth.getToken());
  // ส่ง body เป็น query params สำหรับ simple actions
  const simpleActions = ['update_order_status','mark_item_done','mark_order_ready','start_preparing','bump_order','complete_order','cancel_order'];
  if (simpleActions.includes(action)) {
    Object.entries(body).forEach(([k,v]) => {
      if (k !== 'token' && v !== undefined) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
    });
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');
    return json.data;
  }
  // Full POST for complex payloads (create_order etc.)
  const res = await fetch(API_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' }, // text/plain ไม่ trigger preflight
    body:    JSON.stringify({ action, token: Auth.getToken(), ...body }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data;
};

// ─── Convenience wrappers ────────────────────────────────────────────────────
const API = {
  // Auth
  login:           (email, pw, brand) => apiPost('login', { email, password: pw, brand }),
  logout:          ()                 => apiPost('logout'),

  // Dashboard
  dashboardSummary:(p={})             => apiGet('dashboard_summary', p),

  // Products & Catalogue
  categories:      (brand_id)         => apiGet('get_categories', { brand_id }),
  products:        (p={})             => apiGet('get_products', p),
  modifiers:       (brand_id)         => apiGet('get_modifiers', { brand_id }),
  createProduct:   (data)             => apiPost('create_product', data),
  updateProduct:   (data)             => apiPost('update_product', data),
  deleteProduct:   (id)               => apiPost('delete_product', { product_id: id }),

  // Orders
  orders:          (p={})             => apiGet('get_orders', p),

  // ── ส่งออเดอร์ตรงไป Apps Script (ไม่ผ่าน Backend.gs) ──────────────────
  submitOrderDirect: async (data) => {
    const { customerName, room, pickupTime, note, cartItems, grand, rcpId, brandId, dateTimeStr } = data;
    const url = new URL(API_BASE);
    url.searchParams.set('action', 'submit_order_direct');
    url.searchParams.set('customerName', customerName || 'Walk-in');
    url.searchParams.set('room', room || '');
    url.searchParams.set('pickupTime', pickupTime || '');
    url.searchParams.set('note', note || '');
    url.searchParams.set('cartItems', JSON.stringify(cartItems || []));
    url.searchParams.set('grand', String(grand || 0));
    url.searchParams.set('rcpId', rcpId || ('RCP-' + Date.now()));
    url.searchParams.set('brandId', brandId || 'BB');
    if (dateTimeStr) url.searchParams.set('dateTimeStr', dateTimeStr);
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Submit failed');
    return json.data;
  },
  order:           (id)               => apiGet('get_order', { order_id: id }),
  createOrder:     (data)             => apiPost('create_order', data),
  updateOrderStatus:(id, status)      => apiPost('update_order_status', { order_id: id, status }),
  cancelOrder:     (id, reason)       => apiPost('cancel_order', { order_id: id, reason }),

  // Inventory
  inventory:       (p={})             => apiGet('get_inventory', p),
  lowStock:        (brand_id)         => apiGet('get_low_stock', { brand_id }),
  ingredients:     (p={})             => apiGet('get_ingredients', p),
  updateStock:     (data)             => apiPost('update_stock', data),
  recordWastage:   (data)             => apiPost('record_wastage', data),

  // Recipes
  recipes:         (p={})             => apiGet('get_recipes', p),
  recipe:          (id)               => apiGet('get_recipe', { recipe_id: id }),
  recipeCost:      (id)               => apiGet('get_recipe_cost', { recipe_id: id }),
  createRecipe:    (data)             => apiPost('create_recipe', data),
  updateRecipe:    (data)             => apiPost('update_recipe', data),

  // CRM
  customers:       (p={})             => apiGet('get_customers', p),
  customer:        (id)               => apiGet('get_customer', { customer_id: id }),
  lookupCustomer:  (phone)            => apiGet('lookup_customer', { phone }),
  createCustomer:  (data)             => apiPost('create_customer', data),
  addPoints:       (data)             => apiPost('add_loyalty_points', data),
  redeemPoints:    (data)             => apiPost('redeem_points', data),

  // Staff
  staff:           (p={})             => apiGet('get_staff', p),
  attendance:      (p={})             => apiGet('get_attendance', p),
  createStaff:     (data)             => apiPost('create_staff', data),
  clockIn:         (data)             => apiPost('clock_in', data),
  clockOut:        (data)             => apiPost('clock_out', data),

  // Finance
  expenses:        (p={})             => apiGet('get_expenses', p),
  createExpense:   (data)             => apiPost('create_expense', data),
  suppliers:       (p={})             => apiGet('get_suppliers', p),
  createSupplier:  (data)             => apiPost('create_supplier', data),

  // Reports
  salesReport:     (p={})             => apiGet('get_sales_report', p),
  profitReport:    (p={})             => apiGet('get_profit_report', p),
  inventoryReport: (p={})             => apiGet('get_inventory_report', p),

  // Production
  createBatch:     (data)             => apiPost('create_batch', data),
  completeBatch:   (id)               => apiPost('complete_batch', { batch_id: id }),

  // Settings
  settings:        (brand_id)         => apiGet('get_settings', { brand_id }),
  brands:          ()                 => apiGet('get_brands'),
  updateSetting:   (data)             => apiPost('update_setting', data),
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

  /** Show a loading overlay on an element */
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

  /** Show/hide a modal */
  openModal:  (id) => document.getElementById(id)?.classList.add('open'),
  closeModal: (id) => document.getElementById(id)?.classList.remove('open'),

  /** Skeleton loading shimmer */
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

// ─── Demo-mode banner ────────────────────────────────────────────────────────
(function demoBanner() {
  if (API_BASE !== 'YOUR_APPS_SCRIPT_WEB_APP_URL') return;
  if (window.location.pathname.includes('login')) return;
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.innerHTML = `⚡ <strong>Demo Mode</strong> — using mock data. Replace <code>API_BASE</code> in <code>api.js</code> with your Apps Script URL to go live.`;
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#d97706;color:#fff;text-align:center;padding:7px 16px;font-size:12px;z-index:9000;';
    document.body.prepend(b);
    // Push body down so it doesn't overlap topbar
    const main = document.querySelector('.main');
    if (main) main.style.paddingTop = '34px';
  });
})();
