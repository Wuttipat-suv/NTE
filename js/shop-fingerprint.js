// ============================================================
// Device fingerprint rate limit — 30s cooldown + 5/hour per device
// Complements Firebase App Check (reCAPTCHA v3) at the request level
// ============================================================

const FP_COOLDOWN_MS = 30 * 1000;      // 30s ระหว่างออเดอร์ต่อเครื่อง
const FP_HOURLY_LIMIT = 3;             // สูงสุด 3 ออเดอร์ / ชม / เครื่อง
const FP_HOURLY_WINDOW_MS = 60 * 60 * 1000;

async function _sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

let _fingerprintCache = null;
async function getFingerprint() {
  if (_fingerprintCache) return _fingerprintCache;
  const parts = [
    navigator.userAgent || '',
    `${screen.width}x${screen.height}`,
    screen.colorDepth || 0,
    navigator.language || '',
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || '',
  ].join('|');
  _fingerprintCache = (await _sha256Hex(parts)).substring(0, 32);
  return _fingerprintCache;
}

// ตรวจว่าเครื่องนี้ถูก rate-limit อยู่หรือไม่
// return { blocked, reason }
async function checkFingerprintLimit() {
  try {
    const fp = await getFingerprint();
    const doc = await db.collection('rate_limits').doc(fp).get();
    if (!doc.exists) return { blocked: false };

    const data = doc.data();
    const now = Date.now();
    const lastMs = data.last && typeof data.last.toMillis === 'function'
      ? data.last.toMillis()
      : 0;
    const count = data.count || 0;

    const since = now - lastMs;
    if (since < FP_COOLDOWN_MS) {
      const sec = Math.ceil((FP_COOLDOWN_MS - since) / 1000);
      return { blocked: true, reason: `กรุณารอ ${sec} วินาที ก่อนสั่งซื้อครั้งถัดไป` };
    }

    if (since < FP_HOURLY_WINDOW_MS && count >= FP_HOURLY_LIMIT) {
      return { blocked: true, reason: 'สั่งซื้อเกินจำนวนที่อนุญาตในชั่วโมงนี้ กรุณาลองใหม่ภายหลัง' };
    }

    return { blocked: false };
  } catch (e) {
    console.warn('fingerprint check failed:', e.message);
    return { blocked: false }; // fail-open: ไม่ block ถ้า Firestore อ่านไม่ได้
  }
}

// บันทึกว่าเพิ่งสั่งซื้อสำเร็จ (เพิ่ม count + อัปเดต last)
async function recordFingerprintOrder() {
  try {
    const fp = await getFingerprint();
    const ref = db.collection('rate_limits').doc(fp);
    const doc = await ref.get();
    const now = Date.now();
    const lastMs = doc.exists && doc.data().last && typeof doc.data().last.toMillis === 'function'
      ? doc.data().last.toMillis()
      : 0;
    const prevCount = doc.exists ? (doc.data().count || 0) : 0;
    // รีเซ็ต count ถ้าเกิน 1 ชม
    const newCount = (now - lastMs > FP_HOURLY_WINDOW_MS) ? 1 : prevCount + 1;

    await ref.set({
      last: firebase.firestore.FieldValue.serverTimestamp(),
      count: newCount,
    });
  } catch (e) {
    console.warn('fingerprint record failed:', e.message);
  }
}
