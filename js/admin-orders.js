// ============ ADMIN RESERVATIONS ============
let unsubAdminReservations = null;
let _adminReservations = [];
let _adminReserveInterval = null;

function loadAdminReservations() {
  if (isExternal) return; // external ไม่ต้องเห็นจอง
  if (unsubAdminReservations) { unsubAdminReservations(); unsubAdminReservations = null; }

  unsubAdminReservations = db.collection('reservations').onSnapshot(snapshot => {
    const now = Date.now();
    _adminReservations = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(r => r.expiresAt && r.expiresAt.toMillis() > now);

    // Cleanup: ลบ reservation ที่หมดอายุแล้ว (admin ช่วยทำความสะอาด)
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.expiresAt && data.expiresAt.toMillis() < now) {
        db.collection('reservations').doc(doc.id).delete().catch(() => {});
      }
    });

    renderAdminReservations();
  }, e => {
    console.warn('admin reservation listener:', e.message);
    if (typeof handleQuotaError === 'function') handleQuotaError(e, 'adminReservations');
  });

  // อัปเดต countdown ทุกวินาที
  if (!_adminReserveInterval) {
    _adminReserveInterval = setInterval(renderAdminReservations, 1000);
  }
}

function renderAdminReservations() {
  const container = document.getElementById('adminReservations');
  if (!container) return;
  const now = Date.now();

  // กรอง reservation ที่ยังไม่หมดอายุ
  const active = _adminReservations.filter(r => r.expiresAt && r.expiresAt.toMillis() > now);

  if (active.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // รวม items จากทุก reservation
  const itemTotals = {};
  active.forEach(r => {
    if (!r.items) return;
    for (const [itemId, qty] of Object.entries(r.items)) {
      if (!itemTotals[itemId]) itemTotals[itemId] = 0;
      itemTotals[itemId] += qty;
    }
  });

  // สร้าง HTML
  const rows = active.map(r => {
    const remain = r.expiresAt.toMillis() - now;
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000).toString().padStart(2, '0');
    const itemList = r.items ? Object.entries(r.items).map(([id, qty]) => {
      // หาชื่อสินค้าจาก products cache (ถ้ามี)
      const product = typeof allProducts !== 'undefined' ? allProducts.find(p => p.id === id) : null;
      const name = product ? product.name : id.substring(0, 8) + '...';
      return `${escapeHtml(name)} x${qty}`;
    }).join(', ') : '-';
    const urgentClass = remain < 120000 ? ' reserve-urgent' : remain < 300000 ? ' reserve-warn' : '';
    return `<div class="reserve-row${urgentClass}"><span class="reserve-timer">${m}:${s}</span><span class="reserve-items">${itemList}</span></div>`;
  }).join('');

  container.style.display = 'block';
  container.innerHTML = `
    <div class="admin-reserve-panel">
      <div class="reserve-header">🛒 ลูกค้ากำลังสนใจ (${active.length} คน)</div>
      ${rows}
    </div>
  `;
}

// ============ LOAD ORDERS (Real-time) ============
let knownOrderIds = new Set();
let firstLoad = true;
let currentOrderLimit = 30;
let loadedOrdersCache = {}; // เก็บ object ชั่วคราวเอาไว้โชว์สลิป
let unsubCoupons = null; // Listener คูปอง
let currentDeliverOrderId = null;

