// ============ ADMIN ROLES MANAGEMENT ============
let unsubAdmins = null;
let unsubPendingAdmins = null;

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
      const roleLabel = d.role === 'owner' ? ' <span style="color:#ffeb3b;font-size:11px;font-weight:600;">👑 Owner</span>' : '';
      const displayName = d.displayName || d.name || '-';
      const editBtn = isOwner
        ? `<button class="btn-table secondary" style="font-size:11px;padding:3px 8px;" data-action="editDisplayName" data-uid="${doc.id}" data-current="${escapeHtml(displayName)}">แก้ไข</button>`
        : '';
      return `<tr>
        <td style="word-break: break-all;">${escapeHtml(d.email || doc.id)}${roleLabel}</td>
        <td style="word-break: break-all;">${escapeHtml(d.name || '-')}</td>
        <td style="word-break: break-all;">
          <span style="color:#ff69b4;font-weight:600;">${escapeHtml(displayName)}</span>
          ${editBtn}
        </td>
        <td style="text-align: center;">
          ${d.role === 'owner' ? '<span style="color:#aaa;font-size:12px;">-</span>' : `<button class="btn-table danger" data-action="removeAdmin" data-uid="${doc.id}">ลบสิทธิ์</button>`}
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
  if (!await showConfirm('ต้องการให้สิทธิ์ Admin แก่ ' + email + ' ใช่หรือไม่?')) return;

  const rawName = email.split('@')[0];
  const displayName = await askDisplayName('ตั้งชื่อแสดงผล', 'ตั้งชื่อให้แอดมิน ' + email, rawName);
  if (!displayName) return;

  try {
    await db.collection('admin_users').doc(uid).set({
      email: email,
      name: rawName,
      displayName: displayName,
      role: 'admin',
      grantedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('pending_users').doc(uid).delete();
    await loadAdminNames();
    showToast('เพิ่มแอดมินเรียบร้อย');
  } catch (e) { showAlert('เพิ่มแอดมินไม่ได้: ' + e.message, 'ผิดพลาด'); }
}

async function rejectPendingAdmin(uid) {
  if (!await showConfirm('ต้องการลบคำขอนี้ทิ้งใช่หรือไม่?')) return;
  try {
    await db.collection('pending_users').doc(uid).delete();
    showToast('ลบคำขอแล้ว');
  } catch (e) { showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด'); }
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

function viewSlip(orderId) {
  const order = loadedOrdersCache[orderId];
  if (!order || !order.slipImage) return;
  document.getElementById('slipModalImg').src = order.slipImage;
  document.getElementById('slipModal').classList.add('active');
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

function loadOrders() {
  const board = document.getElementById('orderBoard');

  // ยกเลิก listener เก่าก่อน ป้องกัน duplicate
  if (unsubOrders) {
    unsubOrders();
    unsubOrders = null;
  }

  unsubOrders = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(currentOrderLimit)
    .onSnapshot(snapshot => {
      // นับสถานะ
      let pending = 0, completed = 0, cancelled = 0;
      snapshot.docs.forEach(doc => {
        const s = doc.data().status || 'pending';
        if (s === 'pending') pending++;
        else if (s === 'completed') completed++;
        else if (s === 'cancelled') cancelled++;
      });

      document.getElementById('pendingCounter').textContent = 'รอดำเนินการ: ' + pending;
      document.getElementById('completedCounter').textContent = 'เสร็จแล้ว: ' + completed;
      document.getElementById('cancelledCounter').textContent = 'ยกเลิก: ' + cancelled;

      // Update Tab Title & Favicon
      updateFaviconAndTitle(pending);

      // หา order ใหม่
      const newIds = new Set();
      if (!firstLoad) {
        snapshot.docs.forEach(doc => {
          if (!knownOrderIds.has(doc.id)) newIds.add(doc.id);
        });
        if (newIds.size > 0) {
          showToast('Order ใหม่ +' + newIds.size + ' | รอดำเนินการ: ' + pending);
        }
      }
      knownOrderIds = new Set(snapshot.docs.map(doc => doc.id));
      firstLoad = false;

      const loadMoreBtn = document.getElementById('loadMoreOrdersBtn');
      if (loadMoreBtn) {
        loadMoreBtn.style.display = snapshot.docs.length >= currentOrderLimit ? 'inline-block' : 'none';
      }

      if (snapshot.empty) {
        board.innerHTML = '<p style="color:#aaa;text-align:center;">ยังไม่มี order</p>';
        return;
      }

      const total = snapshot.docs.length;
      board.innerHTML = snapshot.docs.map((doc, index) => {
        const order = doc.data();
        loadedOrdersCache[doc.id] = order; // เซฟลง cache
        
        const date = order.createdAt ? order.createdAt.toDate().toLocaleString('th-TH') : '-';
        const items = Array.isArray(order.items) ? order.items : [];
        const deliveries = Array.isArray(order.deliveries) ? order.deliveries : [];
        const itemsText = items.map(i => {
          const delivered = deliveries.filter(d => d.itemId === i.itemId).reduce((s, d) => s + d.qty, 0);
          const deliverInfo = delivered > 0
            ? ` <span style="color:${delivered >= i.qty ? '#4caf50' : '#ff9800'};font-size:12px;">(ส่งแล้ว ${delivered}/${i.qty})</span>`
            : '';
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
                ${order.slipImage ? `<button class="btn-table secondary" data-action="viewSlip" data-id="${docId}">ดูสลิปโอนเงิน</button>` : '<span style="color:#ff4444; font-size:12px;">ไม่มีสลิปโอนเงิน</span>'}
              </div>
            </div>
            <div class="admin-order-actions">
              <span class="order-status-badge ${status}">${status === 'pending' ? 'รอดำเนินการ' : status === 'completed' ? 'เสร็จแล้ว' : 'ยกเลิก'}</span>
              ${status === 'pending' ? `<button class="btn-order-action btn-order-complete" data-action="deliver" data-id="${docId}">&#128666; ส่งของ</button>` : ''}
              ${status === 'pending' ? `<button class="btn-order-action btn-order-cancel" data-action="cancel" data-id="${docId}">&#10005; ยกเลิก</button>` : ''}
              <button class="btn-order-action btn-order-ban" data-action="ban" data-fb="${fbEscaped}">BAN</button>
            </div>
          </div>
        `;
      }).join('');

      // อัปเดตสรุปยอดขาย
      if (typeof updateRevenueSummary === 'function') updateRevenueSummary(snapshot.docs);
    }, e => {
      console.error(e);
      board.innerHTML = '<p style="color:#ff6b6b;text-align:center;">โหลด order ไม่ได้</p>';
    });
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

function loadBanList() {
  if (unsubBans) { unsubBans(); unsubBans = null; }

  const container = document.getElementById('banList');

  unsubBans = db.collection('settings').doc('spam').onSnapshot(doc => {
    const blocked = doc.exists && Array.isArray(doc.data().blocked) ? doc.data().blocked : [];

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
  
  db.collection('settings').doc('shop').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (data.shopState) {
        currentMode = data.shopState;
      } else if (data.isOpen === false) {
        currentMode = 'force_close';
      } else {
        currentMode = 'auto';
      }
    } else {
      currentMode = 'auto';
    }
    updateBtn(currentMode);
  });
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

// ============ PAYMENT TOGGLE (Owner only) ============
function setupPaymentToggle() {
  const btn = document.getElementById('paymentToggleBtn');
  if (!btn || !isOwner) return;

  btn.style.display = '';

  function updateBtn(enabled) {
    if (enabled) {
      btn.textContent = 'ชำระเงิน: เปิด';
      btn.style.background = 'rgba(76,175,80,0.15)';
      btn.style.color = '#4CAF50';
      btn.style.borderColor = '#4CAF50';
    } else {
      btn.textContent = 'ชำระเงิน: ปิด';
      btn.style.background = 'rgba(255,68,68,0.15)';
      btn.style.color = '#ff4444';
      btn.style.borderColor = '#ff4444';
    }
  }

  let paymentEnabled = true;

  db.collection('settings').doc('shop').onSnapshot(doc => {
    if (doc.exists) {
      paymentEnabled = doc.data().paymentEnabled !== false;
    } else {
      paymentEnabled = true;
    }
    updateBtn(paymentEnabled);
  });

  btn.addEventListener('click', async () => {
    const newVal = !paymentEnabled;
    const msg = newVal
      ? 'แสดงระบบชำระเงิน — ลูกค้าจะเห็น QR/สลิป/ปุ่มสั่งซื้อ'
      : 'ซ่อนระบบชำระเงิน — ลูกค้าดูสรุปสินค้าได้แต่จะไม่เห็นส่วนจ่ายเงิน';
    const yes = await showConfirm(msg, newVal ? 'แสดงชำระเงิน' : 'ซ่อนชำระเงิน');
    if (!yes) return;

    try {
      await db.collection('settings').doc('shop').set({ paymentEnabled: newVal }, { merge: true });
      showToast(newVal ? 'แสดงระบบชำระเงินแล้ว' : 'ซ่อนระบบชำระเงินแล้ว');
    } catch (e) {
      showAlert('เปลี่ยนสถานะไม่ได้: ' + e.message, 'ผิดพลาด');
    }
  });
}

