// ============================================
// BubbleShop - Reservation System (จองสินค้า)
// ============================================

const RESERVATION_TTL = 15 * 60 * 1000; // 15 นาที
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 นาที
const STALE_CLEANUP_THRESHOLD = 30 * 60 * 1000; // 30 นาที

let _heartbeatTimer = null;
let _reservationExists = false;
let _reservationExpiresAt = 0; // ms timestamp ที่ reservation จะหมดอายุ
let _allReservations = []; // [{ sessionId, items, expiresAt }]
let _syncDebounce = null;

// ============ SESSION ID ============
function getSessionId() {
  let id = localStorage.getItem('bubbleshop_sid');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() :
      'xxxx-xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    localStorage.setItem('bubbleshop_sid', id);
  }
  return id;
}
const _sessionId = getSessionId();

// ============ SYNC CART → FIRESTORE ============
function syncReservation() {
  // เริ่ม listener เมื่อ cart มีของ (ประหยัด quota สำหรับคนดูเฉยๆ)
  if (Object.keys(cart).length > 0) {
    _startReservationListener();
  }
  // Debounce: ป้องกันเขียน Firestore ถี่เกินไป (เช่น กด +/- รัว)
  clearTimeout(_syncDebounce);
  _syncDebounce = setTimeout(_doSync, 300);
}

async function _doSync() {
  const ref = db.collection('reservations').doc(_sessionId);
  const entries = Object.entries(cart);

  if (entries.length === 0) {
    if (_reservationExists) {
      try { await ref.delete(); } catch (e) { console.warn('reservation delete:', e.message); }
      _reservationExists = false;
      _reservationExpiresAt = 0;
      _stopHeartbeat();
    }
    // ปิด listener เมื่อ cart ว่าง (ประหยัด quota)
    _stopReservationListener();
    return;
  }

  const itemsMap = {};
  for (const [id, { item, qty }] of entries) {
    const bq = typeof getBundleQty === 'function' ? getBundleQty(item) : 1;
    itemsMap[id] = qty * bq; // เก็บเป็นชิ้นจริง
  }

  try {
    await ref.set({
      sessionId: _sessionId,
      items: itemsMap,
      expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + RESERVATION_TTL),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    _reservationExists = true;
    _reservationExpiresAt = Date.now() + RESERVATION_TTL;
    _startHeartbeat();
  } catch (e) {
    console.warn('reservation sync:', e.message);
  }
}

// ============ HEARTBEAT (ต่ออายุ reservation) ============
function _startHeartbeat() {
  _stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    if (Object.keys(cart).length > 0) _doSync();
  }, HEARTBEAT_INTERVAL);
}

function _stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

// ============ LISTEN RESERVATIONS (real-time) ============
function loadReservations() {
  // ถ้า cart ว่าง → ไม่เริ่ม listener (ประหยัด quota)
  if (typeof cart !== 'undefined' && Object.keys(cart).length === 0 && !_reservationExists) {
    _allReservations = [];
    if (typeof renderItems === 'function') renderItems();
    return;
  }
  _startReservationListener();
}

function _startReservationListener() {
  if (window.unsubReservations) return; // มี listener อยู่แล้ว

  // Quota saving mode → skip real-time, ใช้ข้อมูลเก่า
  if (typeof _quotaSaving !== 'undefined' && _quotaSaving) {
    _allReservations = [];
    if (typeof renderItems === 'function') renderItems();
    return;
  }

  window.unsubReservations = db.collection('reservations')
    .onSnapshot((snapshot) => {
      const now = Date.now();

      _allReservations = snapshot.docs
        .map(doc => doc.data())
        .filter(r => r.expiresAt && r.expiresAt.toMillis() > now)
        .filter(r => r.sessionId !== _sessionId);

      // Opportunistic cleanup: ลบ reservation เก่ามาก (> 30 นาที)
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.expiresAt && data.expiresAt.toMillis() < now - STALE_CLEANUP_THRESHOLD) {
          db.collection('reservations').doc(doc.id).delete().catch(() => {});
        }
      });

      // Re-render เพื่ออัปเดต stock ที่แสดง
      if (typeof renderItems === 'function') renderItems();
      if (typeof renderCart === 'function') renderCart();
    }, (e) => {
      console.warn('reservation listener:', e.message);
      if (typeof handleQuotaError === 'function') handleQuotaError(e, 'reservations');
    });
}

function _stopReservationListener() {
  if (window.unsubReservations) {
    window.unsubReservations();
    window.unsubReservations = null;
  }
}

// ============ AVAILABLE STOCK HELPERS ============
function getReservedQty(itemId) {
  let total = 0;
  const now = Date.now();
  for (const r of _allReservations) {
    if (r.expiresAt && r.expiresAt.toMillis() > now && r.items && r.items[itemId]) {
      total += r.items[itemId];
    }
  }
  return total;
}

// คืนเวลาหมดอายุที่เร็วที่สุดของ reservation บน item นี้ (ms) หรือ 0 ถ้าไม่มี
function getReservationMaxExpiry(itemId) {
  let maxExp = 0;
  const now = Date.now();
  for (const r of _allReservations) {
    if (r.expiresAt && r.items && r.items[itemId] && r.expiresAt.toMillis() > now) {
      const exp = r.expiresAt.toMillis();
      if (exp > maxExp) maxExp = exp;
    }
  }
  return maxExp;
}

// คืนเวลาที่เหลือ (ms) ก่อน reservation ของตัวเองหมดอายุ, 0 ถ้าไม่มี
function getMyReservationRemaining() {
  if (!_reservationExists || !_reservationExpiresAt) return 0;
  return Math.max(0, _reservationExpiresAt - Date.now());
}

function getAvailableStock(item) {
  const reserved = getReservedQty(item.id);
  return Math.max(0, (Number(item.stock) || 0) - reserved);
}

// ============ DELETE RESERVATION ============
async function deleteReservation() {
  if (!_reservationExists) return;
  try {
    await db.collection('reservations').doc(_sessionId).delete();
  } catch (e) { console.warn('reservation delete:', e.message); }
  _reservationExists = false;
  _stopHeartbeat();
}

// ============ BEFOREUNLOAD (best-effort) ============
window.addEventListener('beforeunload', () => {
  if (_reservationExists) {
    // ใช้ sendBeacon กับ REST API เป็น fire-and-forget
    // หรือ fire-and-forget delete
    db.collection('reservations').doc(_sessionId).delete().catch(() => {});
  }
});
