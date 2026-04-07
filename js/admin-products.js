// ============ HELPER: เช็คว่าสินค้าเป็นของ admin คนนี้ ============
function isMyProduct(item) {
  if (!currentAdminName) return false;
  // 1) owner แชร์ให้ external เห็น
  if (item.sharedWithExternal) return true;
  // 2) ตัวเองมี adminStock > 0
  const aliases = typeof getAdminAliases === 'function' ? getAdminAliases(currentAdminName) : [currentAdminName];
  const adminStockMap = item.adminStock || {};
  for (const alias of aliases) {
    if (getAdminStockValue(adminStockMap, alias) > 0) return true;
  }
  return false;
}

// ============ LOAD PRODUCTS (real-time) ============
function loadProducts() {
  if (unsubProducts) {
    unsubProducts();
    unsubProducts = null;
  }

  const tbody = document.getElementById('productTableBody');

  const itemsQuery = db.collection('items');

  if (_quotaSaving) {
    itemsQuery.get().then(snapshot => processProductSnapshot(snapshot)).catch(e => {
      console.error(e);
      if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadProducts');
    });
    return;
  }

  unsubProducts = itemsQuery.onSnapshot(snapshot => {
    processProductSnapshot(snapshot);
  }, (e) => {
    console.error(e);
    if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadProducts');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#ff6b6b;">โหลดสินค้าไม่ได้</td></tr>';
  });
}

function processProductSnapshot(snapshot) {
  const tbody = document.getElementById('productTableBody');
  if (snapshot.empty) {
      allProducts = [];
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#aaa;">ยังไม่มีสินค้า</td></tr>';
      return;
    }

    allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Safety net: auto-fix stock ติดลบ
    for (const item of allProducts) {
      if ((Number(item.stock) || 0) < 0) {
        db.collection('items').doc(item.id).update({ stock: 0 }).catch(() => {});
        item.stock = 0;
      }
    }

    allProducts.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));

    // External admin → แสดงเฉพาะสินค้าที่ตัวเองมี adminStock
    const visibleProducts = isExternal ? allProducts.filter(item => isMyProduct(item)) : allProducts;

    tbody.innerHTML = visibleProducts.map((item, index) => {
      const isActive = item.active !== false;
      return `
        <tr draggable="true" data-id="${item.id}" style="${!isActive ? 'opacity:0.4;' : ''}">
          <td style="text-align:center;"><span class="drag-handle">☰</span> <span style="color:#e0b0ff;font-weight:600;">${index + 1}</span></td>
          <td><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22><rect fill=%22%23333%22 width=%2250%22 height=%2250%22/></svg>'"></td>
          <td>
            <div class="product-name-row">
              <span>${escapeHtml(item.name)}${item.bundleQty > 1 ? ` <span style="color:#ff9800;font-size:11px;">(ชุดละ ${item.bundleQty})</span>` : ''}</span>
              <span class="product-badges">
                ${isOwner ? `<button class="badge-btn" data-action="toggleShare" data-id="${item.id}" data-shared="${!!item.sharedWithExternal}" title="${item.sharedWithExternal ? 'ยกเลิกแชร์กับภายนอก' : 'แชร์ให้แอดมินภายนอกเห็น'}" style="color:${item.sharedWithExternal ? '#ff9800' : '#555'}">${item.sharedWithExternal ? '🔗' : '🔒'}</button>` : ''}
                ${isOwner ? `<button class="badge-btn" data-action="toggleActive" data-id="${item.id}" data-active="${isActive}" title="${isActive ? 'ปิดสินค้า' : 'เปิดสินค้า'}" style="color:${isActive ? '#4CAF50' : '#ff4444'}">${isActive ? '👁' : '🚫'}</button>` : `<span style="color:${isActive ? '#4CAF50' : '#ff4444'};font-size:13px;">${isActive ? '👁' : '🚫'}</span>`}
              </span>
            </div>
          </td>
          <td style="text-align:center;">${formatPrice(item.price)} บาท</td>
          <td style="text-align:center;">${isOwner ? `<input type="number" step="any" min="0" class="promo-input" data-action="promo" data-id="${item.id}" value="${item.promoPrice != null ? item.promoPrice : ''}" placeholder="-">` : `<span style="color:#ff9800;">${item.promoPrice != null ? formatPrice(item.promoPrice) : '-'}</span>`}</td>
          <td style="font-weight:600;text-align:center;">${Number(item.stock) || 0}</td>
          <td style="text-align:center;color:#4fc3f7;">${Number(item.soldCount) || 0}</td>
          <td style="text-align:center;"><div class="stock-btn-group"><button class="btn-stock-add" data-action="addStock" data-id="${item.id}" data-name="${escapeHtml(item.name)}">+</button><button class="btn-stock-reduce" data-action="reduceStock" data-id="${item.id}" data-name="${escapeHtml(item.name)}">-</button></div></td>
          <td style="text-align:center;"><button class="btn-icon" data-action="stockHistory" data-id="${item.id}" data-name="${escapeHtml(item.name)}">&#128065;</button></td>
          <td style="text-align:center;white-space:nowrap;">
            <button class="btn-icon" data-action="edit" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-price="${Number(item.price) || 0}" data-image="${escapeHtml(item.image || '')}" title="แก้ไข"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
            <button class="btn-icon btn-icon-danger" data-action="delete" data-id="${item.id}" title="ลบ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </td>
        </tr>
      `;
    }).join('');

    // Restore active accum badges after re-render
    Object.keys(stockAccum).forEach(id => {
      if (stockAccum[id].total !== 0) showStockAccumBadge(id, stockAccum[id].total);
    });
}

// ============ HELPER: อ่าน adminStock รองรับทั้ง flat key และ nested path ============
function getAdminStockValue(adminStockMap, key) {
  if (!adminStockMap || typeof adminStockMap !== 'object') return 0;
  // 1) flat key: adminStock["เลย์"] or adminStock["bubbleshop.wuttipat"]
  if (adminStockMap[key] !== undefined) return Number(adminStockMap[key]) || 0;
  // 2) nested path: adminStock.bubbleshop.wuttipat (Firestore dot-separated)
  const parts = key.split('.');
  if (parts.length > 1) {
    let val = adminStockMap;
    for (const p of parts) {
      if (val && typeof val === 'object') val = val[p];
      else return 0;
    }
    return Number(val) || 0;
  }
  return 0;
}

// ============ QUICK STOCK ADJUST (กด +/- ทีละ 1, debounce 800ms) ============
function quickStockAdjust(itemId, itemName, delta) {
  if (!stockAccum[itemId]) stockAccum[itemId] = { total: 0, timer: null, sending: false };

  stockAccum[itemId].total += delta;
  showStockAccumBadge(itemId, stockAccum[itemId].total);

  // ถ้ากำลังส่ง Firestore อยู่ ให้สะสมไว้ก่อน จะส่งอีกรอบหลัง commit เสร็จ
  if (stockAccum[itemId].sending) return;

  clearTimeout(stockAccum[itemId].timer);
  stockAccum[itemId].timer = setTimeout(() => flushStockAccum(itemId, itemName), 800);
}

