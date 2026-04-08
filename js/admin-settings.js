// ============ ADMIN ROLES MANAGEMENT ============
let unsubAdmins = null;
let unsubPendingAdmins = null;
let unsubShopSettings = null;
let _payModeCallback = null; // callback จาก setupPayModeToggle

function loadAdminRoles() {
  if (unsubAdmins) unsubAdmins();
  if (unsubPendingAdmins) unsubPendingAdmins();

  unsubAdmins = db.collection('admin_users').onSnapshot(snap => {
    const list = document.getElementById('currentAdminsList');
    if (snap.empty) {
      list.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#aaa;">ไม่มีแอดมินเชิญเพิ่มเติม</td></tr>';
      return;
    }
    list.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      const role = d.role || 'admin';
      const roleLabel = role === 'owner'
        ? '<span style="color:#ffeb3b;font-size:11px;font-weight:600;">👑 Owner</span>'
        : role === 'external'
          ? '<span style="color:#ff9800;font-size:11px;font-weight:600;">ภายนอก</span>'
          : '<span style="color:#4fc3f7;font-size:11px;">Admin</span>';
      const displayName = d.displayName || d.name || '-';
      const editBtn = isOwner
        ? `<button class="btn-table secondary" style="font-size:11px;padding:3px 8px;" data-action="editDisplayName" data-uid="${doc.id}" data-current="${escapeHtml(displayName)}">แก้ไข</button>`
        : '';
      const toggleRoleBtn = (isOwner && role !== 'owner')
        ? `<button class="btn-table secondary" style="font-size:11px;padding:3px 8px;" data-action="toggleRole" data-uid="${doc.id}" data-role="${role}">${role === 'external' ? 'เป็น Admin' : 'เป็นภายนอก'}</button>`
        : '';
      return `<tr>
        <td style="word-break: break-all;">${escapeHtml(d.email || doc.id)} ${roleLabel}</td>
        <td style="word-break: break-all;">${escapeHtml(d.name || '-')}</td>
        <td style="word-break: break-all;">
          <span style="color:#ff69b4;font-weight:600;">${escapeHtml(displayName)}</span>
          ${editBtn}
        </td>
        <td style="text-align: center; white-space: nowrap;">
          ${role === 'owner' ? '<span style="color:#aaa;font-size:12px;">-</span>' : `${toggleRoleBtn} <button class="btn-table danger" data-action="removeAdmin" data-uid="${doc.id}">ลบสิทธิ์</button>`}
        </td>
      </tr>`;
    }).join("");
  });

  unsubPendingAdmins = db.collection('pending_users').orderBy('createdAt', 'desc').onSnapshot(snap => {
    const list = document.getElementById('pendingAdminsList');
    if (snap.empty) {
      list.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;">- ว่างเปล่า -</td></tr>';
      return;
    }
    list.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      const time = d.createdAt ? d.createdAt.toDate().toLocaleString('th-TH') : '-';
      return `<tr>
        <td style="word-break: break-all;">${escapeHtml(d.email || d.name)}</td>
        <td style="font-size:12px;color:#aaa;">${time}</td>
        <td style="display:flex; justify-content:center; gap:5px; flex-wrap:wrap;">
          <button class="btn-table primary" style="flex:1;" data-action="approveAdmin" data-uid="${doc.id}" data-email="${escapeHtml(d.email)}">เพิ่มเป็น Admin</button>
          <button class="btn-table danger" style="flex:1;" data-action="rejectAdmin" data-uid="${doc.id}">ลบทิ้ง</button>
        </td>
      </tr>`;
    }).join("");
  });
}