// ============ DELIVER ORDER (ส่งของ) ============
async function openDeliverModal(orderId) {
  const order = loadedOrdersCache[orderId];
  if (!order) return;

  currentDeliverOrderId = orderId;
  const items = Array.isArray(order.items) ? order.items : [];
  const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];

  document.getElementById('deliverOrderInfo').innerHTML = `
    <div style="color:#e0b0ff;font-weight:600;">FB: ${escapeHtml(order.facebook)}</div>
    <div>ตัวละคร: ${escapeHtml(order.characterName)}</div>
  `;

  // ดึง stock + adminStock สดจาก Firestore
  const stockMap = {};
  try {
    const itemIds = [...new Set(items.map(i => i.itemId).filter(Boolean))];
    const docs = await Promise.all(itemIds.map(id => db.collection('items').doc(id).get()));
    docs.forEach(doc => {
      if (doc.exists) {
        const d = doc.data();
        stockMap[doc.id] = { stock: Math.max(0, Number(d.stock) || 0), adminStock: d.adminStock || {} };
      }
    });
  } catch (e) {
    console.warn('ดึง stock ไม่ได้:', e.message);
  }

  // หา aliases ของ admin ที่ login อยู่ เพื่อหา stock ของตัวเอง
  const adminName = currentAdminName || '';
  const myAliases = adminName && typeof getAdminAliases === 'function' ? getAdminAliases(adminName) : [adminName];

  document.getElementById('deliverItemsList').innerHTML = items.map((item, i) => {
    const delivered = deliveries
      .filter(d => d.itemId === item.itemId)
      .reduce((sum, d) => sum + d.qty, 0);
    const remaining = item.qty - delivered;

    // สร้างข้อมูล adminStock breakdown + หา stock ของ admin ปัจจุบัน
    let stockInfo = '';
    let myStock = remaining; // fallback ถ้าไม่มีข้อมูล
    const info = stockMap[item.itemId];
    if (info) {
      const parts = [];
      const adminStockMap = info.adminStock;
      const seen = new Set();
      let foundMyStock = 0;
      for (const [key, val] of Object.entries(adminStockMap)) {
        if (typeof val !== 'number' || val === 0) continue;
        const display = typeof resolveAdminName === 'function' ? resolveAdminName(key) : key;
        if (seen.has(display)) continue;
        seen.add(display);
        parts.push(`${escapeHtml(display)}: ${val}`);
        // เช็คว่า key นี้เป็นของ admin ปัจจุบันมั้ย
        if (myAliases.includes(key) || myAliases.includes(display)) {
          foundMyStock += val;
        }
      }
      myStock = Math.max(0, Math.min(remaining, foundMyStock));
      stockInfo = `<div style="font-size:11px;color:#aaa;margin-top:2px;">คลัง ${info.stock}${parts.length ? ' (' + parts.join(', ') + ')' : ''}</div>`;
    }

    // สร้างข้อมูลใครส่งเท่าไหร่
    let deliveryDetail = '';
    if (delivered > 0) {
      const itemDeliveries = deliveries.filter(d => d.itemId === item.itemId);
      const byAdmin = {};
      itemDeliveries.forEach(d => {
        const name = typeof resolveAdminName === 'function' ? resolveAdminName(d.by) : (d.by || '?');
        byAdmin[name] = (byAdmin[name] || 0) + d.qty;
      });
      const detailParts = Object.entries(byAdmin).map(([name, qty]) => `${escapeHtml(name)}: ${qty}`).join(', ');
      const uid = `delivDetail_${i}`;
      deliveryDetail = `<button onclick="document.getElementById('${uid}').style.display=document.getElementById('${uid}').style.display==='none'?'block':'none'" style="background:none;border:none;color:#4fc3f7;cursor:pointer;font-size:11px;padding:0;">&#128065; ใครส่ง?</button><div id="${uid}" style="display:none;font-size:11px;color:#ff9800;margin-top:2px;">${detailParts}</div>`;
    }

    return `
      <div class="form-group" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="flex:1;">${escapeHtml(item.name)}</span>
          <input type="number" min="0" max="${remaining}" value="${myStock}"
                 class="deliver-qty-input" data-index="${i}" data-item-id="${item.itemId}"
                 style="width:60px;text-align:center;" ${remaining <= 0 ? 'disabled value="0"' : ''}>
          <span style="color:#aaa;font-size:13px;">/ ${item.qty}${delivered > 0 ? ` (ส่งแล้ว ${delivered})` : ''}</span>
        </div>
        ${stockInfo}
        ${deliveryDetail}
      </div>
    `;
  }).join('');

  document.getElementById('deliverModal').classList.add('active');
}

function closeDeliverModal() {
  document.getElementById('deliverModal').classList.remove('active');
  currentDeliverOrderId = null;
}

