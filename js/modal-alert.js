// ============================================
// Shared Utilities
// ============================================

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML.replace(/'/g, '&#39;');
}

// ============================================
// Modal Alert & Confirm (แทน alert/confirm)
// ============================================

function showAlert(msg, title) {
  const overlay = document.getElementById('alertModal');
  document.getElementById('alertModalTitle').textContent = title || 'แจ้งเตือน';
  document.getElementById('alertModalMsg').textContent = msg;
  document.getElementById('alertModalButtons').innerHTML =
    '<button class="btn-primary" style="width:auto;margin:0 auto;padding:10px 40px;" onclick="closeAlertModal()">ตกลง</button>';
  overlay.classList.add('active');
}

function showConfirm(msg, title) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('alertModal');
    document.getElementById('alertModalTitle').textContent = title || 'ยืนยัน';
    document.getElementById('alertModalMsg').textContent = msg;
    document.getElementById('alertModalButtons').innerHTML =
      '<button class="btn-secondary" id="confirmNo">ยกเลิก</button>' +
      '<button class="btn-primary" id="confirmYes" style="width:auto;padding:10px 30px;">ยืนยัน</button>';
    overlay.classList.add('active');

    document.getElementById('confirmYes').onclick = () => { closeAlertModal(); resolve(true); };
    document.getElementById('confirmNo').onclick = () => { closeAlertModal(); resolve(false); };
  });
}

function closeAlertModal() {
  document.getElementById('alertModal').classList.remove('active');
}

// ============ Toast Notification ============
const TOAST_MAX = 3;
const _toastQueue = [];
let _activeToasts = 0;

function getToastContainer() {
  return document.getElementById('toastContainer');
}

function _processToastQueue() {
  while (_toastQueue.length > 0 && _activeToasts < TOAST_MAX) {
    const data = _toastQueue.shift();
    _showToastNow(data);
  }
}

function _showToastNow(data) {
  _activeToasts++;
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  if (data.items && data.items.length > 0) {
    // Order toast: หลายสินค้าพร้อมรูป
    const label = document.createElement('span');
    label.className = 'toast-label';
    label.textContent = 'มีลูกค้าซื้อ';
    toast.appendChild(label);
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'toast-items';
    for (const item of data.items) {
      const row = document.createElement('div');
      row.className = 'toast-item-row';
      if (item.image) {
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = '';
        img.className = 'toast-img';
        row.appendChild(img);
      }
      const name = document.createElement('span');
      name.textContent = `${item.name} x${item.qty}`;
      row.appendChild(name);
      itemsWrap.appendChild(row);
    }
    toast.appendChild(itemsWrap);
  } else {
    // Simple toast
    if (data.imgSrc) {
      const img = document.createElement('img');
      img.src = data.imgSrc;
      img.alt = '';
      img.className = 'toast-img';
      toast.appendChild(img);
    }
    const text = document.createElement('span');
    text.textContent = data.msg;
    toast.appendChild(text);
  }

  if (!container) { _activeToasts--; return; }
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
      _activeToasts--;
      _processToastQueue();
    }, 600);
  }, data.duration || 5000);
}

function showToast(msg, duration, imgSrc) {
  const data = { msg, duration, imgSrc };
  if (_activeToasts < TOAST_MAX) {
    _showToastNow(data);
  } else {
    if (_toastQueue.length >= 50) _toastQueue.shift();
    _toastQueue.push(data);
  }
}

function showOrderToast(items, duration) {
  const data = { items, duration };
  if (_activeToasts < TOAST_MAX) {
    _showToastNow(data);
  } else {
    _toastQueue.push(data);
  }
}

// ============ QUOTA SAVING MODE ============
let _quotaBannerShown = false;
let _quotaSaving = false; // true = ปิด listener ใช้ .get() แทน
const QUOTA_STORAGE_KEY = 'quotaSavingUntil';

