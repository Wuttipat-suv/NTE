// ============ LOAD ORDERS (Real-time) ============
let knownOrderIds = new Set();
let firstLoad = true;
let currentOrderLimit = 30;
let loadedOrdersCache = {}; // เก็บ object ชั่วคราวเอาไว้โชว์สลิป
let unsubCoupons = null; // Listener คูปอง
let currentDeliverOrderId = null;

// ============ DELIVER ORDER (ส่งของ) ============
function openDeliverModal(orderId) {
  const order = loadedOrdersCache[orderId];
  if (!order) return;

  currentDeliverOrderId = orderId;
  const items = Array.isArray(order.items) ? order.items : [];
  const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];

  document.getElementById('deliverOrderInfo').innerHTML = `
    <div style="color:#e0b0ff;font-weight:600;">FB: ${escapeHtml(order.facebook)}</div>
    <div>ตัวละคร: ${escapeHtml(order.characterName)}</div>
  `;

  document.getElementById('deliverItemsList').innerHTML = items.map((item, i) => {
    const delivered = deliveries
      .filter(d => d.itemId === item.itemId)
      .reduce((sum, d) => sum + d.qty, 0);
    const remaining = item.qty - delivered;
    return `
      <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="flex:1;">${escapeHtml(item.name)}</span>
        <input type="number" min="0" max="${remaining}" value="${remaining}"
               class="deliver-qty-input" data-index="${i}" data-item-id="${item.itemId}"
               style="width:60px;text-align:center;" ${remaining <= 0 ? 'disabled value="0"' : ''}>
        <span style="color:#aaa;font-size:13px;">/ ${item.qty}${delivered > 0 ? ` (ส่งแล้ว ${delivered})` : ''}</span>
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

      for (const di of deliverItems) {
        const totalDelivered = existingDeliveries
          .filter(d => d.itemId === di.itemId)
          .reduce((sum, d) => sum + d.qty, 0);
        const orderItem = orderItems.find(i => i.itemId === di.itemId);
        const remaining = orderItem ? orderItem.qty - totalDelivered : 0;

        if (di.qty > remaining) throw new Error(`${di.name} ส่งได้อีกแค่ ${remaining}`);

        newDeliveries.push({
          itemId: di.itemId,
          qty: di.qty,
          by: adminName,
          at: new Date()
        });

        // บันทึก stockHistory + อัปเดต adminStock
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
      }

      transaction.update(orderRef, updateData);
    });

    closeDeliverModal();
    showToast('บันทึกการส่งของแล้ว');
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

      // คืน stock ทุกไอเทม
      for (const item of items) {
        if (item.itemId) {
          transaction.update(db.collection('items').doc(item.itemId), {
            stock: firebase.firestore.FieldValue.increment(item.qty)
          });
        }
      }

      // ย้อน delivery ที่เคยส่งไป → คืน adminStock + stockHistory
      for (const del of deliveries) {
        if (del.itemId && del.by) {
          transaction.set(db.collection('items').doc(del.itemId), {
            adminStock: { [del.by]: firebase.firestore.FieldValue.increment(del.qty) }
          }, { merge: true });
        }
        transaction.set(
          db.collection('items').doc(del.itemId).collection('stockHistory').doc(),
          {
            qty: del.qty, // +คืน
            addedBy: del.by,
            note: 'คืน stock (ยกเลิก order)',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }
        );
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

    showToast('ยกเลิก order + คืน stock + คืนคูปองแล้ว');
  } catch (e) {
    if (!handleQuotaError(e, 'cancel')) {
      showAlert('ยกเลิกไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  }
}

// ============ REVENUE SUMMARY PER ADMIN ============
let revenueResetAt = null; // โหลดจาก settings

function loadRevenueResetDate() {
  return db.collection('settings').doc('revenue').get().then(doc => {
    if (doc.exists && doc.data().resetAt) {
      revenueResetAt = doc.data().resetAt.toDate();
    }
  }).catch(() => {});
}

async function resetRevenueSummary() {
  const yes = await showConfirm('รีเซ็ตสรุปยอดขายแอดมินเป็น 0?\n(order เก่ายังอยู่ แค่ไม่นับยอด)', 'รีเซ็ตยอดขาย');
  if (!yes) return;

  try {
    await db.collection('settings').doc('revenue').set({
      resetAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    revenueResetAt = new Date();
    showToast('รีเซ็ตยอดขายแล้ว');
  } catch (e) {
    showAlert('รีเซ็ตไม่ได้: ' + e.message, 'ผิดพลาด');
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

    // ข้าม order ก่อน reset
    if (revenueResetAt && order.createdAt && order.createdAt.toDate() < revenueResetAt) return;
    completedCount++;

    const items = Array.isArray(order.items) ? order.items : [];
    const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
    const orderTotal = Number(order.totalPrice) || 0;
    totalRevenue += orderTotal;

    if (deliveries.length === 0) {
      // order เก่าที่ไม่มี delivery record → ใส่ "ไม่ระบุ"
      const who = order.handledBy || 'ไม่ระบุ';
      adminRevenue[who] = (adminRevenue[who] || 0) + orderTotal;
      const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
      adminItemCount[who] = (adminItemCount[who] || 0) + totalQty;
      adminOrderCount[who] = (adminOrderCount[who] || 0) + 1;
      return;
    }

    // คำนวณราคาต่อชิ้นตาม order (รวมส่วนลดแล้ว)
    const rawTotal = items.reduce((s, i) => s + ((Number(i.price) || 0) * (i.qty || 0)), 0);
    const discountRatio = rawTotal > 0 ? orderTotal / rawTotal : 1;

    // กระจายเงินตาม delivery
    const adminsInOrder = new Set();
    deliveries.forEach(del => {
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

  // หัก com 5% จากแอดมินที่ไม่ใช่ owner
  const COM_RATE = 0.05;
  const adminRevenueNet = {};
  const adminComAmount = {};
  for (const [name, rev] of Object.entries(adminRevenue)) {
    // เช็คว่าเป็น owner หรือไม่ — owner ไม่โดนหัก
    const isAdminOwner = name === currentAdminName && isOwner;
    // ถ้าดูจาก owner มุมมอง: ต้องเช็คจาก adminNames + role
    // วิธีง่าย: owner คือคนที่ login อยู่ตอนนี้ (isOwner && name === currentAdminName)
    // คนอื่นหัก com หมด
    if (isAdminOwner) {
      adminRevenueNet[name] = rev;
      adminComAmount[name] = 0;
    } else {
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
          <span style="display:flex;align-items:center;gap:10px;">
            <span class="revenue-total">${formatPrice(totalRevenue)} บาท</span>
            <button class="btn-secondary" style="padding:4px 10px;font-size:11px;width:auto;color:#ff9800;border-color:#ff9800;" onclick="resetRevenueSummary()">รีเซ็ต</button>
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
                <div class="rev-card-amount">${formatPrice(Math.round(netRev))} ฿${comText}</div>
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

