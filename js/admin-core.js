// ============================================
// BubbleShop - Admin Logic
// ============================================

let currentStockItemId = null;
let currentStockItemName = '';
let addImageBase64 = null;
let editImageBase64 = null;
let adminNames = [];
let adminAliasMap = {};
let unsubOrders = null; // เก็บ unsubscribe ป้องกัน duplicate listener
let unsubProducts = null;
let allProducts = [];
let draggedProductId = null;
let stockMode = 'add'; // 'add' | 'reduce'
let currentAdminName = '';
const stockAccum = {}; // { itemId: { total, timer } }

let isOwner = false;

function formatPrice(v) { const n = Number(v) || 0; return n % 1 === 0 ? n.toString() : n.toFixed(2); }

const MAX_IMAGE_SIZE = 500 * 1024; // 500KB (base64 ~680KB, safe for Firestore 1MB limit)

// ============ REUSABLE SHOP SCHEDULE ============
function getNextCloseTime() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  let closeTime = new Date(now);

  // เช็คช่วงคาบเกี่ยวของเที่ยงคืนถึงตีหนึ่ง (00:00 - 01:00) 
  // วัน อังคาร(2) - เสาร์(6) เกิดจากการที่วันก่อนหน้า (จ-ศ) เปิด 20:00 - 01:00
  if (hour === 0 && day >= 2 && day <= 6) {
      closeTime.setHours(1, 0, 0, 0);
      return closeTime;
  }

  // นอกเหนือจากนั้น
  if (day === 0 || day === 6) {
    // เสาร์-อาทิตย์ ปิด 23:59:59
    closeTime.setHours(23, 59, 59, 999);
  } else {
    // จันทร์(1) ถึง ศุกร์(5) ปิด 01:00 วันรุ่งขึ้น
    closeTime.setDate(closeTime.getDate() + 1);
    closeTime.setHours(1, 0, 0, 0);
  }
  return closeTime;
}

// ============ LOAD ADMIN NAMES FROM FIRESTORE ============
async function loadAdminNames() {
  try {
    const snap = await db.collection('admin_users').get();
    if (!snap.empty) {
      adminAliasMap = {};
      adminNames = snap.docs.map(doc => {
        const d = doc.data();
        const rawName = d.name || (d.email ? d.email.split('@')[0] : doc.id);
        // ใช้ displayName ถ้ามี ไม่งั้น fallback เป็น rawName
        const display = d.displayName || rawName;

        // map ทุก key ที่เป็นไปได้ → displayName
        if (d.email) {
          adminAliasMap[d.email] = display;
          adminAliasMap[d.email.split('@')[0]] = display;
        }
        adminAliasMap[rawName] = display;
        adminAliasMap[doc.id] = display;
        return display;
      });
      adminNames = [...new Set(adminNames)];
    }
  } catch (e) {
    console.warn('ใช้รายชื่อ admin default:', e.message);
  }
}

function resolveAdminName(raw) {
  if (!raw) return 'ไม่ระบุ';
  return adminAliasMap[raw] || raw;
}

// reverse: จากชื่อ display → หา raw keys ทั้งหมดที่ map ไปหาชื่อนี้
function getAdminAliases(displayName) {
  const aliases = [displayName];
  for (const [key, val] of Object.entries(adminAliasMap)) {
    if (val === displayName && key !== displayName) aliases.push(key);
  }
  return aliases;
}

function renderAdminOptions(selectedValue) {
  return '<option value="">-- เลือกแอดมิน --</option>' +
    adminNames.map(name =>
      `<option value="${escapeHtml(name)}" ${name === selectedValue ? 'selected' : ''}>${escapeHtml(name)}</option>`
    ).join('');
}

