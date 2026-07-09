/*
 * PATCH สำหรับ api.js
 * ----------------------------------------------------------------
 * ใน object `API` หา section "// Inventory" แล้วเพิ่ม 2 บรรทัดนี้เข้าไป
 * (createIngredient กับ stockTransactions ที่ backend เพิ่งเปิด action ให้แล้ว
 * ตาม Code_fixed.gs เวอร์ชันล่าสุด)
 * ----------------------------------------------------------------
 */

// เดิม:
//   // Inventory
//   inventory:       (p={})             => apiGet('get_inventory', p),
//   lowStock:        (brand_id)         => apiGet('get_low_stock', { brand_id }),
//   ingredients:     (p={})             => apiGet('get_ingredients', p),
//   updateStock:     (data)             => apiPost('update_stock', data),
//   recordWastage:   (data)             => apiPost('record_wastage', data),
//
// ใหม่ — เพิ่ม createIngredient + stockTransactions:

  // Inventory
  inventory:       (p={})             => apiGet('get_inventory', p),   // ⚠️ ระบบเก่า ไม่ตรงกับ ingredients.current_stock อีกต่อไป — inventory.html เปลี่ยนไปใช้ API.ingredients() แทนแล้ว (ดู patch inventory_patch.js)
  lowStock:        (brand_id)         => apiGet('get_low_stock', { brand_id }),
  ingredients:     (p={})             => apiGet('get_ingredients', p),
  updateStock:     (data)             => apiPost('update_stock', data),      // → adjustIngredientStock() ฝั่ง backend (ระบบสต๊อกเดียวแล้ว)
  recordWastage:   (data)             => apiPost('record_wastage', data),    // → adjustIngredientStock(adjust_type='waste')
  createIngredient:(data)             => apiPost('create_ingredient', data), // #NEW
  stockTransactions:(p={})            => apiGet('get_stock_transactions', p), // #NEW — สำหรับ tab Transactions

/*
 * หมายเหตุ: MOCK_DATA (demo mode) ไม่ต้องแก้ เพราะ API_BASE ตั้งเป็น URL จริงแล้ว
 * โค้ดจะข้าม mock ไปเรียก backend จริงเสมอ ไม่ใช้ MOCK_DATA อีกต่อไป
 */