async function confirmDeliver() {
  if (!currentDeliverOrderId) return;

  const order = loadedOrdersCache[currentDeliverOrderId];
  if (!order) return;

  const items = Array.isArray(order.items) ? order.items : [];
  const inputs = document.querySelectorAll('.deliver-qty-input');
  const deliverItems = [];

  inputs.forEach(input => {
    const qty = parseInt(input.value, 10);
    const index = parseInt(input.dataset.index, 10);
    if (qty > 0 && items[index]) {
      deliverItems.push({
        itemId: items[index].itemId,
        name: items[index].name,
        qty
      });
    }
  });

  if (deliverItems.length === 0) {
    showAlert('กรุณากรอกจำนวนที่ส่ง', 'ไม่มีของส่ง');
    return;
  }

  const btn = document.getElementById('confirmDeliverBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  try {
    const orderId = currentDeliverOrderId;
    const adminName = currentAdminName || 'admin';

    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) throw new Error('ไม่พบ order');

      const orderData = orderDoc.data();
      if (orderData.status === 'cancelled') throw new Error('order ถูกยกเลิกแล้ว');

      const orderItems = Array.isArray(orderData.items) ? orderData.items : [];
      const existingDeliveries = Array.isArray(orderData.deliveries) ? orderData.deliveries : [];
      const newDeliveries = [];

      // === READS FIRST ===
      const itemDocs = {};
      for (const di of deliverItems) {
        itemDocs[di.itemId] = await transaction.get(db.collection('items').doc(di.itemId));
      }

      // === VALIDATE ===
      for (const di of deliverItems) {
        const totalDelivered = existingDeliveries
          .filter(d => d.itemId === di.itemId)
          .reduce((sum, d) => sum + d.qty, 0);
        const orderItem = orderItems.find(i => i.itemId === di.itemId);
        const remaining = orderItem ? orderItem.qty - totalDelivered : 0;

        if (di.qty > remaining) throw new Error(`${di.name} ส่งได้อีกแค่ ${remaining}`);

        const itemDoc = itemDocs[di.itemId];
        if (itemDoc && itemDoc.exists) {
          const iData = itemDoc.data();
          const myAdminStock = typeof getAdminStockValue === 'function'
            ? getAdminStockValue(iData.adminStock || {}, adminName)
            : (Number((iData.adminStock || {})[adminName]) || 0);
          if (di.qty > myAdminStock) throw new Error(`${di.name} stock ของคุณมีแค่ ${myAdminStock}`);
        }

        newDeliveries.push({
          itemId: di.itemId,
          qty: di.qty,
          by: adminName,
          at: new Date()
        });
      }

      // === WRITES ===
      for (const di of deliverItems) {
        transaction.set(
          db.collection('items').doc(di.itemId).collection('stockHistory').doc(),
          {
            qty: -di.qty,
            addedBy: adminName,
            note: 'ขาย (order: ' + (orderData.facebook || '-') + ')',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }
        );
        transaction.set(db.collection('items').doc(di.itemId), {
          adminStock: { [adminName]: firebase.firestore.FieldValue.increment(-di.qty) }
        }, { merge: true });
      }

      const allDeliveries = [...existingDeliveries, ...newDeliveries];

      // เช็คว่าส่งครบหรือยัง
      const fullyDelivered = orderItems.every(item => {
        const totalDel = allDeliveries
          .filter(d => d.itemId === item.itemId)
          .reduce((sum, d) => sum + d.qty, 0);
        return totalDel >= item.qty;
      });

      const updateData = { deliveries: allDeliveries };
      if (fullyDelivered) {
        updateData.status = 'completed';
        // อัปเดตสถิติ
        const orderTotal = Number(orderData.totalPrice) || 0;
        transaction.set(db.collection('stats').doc('sales'), {
          completedCount: firebase.firestore.FieldValue.increment(1),
          totalRevenue: firebase.firestore.FieldValue.increment(orderTotal)
        }, { merge: true });
        // เพิ่ม soldCount +1 ต่อ item (นับต่อ order)
        const seenItems = new Set();
        orderItems.forEach(item => {
          if (item.itemId && !seenItems.has(item.itemId)) {
            seenItems.add(item.itemId);
            transaction.set(db.collection('items').doc(item.itemId), {
              soldCount: firebase.firestore.FieldValue.increment(1)
            }, { merge: true });
          }
        });
      }

      transaction.update(orderRef, updateData);
    });

    // เพิ่ม order เข้า _completedOrders cache ทันที
    // เพื่อไม่ให้หายตอน onSnapshot ของ pending ลบออก
    if (typeof _completedOrders !== 'undefined') {
      const cachedOrder = loadedOrdersCache[orderId];
      if (cachedOrder) {
        // อัปเดต cache ให้ตรงกับที่เพิ่งบันทึก
        cachedOrder.status = cachedOrder.status || 'pending';
        cachedOrder.deliveries = [...(Array.isArray(cachedOrder.deliveries) ? cachedOrder.deliveries : []),
          ...deliverItems.map(di => ({ itemId: di.itemId, qty: di.qty, by: adminName, at: new Date() }))];
        const orderItems = Array.isArray(cachedOrder.items) ? cachedOrder.items : [];
        const allDel = cachedOrder.deliveries;
        const fullyDone = orderItems.every(item => {
          const totalDel = allDel.filter(d => d.itemId === item.itemId).reduce((s, d) => s + d.qty, 0);
          return totalDel >= item.qty;
        });
        if (fullyDone) cachedOrder.status = 'completed';

        // สร้าง doc-like object เพิ่มเข้า _completedOrders
        const fakeDoc = { id: orderId, data: () => cachedOrder, exists: true };
        const alreadyExists = _completedOrders.some(d => d.id === orderId);
        if (!alreadyExists) _completedOrders.unshift(fakeDoc);
        else {
          // อัปเดต doc ที่มีอยู่แล้ว
          const idx = _completedOrders.findIndex(d => d.id === orderId);
          if (idx >= 0) _completedOrders[idx] = fakeDoc;
        }
        // render ทันทีหลังเพิ่ม fakeDoc — ป้องกัน order หายเพราะ onSnapshot ยิง
        // ก่อน fakeDoc ถูกเพิ่ม (Firestore SDK fire local snapshot ระหว่าง transaction)
        if (_lastPendingSnapshot) {
          const board = document.getElementById('orderBoard');
          if (board && typeof processOrderSnapshot === 'function') {
            const combined = { docs: [..._lastPendingSnapshot, ..._completedOrders] };
            processOrderSnapshot(combined, board);
          }
        }
      }
    }

    closeDeliverModal();
    showToast('บันทึกการส่งของแล้ว');

    // Auto-snapshot: บันทึก stock อัตโนมัติหลัง order complete (เพื่อ rollback ได้)
    const cachedOrderCheck = loadedOrdersCache[orderId];
    if (cachedOrderCheck && cachedOrderCheck.status === 'completed') {
      autoStockSnapshot('order_completed', orderId);
    }

    // reload completed orders จาก server (background)
    if (typeof loadCompletedOrders === 'function') loadCompletedOrders();
  } catch (e) {
    if (isQuotaError(e)) {
      // Quota หมด → บันทึก offline แทน
      const orderId = currentDeliverOrderId;
      const adminName = currentAdminName || 'admin';
      saveOfflineDelivery(orderId, order, deliverItems, adminName);
      closeDeliverModal();
      enterQuotaSavingMode();
    } else {
      showAlert('บันทึกไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'ยืนยันส่งของ';
  }
}

// ============ DELETE ORDER (Owner only — ลบถาวร) ============
async function deleteOrder(orderId) {
  const yes = await showConfirm('ลบ order นี้ถาวร?\n(จะไม่คืน stock หรือคูปอง — ใช้สำหรับลบ order ขยะ/ทดสอบ)', 'ยืนยันลบ');
  if (!yes) return;

  try {
    await db.collection('orders').doc(orderId).delete();
    delete loadedOrdersCache[orderId];
    showToast('ลบ order แล้ว');
  } catch (e) {
    showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ CANCEL REASON MODAL ============
function askCancelReason() {
  return new Promise((resolve) => {
    const modal = document.getElementById('cancelReasonModal');
    const input = document.getElementById('cancelReasonInput');
    const errorEl = document.getElementById('cancelReasonError');
    input.value = '';
    errorEl.textContent = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 100);

    function onConfirm() {
      const val = input.value.trim();
      if (!val) { errorEl.textContent = 'กรุณาระบุเหตุผล'; return; }
      cleanup(); resolve(val);
    }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }

    const confirmBtn = document.getElementById('cancelReasonConfirmBtn');
    const cancelBtn = document.getElementById('cancelReasonCancelBtn');
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);

    function cleanup() {
      modal.classList.remove('active');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }
  });
}