// ============ FIREBASE AUTH LOGIN ============
function setupLogin() {
  const modal = document.getElementById('passwordModal');
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const btn = document.getElementById('passwordSubmit');
  const error = document.getElementById('passwordError');

  // ถ้า login อยู่แล้ว เช็คสิทธิ์ Admin
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      try {
        // ทดสอบอ่าน admin_users เพื่อเช็ค firestore rules ว่าผ่านไหม
        const adminCheck = await db.collection('admin_users').doc(user.uid).get();
        // ถ้าไม่ error แปลว่าเป็น Admin แน่นอน

        let adminData = adminCheck.exists ? adminCheck.data() : null;

        // ถ้าผ่าน rules แต่ยังไม่มี doc ใน admin_users → เป็น master admin จาก rules, สร้าง doc ให้เลย
        if (!adminCheck.exists) {
          const rawName = user.email ? user.email.split('@')[0] : 'owner';
          const ownerData = { email: user.email, name: rawName, displayName: rawName, role: 'owner', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
          await db.collection('admin_users').doc(user.uid).set(ownerData);
          adminData = ownerData;
        }

        isOwner = adminData && adminData.role === 'owner';

        // ลบจาก pending ถ้าค้างอยู่
        try { await db.collection('pending_users').doc(user.uid).delete(); } catch(e) {}

        modal.classList.remove('active');
        document.getElementById('adminContent').style.display = 'block';

        // ซ่อน tab ที่เฉพาะ owner
        if (!isOwner) {
          document.querySelectorAll('[data-tab="coupons"],[data-tab="admins"]').forEach(el => el.style.display = 'none');
        } else {
          const ownerActions = document.getElementById('ownerStockActions');
          if (ownerActions) ownerActions.style.display = 'flex';
        }

        await loadAdminNames();

        const rawName = (adminData && adminData.name) || (adminData && adminData.email ? adminData.email.split('@')[0] : '') || (user.email ? user.email.split('@')[0] : 'แอดมิน');
        currentAdminName = resolveAdminName(rawName);
        if (typeof renderAdminStockToggles === 'function') renderAdminStockToggles();
        initSortOrder();
        if (typeof loadRevenueResetDate === 'function') await loadRevenueResetDate();
        loadOrders();
        loadProducts();
        loadBanList();
        listenShopToggle();
        if (typeof loadCoupons === 'function') loadCoupons();
        if (typeof loadAdminRoles === 'function') loadAdminRoles();
      } catch (err) {
        // Permission Denied แปลว่าไม่ใช่แอดมิน
        console.warn('Not an admin:', err.message);
        
        // บันทึกตัวเองลง pending_users
        try {
          await db.collection('pending_users').doc(user.uid).set({
            email: user.email || 'ไม่มีอีเมล',
            name: user.displayName || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch(e) { console.error('Failed to log pending user', e); }
        
        await firebase.auth().signOut();
        showAlert('บัญชีนี้ยังไม่ได้รับสิทธิ์แอดมิน\n(ส่งคำขอเข้าระบบแล้ว รอเจ้าของร้านอนุมัติในหน้าบัญชีแอดมิน)', 'ไม่มีสิทธิ์เข้าถึง');
        location.reload();
      }
    }
  });

  async function tryLogin() {
    const email = emailInput.value.trim();
    const pass = passInput.value;

    if (!email || !pass) {
      error.textContent = 'กรุณากรอก Email และรหัสผ่าน';
      error.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'กำลังตรวจสอบ...';
    error.style.display = 'none';

    try {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
      // onAuthStateChanged จะจัดการเปิดหน้า admin เอง
    } catch (e) {
      const msg = e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential'
        ? 'Email หรือรหัสผ่านไม่ถูกต้อง'
        : 'เข้าสู่ระบบไม่ได้: ' + e.message;
      error.textContent = msg;
      error.style.display = 'block';
      passInput.value = '';
      passInput.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'เข้าสู่ระบบ';
    }
  }

  btn.addEventListener('click', tryLogin);
  passInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') tryLogin();
  });
}

// ============ INIT SORT ORDER (ให้ item เก่าที่ยังไม่มี sortOrder) ============
async function initSortOrder() {
  try {
    const snapshot = await db.collection('items').orderBy('createdAt', 'asc').get();
    const batch = db.batch();
    let needsUpdate = false;
    snapshot.docs.forEach((doc, index) => {
      if (doc.data().sortOrder == null) {
        batch.update(doc.ref, { sortOrder: index });
        needsUpdate = true;
      }
    });
    if (needsUpdate) await batch.commit();
  } catch (e) {
    console.warn('initSortOrder:', e.message);
  }
}

// ============ TABS ============
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      document.getElementById(tab.dataset.tab + 'Section').classList.add('active');
    });
  });
}

// ============ FIELD ERROR HELPERS ============
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

// ============ ESCAPE KEY FOR MODALS ============
function setupEscapeKey() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modals = ['addProductModal', 'addStockModal', 'stockHistoryModal', 'editProductModal', 'addCouponModal', 'shopStateModal', 'closeReasonModal', 'slipModal', 'editDisplayNameModal', 'cancelReasonModal', 'alertModal'];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('active')) {
        el.classList.remove('active');
        break;
      }
    }
  });
}