async function approveAdminRole(uid, email) {
  // เช็ค email ซ้ำใน admin_users
  try {
    const existing = await db.collection('admin_users').where('email', '==', email).get();
    if (!existing.empty) {
      showAlert('Email ' + email + ' มีสิทธิ์แอดมินอยู่แล้ว — ลบคำขอนี้ออก', 'ซ้ำ');
      await db.collection('pending_users').doc(uid).delete();
      return;
    }
  } catch (e) { /* ถ้าเช็คไม่ได้ ให้ไปต่อ */ }

  // ให้ owner เลือก role
  const role = await pickAdminRole(email);
  if (!role) return;

  const rawName = email.split('@')[0];
  const displayName = await askDisplayName('ตั้งชื่อแสดงผล', 'ตั้งชื่อให้แอดมิน ' + email, rawName);
  if (!displayName) return;

  try {
    await db.collection('admin_users').doc(uid).set({
      email: email,
      name: rawName,
      displayName: displayName,
      role: role,
      grantedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('pending_users').doc(uid).delete();
    await loadAdminNames();
    const roleLabel = role === 'external' ? 'แอดมินภายนอก' : 'แอดมิน';
    showToast(`เพิ่ม ${displayName} เป็น${roleLabel}เรียบร้อย`);
  } catch (e) { showAlert('เพิ่มแอดมินไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

function pickAdminRole(email) {
  return new Promise((resolve) => {
    const modal = document.getElementById('pickRoleModal');
    document.getElementById('pickRoleEmail').textContent = email;
    modal.classList.add('active');

    function cleanup() {
      modal.classList.remove('active');
      document.getElementById('btnRoleAdmin').removeEventListener('click', onAdmin);
      document.getElementById('btnRoleExternal').removeEventListener('click', onExternal);
      document.getElementById('cancelPickRoleBtn').removeEventListener('click', onCancel);
    }
    function onAdmin() { cleanup(); resolve('admin'); }
    function onExternal() { cleanup(); resolve('external'); }
    function onCancel() { cleanup(); resolve(null); }

    document.getElementById('btnRoleAdmin').addEventListener('click', onAdmin);
    document.getElementById('btnRoleExternal').addEventListener('click', onExternal);
    document.getElementById('cancelPickRoleBtn').addEventListener('click', onCancel);
  });
}

async function rejectPendingAdmin(uid) {
  if (!await showConfirm('ต้องการลบคำขอนี้ทิ้งใช่หรือไม่?')) return;
  try {
    await db.collection('pending_users').doc(uid).delete();
    showToast('ลบคำขอแล้ว');
  } catch (e) { showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

async function toggleAdminRole(uid, currentRole) {
  const newRole = currentRole === 'external' ? 'admin' : 'external';
  const label = newRole === 'external' ? 'แอดมินภายนอก (เห็นเฉพาะสินค้าตัวเอง)' : 'แอดมินปกติ (เห็นทุกสินค้า)';
  if (!await showConfirm(`เปลี่ยนเป็น ${label}?`)) return;
  try {
    await db.collection('admin_users').doc(uid).update({ role: newRole });
    showToast('เปลี่ยน role เรียบร้อย');
  } catch (e) { showAlert('เปลี่ยนไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

async function removeAdminRole(uid) {
  if (firebase.auth().currentUser && uid === firebase.auth().currentUser.uid) {
    showAlert('ไม่สามารถลบสิทธิ์ตัวเองได้ครับ!');
    return;
  }
  if (!await showConfirm('ต้องการลบสิทธิ์ Admin บัญชีนี้ใช่หรือไม่? หลังจากลบ จะไม่สามารถเข้าระบบได้จนกว่าจะเพิ่มใหม่')) return;
  try {
    await db.collection('admin_users').doc(uid).delete();
    showToast('ลบสิทธิ์แอดมินเรียบร้อย');
  } catch (e) { showAlert('ลบสิทธิ์ไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

function askDisplayName(title, desc, defaultValue) {
  return new Promise((resolve) => {
    const modal = document.getElementById('editDisplayNameModal');
    const input = document.getElementById('editDisplayNameInput');
    const errorEl = document.getElementById('editDisplayNameError');
    const confirmBtn = document.getElementById('confirmDisplayNameBtn');
    const cancelBtn = document.getElementById('cancelDisplayNameBtn');

    document.getElementById('editDisplayNameTitle').textContent = title;
    document.getElementById('editDisplayNameDesc').textContent = desc || '';
    input.value = defaultValue || '';
    errorEl.textContent = '';
    errorEl.classList.remove('show');
    modal.classList.add('active');
    input.focus();
    input.select();

    function cleanup() {
      modal.classList.remove('active');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }
    function onConfirm() {
      const val = input.value.trim();
      if (!val) {
        errorEl.textContent = 'กรุณากรอกชื่อแสดงผล';
        errorEl.classList.add('show');
        return;
      }
      cleanup();
      resolve(val);
    }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onConfirm(); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

async function editAdminDisplayName(uid, currentName) {
  const newName = await askDisplayName('แก้ไขชื่อแสดงผล', 'ชื่อนี้จะแสดงทุกที่ในระบบแทนชื่อ email', currentName);
  if (!newName) return;
  try {
    await db.collection('admin_users').doc(uid).update({ displayName: newName });
    await loadAdminNames();
    showToast('เปลี่ยนชื่อแสดงผลเป็น "' + newName + '" แล้ว');
  } catch (e) { showAlert('แก้ชื่อไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

async function viewSlip(orderId) {
  const order = loadedOrdersCache[orderId];
  if (!order) return;

  // รองรับ order เก่า (slipImage ใน doc) + order ใหม่ (แยก subcollection)
  if (order.slipImage) {
    document.getElementById('slipModalImg').src = order.slipImage;
    document.getElementById('slipModal').classList.add('active');
    return;
  }

  // โหลดจาก subcollection
  try {
    const slipDoc = await db.collection('orders').doc(orderId).collection('attachments').doc('slip').get();
    if (slipDoc.exists && slipDoc.data().image) {
      document.getElementById('slipModalImg').src = slipDoc.data().image;
      document.getElementById('slipModal').classList.add('active');
    } else {
      showAlert('ไม่พบสลิปโอนเงิน', 'ไม่มีสลิป');
    }
  } catch (e) {
    showAlert('โหลดสลิปไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// Event delegation for admin tables and order board
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const uid = btn.dataset.uid;
  const id = btn.dataset.id;

  if (action === 'removeAdmin') removeAdminRole(uid);
  else if (action === 'approveAdmin') approveAdminRole(uid, btn.dataset.email);
  else if (action === 'rejectAdmin') rejectPendingAdmin(uid);
  else if (action === 'toggleRole') toggleAdminRole(uid, btn.dataset.role);
  else if (action === 'editDisplayName') editAdminDisplayName(uid, btn.dataset.current);
  else if (action === 'viewSlip') viewSlip(id);
  else if (action === 'toggleCoupon') toggleCouponStatus(id, btn.dataset.active === 'true');
  else if (action === 'deleteCoupon') deleteCoupon(id);
});

function updateFaviconAndTitle(pendingCount) {
  // Update Title
  document.title = pendingCount > 0 ? `(${pendingCount}) BubbleShop - Admin` : `BubbleShop - Admin`;

  // Update Favicon via Canvas
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, 32, 32);
    if (pendingCount > 0) {
      ctx.beginPath();
      ctx.arc(24, 8, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#f02849'; // Red dot
      ctx.fill();
    }
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');
  };
  img.src = 'pic/jin-arc-trace.png';
}

// แจ้งเตือน order ใหม่ (badge + เสียง)
let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playBeep(freq, duration) {
  try {
    const ctx = _getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* ignore audio errors */ }
}

function notifyNewOrder(count) {
  // Badge บน tab Order Board
  const badge = document.getElementById('orderNotiBadge');
  const activeTab = document.querySelector('.nav-tab.active');
  const isOnOrderTab = activeTab && activeTab.dataset.tab === 'orders';
  if (badge && !isOnOrderTab) {
    const prev = parseInt(badge.textContent) || 0;
    badge.textContent = '+' + (prev + count);
    badge.style.display = 'inline';
  }
  // เสียงแจ้งเตือน
  playBeep(800, 0.15);
  setTimeout(() => playBeep(1000, 0.2), 180);
}

let _completedOrders = []; // cache completed/cancelled docs
let _lastPendingSnapshot = null; // เก็บ pending snapshot ล่าสุด

function loadOrders() {
  const board = document.getElementById('orderBoard');

  // ยกเลิก listener เก่าก่อน ป้องกัน duplicate
  if (unsubOrders) {
    unsubOrders();
    unsubOrders = null;
  }

  // Real-time: เฉพาะ pending (ลด quota — completed/cancelled ไม่ต้อง listen)
  const pendingQuery = db.collection('orders')
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(currentOrderLimit);

  function renderCombined(pendingDocs) {
    _lastPendingSnapshot = pendingDocs;
    // รวม pending (realtime) + completed/cancelled (cache)
    const combined = { docs: [...pendingDocs, ..._completedOrders] };
    processOrderSnapshot(combined, board);
  }

  // Quota saving mode → ใช้ .get() ครั้งเดียว
  if (_quotaSaving) {
    pendingQuery.get().then(snapshot => renderCombined(snapshot.docs)).catch(e => {
      console.error(e);
      if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadOrders');
      board.innerHTML = '<p style="color:#ff6b6b;text-align:center;">โหลด order ไม่ได้</p>';
    });
    return;
  }

  unsubOrders = pendingQuery.onSnapshot(
    snapshot => renderCombined(snapshot.docs),
    e => {
      console.error(e);
      if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadOrders');
      board.innerHTML = '<p style="color:#ff6b6b;text-align:center;">โหลด order ไม่ได้</p>';
    }
  );

  // โหลด completed/cancelled ครั้งเดียว (ไม่ real-time)
  loadCompletedOrders();
}

async function loadCompletedOrders() {
  try {
    const snap = await db.collection('orders')
      .where('status', 'in', ['completed', 'cancelled'])
      .orderBy('createdAt', 'desc')
      .limit(currentOrderLimit)
      .get();
    _completedOrders = snap.docs;
    if (_lastPendingSnapshot) {
      const board = document.getElementById('orderBoard');
      const combined = { docs: [..._lastPendingSnapshot, ..._completedOrders] };
      processOrderSnapshot(combined, board);
    }
  } catch (e) {
    console.warn('loadCompletedOrders:', e.message);
    if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadCompletedOrders');
  }
}

let _externalDelayTimer = null;

function processOrderSnapshot(snapshot, board) {
  // Dedup: pending + completed อาจมี order ซ้ำ (ช่วง transition)
  const seenIds = new Set();
  let docs = snapshot.docs.filter(doc => {
    if (seenIds.has(doc.id)) return false;
    seenIds.add(doc.id);
    return true;
  });
  let delayedCount = 0;
  let nearestRevealMs = Infinity; // เวลาที่ order ถัดไปจะโผล่
  if (isExternal && typeof isMyProduct === 'function') {
    const myProductIds = new Set(allProducts.filter(p => isMyProduct(p)).map(p => p.id));
    const delayMs = typeof getExternalOrderDelayMs === 'function' ? getExternalOrderDelayMs() : 120000;
    const now = Date.now();
    // ถ้า allProducts ยังไม่โหลด → ข้ามการกรอง รอ products โหลดแล้ว re-render
    if (myProductIds.size === 0 && allProducts.length === 0) {
      console.log('[orders] allProducts ยังไม่โหลด — รอ re-render');
      return;
    }
    docs = docs.filter(doc => {
      const data = doc.data();
      const items = data.items || [];
      if (!items.some(i => myProductIds.has(i.itemId))) return false;
      // Delay: pending orders ที่ยังไม่ครบ delay → ซ่อน
      if ((data.status || 'pending') === 'pending' && delayMs > 0 && data.createdAt) {
        const age = now - data.createdAt.toMillis();
        if (age < delayMs) {
          delayedCount++;
          const revealIn = delayMs - age;
          if (revealIn < nearestRevealMs) nearestRevealMs = revealIn;
          return false;
        }
      }
      return true;
    });

    // ตั้ง timer re-render เมื่อ order ถัดไปพ้น delay
    if (_externalDelayTimer) clearTimeout(_externalDelayTimer);
    if (nearestRevealMs < Infinity && nearestRevealMs > 0) {
      _externalDelayTimer = setTimeout(() => {
        if (_lastPendingSnapshot) {
          const combined = { docs: [..._lastPendingSnapshot, ..._completedOrders] };
          processOrderSnapshot(combined, board);
        }
      }, nearestRevealMs + 500); // +500ms buffer
    }
  }

  // นับสถานะ
  let pending = 0, completed = 0, cancelled = 0;
  docs.forEach(doc => {
    const s = doc.data().status || 'pending';
    if (s === 'pending') pending++;
    else if (s === 'completed') completed++;
    else if (s === 'cancelled') cancelled++;
  });

  document.getElementById('pendingCounter').textContent = 'รอดำเนินการ: ' + pending + (delayedCount > 0 ? ` (+${delayedCount} รอคิว)` : '');
  document.getElementById('completedCounter').textContent = 'เสร็จแล้ว: ' + completed;
  document.getElementById('cancelledCounter').textContent = 'ยกเลิก: ' + cancelled;

  updateFaviconAndTitle(pending);

  // ตรวจ order ใหม่เฉพาะ pending เท่านั้น (completed/cancelled ไม่ต้อง notify)
  const pendingDocs = docs.filter(d => (d.data().status || 'pending') === 'pending');
  const newIds = new Set();
  if (!firstLoad) {
    pendingDocs.forEach(doc => {
      if (!knownOrderIds.has(doc.id)) newIds.add(doc.id);
    });
    if (newIds.size > 0) {
      showToast('Order ใหม่ +' + newIds.size + ' | รอดำเนินการ: ' + pending);
      notifyNewOrder(newIds.size);
    }
  }
  // ถ้าอยู่ tab orders → ซ่อน badge
  const activeTab = document.querySelector('.nav-tab.active');
  if (activeTab && activeTab.dataset.tab === 'orders') {
    const badge = document.getElementById('orderNotiBadge');
    if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
  }
  knownOrderIds = new Set(docs.map(doc => doc.id));
  firstLoad = false;

  const loadMoreBtn = document.getElementById('loadMoreOrdersBtn');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = docs.length >= currentOrderLimit ? 'inline-block' : 'none';
  }

  if (docs.length === 0) {
    board.innerHTML = '<p style="color:#aaa;text-align:center;">ยังไม่มี order</p>';
    return;
  }

  const total = docs.length;
  board.innerHTML = docs.map((doc, index) => {
    const order = doc.data();
    loadedOrdersCache[doc.id] = order;

    const date = order.createdAt ? order.createdAt.toDate().toLocaleString('th-TH') : '-';
    const items = Array.isArray(order.items) ? order.items : [];
    const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
    const itemsText = items.map(i => {
      const delivered = deliveries.filter(d => d.itemId === i.itemId).reduce((s, d) => s + d.qty, 0);
      let deliverInfo = '';
      if (delivered > 0) {
        const byAdmin = {};
        deliveries.filter(d => d.itemId === i.itemId).forEach(d => {
          const name = typeof resolveAdminName === 'function' ? resolveAdminName(d.by) : (d.by || '?');
          byAdmin[name] = (byAdmin[name] || 0) + d.qty;
        });
        const whoText = Object.entries(byAdmin).map(([n, q]) => `${escapeHtml(n)}:${q}`).join(', ');
        deliverInfo = ` <span style="color:${delivered >= i.qty ? '#4caf50' : '#ff9800'};font-size:12px;">(ส่งแล้ว ${delivered}/${i.qty} — ${whoText})</span>`;
      }
      return `${escapeHtml(i.name)} x${i.qty}${deliverInfo}`;
    }).join('<br>');
    const status = order.status || 'pending';
    const isNew = newIds.has(doc.id);
    const orderNum = total - index;
    const docId = escapeHtml(doc.id);
    const fbEscaped = escapeHtml(order.facebook);

    return `
      <div class="admin-order-card ${isNew ? 'order-new' : ''}" data-order-id="${docId}">
        ${isOwner ? `<button class="btn-delete-order" data-action="deleteOrder" data-id="${docId}" title="ลบ order">&times;</button>` : ''}
        ${isNew ? '<span class="new-badge">ใหม่</span>' : ''}
        <div class="admin-order-header">
          <span style="font-weight:600;color:#e0b0ff;">#${orderNum}</span>
          <span style="font-weight:600;">FB: ${fbEscaped}</span>
          <span style="font-size:13px;color:#aaa;">${date}</span>
        </div>
        <div class="admin-order-info">
          <div>ตัวละคร: <strong>${escapeHtml(order.characterName)}</strong></div>
          ${order.couponCode ? `<div style="color:#ffeb3b; font-size:13px; margin-top:3px;">🎟️ คูปอง: ${escapeHtml(order.couponCode)} (-${formatPrice(order.discountAmount)} บาท)</div>` : ''}
          <div style="margin-top:8px;">${itemsText}</div>
          <div style="color:#ff69b4;font-weight:600;margin-top:8px;">
            รวม ${formatPrice(order.totalPrice)} บาท
            ${order.originalPrice && order.originalPrice !== order.totalPrice ? `<span style="text-decoration:line-through;color:#aaa;font-size:12px;margin-left:5px;">${formatPrice(order.originalPrice)}</span>` : ''}
          </div>
          <div style="margin-top:8px;">
            ${order.paymentMode === 'paid' ? '<span style="color:#4CAF50;font-size:12px;font-weight:600;">โอนแล้ว</span>' : `<span style="color:#ff9800;font-size:12px;font-weight:600;">สั่งก่อน (ยังไม่โอน)</span><button class="btn-table secondary" data-action="markPaid" data-id="${docId}" style="margin-left:6px;font-size:11px;padding:2px 8px;">โอนแล้ว</button>`}
            ${(order.slipImage || order.hasSlip) ? `<button class="btn-table secondary" data-action="viewSlip" data-id="${docId}" style="margin-left:6px;">ดูสลิป</button>` : ''}
          </div>
        </div>
        <div class="admin-order-actions">
          <span class="order-status-badge ${status}">${status === 'pending' ? 'รอดำเนินการ' : status === 'completed' ? 'เสร็จแล้ว' : 'ยกเลิก'}</span>
          ${status === 'pending' ? `<button class="btn-order-action btn-order-complete" data-action="deliver" data-id="${docId}">&#128666; ส่งของ</button>` : ''}
          ${status === 'pending' ? `<button class="btn-order-action btn-order-cancel" data-action="cancel" data-id="${docId}">&#10005; ยกเลิก</button>` : ''}
          ${status === 'pending' && !bannedSet.has((order.facebook || '').toLowerCase()) ? `<button class="btn-order-action btn-order-ban" data-action="ban" data-fb="${fbEscaped}">BAN</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  if (typeof updateRevenueSummary === 'function') updateRevenueSummary(docs);
  if (typeof renderOfflineQueue === 'function') renderOfflineQueue();
}

// ============ BLOCK FACEBOOK (BAN) ============
async function blockFacebook(fbName) {
  if (!fbName) return;
  const yes = await showConfirm(`บล็อก "${fbName}" จากการสั่งซื้อ?\nOrder ที่รอดำเนินการจะถูกยกเลิก + คืน stock`, 'ยืนยัน BAN');
  if (!yes) return;

  try {
    // เพิ่มชื่อเข้า blocklist
    await db.collection('settings').doc('spam').set({
      blocked: firebase.firestore.FieldValue.arrayUnion(fbName.toLowerCase())
    }, { merge: true });

    // ยกเลิก pending orders ของ FB นี้ + คืน stock (แบ่ง batch ถ้าเกิน 500)
    const pendingSnap = await db.collection('orders')
      .where('facebook', '==', fbName)
      .where('status', '==', 'pending')
      .get();

    if (!pendingSnap.empty) {
      let ops = [];
      for (const orderDoc of pendingSnap.docs) {
        const order = orderDoc.data();
        ops.push({ ref: db.collection('orders').doc(orderDoc.id), data: { status: 'cancelled' }, type: 'update' });
        const items = Array.isArray(order.items) ? order.items : [];
        for (const item of items) {
          if (item.itemId) {
            ops.push({
              ref: db.collection('items').doc(item.itemId),
              data: { stock: firebase.firestore.FieldValue.increment(item.qty) },
              type: 'update'
            });
          }
        }
      }

      // แบ่ง batch ทีละ 499 ops (Firestore limit = 500)
      for (let i = 0; i < ops.length; i += 499) {
        const chunk = ops.slice(i, i + 499);
        const batch = db.batch();
        chunk.forEach(op => batch.update(op.ref, op.data));
        await batch.commit();
      }
    }

    showToast(`บล็อก "${fbName}" + ยกเลิก ${pendingSnap.size} order แล้ว`);
  } catch (e) {
    showAlert('บล็อกไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ BAN LIST ============
let unsubBans = null;
let bannedSet = new Set(); // เก็บชื่อที่ถูก ban (lowercase)

function loadBanList() {
  if (unsubBans) { unsubBans(); unsubBans = null; }

  const container = document.getElementById('banList');

  unsubBans = db.collection('settings').doc('spam').onSnapshot(doc => {
    const blocked = doc.exists && Array.isArray(doc.data().blocked) ? doc.data().blocked : [];
    bannedSet = new Set(blocked.map(n => n.toLowerCase()));

    if (blocked.length === 0) {
      container.innerHTML = '<p style="color:#aaa;text-align:center;">ยังไม่มีรายชื่อที่ถูก BAN</p>';
      return;
    }

    container.innerHTML = `
      <p style="color:#aaa;margin-bottom:12px;">ทั้งหมด ${blocked.length} รายชื่อ</p>
      ${blocked.map(name => `
        <div class="ban-item">
          <span class="ban-item-name">${escapeHtml(name)}</span>
          <button class="btn-order-action btn-order-complete" data-unban="${escapeHtml(name)}">ยกเลิก BAN</button>
        </div>
      `).join('')}
    `;
  }, e => {
    console.error(e);
    container.innerHTML = '<p style="color:#ff6b6b;text-align:center;">โหลดรายชื่อไม่ได้</p>';
  });
}

async function unbanFacebook(fbName) {
  const yes = await showConfirm(`ยกเลิก BAN "${fbName}" ?`, 'ยืนยัน');
  if (!yes) return;

  try {
    await db.collection('settings').doc('spam').update({
      blocked: firebase.firestore.FieldValue.arrayRemove(fbName)
    });
    showToast(`ยกเลิก BAN "${fbName}" แล้ว`);
  } catch (e) {
    showAlert('ยกเลิก BAN ไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

// ============ CLOSE REASON MODAL ============
function askCloseReason() {
  return new Promise((resolve) => {
    const modal = document.getElementById('closeReasonModal');
    const input = document.getElementById('closeReasonInput');
    const confirmBtn = document.getElementById('closeReasonConfirm');
    const cancelBtn = document.getElementById('closeReasonCancel');
    input.value = '';
    modal.classList.add('active');
    input.focus();

    function cleanup() {
      modal.classList.remove('active');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }
    function onConfirm() { cleanup(); resolve(input.value); }
    function onCancel() { cleanup(); resolve(null); }
    function onKey(e) { if (e.key === 'Enter') onConfirm(); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

// ============ SHOP OPEN/CLOSE TOGGLE ============
function listenShopToggle() {
  const btn = document.getElementById('shopToggleBtn');
  const modal = document.getElementById('shopStateModal');
  const btnAuto = document.getElementById('btnModeAuto');
  const btnForceOpen = document.getElementById('btnModeForceOpen');
  const btnForceClose = document.getElementById('btnModeForceClose');
  const cancelBtn = document.getElementById('shopStateCancelBtn');

  function isWithinShopHours() {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();

    // กะดึก: เที่ยงคืนถึงตีหนึ่ง ของวัน อ.(2)-ส.(6) ต่อจากคืนก่อนหน้า
    if (hour === 0 && day >= 2 && day <= 6) return true;

    if (day === 0 || day === 6) return hour >= 10; // เสาร์-อาทิตย์ เปิด 10:00
    return hour >= 20; // จันทร์-ศุกร์ เปิด 20:00
  }

  function updateBtn(mode) {
    // อัปเดต UI ของปุ่มบอกสถานะด้านบน
    if (mode === 'force_open') {
      btn.className = 'btn-shop-toggle open';
      btn.textContent = '🟢 บังคับเปิดตลอด';
    } else if (mode === 'force_close') {
      btn.className = 'btn-shop-toggle closed';
      btn.textContent = '🔴 บังคับปิดร้าน';
    } else {
      const inHours = isWithinShopHours();
      btn.className = 'btn-shop-toggle ' + (inHours ? 'open' : 'closed');
      btn.textContent = inHours ? '🕒 ร้านเปิดอยู่ (Auto)' : '🕒 ร้านปิดอยู่ (Auto)';
    }
  }

  let currentMode = 'auto'; 
  
  function processShopDoc(doc) {
    if (doc.exists) {
      const data = doc.data();
      if (data.shopState) currentMode = data.shopState;
      else if (data.isOpen === false) currentMode = 'force_close';
      else currentMode = 'auto';
      // broadcast payMode ให้ setupPayModeToggle
      if (_payModeCallback) _payModeCallback(data.payMode || 'both');
      // ถ้า quota close → เปลี่ยน badge
      const reason = data.closeReason || '';
      if (reason === '[QUOTA_CLOSE]' || reason.includes('ระบบขัดข้อง')) {
        if (typeof switchQuotaBadgeToError === 'function') switchQuotaBadgeToError();
      } else if (currentMode !== 'force_close') {
        if (typeof restoreQuotaBadgeToOk === 'function') restoreQuotaBadgeToOk();
      }
    } else {
      currentMode = 'auto';
      if (_payModeCallback) _payModeCallback('both');
    }
    updateBtn(currentMode);
  }

  if (unsubShopSettings) { unsubShopSettings(); unsubShopSettings = null; }
  if (_quotaSaving) {
    db.collection('settings').doc('shop').get().then(doc => processShopDoc(doc)).catch(() => {});
  } else {
    unsubShopSettings = db.collection('settings').doc('shop').onSnapshot(
      doc => processShopDoc(doc),
      e => { if (typeof handleQuotaError === 'function') handleQuotaError(e, 'shopToggle'); }
    );
  }
  // Auto update text if schedule changes while viewing admin
  setInterval(() => updateBtn(currentMode), 60000);

  // เปิด Modal
  btn.addEventListener('click', () => {
    modal.classList.add('active');
  });

  // ปิด Modal
  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  // Handle Mode Change
  async function setShopMode(newMode) {
    modal.classList.remove('active');
    btn.disabled = true;

    try {
      if (newMode === 'force_close') {
        const reason = await askCloseReason();
        if (reason === null) return;
        await db.collection('settings').doc('shop').set({
          shopState: 'force_close',
          isOpen: false,
          closeReason: reason.trim() || ''
        }, { merge: true });
        showToast('ตั้งค่าเป็น: บังคับปิดร้าน');
      } else {
        await db.collection('settings').doc('shop').set({
          shopState: newMode,
          isOpen: true,
          closeReason: firebase.firestore.FieldValue.delete()
        }, { merge: true });
        showToast(`ตั้งค่าเป็น: ${newMode === 'force_open' ? 'บังคับเปิด 24 ชม.' : 'เปิดตามเวลา (Auto)'}`);
      }
    } catch (err) {
      showAlert('เปลี่ยนสถานะร้านไม่ได้: ' + err.message, 'ผิดพลาด');
    } finally {
      btn.disabled = false;
    }
  }

  btnAuto.addEventListener('click', () => setShopMode('auto'));
  btnForceOpen.addEventListener('click', () => setShopMode('force_open'));
  btnForceClose.addEventListener('click', () => setShopMode('force_close'));
}

// ============ COUPONS & PAYMENTS ============
function loadCoupons() {
  if (unsubCoupons) unsubCoupons();
  
  // โหลดคูปอง
  unsubCoupons = db.collection('coupons').onSnapshot(snapshot => {
    const container = document.getElementById('couponListContainer');
    if (snapshot.empty) {
      container.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px;">ยังไม่มีคูปอง</p>';
      return;
    }

    container.innerHTML = snapshot.docs.map(doc => {
      const c = doc.data();
      const code = escapeHtml(doc.id);
      const discountText = c.type === 'percent' ? `${c.value}%` : `${c.value} ฿`;
      const usesText = c.maxUses > 0 ? `${c.usedCount || 0}/${c.maxUses}` : `${c.usedCount || 0}/∞`;
      const minText = c.minAmount > 0 ? `ขั้นต่ำ ${c.minAmount} ฿` : '';
      const isOff = c.active === false;
      const isFull = c.maxUses > 0 && (c.usedCount || 0) >= c.maxUses;

      const badges = [];
      if (isOff) badges.push('<span class="coupon-badge coupon-badge-off">ปิดอยู่</span>');
      if (isFull) badges.push('<span class="coupon-badge coupon-badge-full">เต็มแล้ว</span>');
      if (c.limitNewCustomer) badges.push('<span class="coupon-badge coupon-badge-new">ลูกค้าใหม่</span>');

      return `
        <div class="coupon-card ${isOff ? 'coupon-card-off' : ''}">
          <div class="coupon-card-left">
            <div class="coupon-card-code">${code}</div>
            <div class="coupon-card-discount">ลด ${discountText}</div>
            ${badges.length ? '<div class="coupon-card-badges">' + badges.join('') + '</div>' : ''}
          </div>
          <div class="coupon-card-right">
            <div class="coupon-card-stats">
              <span>ใช้แล้ว ${usesText}</span>
              ${minText ? '<span>' + minText + '</span>' : ''}
            </div>
            <div class="coupon-card-actions">
              <button class="btn-table secondary" data-action="toggleCoupon" data-id="${doc.id}" data-active="${c.active !== false}">
                ${isOff ? 'เปิดใช้' : 'ปิด'}
              </button>
              <button class="btn-table danger" data-action="deleteCoupon" data-id="${doc.id}">ลบ</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  });
  
  // โหลด PP
  db.collection('settings').doc('shop').get().then(doc => {
    const ppDisplay = document.getElementById('ppCurrentDisplay');
    if (doc.exists && doc.data().promptpay) {
      const pp = doc.data().promptpay;
      document.getElementById('ppInputSetting').value = pp;
      ppDisplay.textContent = 'ใช้อยู่: ' + pp;
      ppDisplay.style.color = '#4CAF50';
    } else {
      ppDisplay.textContent = 'ยังไม่ได้ตั้งค่า';
      ppDisplay.style.color = '#ff9800';
    }
  }).catch(() => {
    document.getElementById('ppCurrentDisplay').textContent = 'โหลดข้อมูลไม่ได้';
    document.getElementById('ppCurrentDisplay').style.color = '#ff4444';
  });
}

async function toggleCouponStatus(id, currentActive) {
  try {
    await db.collection('coupons').doc(id).update({ active: !currentActive });
    showToast(!currentActive ? 'เปิดใช้คูปองแล้ว' : 'ปิดคูปองแล้ว');
  } catch (e) { showAlert('เปลี่ยนสถานะไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

async function deleteCoupon(id) {
  if (!await showConfirm('คุณต้องการลบคูปอง ' + id + ' ใช่หรือไม่?')) return;
  try {
    await db.collection('coupons').doc(id).delete();
    showToast('ลบคูปองแล้ว');
  } catch (e) { showAlert('ลบคูปองไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

// ============ PAY MODE TOGGLE (Owner only) ============
function setupPayModeToggle() {
  const btn = document.getElementById('payModeBtn');
  const modal = document.getElementById('payModeModal');
  if (!btn || !modal || !isOwner) return;

  btn.style.display = '';

  const labels = {
    both: '🟢 ชำระ: ลูกค้าเลือก',
    pay_only: '💳 ชำระ: โอนเท่านั้น',
    order_only: '📋 ชำระ: สั่งก่อนเท่านั้น'
  };
  const colors = {
    both: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50', border: '#4CAF50' },
    pay_only: { bg: 'rgba(255,152,0,0.15)', color: '#ff9800', border: '#ff9800' },
    order_only: { bg: 'rgba(79,195,247,0.15)', color: '#4fc3f7', border: '#4fc3f7' }
  };

  function updateBtn(mode) {
    btn.textContent = labels[mode] || labels.both;
    const c = colors[mode] || colors.both;
    btn.style.background = c.bg;
    btn.style.color = c.color;
    btn.style.borderColor = c.border;
  }

  // ใช้ shared listener จาก listenShopToggle แทน onSnapshot แยก
  _payModeCallback = (mode) => updateBtn(mode);

  btn.addEventListener('click', () => modal.classList.add('active'));
  document.getElementById('payModeCancelBtn').addEventListener('click', () => modal.classList.remove('active'));

  async function setPayMode(newMode) {
    modal.classList.remove('active');
    try {
      await db.collection('settings').doc('shop').set({ payMode: newMode }, { merge: true });
      showToast('เปลี่ยนโหมดชำระเงินแล้ว');
    } catch (e) {
      showAlert('เปลี่ยนไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  }

  document.getElementById('btnPayModeBoth').addEventListener('click', () => setPayMode('both'));
  document.getElementById('btnPayModePayOnly').addEventListener('click', () => setPayMode('pay_only'));
  document.getElementById('btnPayModeOrderOnly').addEventListener('click', () => setPayMode('order_only'));
}

// ============ COMMISSION TIERS (Owner only) ============
// Default tiers ถ้ายังไม่เคยตั้ง
const DEFAULT_TIERS = [
  { maxPrice: 50, ownerPct: 30 },
  { maxPrice: 100, ownerPct: 25 },
  { maxPrice: 200, ownerPct: 20 },
  { maxPrice: 0, ownerPct: 15 }  // 0 = ไม่จำกัด (201+)
];

let _commissionTiers = []; // cache สำหรับใช้ทั่วระบบ
let _externalOrderDelay = 2; // นาที — delay ก่อนแอดนอกเห็น order

function getExternalOrderDelayMs() {
  return _externalOrderDelay * 60 * 1000;
}

function loadCommissionTiers() {
  return db.collection('settings').doc('commission').get().then(doc => {
    if (doc.exists) {
      const data = doc.data();
      if (Array.isArray(data.tiers) && data.tiers.length > 0) {
        _commissionTiers = data.tiers;
      } else {
        _commissionTiers = DEFAULT_TIERS.map(t => ({ ...t }));
      }
      if (typeof data.externalOrderDelay === 'number') {
        _externalOrderDelay = data.externalOrderDelay;
      }
    } else {
      _commissionTiers = DEFAULT_TIERS.map(t => ({ ...t }));
    }
    renderCommissionTiers();
  }).catch(() => {
    _commissionTiers = DEFAULT_TIERS.map(t => ({ ...t }));
    renderCommissionTiers();
  });
}

function renderCommissionTiers() {
  const container = document.getElementById('commissionTiersContainer');
  if (!container) return;

  container.innerHTML = `
    <table class="admin-table" style="table-layout:fixed;">
      <thead>
        <tr>
          <th style="width:40%;text-align:center;">ช่วงราคา (฿)</th>
          <th style="width:25%;text-align:center;">Owner ได้ (%)</th>
          <th style="width:25%;text-align:center;">แอดนอกได้ (%)</th>
          <th style="width:10%;text-align:center;"></th>
        </tr>
      </thead>
      <tbody id="commissionTiersBody">
        ${_commissionTiers.map((tier, i) => {
          const prevMax = i > 0 ? _commissionTiers[i - 1].maxPrice : 0;
          const rangeText = tier.maxPrice > 0 ? `${prevMax + 1} - ${tier.maxPrice}` : `${prevMax + 1}+`;
          return `
            <tr>
              <td style="text-align:center;">
                ${tier.maxPrice > 0
                  ? `<input type="number" class="tier-max-input" data-idx="${i}" value="${tier.maxPrice}" min="1">`
                  : `<span style="color:#aaa;">${prevMax + 1}+ (ไม่จำกัด)</span>`}
              </td>
              <td style="text-align:center;">
                <input type="number" class="tier-pct-input" data-idx="${i}" value="${tier.ownerPct}" min="0" max="100">%
              </td>
              <td style="text-align:center;color:#4CAF50;font-weight:600;">
                ${100 - tier.ownerPct}%
              </td>
              <td style="text-align:center;">
                ${tier.maxPrice > 0 ? `<button class="btn-icon btn-icon-danger" data-remove-tier="${i}" title="ลบ">&times;</button>` : ''}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:8px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
      <div style="font-size:12px;color:#aaa;margin-bottom:6px;">ตัวอย่าง:</div>
      <div id="tierExamples" style="font-size:13px;color:#e0b0ff;"></div>
    </div>
    <div style="margin-top:12px;padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;">
      <label style="font-size:13px;color:#aaa;">Delay order แอดนอก (ให้ internal ส่งก่อน)</label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <input type="number" id="externalDelayInput" value="${_externalOrderDelay}" min="0" max="30">
        <span style="color:#aaa;font-size:13px;">นาที</span>
        <span style="color:#666;font-size:11px;">(0 = ไม่ delay)</span>
      </div>
    </div>
  `;

  updateTierExamples();

  // Event: ลบ tier
  container.querySelectorAll('[data-remove-tier]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.removeTier);
      _commissionTiers.splice(idx, 1);
      renderCommissionTiers();
    });
  });

  // Event: เปลี่ยนค่า → อัปเดต preview
  container.querySelectorAll('.tier-max-input, .tier-pct-input').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.idx);
      if (input.classList.contains('tier-max-input')) {
        _commissionTiers[idx].maxPrice = parseInt(input.value) || 0;
      } else {
        _commissionTiers[idx].ownerPct = parseFloat(input.value) || 0;
      }
      updateTierExamples();
    });
  });
}

function updateTierExamples() {
  const el = document.getElementById('tierExamples');
  if (!el) return;
  const examples = [15, 50, 100, 150, 200, 250, 500];
  el.innerHTML = examples.map(price => {
    const rate = calcOwnerPct(price);
    const ownerGets = Math.round(price * rate / 100);
    const extGets = price - ownerGets;
    return `<span style="margin-right:12px;">${price}฿ → Owner ${ownerGets}฿ · แอดนอก ${extGets}฿ <span style="color:#aaa;">(${rate}%)</span></span>`;
  }).join('<br>');
}

// คำนวณ % ที่ Owner ได้จากราคาสินค้า
function calcOwnerPct(price) {
  const tiers = _commissionTiers.length > 0 ? _commissionTiers : DEFAULT_TIERS;
  for (const tier of tiers) {
    if (tier.maxPrice > 0 && price <= tier.maxPrice) return tier.ownerPct;
  }
  // ถ้าเกินทุก tier → ใช้ tier สุดท้าย (maxPrice = 0)
  const last = tiers[tiers.length - 1];
  return last ? last.ownerPct : 20;
}

// คำนวณ externalCut จากราคา
function calcExternalCut(price) {
  const ownerPct = calcOwnerPct(price);
  return Math.round(price * (100 - ownerPct) / 100);
}

function setupCommissionTiers() {
  const addBtn = document.getElementById('addTierBtn');
  const saveBtn = document.getElementById('saveTiersBtn');
  if (!addBtn || !saveBtn) return;

  addBtn.addEventListener('click', () => {
    // เพิ่ม tier ก่อน tier สุดท้าย (tier สุดท้ายคือ maxPrice=0)
    const lastIdx = _commissionTiers.length - 1;
    const prevMax = lastIdx > 0 ? _commissionTiers[lastIdx - 1].maxPrice : 50;
    _commissionTiers.splice(lastIdx, 0, { maxPrice: prevMax + 100, ownerPct: 20 });
    renderCommissionTiers();
  });

  saveBtn.addEventListener('click', async () => {
    // Validate: maxPrice ต้องเรียงจากน้อยไปมาก
    for (let i = 0; i < _commissionTiers.length - 1; i++) {
      if (_commissionTiers[i].maxPrice <= 0) {
        showAlert('ช่วงราคาต้องมากกว่า 0 (ยกเว้นขั้นสุดท้าย)');
        return;
      }
      if (i > 0 && _commissionTiers[i].maxPrice <= _commissionTiers[i - 1].maxPrice) {
        showAlert('ช่วงราคาต้องเรียงจากน้อยไปมาก');
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'กำลังบันทึก...';
    try {
      const delayInput = document.getElementById('externalDelayInput');
      _externalOrderDelay = parseInt(delayInput ? delayInput.value : '2') || 0;
      await db.collection('settings').doc('commission').set({ tiers: _commissionTiers, externalOrderDelay: _externalOrderDelay });
      showToast('บันทึกอัตราค่า com แล้ว');
    } catch (e) {
      showAlert('บันทึกไม่ได้: ' + e.message, 'ผิดพลาด');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'บันทึก';
    }
  });
}