// เช็คตอนโหลดหน้า — ถ้า localStorage บอกว่า quota ยังหมดอยู่ให้เข้า saving mode ทันที
(function checkQuotaOnLoad() {
  try {
    const until = parseInt(localStorage.getItem(QUOTA_STORAGE_KEY) || '0');
    if (until && Date.now() < until) {
      _quotaSaving = true;
      // รอ DOM พร้อมแล้วค่อย switch badge
      const ready = () => { switchQuotaBadgeToError(); showQuotaBanner(); };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
      } else {
        ready();
      }
    } else if (until) {
      localStorage.removeItem(QUOTA_STORAGE_KEY);
    }
  } catch(e) {}
})();

function isQuotaError(err) {
  if (!err) return false;
  const msg = (err.message || err.code || '').toLowerCase();
  return msg.includes('quota') || msg.includes('resource exhausted') || msg.includes('resource-exhausted');
}

// คำนวณเวลา quota reset ถัดไป (เที่ยงคืน Pacific Time)
function getNextQuotaReset() {
  // สร้างเวลาปัจจุบันใน Pacific Time
  const now = new Date();
  const ptString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const ptNow = new Date(ptString);

  // เที่ยงคืนวันถัดไป Pacific Time
  const ptMidnight = new Date(ptNow);
  ptMidnight.setDate(ptMidnight.getDate() + 1);
  ptMidnight.setHours(0, 0, 0, 0);

  // แปลงกลับเป็น local time: หาผลต่าง
  const diffMs = ptMidnight.getTime() - ptNow.getTime();
  return Date.now() + diffMs;
}

