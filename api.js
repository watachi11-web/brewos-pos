// ============================================================
// FILE: api.js — Frontend API Client
// ============================================================

const CONFIG_API = {
  // URL ของ Google Apps Script ที่ Deploy ไว้
  URL: 'https://script.google.com/macros/s/AKfycbxw8XBigvESVUCugH7CNUnTWel_s_oMdRrJ4Bbyeb43wF5gwrUaOXrzKIUADUsPR52Pdg/exec' 
};

/**
 * Helper Function สำหรับส่ง HTTP GET Request
 */
async function apiGet(action, params = {}) {
  try {
    // สร้าง URL พร้อม Query Parameters
    const url = new URL(CONFIG_API.URL);
    url.searchParams.append('action', action);
    
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key]);
      }
    });

    const response = await fetch(url.toString(), { 
      method: 'GET', 
      mode: 'cors' 
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    return data;
  } catch (err) {
    console.error(`API GET Error [${action}]:`, err);
    throw err;
  }
}

/**
 * Helper Function สำหรับส่ง HTTP POST Request
 */
async function apiPost(action, payload = {}) {
  try {
    const response = await fetch(`${CONFIG_API.URL}?action=${action}`, {
      method: 'POST',
      mode: 'cors',
      // GAS มักจะรับ Content-Type: text/plain ได้ดีกว่า เพื่อหลีกเลี่ยงปัญหา CORS Preflight
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    return data;
  } catch (err) {
    console.error(`API POST Error [${action}]:`, err);
    throw err;
  }
}

// ============================================================
// MAIN API OBJECT
// ============================================================
const API = {
  
  // ----------------------------------------------------------------
  // Inventory (อัปเดตตาม PATCH เรียบร้อยแล้ว)
  // ----------------------------------------------------------------
  inventory:         (p={})     => apiGet('get_inventory', p), // ⚠️ ระบบเก่า: inventory.html เปลี่ยนไปใช้ API.ingredients() แทน
  lowStock:          (brand_id) => apiGet('get_low_stock', { brand_id }),
  ingredients:       (p={})     => apiGet('get_ingredients', p),
  updateStock:       (data)     => apiPost('update_stock', data),        // → adjustIngredientStock()
  recordWastage:     (data)     => apiPost('record_wastage', data),      // → adjustIngredientStock(adjust_type='waste')
  createIngredient:  (data)     => apiPost('create_ingredient', data),   // #NEW
  stockTransactions: (p={})     => apiGet('get_stock_transactions', p),  // #NEW — สำหรับ tab Transactions

  // ----------------------------------------------------------------
  // TODO: ส่วนอื่นๆ ของ API (ถ้ามีเพิ่มในอนาคต สามารถเขียนต่อตรงนี้ได้เลย)
  // เช่น:
  // orders:         (p={})     => apiGet('get_orders', p),
  // createOrder:    (data)     => apiPost('create_order', data),
  // ----------------------------------------------------------------
};