// ============ CANCEL ORDER (Transaction) ============
async function cancelOrder(orderId) {
  const reason = await askCancelReason();
  if (!reason) return;

  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) return;
      const order = orderDoc.data();

      if (order.status === 'cancelled') return;

      const items = Array.isArray(order.items) ? order.items : [];
      const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];

      // ถ้าเคย completed → ลบสถิติ
      if (order.status === 'completed') {
        const orderTotal = Number(order.totalPrice) || 0;
        transaction.set(db.collection('stats').doc('sales'), {
          completedCount: firebase.firestore.FieldValue.increment(-1),
          totalRevenue: firebase.firestore.FieldValue.increment(-orderTotal)
        }, { merge: true });
      }

      // คำนวณจำนวนที่ส่งแล้วต่อ item เพื่อคืน stock ให้ถูกต้อง
      const deliveredPerItem = {};
      for (const del of deliveries) {
        if (del.itemId) {
          deliveredPerItem[del.itemId] = (deliveredPerItem[del.itemId] || 0) + (del.qty || 0);
        }
      }

      // รวม stock ที่ต้องคืนต่อ item ไว้ก่อน แล้วเขียนทีเดียว
      // (Firestore transaction เขียน doc เดียวกันหลายครั้ง → เฉพาะครั้งสุดท้ายมีผล)
      const restoreMap = {}; // { itemId: { stock, adminStock: { name: qty }, historyEntries: [] } }

      // อ่าน item docs เพื่อดู adminStock ว่าของใคร
      const undeliveredItemIds = [];
      for (const item of items) {
        if (!item.itemId) continue;
        const delivered = deliveredPerItem[item.itemId] || 0;
        if (item.qty - delivered > 0 && !undeliveredItemIds.includes(item.itemId)) {
          undeliveredItemIds.push(item.itemId);
        }
      }
      const itemDocMap = {};
      for (const iid of undeliveredItemIds) {
        const iDoc = await transaction.get(db.collection('items').doc(iid));
        if (iDoc.exists) itemDocMap[iid] = iDoc.data();
      }

      // ส่วนที่ยังไม่ส่ง — คืนตามสัดส่วน adminStock ของแต่ละ admin
      for (const item of items) {
        if (!item.itemId) continue;
        const delivered = deliveredPerItem[item.itemId] || 0;
        const undelivered = item.qty - delivered;
        if (undelivered > 0) {
          if (!restoreMap[item.itemId]) restoreMap[item.itemId] = { stock: 0, adminStock: {}, history: [] };
          restoreMap[item.itemId].stock += undelivered;

          const iData = itemDocMap[item.itemId];
          const adminStockMap = iData && iData.adminStock ? iData.adminStock : {};
          const owners = Object.entries(adminStockMap).filter(([, v]) => Number(v) > 0);

          if (owners.length === 1) {
            const ownerName = owners[0][0];
            restoreMap[item.itemId].history.push({
              qty: undelivered, addedBy: ownerName, note: 'คืน stock ยังไม่ส่ง (ยกเลิก order)'
            });
          } else if (owners.length > 1) {
            const totalOwned = owners.reduce((s, [, v]) => s + Number(v), 0);
            let remaining = undelivered;
            for (let oi = 0; oi < owners.length; oi++) {
              const [name, val] = owners[oi];
              const share = oi === owners.length - 1
                ? remaining
                : Math.round(undelivered * Number(val) / totalOwned);
              if (share > 0) {
                restoreMap[item.itemId].history.push({
                  qty: share, addedBy: name, note: 'คืน stock ยังไม่ส่ง (ยกเลิก order)'
                });
                remaining -= share;
              }
            }
          } else {
            restoreMap[item.itemId].history.push({
              qty: undelivered, addedBy: 'system', note: 'คืน stock ยังไม่ส่ง (ยกเลิก order)'
            });
          }
        }
      }

      // ส่วนที่ส่งแล้ว → คืนทั้ง stock + adminStock
      for (const del of deliveries) {
        if (!del.itemId || !del.by) continue;
        if (!restoreMap[del.itemId]) restoreMap[del.itemId] = { stock: 0, adminStock: {}, history: [] };
        restoreMap[del.itemId].stock += del.qty;
        restoreMap[del.itemId].adminStock[del.by] = (restoreMap[del.itemId].adminStock[del.by] || 0) + del.qty;
        restoreMap[del.itemId].history.push({
          qty: del.qty, addedBy: del.by, note: 'คืน stock ส่งแล้ว (ยกเลิก order)'
        });
      }

      // เขียน Firestore — แต่ละ item เขียนครั้งเดียว
      for (const [itemId, restore] of Object.entries(restoreMap)) {
        const itemRef = db.collection('items').doc(itemId);
        const updateData = {
          stock: firebase.firestore.FieldValue.increment(restore.stock)
        };
        // รวม adminStock increments
        for (const [adminName, qty] of Object.entries(restore.adminStock)) {
          updateData['adminStock.' + adminName] = firebase.firestore.FieldValue.increment(qty);
        }
        transaction.update(itemRef, updateData);
        // stockHistory entries (subcollection docs ไม่ซ้ำกัน — เขียนหลาย doc ได้)
        for (const entry of restore.history) {
          transaction.set(itemRef.collection('stockHistory').doc(), {
            ...entry,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      // คืนยอดใช้คูปอง
      if (order.couponCode) {
        const couponRef = db.collection('coupons').doc(order.couponCode);
        transaction.update(couponRef, {
          usedCount: firebase.firestore.FieldValue.increment(-1)
        });
      }

      transaction.update(orderRef, {
        status: 'cancelled',
        cancelReason: reason,
        cancelledBy: currentAdminName || 'admin',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    // เพิ่ม order เข้า _completedOrders cache ทันที (ป้องกันหายจาก board)
    if (typeof _completedOrders !== 'undefined') {
      const cachedOrder = loadedOrdersCache[orderId];
      if (cachedOrder) {
        cachedOrder.status = 'cancelled';
        cachedOrder.cancelReason = reason;
        cachedOrder.cancelledBy = currentAdminName || 'admin';
        const fakeDoc = { id: orderId, data: () => cachedOrder, exists: true };
        const alreadyExists = _completedOrders.some(d => d.id === orderId);
        if (!alreadyExists) _completedOrders.unshift(fakeDoc);
        else {
          const idx = _completedOrders.findIndex(d => d.id === orderId);
          if (idx >= 0) _completedOrders[idx] = fakeDoc;
        }
        // render ทันที — ป้องกัน order หายจาก board
        if (_lastPendingSnapshot) {
          const board = document.getElementById('orderBoard');
          if (board && typeof processOrderSnapshot === 'function') {
            const combined = { docs: [..._lastPendingSnapshot, ..._completedOrders] };
            processOrderSnapshot(combined, board);
          }
        }
      }
    }

    showToast('ยกเลิก order + คืน stock + คืนคูปองแล้ว');
    if (typeof loadCompletedOrders === 'function') loadCompletedOrders();
  } catch (e) {
    if (!handleQuotaError(e, 'cancel')) {
      showAlert('ยกเลิกไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  }
}

// ============ REVENUE SUMMARY PER ADMIN ============
let revenueResetAt = null; // โหลดจาก settings
let revenueSelectedOrders = null; // ถ้ามี = นับเฉพาะ order เหล่านี้
let adminRevenueResetAt = {}; // per-admin reset timestamps

function loadRevenueResetDate() {
  return db.collection('settings').doc('revenue').get().then(doc => {
    if (doc.exists) {
      const data = doc.data();
      if (data.resetAt) revenueResetAt = data.resetAt.toDate();
      if (Array.isArray(data.selectedOrders) && data.selectedOrders.length > 0) {
        revenueSelectedOrders = new Set(data.selectedOrders);
      } else {
        revenueSelectedOrders = null;
      }
      // per-admin reset
      if (data.adminResetAt && typeof data.adminResetAt === 'object') {
        adminRevenueResetAt = {};
        for (const [name, ts] of Object.entries(data.adminResetAt)) {
          if (ts && ts.toDate) adminRevenueResetAt[name] = ts.toDate();
        }
      }
    }
  }).catch(() => {});
}

async function resetRevenueSummary() {
  const yes = await showConfirm('รีเซ็ตสรุปยอดขายแอดมิน "ทุกคน" เป็น 0?\n(order เก่ายังอยู่ แค่ไม่นับยอด)', 'รีเซ็ตยอดขายทั้งหมด');
  if (!yes) return;

  try {
    await db.collection('settings').doc('revenue').set({
      resetAt: firebase.firestore.FieldValue.serverTimestamp(),
      adminResetAt: firebase.firestore.FieldValue.delete()
    }, { merge: true });
    revenueResetAt = new Date();
    revenueSelectedOrders = null;
    adminRevenueResetAt = {};
    showToast('รีเซ็ตยอดขายทั้งหมดแล้ว');
  } catch (e) {
    showAlert('รีเซ็ตไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

async function resetAdminRevenue(adminName) {
  const yes = await showConfirm(`รีเซ็ตยอดขายของ "${adminName}" เป็น 0?\n(order เก่ายังอยู่ แค่ไม่นับยอดของคนนี้)`, 'รีเซ็ตยอดขาย');
  if (!yes) return;

  try {
    await db.collection('settings').doc('revenue').set({
      adminResetAt: { [adminName]: firebase.firestore.FieldValue.serverTimestamp() }
    }, { merge: true });
    adminRevenueResetAt[adminName] = new Date();
    showToast(`รีเซ็ตยอด ${adminName} แล้ว`);
    // re-render
    if (_lastPendingSnapshot) {
      const board = document.getElementById('orderBoard');
      const combined = { docs: [..._lastPendingSnapshot, ..._completedOrders] };
      processOrderSnapshot(combined, board);
    }
  } catch (e) {
    showAlert('รีเซ็ตไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ซ่อมยอดรวม stats/sales จาก completed orders ทั้งหมด
async function repairStats() {
  const yes = await showConfirm('ซ่อมยอดรวม (นับ completed orders ทั้งหมดใหม่)?', 'ซ่อมยอดรวม');
  if (!yes) return;
  try {
    showToast('กำลังนับ orders...');
    const snap = await db.collection('orders').where('status', '==', 'completed').get();
    let total = 0;
    snap.forEach(doc => { total += Number(doc.data().totalPrice) || 0; });
    await db.collection('stats').doc('sales').set({
      completedCount: snap.size,
      totalRevenue: total
    });
    showAlert(`ซ่อมเสร็จ!\n\nออเดอร์สำเร็จ: ${snap.size}\nยอดรวม: ${total.toLocaleString()} บาท`, 'ซ่อมยอดรวม');
  } catch (e) {
    showAlert('ซ่อมไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// คำนวณยอดขายใหม่ — เลือก order ได้
async function recalculateRevenue() {
  try {
    showToast('กำลังโหลด orders...');
    const snapshot = await db.collection('orders').get();
    const completedOrders = [];
    snapshot.forEach(doc => {
      const order = doc.data();
      if (order.status !== 'completed') return;
      completedOrders.push({ id: doc.id, ...order });
    });

    if (completedOrders.length === 0) {
      showAlert('ไม่มี completed orders', 'คำนวณยอดใหม่');
      return;
    }

    // Sort by createdAt desc
    completedOrders.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    // สร้าง overlay
    let overlay = document.getElementById('recalcOverlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'recalcOverlay';
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '10001';

    const totalAll = completedOrders.reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);

    overlay.innerHTML = `
      <div class="modal" style="max-width:600px;max-height:80vh;display:flex;flex-direction:column;">
        <h2>🔄 คำนวณยอดใหม่</h2>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0;gap:8px;flex-wrap:wrap;">
          <label style="font-size:13px;cursor:pointer;">
            <input type="checkbox" id="recalcSelectAll" checked> เลือกทั้งหมด (${completedOrders.length})
          </label>
          <div style="font-size:14px;font-weight:600;" id="recalcTotal">
            ยอดรวม: <span style="color:#4CAF50;">${totalAll.toLocaleString()}</span> บาท
          </div>
        </div>
        <div style="overflow-y:auto;flex:1;border:1px solid #333;border-radius:8px;padding:4px;margin:8px 0;">
          ${completedOrders.map((o, i) => {
            const price = Number(o.totalPrice) || 0;
            const date = o.createdAt ? new Date(o.createdAt.toMillis()).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-';
            const items = Array.isArray(o.items) ? o.items.map(it => `${escapeHtml(it.name)} x${it.qty}`).join(', ') : '';
            return `
              <label class="recalc-row" style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-bottom:1px solid #222;cursor:pointer;font-size:13px;">
                <input type="checkbox" class="recalc-cb" data-idx="${i}" data-price="${price}" checked style="margin-top:3px;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                  <div style="display:flex;justify-content:space-between;gap:8px;">
                    <span style="color:#e0b0ff;font-weight:500;">#${o.orderNumber || o.id}</span>
                    <span style="color:#aaa;font-size:11px;white-space:nowrap;">${date}</span>
                  </div>
                  <div style="color:#aaa;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${escapeHtml(o.facebook || '')} · ${items}
                  </div>
                </div>
                <span style="color:#4CAF50;font-weight:600;white-space:nowrap;">${price.toLocaleString()} ฿</span>
              </label>
            `;
          }).join('')}
        </div>
        <div class="modal-buttons" style="margin-top:8px;">
          <button class="btn-secondary" id="recalcCancel">ยกเลิก</button>
          <button class="btn-primary" id="recalcConfirm" style="width:auto;padding:10px 30px;margin-top:0;">คำนวณ</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // อัปเดตยอดรวมเมื่อ toggle checkbox
    function updateTotal() {
      let sum = 0, count = 0;
      overlay.querySelectorAll('.recalc-cb').forEach(cb => {
        if (cb.checked) { sum += Number(cb.dataset.price); count++; }
      });
      document.getElementById('recalcTotal').innerHTML =
        `ยอดรวม: <span style="color:#4CAF50;">${sum.toLocaleString()}</span> บาท (${count} orders)`;
    }

    overlay.querySelector('#recalcSelectAll').addEventListener('change', function() {
      overlay.querySelectorAll('.recalc-cb').forEach(cb => cb.checked = this.checked);
      updateTotal();
    });
    overlay.querySelectorAll('.recalc-cb').forEach(cb => cb.addEventListener('change', () => {
      const all = overlay.querySelectorAll('.recalc-cb');
      const checked = overlay.querySelectorAll('.recalc-cb:checked');
      document.getElementById('recalcSelectAll').checked = all.length === checked.length;
      updateTotal();
    }));

    // ยกเลิก
    overlay.querySelector('#recalcCancel').addEventListener('click', () => overlay.remove());

    // ยืนยัน
    overlay.querySelector('#recalcConfirm').addEventListener('click', async () => {
      const selected = [];
      overlay.querySelectorAll('.recalc-cb:checked').forEach(cb => {
        selected.push(completedOrders[Number(cb.dataset.idx)]);
      });

      if (selected.length === 0) {
        showAlert('ไม่ได้เลือก order', 'ผิดพลาด');
        return;
      }

      try {
        let totalRevenue = 0;
        selected.forEach(o => totalRevenue += Number(o.totalPrice) || 0);

        // เก็บ list order ที่เลือก → สรุปยอดแอดมินจะกรองตาม (ไม่แตะ stats/sales)
        const selectedIds = selected.map(o => o.id);
        await db.collection('settings').doc('revenue').set({
          selectedOrders: selectedIds
        });
        revenueResetAt = null;
        revenueSelectedOrders = new Set(selectedIds);

        overlay.remove();
        showAlert(
          `คำนวณใหม่เสร็จ!\n\nเลือก: ${selected.length} / ${completedOrders.length} orders\nยอดรวม: ${totalRevenue.toLocaleString()} บาท`,
          '✅ คำนวณยอดใหม่'
        );
        if (typeof loadOrders === 'function') loadOrders();
      } catch (e) {
        showAlert('คำนวณไม่ได้: ' + e.message, 'ผิดพลาด');
      }
    });

  } catch (e) {
    showAlert('โหลด orders ไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ MARK ORDER AS PAID ============
async function markOrderPaid(orderId) {
  try {
    await db.collection('orders').doc(orderId).update({ paymentMode: 'paid' });
    // อัพเดต DOM ทันทีไม่ต้อง F5 (completed orders ไม่ได้ฟัง real-time)
    const card = document.querySelector(`.admin-order-card[data-order-id="${orderId}"]`);
    if (card) {
      const btn = card.querySelector('[data-action="markPaid"]');
      if (btn) {
        const parent = btn.parentElement;
        // ลบปุ่ม + ข้อความเดิม แล้วใส่ "โอนแล้ว" สีเขียว
        const unpaidLabel = parent.querySelector('span[style*="ff9800"]');
        if (unpaidLabel) unpaidLabel.remove();
        btn.insertAdjacentHTML('beforebegin', '<span style="color:#4CAF50;font-size:12px;font-weight:600;">โอนแล้ว</span>');
        btn.remove();
      }
    }
    // re-fetch completed cache ด้วย (กันกรณี re-render ทับ)
    if (typeof loadCompletedOrders === 'function') loadCompletedOrders();
    showToast('อัปเดตเป็น "โอนแล้ว"');
  } catch (e) {
    showAlert('อัปเดตไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

function updateRevenueSummary(orderDocs) {
  const container = document.getElementById('adminRevenueSummary');
  if (!container) return;

  const adminRevenue = {};   // ยอดเงินจากการส่งของ
  const adminItemCount = {}; // จำนวนชิ้นที่ส่ง
  const adminOrderCount = {}; // จำนวน order ที่ส่ง
  let totalRevenue = 0;
  let completedCount = 0;

  orderDocs.forEach(doc => {
    const order = doc.data();
    if (order.status !== 'completed') return;

    // ถ้ามี selectedOrders (จากคำนวณใหม่) → นับเฉพาะ order ที่เลือก
    if (revenueSelectedOrders && !revenueSelectedOrders.has(doc.id)) return;
    // ข้าม order ก่อน reset (ใช้เมื่อไม่มี selectedOrders)
    if (!revenueSelectedOrders && revenueResetAt && order.createdAt && order.createdAt.toDate() < revenueResetAt) return;
    completedCount++;

    const items = Array.isArray(order.items) ? order.items : [];
    const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
    const orderTotal = Number(order.totalPrice) || 0;
    totalRevenue += orderTotal;

    const orderDate = order.createdAt ? order.createdAt.toDate() : null;

    // helper: เช็คว่า admin คนนี้ถูก per-admin reset หรือยัง
    function isAdminReset(adminName) {
      const perReset = adminRevenueResetAt[adminName];
      return perReset && orderDate && orderDate < perReset;
    }

    if (deliveries.length === 0) {
      // order เก่าที่ไม่มี delivery record → ใส่ "ไม่ระบุ"
      const who = order.handledBy || 'ไม่ระบุ';
      if (!isAdminReset(who)) {
        adminRevenue[who] = (adminRevenue[who] || 0) + orderTotal;
        const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
        adminItemCount[who] = (adminItemCount[who] || 0) + totalQty;
        adminOrderCount[who] = (adminOrderCount[who] || 0) + 1;
      }
      return;
    }

    // คำนวณราคาต่อชิ้นตาม order (รวมส่วนลดแล้ว)
    const rawTotal = items.reduce((s, i) => s + ((Number(i.price) || 0) * (i.qty || 0)), 0);
    const discountRatio = rawTotal > 0 ? orderTotal / rawTotal : 1;

    // กระจายเงินตาม delivery
    const adminsInOrder = new Set();
    deliveries.forEach(del => {
      if (isAdminReset(del.by)) return; // ข้ามถ้าถูก per-admin reset
      const item = items.find(i => i.itemId === del.itemId);
      if (!item) return;
      const itemPrice = (Number(item.price) || 0) * discountRatio;
      const amount = itemPrice * del.qty;

      adminRevenue[del.by] = (adminRevenue[del.by] || 0) + amount;
      adminItemCount[del.by] = (adminItemCount[del.by] || 0) + del.qty;
      adminsInOrder.add(del.by);
    });
    adminsInOrder.forEach(name => {
      adminOrderCount[name] = (adminOrderCount[name] || 0) + 1;
    });
  });

  // หัก com: ถ้าสินค้ามี externalCut ใช้ per-product, ไม่มีใช้ flat 5%
  const COM_RATE = 0.05;
  const adminRevenueNet = {};
  const adminComAmount = {};
  // คำนวณ externalCut com ต่อ admin จาก delivery records
  const adminExternalCutCom = {};
  orderDocs.forEach(doc => {
    const order = doc.data();
    if (order.status !== 'completed') return;
    if (revenueSelectedOrders && !revenueSelectedOrders.has(doc.id)) return;
    if (!revenueSelectedOrders && revenueResetAt && order.createdAt && order.createdAt.toDate() < revenueResetAt) return;
    const items = Array.isArray(order.items) ? order.items : [];
    const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
    const orderDate2 = order.createdAt ? order.createdAt.toDate() : null;
    deliveries.forEach(del => {
      // ข้ามถ้าถูก per-admin reset
      const perReset = adminRevenueResetAt[del.by];
      if (perReset && orderDate2 && orderDate2 < perReset) return;
      const item = items.find(i => i.itemId === del.itemId);
      if (!item) return;
      // หา product จาก allProducts เพื่อเช็ค externalCut
      const product = typeof allProducts !== 'undefined' ? allProducts.find(p => p.id === del.itemId) : null;
      if (product && product.externalCut > 0) {
        // สินค้ามี externalCut → แอดนอกได้ externalCut * qty, owner ได้ส่วนที่เหลือ
        const cutTotal = product.externalCut * del.qty;
        adminExternalCutCom[del.by] = (adminExternalCutCom[del.by] || 0) + cutTotal;
      }
    });
  });

  for (const [name, rev] of Object.entries(adminRevenue)) {
    const isAdminOwner = name === currentAdminName && isOwner;
    if (isAdminOwner) {
      adminRevenueNet[name] = rev;
      adminComAmount[name] = 0;
    } else if (adminExternalCutCom[name] > 0) {
      // มี externalCut → ใช้ externalCut เป็นยอดสุทธิ
      adminRevenueNet[name] = adminExternalCutCom[name];
      adminComAmount[name] = rev - adminExternalCutCom[name];
    } else {
      // ไม่มี externalCut → flat 5%
      const com = rev * COM_RATE;
      adminRevenueNet[name] = rev - com;
      adminComAmount[name] = com;
    }
  }

  // Sort by net revenue desc
  const sorted = Object.entries(adminRevenueNet).sort((a, b) => b[1] - a[1]);
  const totalCom = Object.values(adminComAmount).reduce((s, v) => s + v, 0);

  container.style.display = 'block';

  if (isOwner) {
    // Owner: เห็นยอดรวมทั้งหมด + ทุก admin (หลังหัก com)
    container.innerHTML = `
      <div class="revenue-summary">
        <div class="revenue-header">
          <span>สรุปยอดขายแอดมิน</span>
          <span class="revenue-actions" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="revenue-total">${formatPrice(totalRevenue)} บาท</span>
            <button class="btn-secondary" style="padding:4px 10px;font-size:11px;width:auto;" onclick="recalculateRevenue()">🔄 คำนวณใหม่</button>
            <button class="btn-secondary" style="padding:4px 10px;font-size:11px;width:auto;color:#ff9800;border-color:#ff9800;" onclick="resetRevenueSummary()">รีเซ็ต</button>
            <button class="btn-secondary" style="padding:4px 10px;font-size:11px;width:auto;color:#4fc3f7;border-color:#4fc3f7;" onclick="repairStats()">🔧 ซ่อมยอดรวม</button>
          </span>
        </div>
        ${totalCom > 0 ? `<div style="text-align:right;font-size:12px;color:#4CAF50;margin:-4px 0 8px;">รายได้ค่า com 5%: +${formatPrice(Math.round(totalCom))} ฿</div>` : ''}
        ${sorted.length > 0 ? `<div class="revenue-cards">
          ${sorted.map(([name, netRev], i) => {
            const grossRev = adminRevenue[name] || 0;
            const com = adminComAmount[name] || 0;
            const pct = totalRevenue > 0 ? Math.round((grossRev / totalRevenue) * 100) : 0;
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            const comText = com > 0 ? `<span style="color:#ff9800;font-size:11px;"> (-${formatPrice(Math.round(com))} com)</span>` : '';
            return `
              <div class="revenue-card-v2">
                <div class="rev-card-rank">${medal || '#' + rank}</div>
                <div class="rev-card-info">
                  <div class="rev-card-name">${escapeHtml(name)}</div>
                  <div class="rev-card-bar-wrap">
                    <div class="rev-card-bar" style="width:${pct}%"></div>
                  </div>
                  <div class="rev-card-stats">${adminItemCount[name] || 0} ชิ้น · ${adminOrderCount[name] || 0} orders · ${pct}%</div>
                </div>
                <div class="rev-card-amount">
                  ${formatPrice(Math.round(netRev))} ฿${comText}
                  <button onclick="resetAdminRevenue('${escapeHtml(name)}')" style="display:block;margin-top:4px;background:none;border:1px solid #ff9800;color:#ff9800;border-radius:4px;font-size:10px;padding:2px 6px;cursor:pointer;font-family:inherit;">รีเซ็ต</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>` : '<p style="text-align:center;color:#aaa;margin:8px 0 0;">ยังไม่มียอดขาย</p>'}
      </div>
    `;
  } else {
    // Admin ทั่วไป: เห็นแค่ยอดตัวเอง (หลังหัก com แบบเงียบ)
    const myNet = adminRevenueNet[currentAdminName] || 0;
    const myItems = adminItemCount[currentAdminName] || 0;
    const myOrders = adminOrderCount[currentAdminName] || 0;
    const myGross = adminRevenue[currentAdminName] || 0;
    const myPct = totalRevenue > 0 ? Math.round((myGross / totalRevenue) * 100) : 0;

    container.innerHTML = `
      <div class="revenue-summary revenue-my">
        <div class="revenue-my-label">ยอดขายของฉัน</div>
        <div class="revenue-my-amount">${formatPrice(Math.round(myNet))} ฿</div>
        <div class="revenue-my-stats">${myItems} ชิ้น · ${myOrders} orders</div>
      </div>
    `;
  }
}