async function flushStockAccum(itemId, itemName) {
  const acc = stockAccum[itemId];
  if (!acc || acc.total === 0) {
    // total = 0 → กด + แล้ว - เท่ากัน ไม่ต้องส่ง
    if (acc) { fadeStockAccumBadge(itemId); delete stockAccum[itemId]; }
    return;
  }

  const delta = acc.total;
  acc.total = 0; // reset เพื่อรับคลิกใหม่ระหว่างส่ง
  acc.sending = true;

  try {
    await db.runTransaction(async (transaction) => {
      const itemRef = db.collection('items').doc(itemId);
      const itemDoc = await transaction.get(itemRef);
      if (!itemDoc.exists) throw new Error('ไม่พบสินค้า');

      const currentStock = Number(itemDoc.data().stock) || 0;
      if (delta < 0 && currentStock + delta < 0) {
        throw new Error('stock ไม่พอ (เหลือ ' + currentStock + ')');
      }

      transaction.set(itemRef, {
        stock: firebase.firestore.FieldValue.increment(delta),
        adminStock: { [currentAdminName]: firebase.firestore.FieldValue.increment(delta) },
        _adminAdjust: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(itemRef.collection('stockHistory').doc(), {
        qty: delta,
        addedBy: currentAdminName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  } catch (e) {
    if (typeof handleQuotaError === 'function' && handleQuotaError(e, 'stockAdjust')) {
      // handled
    } else if (e.message.startsWith('stock ไม่พอ')) {
      showToast(`${itemName} ${e.message}`);
    } else {
      showAlert('แก้ stock ไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  }

  acc.sending = false;

  // ถ้ามีคลิกสะสมเพิ่มระหว่างส่ง → ส่งอีกรอบ
  if (acc.total !== 0) {
    acc.timer = setTimeout(() => flushStockAccum(itemId, itemName), 300);
  } else {
    fadeStockAccumBadge(itemId);
    delete stockAccum[itemId];
  }
}

function showStockAccumBadge(itemId, total) {
  let badge = document.querySelector(`.stock-accum-badge[data-item-id="${itemId}"]`);
  if (!badge) {
    const btnGroup = document.querySelector(`button[data-action="addStock"][data-id="${itemId}"]`);
    if (!btnGroup) return;
    badge = document.createElement('span');
    badge.className = 'stock-accum-badge';
    badge.dataset.itemId = itemId;
    btnGroup.closest('.stock-btn-group').appendChild(badge);
  }
  badge.textContent = (total > 0 ? '+' : '') + total;
  badge.className = 'stock-accum-badge ' + (total > 0 ? 'positive' : total < 0 ? 'negative' : '');
  badge.style.opacity = '1';
  badge.style.transition = 'none';
}

function fadeStockAccumBadge(itemId) {
  const badge = document.querySelector(`.stock-accum-badge[data-item-id="${itemId}"]`);
  if (!badge) return;
  badge.style.transition = 'opacity 0.5s ease';
  badge.style.opacity = '0';
  setTimeout(() => badge.remove(), 500);
}

// ============ ADD STOCK MODAL ============
function openAddStockModal(itemId, itemName, mode) {
  currentStockItemId = itemId;
  currentStockItemName = itemName;
  stockMode = mode || 'add';
  clearFieldErrors();
  document.getElementById('addStockItemName').textContent = itemName;
  document.getElementById('addStockQty').value = '';
  document.getElementById('addStockBy').innerHTML = renderAdminOptions(currentAdminName);

  const isReduce = stockMode === 'reduce';
  document.getElementById('addStockModal').querySelector('h2').textContent = isReduce ? 'ลด Stock' : 'เพิ่ม Stock';
  document.getElementById('confirmAddStock').textContent = isReduce ? 'ลด Stock' : 'เพิ่ม Stock';
  document.querySelector('label[for="addStockQty"]').textContent = isReduce ? 'จำนวนที่ลด' : 'จำนวนที่เพิ่ม';
  document.getElementById('addStockModal').classList.add('active');
}

function closeAddStockModal() {
  document.getElementById('addStockModal').classList.remove('active');
  currentStockItemId = null;
}

async function confirmAddStock() {
  clearFieldErrors();
  const qty = parseInt(document.getElementById('addStockQty').value, 10);
  const addedBy = document.getElementById('addStockBy').value.trim();

  let hasError = false;
  if (isNaN(qty) || qty <= 0) { showFieldError('addStockQtyError', 'กรุณากรอกจำนวน'); hasError = true; }
  if (!addedBy) { showFieldError('addStockByError', 'กรุณากรอกชื่อคนเพิ่ม'); hasError = true; }
  if (hasError) return;

  const btn = document.getElementById('confirmAddStock');
  btn.disabled = true;
  btn.textContent = 'กำลังเพิ่ม...';

  try {
    const isReduce = stockMode === 'reduce';
    const delta = isReduce ? -qty : qty;
    const itemId = currentStockItemId;

    await db.runTransaction(async (transaction) => {
      const itemRef = db.collection('items').doc(itemId);
      const itemDoc = await transaction.get(itemRef);
      if (!itemDoc.exists) throw new Error('ไม่พบสินค้า');

      if (isReduce) {
        const currentStock = Number(itemDoc.data().stock) || 0;
        if (qty > currentStock) throw new Error(`stock มีแค่ ${currentStock} ลดไม่ได้`);
      }

      transaction.set(itemRef, {
        stock: firebase.firestore.FieldValue.increment(delta),
        adminStock: { [addedBy]: firebase.firestore.FieldValue.increment(delta) },
        _adminAdjust: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(itemRef.collection('stockHistory').doc(), {
        qty: delta,
        addedBy,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    closeAddStockModal();
  } catch (e) {
    showAlert((stockMode === 'reduce' ? 'ลด' : 'เพิ่ม') + ' stock ไม่ได้: ' + e.message, 'ผิดพลาด');
  } finally {
    btn.disabled = false;
    btn.textContent = stockMode === 'reduce' ? 'ลด Stock' : 'เพิ่ม Stock';
  }
}

// ============ STOCK HISTORY MODAL ============
async function openStockHistory(itemId, itemName) {
  document.getElementById('stockHistoryItemName').textContent = itemName;
  const list = document.getElementById('stockHistoryList');
  const summary = document.getElementById('stockHistorySummary');
  list.innerHTML = '<p style="text-align:center;color:#aaa;">กำลังโหลด...</p>';
  summary.innerHTML = '';
  document.getElementById('stockHistoryModal').classList.add('active');

  try {
    const snapshot = await db.collection('items').doc(itemId)
      .collection('stockHistory')
      .orderBy('createdAt', 'desc')
      .get();

    if (snapshot.empty) {
      list.innerHTML = '<p style="text-align:center;color:#aaa;">ยังไม่มีประวัติ</p>';
      return;
    }

    // สรุปยอดแต่ละคน — เพิ่ม / ส่งของ / คงเหลือ (ตามจริง)
    const adminAdded = {};     // ยอดเพิ่ม (+) ของแต่ละ admin
    const adminDelivered = {}; // ยอดส่ง (-) ของแต่ละ admin
    let historyTotal = 0;

    snapshot.docs.forEach(doc => {
      const h = doc.data();
      const who = typeof resolveAdminName === 'function' ? resolveAdminName(h.addedBy) : (h.addedBy || 'ไม่ระบุ');
      const qty = h.qty || 0;
      historyTotal += qty;

      if (qty > 0) {
        adminAdded[who] = (adminAdded[who] || 0) + qty;
      } else if (qty < 0) {
        adminDelivered[who] = (adminDelivered[who] || 0) + Math.abs(qty);
      }
    });

    // stock จริง + ยอดรอส่ง
    const product = allProducts.find(p => p.id === itemId);
    const actualStock = product ? (Number(product.stock) || 0) : 0;
    const pending = historyTotal - actualStock; // order ที่ซื้อแล้วแต่ยังไม่กดส่ง

    // สร้าง summary แต่ละ admin
    const allAdmins = new Set([...Object.keys(adminAdded), ...Object.keys(adminDelivered)]);
    const adminNets = {};
    allAdmins.forEach(name => {
      const added = adminAdded[name] || 0;
      const delivered = adminDelivered[name] || 0;
      adminNets[name] = added - delivered;
    });

    // Pass 2: ข้อมูลเก่า — ถ้า admin ไหนติดลบ (หักคนเดียว) → ย้ายส่วนลบไปคนอื่นตามสัดส่วน
    let fixNeeded = true;
    while (fixNeeded) {
      fixNeeded = false;
      for (const [negName, negNet] of Object.entries(adminNets)) {
        if (negNet >= 0) continue;
        const deficit = Math.abs(negNet);
        adminNets[negName] = 0;

        const posEntries = Object.entries(adminNets).filter(([n, v]) => n !== negName && v > 0);
        const totalPos = posEntries.reduce((s, [, v]) => s + v, 0);
        if (totalPos === 0) break;

        let remaining = deficit;
        posEntries.forEach(([posName, posNet], i) => {
          const share = (i === posEntries.length - 1) ? remaining : Math.round(deficit * (posNet / totalPos));
          adminNets[posName] -= share;
          remaining -= share;
        });
        fixNeeded = true;
        break; // restart loop after redistribution
      }
    }

    const adminSummary = [];
    allAdmins.forEach(name => {
      adminSummary.push({
        name,
        added: adminAdded[name] || 0,
        delivered: adminDelivered[name] || 0,
        net: adminNets[name]
      });
    });

    summary.innerHTML = `
      <div class="stock-summary">
        ${adminSummary.map(a =>
          `<div class="stock-summary-item">
            <span>${escapeHtml(a.name)}</span>
            <span style="font-size:11px;color:#aaa;">เพิ่ม +${a.added}${a.delivered ? ' / ส่ง -' + a.delivered : ''}</span>
            <span style="color:${a.net >= 0 ? '#4caf50' : '#ff4444'};font-weight:700;">${a.net >= 0 ? '+' : ''}${a.net}</span>
          </div>`
        ).join('')}
        ${pending > 0 ? `<div class="stock-summary-item" style="color:#ff9800;">
          <span>รอส่ง</span>
          <span style="font-weight:700;">${pending}</span>
        </div>` : ''}
        <div class="stock-summary-total">
          <span>คงเหลือจริง</span>
          <span style="font-weight:700;">${actualStock}</span>
        </div>
      </div>
    `;

    // รวม record ต่อเนื่อง (คนเดียวกัน, ห่างกัน ≤10 วินาที)
    const GAP = 10000; // 10 วินาที
    const groups = [];
    snapshot.docs.forEach(doc => {
      const h = doc.data();
      const who = typeof resolveAdminName === 'function' ? resolveAdminName(h.addedBy) : (h.addedBy || 'ไม่ระบุ');
      const time = h.createdAt ? h.createdAt.toDate() : null;
      const note = h.note || '';
      const last = groups.length > 0 ? groups[groups.length - 1] : null;

      if (last && last.who === who && !note && !last.note && time && last.startTime
          && Math.abs(last.startTime - time) <= GAP) {
        last.qty += (h.qty || 0);
        // docs เรียง desc → time เก่ากว่า last
        if (time < last.startTime) last.startTime = time;
        if (time > last.endTime) last.endTime = time;
        last.count++;
      } else {
        groups.push({ who, qty: h.qty || 0, note, startTime: time, endTime: time, count: 1 });
      }
    });

    list.innerHTML = groups.map(g => {
      const note = g.note ? `<div style="font-size:11px;color:#ff9800;">${escapeHtml(g.note)}</div>` : '';
      const fmt = (d) => d ? d.toLocaleTimeString('th-TH') : '-';
      const dateFmt = (d) => d ? d.toLocaleDateString('th-TH') : '';
      let timeText;
      if (g.count > 1 && g.startTime && g.endTime) {
        timeText = `${dateFmt(g.endTime)} ${fmt(g.endTime)}-${fmt(g.startTime)}`;
      } else {
        timeText = g.startTime ? g.startTime.toLocaleString('th-TH') : '-';
      }
      return `
        <div class="stock-history-row">
          <div>
            <div style="font-weight:600;">${escapeHtml(g.who)}</div>
            ${note}
            <div style="font-size:12px;color:#aaa;">${timeText}</div>
          </div>
          <div style="color:${g.qty >= 0 ? '#4caf50' : '#ff4444'};font-weight:600;font-size:16px;">${g.qty >= 0 ? '+' : ''}${g.qty}</div>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.error(e);
    list.innerHTML = '<p style="text-align:center;color:#ff6b6b;">โหลดประวัติไม่ได้</p>';
  }
}

function closeStockHistory() {
  document.getElementById('stockHistoryModal').classList.remove('active');
}

// ============ CLEAR ALL STOCK HISTORY ============
async function clearAllStockHistory() {
  const yes = await showConfirm(
    'ลบประวัติ Stock ทั้งหมดทุกสินค้า?\nจะเริ่มนับใหม่จาก 0 (stock จริงไม่เปลี่ยน)',
    'เคลียร์ประวัติ Stock'
  );
  if (!yes) return;

  const btn = document.getElementById('clearStockHistoryBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังลบ...'; }

  try {
    const itemsSnap = await db.collection('items').get();
    let totalDeleted = 0;

    for (const itemDoc of itemsSnap.docs) {
      const histSnap = await itemDoc.ref.collection('stockHistory').get();
      if (histSnap.empty) continue;

      // Firestore batch limit = 500
      const docs = histSnap.docs;
      for (let i = 0; i < docs.length; i += 499) {
        const batch = db.batch();
        docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      totalDeleted += docs.length;
    }

    showToast(`ลบประวัติ Stock แล้ว ${totalDeleted} รายการ`);
  } catch (e) {
    showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'เคลียร์ประวัติ Stock ทั้งหมด'; }
  }
}

// ============ RESET ALL STOCK TO ZERO ============
async function resetAllStockToZero() {
  const yes = await showConfirm(
    'รีเซ็ต stock ทุกสินค้าเป็น 0\nรวมถึง adminStock และประวัติ Stock ทั้งหมด\n\nยืนยัน?',
    'รีเซ็ต Stock ทั้งหมด'
  );
  if (!yes) return;

  const doubleCheck = await showConfirm('ยืนยันอีกครั้ง — stock ทุกสินค้าจะเป็น 0 หมด!', 'ยืนยันครั้งสุดท้าย');
  if (!doubleCheck) return;

  showToast('กำลังรีเซ็ต...');

  try {
    const itemsSnap = await db.collection('items').get();

    for (let i = 0; i < itemsSnap.docs.length; i += 499) {
      const batch = db.batch();
      itemsSnap.docs.slice(i, i + 499).forEach(doc => {
        batch.update(doc.ref, { stock: 0, adminStock: {} });
      });
      await batch.commit();
    }

    // ล้าง settings/adminStock (disabled toggles)
    await db.collection('settings').doc('adminStock').set({ disabled: {} });

    // ล้าง stockHistory ทุกสินค้า
    for (const itemDoc of itemsSnap.docs) {
      const histSnap = await itemDoc.ref.collection('stockHistory').get();
      if (histSnap.empty) continue;
      for (let i = 0; i < histSnap.docs.length; i += 499) {
        const batch = db.batch();
        histSnap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }

    showAlert(`รีเซ็ตแล้ว ${itemsSnap.docs.length} สินค้า — stock = 0, adminStock ว่าง, ประวัติถูกลบ`, 'เสร็จแล้ว');
  } catch (e) {
    showAlert('รีเซ็ตไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ ADMIN STOCK TOGGLE (เปิด/ปิด stock แอดมิน) ============
let disabledAdminsCache = {}; // { adminName: { itemId: qty } }
let unsubAdminStock = null;

function renderAdminStockToggles() {
  const container = document.getElementById('adminStockToggles');
  if (!container) return;

  // ยกเลิก listener เก่าก่อน ป้องกัน duplicate
  if (unsubAdminStock) { unsubAdminStock(); unsubAdminStock = null; }

  // แอดมินทั่วไปเห็นแค่ของตัวเอง / owner เห็นทั้งหมด
  const visibleAdmins = isOwner ? adminNames : [currentAdminName];

  function processAdminStockDoc(doc) {
    disabledAdminsCache = (doc.exists && doc.data().disabled) ? doc.data().disabled : {};

    container.style.display = 'block';
    container.innerHTML = `
      <div class="admin-stock-toggles-title">เปิด/ปิด Stock แอดมิน</div>
      <div class="admin-stock-toggle-list">
        ${visibleAdmins.map(name => {
          const isDisabled = !!disabledAdminsCache[name];
          return `
            <div class="admin-stock-toggle-item ${isDisabled ? 'disabled' : ''}">
              <span class="admin-stock-toggle-name">${escapeHtml(name)}</span>
              <label class="toggle-switch">
                <input type="checkbox" ${isDisabled ? '' : 'checked'} data-admin-toggle="${escapeHtml(name)}">
                <span class="toggle-slider"></span>
              </label>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Bind toggle events
    container.querySelectorAll('[data-admin-toggle]').forEach(input => {
      input.addEventListener('change', (e) => {
        const name = e.target.dataset.adminToggle;
        const enabling = e.target.checked;
        e.target.disabled = true;
        toggleAdminStock(name, enabling).finally(() => { e.target.disabled = false; });
      });
    });
  }

  // Quota saving mode → .get() ครั้งเดียว
  if (_quotaSaving) {
    db.collection('settings').doc('adminStock').get()
      .then(doc => processAdminStockDoc(doc))
      .catch(() => {});
    return;
  }

  unsubAdminStock = db.collection('settings').doc('adminStock').onSnapshot(
    doc => processAdminStockDoc(doc),
    e => { if (typeof handleQuotaError === 'function') handleQuotaError(e, 'adminStockToggle'); }
  );
}

async function toggleAdminStock(adminName, enabling) {
  if (enabling) {
    // คืน stock — ดึงข้อมูลจาก Firestore ตรงๆ ไม่พึ่ง cache (อาจ stale)
    let saved = disabledAdminsCache[adminName];
    try {
      const freshDoc = await db.collection('settings').doc('adminStock').get();
      if (freshDoc.exists && freshDoc.data().disabled && freshDoc.data().disabled[adminName]) {
        saved = freshDoc.data().disabled[adminName];
        disabledAdminsCache = freshDoc.data().disabled;
      }
    } catch (e) {
      console.warn('toggleAdminStock: fetch fresh disabled data failed, using cache', e);
    }
    if (!saved || Object.keys(saved).length === 0) {
      // ไม่มีข้อมูลที่เก็บไว้ แค่ลบ flag
      await db.collection('settings').doc('adminStock').set({
        disabled: { [adminName]: firebase.firestore.FieldValue.delete() }
      }, { merge: true });
      showToast(`เปิด stock ${adminName} แล้ว`);
      return;
    }

    const entries = Object.entries(saved);
    for (let i = 0; i < entries.length; i += 249) {
      const batch = db.batch();
      entries.slice(i, i + 249).forEach(([itemId, qty]) => {
        const itemRef = db.collection('items').doc(itemId);
        batch.set(itemRef, {
          stock: firebase.firestore.FieldValue.increment(qty),
          adminStock: { [adminName]: firebase.firestore.FieldValue.increment(qty) },
          _adminAdjust: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        batch.set(itemRef.collection('stockHistory').doc(), {
          qty: qty,
          addedBy: adminName,
          note: 'เปิด stock กลับ',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      if (i === 0) {
        batch.set(db.collection('settings').doc('adminStock'), {
          disabled: { [adminName]: firebase.firestore.FieldValue.delete() }
        }, { merge: true });
      }
      await batch.commit();
    }
    showToast(`เปิด stock ${adminName} แล้ว (คืน stock ทุกสินค้า)`);

  } else {
    // ปิด stock — ดึง adminStock จาก item โดยตรง
    const yes = await showConfirm(
      `ปิด stock ของ "${adminName}"?\nstock ทุกสินค้าจะลดลงตามจำนวนที่ ${adminName} เพิ่มไว้`,
      'ปิด Stock แอดมิน'
    );
    if (!yes) return;

    const savedAmounts = {};
    const aliases = typeof getAdminAliases === 'function' ? getAdminAliases(adminName) : [adminName];
    // ถ้า allProducts ว่าง (quota mode) ให้ fetch จาก Firestore ตรงๆ
    let productList = allProducts;
    if (!productList || productList.length === 0) {
      try {
        const snap = await db.collection('items').get();
        productList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) {
        showAlert('โหลดสินค้าไม่ได้: ' + e.message, 'ผิดพลาด');
        return;
      }
    }
    for (const item of productList) {
      const adminStockMap = item.adminStock || {};
      let adminQty = 0;
      let matchedKey = adminName;
      for (const alias of aliases) {
        const val = getAdminStockValue(adminStockMap, alias);
        if (val > 0) {
          adminQty += val;
          matchedKey = alias;
        }
      }
      if (adminQty > 0) {
        // Cap หักจาก stock จริงไม่ให้ติดลบ (ของอาจถูกขายไปแล้ว)
        const currentStock = Math.max(0, Number(item.stock) || 0);
        const deductQty = Math.min(adminQty, currentStock);
        savedAmounts[item.id] = { deductQty, adminQty, key: matchedKey };
      }
    }

    if (Object.keys(savedAmounts).length === 0) {
      await db.collection('settings').doc('adminStock').set({
        disabled: { [adminName]: {} }
      }, { merge: true });
      showToast(`ปิด stock ${adminName} แล้ว (ไม่มี stock ที่ต้องหัก)`);
      return;
    }

    // แปลงเป็น { itemId: deductQty } สำหรับ save + restore
    const saveForRestore = {};
    const entries = Object.entries(savedAmounts);
    entries.forEach(([itemId, { deductQty }]) => { saveForRestore[itemId] = deductQty; });

    for (let i = 0; i < entries.length; i += 249) {
      const batch = db.batch();
      entries.slice(i, i + 249).forEach(([itemId, { deductQty, adminQty, key }]) => {
        const itemRef = db.collection('items').doc(itemId);
        batch.set(itemRef, {
          stock: firebase.firestore.FieldValue.increment(-deductQty),
          adminStock: { [key]: firebase.firestore.FieldValue.increment(-adminQty) },
          _adminAdjust: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        if (deductQty > 0) {
          batch.set(itemRef.collection('stockHistory').doc(), {
            qty: -deductQty,
            addedBy: key,
            note: 'ปิด stock แอดมิน',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      });
      if (i === 0) {
        batch.set(db.collection('settings').doc('adminStock'), {
          disabled: { [adminName]: saveForRestore }
        }, { merge: true });
      }
      await batch.commit();
    }

    showToast(`ปิด stock ${adminName} แล้ว (หัก stock ${entries.length} สินค้า)`);
  }
}


// ============ IMAGE UPLOAD HELPERS ============
function fileToBase64(file, maxWidth) {
  if (file.size > MAX_IMAGE_SIZE) {
    return Promise.reject(new Error(`ไฟล์ใหญ่เกิน ${MAX_IMAGE_SIZE / 1024 / 1024}MB`));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * maxWidth / w);
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupImageUploadArea(areaId, inputId, previewId, textId, onSelect) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const text = document.getElementById(textId);

  area.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const base64 = await fileToBase64(file, 300);
      preview.src = base64;
      preview.style.display = 'block';
      text.textContent = file.name;
      onSelect(base64);
    } catch (err) {
      showAlert(err.message, 'ไฟล์ไม่ถูกต้อง');
      input.value = '';
    }
  });

  // Drag & drop
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.style.borderColor = '#ff69b4'; });
  area.addEventListener('dragleave', () => { area.style.borderColor = ''; });
  area.addEventListener('drop', async (e) => {
    e.preventDefault();
    area.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const base64 = await fileToBase64(file, 300);
        preview.src = base64;
        preview.style.display = 'block';
        text.textContent = file.name;
        onSelect(base64);
      } catch (err) {
        showAlert(err.message, 'ไฟล์ไม่ถูกต้อง');
      }
    }
  });
}

// ============ ADD PRODUCT ============
async function addProduct() {
  clearFieldErrors();
  const name = document.getElementById('pName').value.trim();
  const price = parseFloat(document.getElementById('pPrice').value);
  const stock = parseInt(document.getElementById('pStock').value, 10);
  const addedBy = document.getElementById('pAddedBy').value.trim();

  let hasError = false;
  if (!name) { showFieldError('pNameError', 'กรุณากรอกชื่อสินค้า'); hasError = true; }
  if (isNaN(price) || price <= 0) { showFieldError('pPriceError', 'กรุณากรอกราคา'); hasError = true; }
  if (isNaN(stock) || stock < 0) { showFieldError('pStockError', 'กรุณากรอกจำนวน stock'); hasError = true; }
  if (!addImageBase64) { showFieldError('pImageError', 'กรุณาเลือกรูปสินค้า'); hasError = true; }
  if (!addedBy) { showFieldError('pAddedByError', 'กรุณากรอกชื่อคนเพิ่ม'); hasError = true; }
  if (hasError) return;

  const btn = document.getElementById('addProductBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังเพิ่ม...';

  try {
    const bundleQty = parseInt(document.getElementById('pBundleQty').value) || 0;
    const selectedCats = getSelectedCategories('addProductCategories');
    const newItem = {
      name,
      price,
      stock,
      image: addImageBase64,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (bundleQty > 1) newItem.bundleQty = bundleQty;
    if (selectedCats.length > 0) newItem.categories = selectedCats;
    if (stock > 0 && addedBy) {
      newItem.adminStock = { [addedBy]: stock };
    }

    // External admin → ส่งรออนุมัติ
    if (isExternal) {
      newItem.submittedBy = currentAdminName;
      await db.collection('pending_items').doc().set(newItem);
      closeAddProductModal();
      showToast('ส่งสินค้ารอ Owner อนุมัติแล้ว');
    } else {
      // Owner / Admin → เพิ่มตรงเลย
      const docRef = db.collection('items').doc();
      const batch = db.batch();
      const maxSort = allProducts.reduce((max, p) => Math.max(max, p.sortOrder ?? 0), -1);
      newItem.sortOrder = maxSort + 1;
      batch.set(docRef, newItem);

      if (stock > 0) {
        batch.set(docRef.collection('stockHistory').doc(), {
          qty: stock,
          addedBy: addedBy,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      await batch.commit();
      closeAddProductModal();
    }
  } catch (e) {
    showAlert('เพิ่มสินค้าไม่ได้: ' + e.message, 'ผิดพลาด');
  } finally {
    btn.disabled = false;
    btn.textContent = 'เพิ่มสินค้า';
  }
}

// ============ ADD PRODUCT MODAL ============
function openAddProductModal() {
  clearFieldErrors();
  addImageBase64 = null;
  document.getElementById('pName').value = '';
  document.getElementById('pPrice').value = '';
  document.getElementById('pStock').value = '';
  document.getElementById('pImage').value = '';
  document.getElementById('pBundleQty').value = '';
  document.getElementById('pAddedBy').innerHTML = renderAdminOptions(currentAdminName);
  document.getElementById('addImagePreview').style.display = 'none';
  document.getElementById('addImageUploadText').textContent = 'คลิกเพื่อเลือกรูป';
  renderCategoryCheckboxes('addProductCategories', []);
  document.getElementById('addProductModal').classList.add('active');
}

function closeAddProductModal() {
  document.getElementById('addProductModal').classList.remove('active');
}

// ============ EDIT PRODUCT MODAL ============
let editingProductId = null;
let editOriginalImage = null;

function openEditProductModal(itemId, name, price, currentImage) {
  editingProductId = itemId;
  editOriginalImage = currentImage;
  editImageBase64 = null;
  clearFieldErrors();
  document.getElementById('editName').value = name;
  document.getElementById('editPrice').value = price;
  document.getElementById('editImage').value = '';
  const item = allProducts.find(p => p.id === itemId);
  const bqInput = document.getElementById('editBundleQty');
  if (bqInput) bqInput.value = (item && item.bundleQty > 1) ? item.bundleQty : '';

  // ล็อคราคาสำหรับ non-owner
  const priceInput = document.getElementById('editPrice');
  if (!isOwner) {
    priceInput.disabled = true;
    priceInput.style.opacity = '0.5';
    priceInput.title = 'เฉพาะ owner แก้ราคาได้';
  } else {
    priceInput.disabled = false;
    priceInput.style.opacity = '';
    priceInput.title = '';
  }

  const preview = document.getElementById('editImagePreview');
  if (currentImage) {
    preview.src = currentImage;
    preview.style.display = 'block';
    document.getElementById('editImageUploadText').textContent = 'คลิกเพื่อเปลี่ยนรูป';
  } else {
    preview.style.display = 'none';
    document.getElementById('editImageUploadText').textContent = 'คลิกเพื่อเลือกรูป';
  }

  renderCategoryCheckboxes('editProductCategories', item ? (item.categories || []) : []);
  document.getElementById('editProductModal').classList.add('active');
}

function closeEditProductModal() {
  document.getElementById('editProductModal').classList.remove('active');
  editingProductId = null;
}

async function confirmEditProduct() {
  clearFieldErrors();
  const name = document.getElementById('editName').value.trim();
  const price = parseFloat(document.getElementById('editPrice').value);

  let hasError = false;
  if (!name) { showFieldError('editNameError', 'กรุณากรอกชื่อสินค้า'); hasError = true; }
  if (isOwner && (isNaN(price) || price <= 0)) { showFieldError('editPriceError', 'กรุณากรอกราคา'); hasError = true; }
  if (!editImageBase64 && !editOriginalImage) { showFieldError('editImageError', 'กรุณาเลือกรูปสินค้า'); hasError = true; }
  if (hasError) return;

  const btn = document.getElementById('confirmEditProduct');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  try {
    const bundleQty = parseInt(document.getElementById('editBundleQty').value) || 0;
    const updateData = { name };
    // เฉพาะ owner แก้ราคาได้
    if (isOwner) updateData.price = price;
    if (bundleQty > 1) {
      updateData.bundleQty = bundleQty;
    } else {
      updateData.bundleQty = firebase.firestore.FieldValue.delete();
    }
    const selectedCats = getSelectedCategories('editProductCategories');
    updateData.categories = selectedCats;
    if (editImageBase64) {
      updateData.image = editImageBase64;
    }

    await db.collection('items').doc(editingProductId).update(updateData);

    closeEditProductModal();
  } catch (e) {
    showAlert('แก้ไขไม่ได้: ' + e.message, 'ผิดพลาด');
  } finally {
    btn.disabled = false;
    btn.textContent = 'บันทึก';
  }
}

// ============ TOGGLE SHARE WITH EXTERNAL ============
async function toggleShareExternal(itemId, currentShared) {
  try {
    await db.collection('items').doc(itemId).update({ sharedWithExternal: !currentShared });
    showToast(!currentShared ? 'แชร์สินค้าให้แอดมินภายนอกเห็นแล้ว' : 'ยกเลิกแชร์กับแอดมินภายนอกแล้ว');
  } catch (e) {
    showAlert('เปลี่ยนสถานะไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ TOGGLE ITEM ACTIVE ============
async function toggleItemActive(itemId, currentActive) {
  if (!isOwner) { showToast('เฉพาะ owner เปิด/ปิดสินค้าได้'); return; }
  try {
    await db.collection('items').doc(itemId).update({ active: !currentActive });
    showToast(!currentActive ? 'เปิดสินค้าแล้ว' : 'ปิดสินค้าแล้ว (ลูกค้าจะไม่เห็น)');
  } catch (e) {
    showAlert('เปลี่ยนสถานะไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ DELETE PRODUCT ============
async function deleteProduct(itemId) {
  const item = allProducts.find(p => p.id === itemId);
  const itemName = item ? item.name : itemId;

  if (isOwner) {
    // Owner ลบได้ตรง
    const yes = await showConfirm(`ต้องการลบ "${itemName}"?`, 'ยืนยันการลบ');
    if (!yes) return;
    try {
      const historySnap = await db.collection('items').doc(itemId).collection('stockHistory').get();
      const batch = db.batch();
      historySnap.docs.forEach(doc => batch.delete(doc.ref));
      batch.delete(db.collection('items').doc(itemId));
      await batch.commit();
      showToast('ลบสินค้าแล้ว');
    } catch (e) {
      showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  } else {
    // Non-owner → ส่งคำขอลบ รอ owner approve
    const yes = await showConfirm(`ส่งคำขอลบ "${itemName}" ให้ owner อนุมัติ?`, 'ขอลบสินค้า');
    if (!yes) return;
    try {
      await db.collection('pending_deletes').doc(itemId).set({
        itemId,
        itemName,
        itemImage: item ? item.image : '',
        requestedBy: currentAdminName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast('ส่งคำขอลบแล้ว รอ owner อนุมัติ');
    } catch (e) {
      showAlert('ส่งคำขอไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  }
}

// ============ DRAG & DROP REORDER ============
function setupProductDrag() {
  const tbody = document.getElementById('productTableBody');

  tbody.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr[draggable]');
    if (!row) return;
    draggedProductId = row.dataset.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  tbody.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('tr[draggable]');
    if (!row || row.dataset.id === draggedProductId) return;
    tbody.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });

  tbody.addEventListener('dragleave', (e) => {
    const row = e.target.closest('tr[draggable]');
    if (row) row.classList.remove('drag-over');
  });

  tbody.addEventListener('drop', async (e) => {
    e.preventDefault();
    tbody.querySelectorAll('.drag-over, .dragging').forEach(r => r.classList.remove('drag-over', 'dragging'));
    const targetRow = e.target.closest('tr[draggable]');
    if (!targetRow || !draggedProductId) return;
    const targetId = targetRow.dataset.id;
    if (targetId === draggedProductId) { draggedProductId = null; return; }

    const fromIndex = allProducts.findIndex(p => p.id === draggedProductId);
    const toIndex = allProducts.findIndex(p => p.id === targetId);
    if (fromIndex === -1 || toIndex === -1) { draggedProductId = null; return; }

    const [moved] = allProducts.splice(fromIndex, 1);
    allProducts.splice(toIndex, 0, moved);
    await saveSortOrder();
    draggedProductId = null;
  });

  tbody.addEventListener('dragend', () => {
    tbody.querySelectorAll('.dragging, .drag-over').forEach(r => r.classList.remove('dragging', 'drag-over'));
    draggedProductId = null;
  });
}

async function saveSortOrder() {
  try {
    const batch = db.batch();
    allProducts.forEach((product, index) => {
      if (product.sortOrder !== index) {
        batch.update(db.collection('items').doc(product.id), { sortOrder: index });
      }
    });
    await batch.commit();
  } catch (e) {
    showAlert('บันทึกลำดับไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ CATEGORY MANAGEMENT ============
let adminCategoriesList = []; // { id, name, order }

async function loadAdminCategories() {
  try {
    const doc = await db.collection('settings').doc('categories').get();
    adminCategoriesList = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list : [];
    adminCategoriesList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  } catch (e) {
    console.warn('loadAdminCategories:', e.message);
  }
}

function openCategoryModal() {
  renderCategoryList();
  document.getElementById('newCategoryName').value = '';
  document.getElementById('categoryModal').classList.add('active');
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('active');
}

function renderCategoryList() {
  const container = document.getElementById('categoryList');
  if (adminCategoriesList.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#aaa;">ยังไม่มีหมวดหมู่</p>';
    return;
  }
  container.innerHTML = adminCategoriesList.map((cat, i) => `
    <div class="category-list-item" draggable="true" data-cat-index="${i}" data-id="${escapeHtml(cat.id)}">
      <div style="display:flex;align-items:center;gap:8px;overflow:hidden;">
        <span class="drag-handle" style="cursor:grab;color:#aaa;">☰</span>
        <span class="category-list-name">${escapeHtml(cat.name)}</span>
      </div>
      <div class="category-list-actions">
        <button class="btn-icon" data-cat-action="assign" data-cat-index="${i}" title="จัดการสินค้า" style="color:#4fc3f7;font-size:11px;padding:4px 8px;">📦</button>
        <button class="btn-icon" data-cat-action="rename" data-cat-index="${i}" title="เปลี่ยนชื่อ">✏️</button>
        <button class="btn-icon btn-icon-danger" data-cat-action="delete" data-cat-index="${i}" title="ลบ">🗑</button>
      </div>
    </div>
  `).join('');
}

async function saveCategories() {
  adminCategoriesList.forEach((cat, i) => { cat.order = i; });
  try {
    await db.collection('settings').doc('categories').set({ list: adminCategoriesList });
  } catch (e) {
    showAlert('บันทึกหมวดหมู่ไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

async function addCategory() {
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) return;

  const id = 'cat_' + Date.now();
  adminCategoriesList.push({ id, name, order: adminCategoriesList.length });
  await saveCategories();
  input.value = '';
  renderCategoryList();
  showToast('เพิ่มหมวดหมู่ "' + name + '" แล้ว');
}

let renameCatIndex = null;

function openRenameCategoryModal(index) {
  const cat = adminCategoriesList[index];
  if (!cat) return;
  renameCatIndex = index;
  document.getElementById('renameCategoryInput').value = cat.name;
  document.getElementById('categoryModal').classList.remove('active');
  document.getElementById('renameCategoryModal').classList.add('active');
  document.getElementById('renameCategoryInput').focus();
}

function closeRenameCategoryModal() {
  document.getElementById('renameCategoryModal').classList.remove('active');
  document.getElementById('categoryModal').classList.add('active');
  renameCatIndex = null;
}

async function confirmRenameCategory() {
  if (renameCatIndex === null) return;
  const cat = adminCategoriesList[renameCatIndex];
  if (!cat) return;
  const newName = document.getElementById('renameCategoryInput').value.trim();
  if (!newName || newName === cat.name) { closeRenameCategoryModal(); return; }
  cat.name = newName;
  await saveCategories();
  renderCategoryList();
  showToast('เปลี่ยนชื่อเป็น "' + cat.name + '" แล้ว');
  closeRenameCategoryModal();
}

async function deleteCategory(index) {
  const cat = adminCategoriesList[index];
  if (!cat) return;
  const yes = await showConfirm(`ลบหมวดหมู่ "${cat.name}"?\n(สินค้าจะยังอยู่ แต่ไม่อยู่ในหมวดนี้แล้ว)`, 'ยืนยันลบ');
  if (!yes) return;
  adminCategoriesList.splice(index, 1);
  await saveCategories();
  renderCategoryList();
  showToast('ลบหมวดหมู่แล้ว');
}

function setupCategoryDrag() {
  const container = document.getElementById('categoryList');
  let dragIndex = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.category-list-item[draggable]');
    if (!item) return;
    dragIndex = parseInt(item.dataset.catIndex);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.category-list-item[draggable]');
    if (!item || parseInt(item.dataset.catIndex) === dragIndex) return;
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.category-list-item[draggable]');
    if (item) item.classList.remove('drag-over');
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.querySelectorAll('.drag-over, .dragging').forEach(el => el.classList.remove('drag-over', 'dragging'));
    const target = e.target.closest('.category-list-item[draggable]');
    if (!target || dragIndex === null) return;
    const toIndex = parseInt(target.dataset.catIndex);
    if (toIndex === dragIndex) { dragIndex = null; return; }

    const [moved] = adminCategoriesList.splice(dragIndex, 1);
    adminCategoriesList.splice(toIndex, 0, moved);
    await saveCategories();
    renderCategoryList();
    dragIndex = null;
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.dragging, .drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
    dragIndex = null;
  });
}

function renderCategoryCheckboxes(containerId, selectedIds) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (adminCategoriesList.length === 0) {
    container.innerHTML = '<span style="color:#aaa;font-size:13px;">ยังไม่มีหมวดหมู่ (จัดการที่ปุ่ม "หมวดหมู่")</span>';
    return;
  }
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  container.innerHTML = adminCategoriesList.map(cat => `
    <label class="category-checkbox-item">
      <input type="checkbox" value="${escapeHtml(cat.id)}" ${selected.includes(cat.id) ? 'checked' : ''} />
      <span>${escapeHtml(cat.name)}</span>
    </label>
  `).join('');
}

function getSelectedCategories(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ============ BULK ASSIGN PRODUCTS TO CATEGORY ============
let bulkAssignCatId = null;

function openBulkAssignModal(catIndex) {
  const cat = adminCategoriesList[catIndex];
  if (!cat) return;
  bulkAssignCatId = cat.id;

  document.getElementById('bulkAssignCatName').textContent = cat.name;

  // ใช้ allProducts จาก admin
  const list = document.getElementById('bulkAssignList');
  if (!allProducts || allProducts.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#aaa;">ไม่มีสินค้า</p>';
    return;
  }

  list.innerHTML = allProducts.map(item => {
    const checked = Array.isArray(item.categories) && item.categories.includes(cat.id);
    return `
      <label class="bulk-assign-item">
        <input type="checkbox" value="${item.id}" ${checked ? 'checked' : ''} />
        <img src="${escapeHtml(item.image)}" alt="" class="bulk-assign-img" onerror="this.style.display='none'" />
        <span>${escapeHtml(item.name)}</span>
      </label>
    `;
  }).join('');

  // ซ่อน category modal, เปิด bulk assign modal
  document.getElementById('categoryModal').classList.remove('active');
  document.getElementById('bulkAssignModal').classList.add('active');
}

function closeBulkAssignModal() {
  document.getElementById('bulkAssignModal').classList.remove('active');
  // กลับไป category modal
  document.getElementById('categoryModal').classList.add('active');
}

async function confirmBulkAssign() {
  if (!bulkAssignCatId) return;

  const container = document.getElementById('bulkAssignList');
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');

  const toAdd = []; // itemIds ที่ต้องเพิ่ม category
  const toRemove = []; // itemIds ที่ต้องลบ category

  checkboxes.forEach(cb => {
    const itemId = cb.value;
    const item = allProducts.find(p => p.id === itemId);
    const hadCat = item && Array.isArray(item.categories) && item.categories.includes(bulkAssignCatId);

    if (cb.checked && !hadCat) toAdd.push(itemId);
    else if (!cb.checked && hadCat) toRemove.push(itemId);
  });

  if (toAdd.length === 0 && toRemove.length === 0) {
    closeBulkAssignModal();
    return;
  }

  const btn = document.getElementById('confirmBulkAssignBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  try {
    const allChanges = [
      ...toAdd.map(id => ({ id, action: 'add' })),
      ...toRemove.map(id => ({ id, action: 'remove' }))
    ];

    for (let i = 0; i < allChanges.length; i += 499) {
      const batch = db.batch();
      allChanges.slice(i, i + 499).forEach(({ id, action }) => {
        const ref = db.collection('items').doc(id);
        if (action === 'add') {
          batch.update(ref, { categories: firebase.firestore.FieldValue.arrayUnion(bulkAssignCatId) });
        } else {
          batch.update(ref, { categories: firebase.firestore.FieldValue.arrayRemove(bulkAssignCatId) });
        }
      });
      await batch.commit();
    }

    // อัปเดต local cache
    toAdd.forEach(id => {
      const item = allProducts.find(p => p.id === id);
      if (item) {
        if (!Array.isArray(item.categories)) item.categories = [];
        item.categories.push(bulkAssignCatId);
      }
    });
    toRemove.forEach(id => {
      const item = allProducts.find(p => p.id === id);
      if (item && Array.isArray(item.categories)) {
        item.categories = item.categories.filter(c => c !== bulkAssignCatId);
      }
    });

    showToast(`บันทึกแล้ว — เพิ่ม ${toAdd.length} / ลบ ${toRemove.length} สินค้า`);
    closeBulkAssignModal();
  } catch (e) {
    showAlert('บันทึกไม่ได้: ' + e.message, 'ผิดพลาด');
  } finally {
    btn.disabled = false;
    btn.textContent = 'บันทึก';
  }
}

// ============ PENDING ITEMS (Owner Approval) ============
let unsubPendingItems = null;

function loadPendingItems() {
  if (!isOwner) return;
  if (unsubPendingItems) { unsubPendingItems(); unsubPendingItems = null; }

  unsubPendingItems = db.collection('pending_items').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    renderPendingItems(snapshot.docs);
  }, e => {
    console.warn('pending_items listener:', e.message);
  });
}

function renderPendingItems(docs) {
  const container = document.getElementById('pendingItemsPanel');
  if (!container) return;

  if (docs.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="pending-items-header">สินค้ารออนุมัติ (${docs.length})</div>
    ${docs.map(doc => {
      const d = doc.data();
      const bqText = d.bundleQty > 1 ? ` (ชุดละ ${d.bundleQty})` : '';
      return `
        <div class="pending-item-card">
          <img src="${escapeHtml(d.image || '')}" class="pending-item-img" onerror="this.style.display='none'">
          <div class="pending-item-info">
            <div class="pending-item-name">${escapeHtml(d.name)}${bqText}</div>
            <div class="pending-item-detail">${formatPrice(d.price)} บาท · stock ${d.stock || 0} · โดย ${escapeHtml(d.submittedBy || '?')}</div>
          </div>
          <div class="pending-item-actions">
            <button class="btn-pending-approve" data-pending-id="${doc.id}">อนุมัติ</button>
            <button class="btn-pending-reject" data-pending-id="${doc.id}">ปฏิเสธ</button>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

async function approvePendingItem(pendingId) {
  try {
    const doc = await db.collection('pending_items').doc(pendingId).get();
    if (!doc.exists) return;
    const data = doc.data();
    delete data.submittedBy;

    const docRef = db.collection('items').doc();
    const batch = db.batch();
    const maxSort = allProducts.reduce((max, p) => Math.max(max, p.sortOrder ?? 0), -1);
    data.sortOrder = maxSort + 1;
    batch.set(docRef, data);

    if ((data.stock || 0) > 0) {
      const addedBy = Object.keys(data.adminStock || {})[0] || 'unknown';
      batch.set(docRef.collection('stockHistory').doc(), {
        qty: data.stock,
        addedBy,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    batch.delete(db.collection('pending_items').doc(pendingId));
    await batch.commit();
    showToast('อนุมัติสินค้า "' + (data.name || '') + '" แล้ว');
  } catch (e) {
    showAlert('อนุมัติไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

async function rejectPendingItem(pendingId) {
  if (!await showConfirm('ปฏิเสธสินค้านี้?', 'ยืนยัน')) return;
  try {
    await db.collection('pending_items').doc(pendingId).delete();
    showToast('ปฏิเสธสินค้าแล้ว');
  } catch (e) {
    showAlert('ปฏิเสธไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ PENDING DELETES (owner approve) ============
let unsubPendingDeletes = null;

function loadPendingDeletes() {
  if (!isOwner) return;
  if (unsubPendingDeletes) { unsubPendingDeletes(); unsubPendingDeletes = null; }

  unsubPendingDeletes = db.collection('pending_deletes').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    renderPendingDeletes(snapshot.docs);
  }, e => {
    console.warn('pending_deletes listener:', e.message);
  });
}

function renderPendingDeletes(docs) {
  const container = document.getElementById('pendingDeletesPanel');
  if (!container) return;

  if (docs.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="pending-items-header" style="color:#ff4444;">รอลบสินค้า (${docs.length})</div>
    ${docs.map(doc => {
      const d = doc.data();
      return `
        <div class="pending-item-card" style="border-color:rgba(255,68,68,0.3);">
          <img src="${escapeHtml(d.itemImage || '')}" class="pending-item-img" onerror="this.style.display='none'">
          <div class="pending-item-info">
            <div class="pending-item-name">${escapeHtml(d.itemName || d.itemId)}</div>
            <div class="pending-item-detail">ขอลบโดย ${escapeHtml(d.requestedBy || '?')}</div>
          </div>
          <div class="pending-item-actions">
            <button class="btn-pending-approve" data-delete-id="${doc.id}" data-item-id="${d.itemId}">อนุมัติลบ</button>
            <button class="btn-pending-reject" data-delete-id="${doc.id}">ปฏิเสธ</button>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

async function approvePendingDelete(pendingDeleteId, itemId) {
  if (!await showConfirm('อนุมัติลบสินค้านี้?', 'ยืนยันการลบ')) return;
  try {
    const historySnap = await db.collection('items').doc(itemId).collection('stockHistory').get();
    const batch = db.batch();
    historySnap.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(db.collection('items').doc(itemId));
    batch.delete(db.collection('pending_deletes').doc(pendingDeleteId));
    await batch.commit();
    showToast('ลบสินค้าแล้ว');
  } catch (e) {
    showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

async function rejectPendingDelete(pendingDeleteId) {
  try {
    await db.collection('pending_deletes').doc(pendingDeleteId).delete();
    showToast('ปฏิเสธคำขอลบแล้ว');
  } catch (e) {
    showAlert('ปฏิเสธไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