// ============ MANUAL REFRESH (Quota Saving Mode) ============
function manualRefresh() {
  showToast('กำลังโหลดข้อมูลใหม่...');
  if (typeof loadOrders === 'function') loadOrders();
  if (typeof loadProducts === 'function') loadProducts();
  if (typeof renderOfflineQueue === 'function') renderOfflineQueue();
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  setupLogin();
  setupTabs();
  setupEscapeKey();

  // Image upload areas
  setupImageUploadArea('addImageUploadArea', 'pImage', 'addImagePreview', 'addImageUploadText', (b64) => { addImageBase64 = b64; });
  setupImageUploadArea('editImageUploadArea', 'editImage', 'editImagePreview', 'editImageUploadText', (b64) => { editImageBase64 = b64; });

  setupProductDrag();

  document.getElementById('addProductBtn').addEventListener('click', addProduct);
  document.getElementById('openAddProductBtn').addEventListener('click', openAddProductModal);
  document.getElementById('cancelAddProduct').addEventListener('click', closeAddProductModal);

  document.getElementById('confirmAddStock').addEventListener('click', confirmAddStock);
  document.getElementById('cancelAddStock').addEventListener('click', closeAddStockModal);
  document.getElementById('closeStockHistory').addEventListener('click', closeStockHistory);

  document.getElementById('confirmEditProduct').addEventListener('click', confirmEditProduct);
  document.getElementById('cancelEditProduct').addEventListener('click', closeEditProductModal);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await firebase.auth().signOut();
    location.reload();
  });
  
  // COUPON & SLIP MODAL CLOSE BUTTONS
  document.getElementById('cancelAddCouponBtn').addEventListener('click', () => {
    document.getElementById('addCouponModal').classList.remove('active');
  });
  document.getElementById('closeSlipModalBtn').addEventListener('click', () => {
    document.getElementById('slipModal').classList.remove('active');
  });
  document.getElementById('cancelDeliverBtn').addEventListener('click', closeDeliverModal);
  document.getElementById('confirmDeliverBtn').addEventListener('click', confirmDeliver);

  // COUPON DOM EVENTS
  document.getElementById('openAddCouponBtn').addEventListener('click', () => {
    document.getElementById('cCode').value = '';
    document.getElementById('cValue').value = '';
    document.getElementById('cMinAmount').value = '';
    document.getElementById('cMaxUses').value = '';
    document.getElementById('cLimitNew').checked = false;
    document.getElementById('addCouponModal').classList.add('active');
  });

  document.getElementById('confirmAddCouponBtn').addEventListener('click', async () => {
    const btn = document.getElementById('confirmAddCouponBtn');
    const code = document.getElementById('cCode').value.trim().toUpperCase();
    const type = document.getElementById('cType').value;
    const val = parseInt(document.getElementById('cValue').value);
    const minAmt = parseInt(document.getElementById('cMinAmount').value) || 0;
    const maxUses = parseInt(document.getElementById('cMaxUses').value) || 0;
    const limitNew = document.getElementById('cLimitNew').checked;

    if (!code || !val) { showAlert('กรุณากรอกรหัสคูปอง และมูลค่าส่วนลด'); return; }
    if (!/^[A-Z0-9]+$/.test(code)) { showAlert('รหัสคูปองใช้ได้เฉพาะตัวอักษรภาษาอังกฤษและตัวเลขเท่านั้น'); return; }

    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';
    try {
      const docRef = db.collection('coupons').doc(code);
      const snap = await docRef.get();
      if (snap.exists) { showAlert('รหัสคูปองซ้ำ มีในระบบแล้ว'); return; }

      await docRef.set({
        type,
        value: val,
        minAmount: minAmt,
        maxUses,
        usedCount: 0,
        limitNewCustomer: limitNew,
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.getElementById('addCouponModal').classList.remove('active');
      showToast('สร้างคูปอง ' + code + ' เรียบร้อย');
    } catch (e) {
      showAlert('สร้างคูปองไม่ได้: ' + e.message, 'ผิดพลาด');
    } finally {
      btn.disabled = false;
      btn.textContent = 'บันทึก';
    }
  });
  
  // PROMPTPAY EVENT
  document.getElementById('savePPBtn').addEventListener('click', async () => {
    const btn = document.getElementById('savePPBtn');
    const input = document.getElementById('ppInputSetting').value.trim().replace(/[-\s]/g, '');
    if (!input) { showAlert("กรุณากรอกเบอร์/พร้อมเพย์ ก่อนกดบันทึก"); return; }
    if (!/^\d{10}$/.test(input) && !/^\d{13}$/.test(input)) { showAlert("เลขพร้อมเพย์ต้องเป็นเบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก"); return; }
    btn.disabled = true;
    btn.textContent = "กำลังบันทึก";
    try {
      await db.collection('settings').doc('shop').set({ promptpay: input }, { merge: true });
      document.getElementById('ppCurrentDisplay').textContent = '✅ ใช้อยู่: ' + input;
      showToast("บันทึกบัญชีรับเงินเรียบร้อย");
    } finally {
       btn.disabled = false;
       btn.textContent = "บันทึก";
    }
  });

  const loadMoreBtn = document.getElementById('loadMoreOrdersBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      currentOrderLimit += 30;
      loadOrders();
    });
  }

  // Promo price: save on change
  document.getElementById('productTableBody').addEventListener('change', (e) => {
    if (e.target.dataset.action === 'promo') {
      const id = e.target.dataset.id;
      const val = e.target.value.trim();
      
      const updateData = {};
      if (val === '') {
        updateData.promoPrice = firebase.firestore.FieldValue.delete();
        updateData.promoExpiresAt = firebase.firestore.FieldValue.delete();
      } else {
        const promo = parseFloat(val);
        if (isNaN(promo) || promo < 0) return;
        updateData.promoPrice = promo;
        // ตั้งเวลาหมดอายุตรงกับเวลาร้านปิด
        updateData.promoExpiresAt = firebase.firestore.Timestamp.fromDate(getNextCloseTime());
      }

      db.collection('items').doc(id).update(updateData)
        .then(() => showToast(val === '' ? 'ลบราคาโปรแล้ว' : 'ตั้งราคาโปร ' + val + ' บาท (24 ชม.)'))
        .catch(err => showAlert('บันทึกไม่ได้: ' + err.message, 'ผิดพลาด'));
    }
  });

  // Event delegation สำหรับปุ่มในตารางสินค้า
  document.getElementById('productTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, name, price, image } = btn.dataset;
    if (action === 'addStock') {
      const bq = (allProducts.find(p => p.id === id) || {}).bundleQty || 1;
      currentAdminName ? quickStockAdjust(id, name, bq) : openAddStockModal(id, name, 'add');
    } else if (action === 'reduceStock') {
      const bq = (allProducts.find(p => p.id === id) || {}).bundleQty || 1;
      currentAdminName ? quickStockAdjust(id, name, -bq) : openAddStockModal(id, name, 'reduce');
    } else if (action === 'stockHistory') openStockHistory(id, name);
    else if (action === 'toggleActive') toggleItemActive(id, btn.dataset.active === 'true');
    else if (action === 'edit') openEditProductModal(id, name, Number(price), image);
    else if (action === 'delete') deleteProduct(id);
  });

  // Event delegation สำหรับ order board
  document.getElementById('orderBoard').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'deliver') {
      openDeliverModal(btn.dataset.id);
    } else if (action === 'cancel') {
      showConfirm('ยกเลิก order นี้? stock จะถูกคืนอัตโนมัติ', 'ยืนยันยกเลิก').then(yes => {
        if (yes) cancelOrder(btn.dataset.id);
      });
    } else if (action === 'ban') {
      blockFacebook(btn.dataset.fb);
    } else if (action === 'deleteOrder') {
      deleteOrder(btn.dataset.id);
    }
  });

  // Unban delegation
  document.getElementById('banList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-unban]');
    if (btn) unbanFacebook(btn.dataset.unban);
  });

  // ปิด modal เมื่อกดพื้นหลัง
  ['addProductModal', 'addStockModal', 'stockHistoryModal', 'editProductModal', 'addCouponModal', 'shopStateModal', 'closeReasonModal', 'slipModal', 'editDisplayNameModal', 'deliverModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target.id === id) {
        document.getElementById(id).classList.remove('active');
      }
    });
  });

  // จัดการการพับจอ (Page Visibility) เพื่อประหยัดโควต้า
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (unsubOrders) { unsubOrders(); unsubOrders = null; }
      if (unsubProducts) { unsubProducts(); unsubProducts = null; }
      if (typeof unsubCoupons !== 'undefined' && unsubCoupons) { unsubCoupons(); unsubCoupons = null; }
      if (typeof unsubBans !== 'undefined' && unsubBans) { unsubBans(); unsubBans = null; }
      if (typeof unsubAdmins !== 'undefined' && unsubAdmins) { unsubAdmins(); unsubAdmins = null; }
      if (typeof unsubPendingAdmins !== 'undefined' && unsubPendingAdmins) { unsubPendingAdmins(); unsubPendingAdmins = null; }
      if (typeof unsubAdminStock !== 'undefined' && unsubAdminStock) { unsubAdminStock(); unsubAdminStock = null; }
    } else {
      if (currentAdminName) {
        if (!unsubOrders) loadOrders();
        if (!unsubProducts) loadProducts();
        if (typeof unsubCoupons !== 'undefined' && !unsubCoupons) loadCoupons();
        if (typeof unsubBans !== 'undefined' && !unsubBans) loadBanList();
        if (typeof unsubAdmins !== 'undefined' && !unsubAdmins) loadAdminRoles();
      }
    }
  });

  // loadCoupons ถูกเรียกผ่าน setupLogin > onAuthStateChanged แล้ว (ไม่ต้องเรียกซ้ำ)

});