function getQuotaResetThaiTime() {
  // หาว่าเที่ยงคืน PT ตรงกับกี่โมงไทย
  const testDate = new Date();
  testDate.setDate(testDate.getDate() + 1);
  // สร้างเที่ยงคืน PT
  const ptStr = testDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [m, d, y] = ptStr.split('/');
  const midnightPT = new Date(`${y}-${m}-${d}T00:00:00`);
  // แปลงเป็น UTC โดยใช้ offset ของ PT
  const ptOffset = new Date(midnightPT.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const utcOffset = new Date(midnightPT.toLocaleString('en-US', { timeZone: 'UTC' }));
  const diffHrs = (utcOffset - ptOffset) / 3600000;
  // เวลาไทย = UTC+7
  const thaiHour = (0 - diffHrs + 7 + 24) % 24;
  return thaiHour;
}

function formatQuotaCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
  const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

let _quotaResetTarget = 0;
let _quotaCountdownTimer = null;
let _quotaBadgeTimer = null;

// เปลี่ยน quota badge (ทั้ง index + admin) เป็นโหมด error พร้อม countdown
function switchQuotaBadgeToError() {
  const info = document.getElementById('quotaInfo');
  const label = info && info.querySelector('.quota-reset-label');
  const time = document.getElementById('quotaResetCountdown');
  if (!info || !time) return;

  info.classList.remove('quota-ok');
  info.classList.add('quota-error');
  if (label) label.textContent = 'Quota หมด';

  const target = getNextQuotaReset();

  function tick() {
    const remain = target - Date.now();
    if (remain <= 0) {
      time.textContent = 'Reset!';
      time.style.color = '#76ff03';
      clearInterval(_quotaBadgeTimer);
    } else {
      time.textContent = formatQuotaCountdown(remain);
    }
  }
  tick();
  if (_quotaBadgeTimer) clearInterval(_quotaBadgeTimer);
  _quotaBadgeTimer = setInterval(tick, 1000);
}

// คืน quota badge กลับเป็นปกติ
function restoreQuotaBadgeToOk() {
  const info = document.getElementById('quotaInfo');
  const label = info && info.querySelector('.quota-reset-label');
  const time = document.getElementById('quotaResetCountdown');
  if (!info || !time) return;

  info.classList.remove('quota-error');
  info.classList.add('quota-ok');
  if (label) label.textContent = 'ระบบ';
  time.textContent = 'ปกติ';
  time.style.color = '';
  if (_quotaBadgeTimer) { clearInterval(_quotaBadgeTimer); _quotaBadgeTimer = null; }
  _quotaSaving = false;
  try { localStorage.removeItem(QUOTA_STORAGE_KEY); } catch(e) {}
}

function showQuotaBanner() {
  if (_quotaBannerShown) return;
  _quotaBannerShown = true;
  _quotaResetTarget = getNextQuotaReset();
  const thaiHour = getQuotaResetThaiTime();

  let banner = document.getElementById('quotaBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'quotaBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff1744;color:#fff;padding:12px 16px;text-align:center;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    banner.innerHTML = `
      ⚠️ Quota saving mode — ปิด real-time อัตโนมัติเพื่อประหยัด quota<br>
      <span style="font-size:13px;font-weight:400;">
        Quota กลับมาใน <strong id="quotaCountdown" style="font-variant-numeric:tabular-nums;">--:--:--</strong>
        <span style="color:#ffcdd2;font-size:11px;">(รีเซ็ตทุกวัน ${thaiHour}:00 น.)</span>
      </span><br>
      <span style="font-size:12px;font-weight:400;">
        <button onclick="if(typeof manualRefresh==='function')manualRefresh();" style="background:#fff;color:#ff1744;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:600;margin:4px 6px 0;">🔄 Refresh ข้อมูล</button>
        แก้ถาวร: อัพเกรดเป็น Blaze plan →
        <a href="https://console.firebase.google.com" target="_blank" style="color:#fff;text-decoration:underline;">Firebase Console</a>
      </span>
      <button onclick="this.parentElement.remove();_quotaBannerShown=false;clearInterval(_quotaCountdownTimer);" style="position:absolute;right:10px;top:8px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">&times;</button>
    `;
    document.body.prepend(banner);
  }

  // อัปเดต countdown ทุกวินาที
  function updateCountdown() {
    const el = document.getElementById('quotaCountdown');
    if (!el) { clearInterval(_quotaCountdownTimer); return; }
    const remain = _quotaResetTarget - Date.now();
    if (remain <= 0) {
      el.textContent = 'กำลังรีเซ็ต... ลอง Refresh!';
      el.style.color = '#76ff03';
    } else {
      el.textContent = formatQuotaCountdown(remain);
    }
  }
  updateCountdown();
  if (_quotaCountdownTimer) clearInterval(_quotaCountdownTimer);
  _quotaCountdownTimer = setInterval(updateCountdown, 1000);
}

// ปิด listener ทั้งหมดเพื่อประหยัด quota
function enterQuotaSavingMode() {
  if (_quotaSaving) return;
  _quotaSaving = true;
  console.warn('[QUOTA] Entering saving mode — all listeners stopped');
  // บันทึกลง localStorage — หมดอายุตอน quota reset
  try { localStorage.setItem(QUOTA_STORAGE_KEY, String(getNextQuotaReset())); } catch(e) {}

  // ปิด listener ฝั่ง customer
  if (typeof window !== 'undefined') {
    if (window.unsubItems) { window.unsubItems(); window.unsubItems = null; }
    if (window.unsubStats) { window.unsubStats(); window.unsubStats = null; }
    if (window.unsubReservations) { window.unsubReservations(); window.unsubReservations = null; }
    if (window.unsubShopStatus) { window.unsubShopStatus(); window.unsubShopStatus = null; }
    if (window.unsubCategories) { window.unsubCategories(); window.unsubCategories = null; }
    if (typeof _stopHeartbeat === 'function') _stopHeartbeat();
  }
  // ปิด listener ฝั่ง admin
  if (typeof unsubOrders !== 'undefined' && unsubOrders) { unsubOrders(); unsubOrders = null; }
  if (typeof unsubProducts !== 'undefined' && unsubProducts) { unsubProducts(); unsubProducts = null; }
  if (typeof unsubCoupons !== 'undefined' && unsubCoupons) { unsubCoupons(); unsubCoupons = null; }
  if (typeof unsubBans !== 'undefined' && unsubBans) { unsubBans(); unsubBans = null; }
  if (typeof unsubAdmins !== 'undefined' && unsubAdmins) { unsubAdmins(); unsubAdmins = null; }
  if (typeof unsubPendingAdmins !== 'undefined' && unsubPendingAdmins) { unsubPendingAdmins(); unsubPendingAdmins = null; }
  if (typeof unsubShopSettings !== 'undefined' && unsubShopSettings) { unsubShopSettings(); unsubShopSettings = null; }
  if (typeof unsubAdminReservations !== 'undefined' && unsubAdminReservations) { unsubAdminReservations(); unsubAdminReservations = null; }
  if (typeof unsubPendingItems !== 'undefined' && unsubPendingItems) { unsubPendingItems(); unsubPendingItems = null; }
  if (typeof unsubPendingDeletes !== 'undefined' && unsubPendingDeletes) { unsubPendingDeletes(); unsubPendingDeletes = null; }

  // เปลี่ยน quota badge เป็นโหมด error + countdown
  switchQuotaBadgeToError();

  // พยายามปิดร้านอัตโนมัติ
  autoCloseShopOnQuota();

  showQuotaBanner();
}

// ปิดร้านอัตโนมัติเมื่อ quota หมด — บอกเวลาที่จะกลับมา
async function autoCloseShopOnQuota() {
  try {
    if (typeof db === 'undefined') return;
    const thaiHour = getQuotaResetThaiTime();
    const resetTarget = getNextQuotaReset();
    await db.collection('settings').doc('shop').set({
      shopState: 'force_close',
      isOpen: false,
      closeReason: `[QUOTA_CLOSE]`,
      quotaResetAt: resetTarget,
      quotaResetHour: thaiHour
    }, { merge: true });
    console.warn('[QUOTA] Auto-closed shop due to quota exhaustion');
  } catch (e) {
    console.warn('[QUOTA] Could not auto-close shop:', e.message);
  }
}

function handleQuotaError(err, context) {
  if (isQuotaError(err)) {
    enterQuotaSavingMode();
    showAlert(
      'Quota ใกล้หมด — ระบบเปลี่ยนเป็นโหมดประหยัดอัตโนมัติ\nกดปุ่ม Refresh เพื่อโหลดข้อมูลใหม่\n\nแก้ถาวร: อัพเกรด Blaze plan ที่ Firebase Console',
      '⚠️ Quota Saving Mode'
    );
    return true;
  }
  return false;
}

// ============ OFFLINE DELIVERY QUEUE ============
const OFFLINE_QUEUE_KEY = 'offlineDeliverQueue';

function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
  catch { return []; }
}

function saveOfflineDelivery(orderId, order, deliverItems, adminName) {
  const queue = getOfflineQueue();
  queue.push({
    orderId,
    facebook: order.facebook,
    characterName: order.characterName,
    deliverItems,
    adminName,
    savedAt: Date.now()
  });
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  showToast('บันทึกการส่งของไว้ offline — จะ sync เมื่อ quota กลับมา');
  renderOfflineQueue();
}

function removeOfflineEntry(index) {
  const queue = getOfflineQueue();
  queue.splice(index, 1);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  renderOfflineQueue();
}

function renderOfflineQueue() {
  const container = document.getElementById('offlineQueueContainer');
  if (!container) return;
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div style="background:#1a1a2e;border:2px solid #ff9800;border-radius:8px;padding:12px;margin-bottom:16px;">
      <div style="color:#ff9800;font-weight:600;margin-bottom:8px;">📋 รอ Sync (${queue.length} รายการ) <button class="btn-primary" style="width:auto;padding:4px 12px;font-size:12px;float:right;" onclick="syncOfflineQueue()">🔄 Sync ทั้งหมด</button></div>
      ${queue.map((q, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid #333;font-size:13px;">
          <span>FB: ${escapeHtml(q.facebook)} | ${escapeHtml(q.characterName)} | ส่งโดย: ${escapeHtml(q.adminName)} | ${q.deliverItems.map(d => escapeHtml(d.name) + ' x' + d.qty).join(', ')}</span>
          <button onclick="removeOfflineEntry(${i})" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:16px;">&times;</button>
        </div>
      `).join('')}
    </div>
  `;
}

async function syncOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) { showToast('ไม่มีรายการรอ sync'); return; }

  let success = 0, fail = 0;
  const remaining = [];
  const errors = [];

  for (const entry of queue) {
    try {
      await db.runTransaction(async (transaction) => {
        const orderRef = db.collection('orders').doc(entry.orderId);
        const orderDoc = await transaction.get(orderRef);
        if (!orderDoc.exists) throw new Error('ไม่พบ order');

        const orderData = orderDoc.data();
        if (orderData.status === 'cancelled') throw new Error('order ถูกยกเลิกแล้ว');

        const orderItems = Array.isArray(orderData.items) ? orderData.items : [];
        const existingDeliveries = Array.isArray(orderData.deliveries) ? orderData.deliveries : [];
        const newDeliveries = [];

        for (const di of entry.deliverItems) {
          const totalDelivered = existingDeliveries
            .filter(d => d.itemId === di.itemId)
            .reduce((sum, d) => sum + d.qty, 0);
          const orderItem = orderItems.find(i => i.itemId === di.itemId);
          const remain = orderItem ? orderItem.qty - totalDelivered : 0;
          if (di.qty > remain) throw new Error(`${di.name} ส่งเกินจำนวน`);

          newDeliveries.push({ itemId: di.itemId, qty: di.qty, by: entry.adminName, at: new Date() });

          transaction.set(
            db.collection('items').doc(di.itemId).collection('stockHistory').doc(),
            { qty: -di.qty, addedBy: entry.adminName, note: 'ขาย (offline sync)', createdAt: firebase.firestore.FieldValue.serverTimestamp() }
          );
          transaction.set(db.collection('items').doc(di.itemId), {
            adminStock: { [entry.adminName]: firebase.firestore.FieldValue.increment(-di.qty) }
          }, { merge: true });
        }

        const allDeliveries = [...existingDeliveries, ...newDeliveries];
        const fullyDelivered = orderItems.every(item => {
          const totalDel = allDeliveries.filter(d => d.itemId === item.itemId).reduce((sum, d) => sum + d.qty, 0);
          return totalDel >= item.qty;
        });

        const updateData = { deliveries: allDeliveries };
        if (fullyDelivered) {
          updateData.status = 'completed';
          const orderTotal = Number(orderData.totalPrice) || 0;
          transaction.set(db.collection('stats').doc('sales'), {
            completedCount: firebase.firestore.FieldValue.increment(1),
            totalRevenue: firebase.firestore.FieldValue.increment(orderTotal)
          }, { merge: true });
        }
        transaction.update(orderRef, updateData);
      });
      success++;
    } catch (e) {
      if (isQuotaError(e)) {
        remaining.push(entry);
      } else {
        // เก็บ error + entry ไว้ถาม user
        errors.push({ entry, reason: e.message });
        remaining.push(entry); // เก็บไว้ก่อน ไม่ลบ
      }
      fail++;
    }
  }

  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  renderOfflineQueue();

  if (fail === 0) {
    showAlert(`Sync สำเร็จทั้งหมด ${success} รายการ!`, '✅ Sync เสร็จ');
    _quotaSaving = false;
  } else if (errors.length > 0) {
    // แจ้ง error แต่ละรายการ พร้อมปุ่ม force ลบ
    const errMsg = errors.map(e =>
      `• FB: ${e.entry.facebook} — ${e.reason}`
    ).join('\n');
    const doForce = await showConfirm(
      `Sync ได้ ${success}, fail ${fail} รายการ:\n\n${errMsg}\n\nต้องการลบรายการที่ fail ออก?`,
      'Sync ไม่สำเร็จ'
    );
    if (doForce) {
      // ลบ error entries ออกจาก remaining
      const errorOrderIds = new Set(errors.map(e => e.entry.orderId));
      const cleaned = remaining.filter(r => !errorOrderIds.has(r.orderId));
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(cleaned));
      renderOfflineQueue();
      showToast(`ลบ ${errors.length} รายการที่ sync ไม่ได้แล้ว`);
    }
  } else {
    showAlert(`Sync ได้ ${success} รายการ, ไม่สำเร็จ ${fail} รายการ (quota ยังหมด)`, 'ผลการ Sync');
  }
}
