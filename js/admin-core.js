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
let stockMode = 'add'; // 'add' | 'reduce'
let currentAdminName = '';
const stockAccum = {}; // { itemId: { total, timer } }

let isOwner = false;
let isExternal = false;

// formatPrice() + escapeHtml() live in js/modal-alert.js (shared)

const MAX_IMAGE_SIZE = 500 * 1024; // 500KB (base64 ~680KB, safe for Firestore 1MB limit)

// ============ REUSABLE SHOP SCHEDULE ============
// ฟังก์ชันกลาง: ตรวจสอบว่าอยู่ในเวลาเปิดร้านหรือไม่ (รองรับข้ามวัน)
function checkShopHours(config) {
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours();
  const m = now.getMinutes();
  const nowMin = h * 60 + m; // นาทีปัจจุบันของวัน

  const isWeekend = day === 0 || day === 6;
  const sched = isWeekend ? config.weekend : config.weekday;
  const openParts = (sched.open || '20:00').split(':');
  const closeParts = (sched.close || '01:00').split(':');
  const openMin = parseInt(openParts[0]) * 60 + parseInt(openParts[1] || 0);
  const closeMin = parseInt(closeParts[0]) * 60 + parseInt(closeParts[1] || 0);

  if (closeMin > openMin) {
    // ปิดวันเดียวกัน เช่น 10:00 - 23:59
    return nowMin >= openMin && nowMin < closeMin;
  } else {
    // ข้ามวัน เช่น 20:00 - 01:00
    if (nowMin >= openMin) return true; // หลังเปิด (เช่น 20:00+)
    if (nowMin < closeMin) {
      // ก่อนปิด (เช่น 00:00-01:00) — เช็คว่าวันก่อนหน้ามี schedule เปิดข้ามวันด้วย
      const yesterday = (day + 6) % 7;
      const yIsWeekend = yesterday === 0 || yesterday === 6;
      const ySched = yIsWeekend ? config.weekend : config.weekday;
      const yOpenParts = (ySched.open || '20:00').split(':');
      const yCloseParts = (ySched.close || '01:00').split(':');
      const yOpenMin = parseInt(yOpenParts[0]) * 60 + parseInt(yOpenParts[1] || 0);
      const yCloseMin = parseInt(yCloseParts[0]) * 60 + parseInt(yCloseParts[1] || 0);
      // ข้ามวัน: closeMin <= openMin && nowMin < yCloseMin
      if (yCloseMin <= yOpenMin && nowMin < yCloseMin) return true;
    }
    return false;
  }
}

function getNextCloseTime(config) {
  if (!config) config = { weekday: { open: '20:00', close: '01:00' }, weekend: { open: '10:00', close: '23:59' } };
  const now = new Date();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const sched = isWeekend ? config.weekend : config.weekday;
  const closeParts = (sched.close || '01:00').split(':');
  const openParts = (sched.open || '20:00').split(':');
  const closeH = parseInt(closeParts[0]);
  const closeM = parseInt(closeParts[1] || 0);
  const openH = parseInt(openParts[0]);
  const closeMin = closeH * 60 + closeM;
  const openMin = openH * 60 + parseInt(openParts[1] || 0);

  let closeTime = new Date(now);
  if (closeMin <= openMin) {
    // ข้ามวัน: ปิดวันรุ่งขึ้น
    closeTime.setDate(closeTime.getDate() + 1);
  }
  closeTime.setHours(closeH, closeM, 0, 0);
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
        isExternal = adminData && adminData.role === 'external';

        // ลบจาก pending ถ้าค้างอยู่
        try { await db.collection('pending_users').doc(user.uid).delete(); } catch(e) {}

        modal.classList.remove('active');
        document.getElementById('adminContent').style.display = 'block';

        // ซ่อน section ตาม role
        if (!isOwner) {
          document.querySelectorAll('.owner-only').forEach(el => el.style.display = 'none');
        } else {
          const ownerBackup = document.getElementById('ownerStockBackup');
          if (ownerBackup) ownerBackup.style.display = 'flex';
          // Owner: quota badge เป็นลิงก์ไป Firebase Console
          const quotaEl = document.getElementById('quotaInfo');
          if (quotaEl) {
            quotaEl.style.cursor = 'pointer';
            quotaEl.title = 'ดู Usage ใน Firebase Console';
            quotaEl.addEventListener('click', () => window.open('https://console.firebase.google.com/project/telesrunner-afab6/usage', '_blank'));
          }
        }
        // ซ่อนปุ่ม owner-only สำหรับ external (internal เห็นหมวดหมู่ได้)
        if (isExternal) {
          const catBtn = document.getElementById('manageCategoriesBtn');
          if (catBtn) catBtn.style.display = 'none';
        }
        if (isExternal) {
          // external ซ่อน tab ตั้งค่า, ปุ่ม shop toggle, pay mode
          const settingsTab = document.querySelector('[data-tab="settings"]');
          if (settingsTab) settingsTab.style.display = 'none';
          document.getElementById('shopToggleBtn').style.display = 'none';
          document.getElementById('payModeBtn').style.display = 'none';
          document.querySelectorAll('.owner-only').forEach(el => el.style.display = 'none');
          const stockToggles = document.getElementById('adminStockToggles');
          if (stockToggles) stockToggles.style.display = 'none';
        }

        await loadAdminNames();

        const rawName = (adminData && adminData.name) || (adminData && adminData.email ? adminData.email.split('@')[0] : '') || (user.email ? user.email.split('@')[0] : 'แอดมิน');
        currentAdminName = resolveAdminName(rawName);
        if (typeof renderAdminStockToggles === 'function') renderAdminStockToggles();
        if (typeof loadAdminCategories === 'function') await loadAdminCategories();
        initSortOrder();
        if (typeof loadRevenueResetDate === 'function') await loadRevenueResetDate();
        loadOrders();
        loadProducts();
        loadBanList();
        if (typeof trackVisitor === 'function') { trackVisitor(); loadTotalCount(); }
        if (typeof loadAdminReservations === 'function') loadAdminReservations();
        listenShopToggle();
        if (typeof setupPayModeToggle === 'function') setupPayModeToggle();
        if (typeof loadCoupons === 'function') loadCoupons();
        if (typeof loadAdminRoles === 'function') loadAdminRoles();
        if (typeof loadPendingItems === 'function') loadPendingItems();
        if (typeof loadPendingDeletes === 'function') loadPendingDeletes();
        if (typeof loadCommissionTiers === 'function') loadCommissionTiers();
        if (typeof setupCommissionTiers === 'function') setupCommissionTiers();
        if (typeof loadPendingActions === 'function') loadPendingActions();
        if (typeof loadDiscordSettings === 'function') loadDiscordSettings();
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

  async function tryRegister() {
    const email = emailInput.value.trim();
    const pass = passInput.value;

    if (!email || !pass) {
      error.textContent = 'กรุณากรอก Email และรหัสผ่าน';
      error.style.display = 'block';
      return;
    }
    if (pass.length < 6) {
      error.textContent = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
      error.style.display = 'block';
      return;
    }

    const regBtn = document.getElementById('registerSubmit');
    regBtn.disabled = true;
    regBtn.textContent = 'กำลังสมัคร...';
    error.style.display = 'none';

    try {
      await firebase.auth().createUserWithEmailAndPassword(email, pass);
      // onAuthStateChanged จะจัดการ → ตรวจ admin → ถ้าไม่ใช่ → เขียน pending_users
    } catch (e) {
      let msg;
      if (e.code === 'auth/email-already-in-use') {
        msg = 'Email นี้มีบัญชีอยู่แล้ว — กรุณากด "เข้าสู่ระบบ" แทน';
      } else if (e.code === 'auth/weak-password') {
        msg = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
      } else if (e.code === 'auth/invalid-email') {
        msg = 'รูปแบบ Email ไม่ถูกต้อง';
      } else {
        msg = 'สมัครไม่สำเร็จ: ' + e.message;
      }
      error.textContent = msg;
      error.style.display = 'block';
    } finally {
      regBtn.disabled = false;
      regBtn.textContent = 'สมัครใหม่ (ขอเข้าระบบ)';
    }
  }

  btn.addEventListener('click', tryLogin);
  document.getElementById('registerSubmit').addEventListener('click', tryRegister);
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

      // ซ่อน badge เมื่อกลับมาที่ tab orders
      if (tab.dataset.tab === 'orders') {
        const badge = document.getElementById('orderNotiBadge');
        if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
      }
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
    const modals = ['pickRoleModal', 'renameCategoryModal', 'bulkAssignModal', 'categoryModal', 'addProductModal', 'addStockModal', 'stockHistoryModal', 'editProductModal', 'addCouponModal', 'shopStateModal', 'closeReasonModal', 'slipModal', 'editDisplayNameModal', 'cancelReasonModal', 'alertModal'];
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

  document.getElementById('addProductBtn').addEventListener('click', addProduct);
  document.getElementById('openAddProductBtn').addEventListener('click', openAddProductModal);
  document.getElementById('cancelAddProduct').addEventListener('click', closeAddProductModal);

  document.getElementById('confirmAddStock').addEventListener('click', confirmAddStock);
  document.getElementById('cancelAddStock').addEventListener('click', closeAddStockModal);
  document.getElementById('closeStockHistory').addEventListener('click', closeStockHistory);

  document.getElementById('confirmEditProduct').addEventListener('click', confirmEditProduct);
  document.getElementById('cancelEditProduct').addEventListener('click', closeEditProductModal);

  // Category management
  document.getElementById('manageCategoriesBtn').addEventListener('click', openCategoryModal);
  document.getElementById('closeCategoryModalBtn').addEventListener('click', closeCategoryModal);
  document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
  document.getElementById('newCategoryName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCategory();
  });
  document.getElementById('categoryList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat-action]');
    if (!btn) return;
    const action = btn.dataset.catAction;
    const index = parseInt(btn.dataset.catIndex);
    if (action === 'assign') openBulkAssignModal(index);
    else if (action === 'rename') openRenameCategoryModal(index);
    else if (action === 'delete') deleteCategory(index);
  });

  setupCategoryDrag();

  // Rename category modal
  document.getElementById('cancelRenameCategoryBtn').addEventListener('click', closeRenameCategoryModal);
  document.getElementById('confirmRenameCategoryBtn').addEventListener('click', confirmRenameCategory);
  document.getElementById('renameCategoryInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmRenameCategory();
  });

  // Bulk assign modal
  document.getElementById('cancelBulkAssignBtn').addEventListener('click', closeBulkAssignModal);
  document.getElementById('confirmBulkAssignBtn').addEventListener('click', confirmBulkAssign);

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
        // ไม่ลบ promoExpiresAt — ให้ expiry input จัดการแยก
      }

      // เตือนถ้าราคาโปร < externalCut (owner ขาดทุน)
      const externalCut = parseFloat(e.target.dataset.externalCut) || 0;
      if (externalCut > 0 && val !== '') {
        const promo = parseFloat(val);
        if (!isNaN(promo) && promo < externalCut) {
          showAlert(`ราคาโปร ${promo} ฿ ต่ำกว่าส่วนแบ่งแอดนอก ${externalCut} ฿\nOwner จะขาดทุน ${formatPrice(externalCut - promo)} ฿ ต่อชิ้น`, 'คำเตือน');
        }
      }

      db.collection('items').doc(id).update(updateData)
        .then(() => showToast(val === '' ? 'ลบราคาโปรแล้ว' : 'ตั้งราคาโปร ' + val + ' บาท'))
        .catch(err => showAlert('บันทึกไม่ได้: ' + err.message, 'ผิดพลาด'));
    }


    // Internal admin: promo request → pending_actions
    if (e.target.dataset.action === 'promo-request') {
      const id = e.target.dataset.id;
      const itemName = e.target.dataset.name;
      const val = e.target.value.trim();
      const current = e.target.dataset.current;
      if (val === current) return; // ไม่เปลี่ยน

      const newPromo = val === '' ? null : parseFloat(val);
      if (val !== '' && (isNaN(newPromo) || newPromo < 0)) return;

      const docId = 'promo_' + id;
      db.collection('pending_actions').doc(docId).set({
        type: 'promo_change', itemId: id, itemName,
        newPromo, requestedBy: currentAdminName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => {
        showToast('ส่งคำขอเปลี่ยนโปร ' + itemName + ' แล้ว รอ owner อนุมัติ');
        e.target.value = current; // revert to original
      }).catch(err => showAlert('ส่งคำขอไม่ได้: ' + err.message, 'ผิดพลาด'));
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
    else if (action === 'toggleShare') toggleShareExternal(id, btn.dataset.shared === 'true');
    else if (action === 'toggleActive') toggleItemActive(id, btn.dataset.active === 'true');
    else if (action === 'toggleMyStock') toggleMyStock(id);
    else if (action === 'edit') openEditProductModal(id, name, Number(price), image);
    else if (action === 'delete') deleteProduct(id);
  });

  // Event delegation สำหรับลบประวัติ stock ของ admin
  document.getElementById('stockHistorySummary').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="deleteAdminHistory"]');
    if (!btn) return;
    const { itemId, rawKeys, name } = btn.dataset;
    if (!await showConfirm(
      'ลบประวัติ Stock ของ "' + name + '" ในสินค้านี้?\n\n' +
      '• ประวัติ stock → ลบหมด\n' +
      '• stock รวม → หักตามจำนวนที่ ' + name + ' เคยเพิ่ม\n' +
      '• adminStock → ลบออก',
      'ยืนยันลบ'
    )) return;
    try {
      const keys = rawKeys.split('||');
      const itemRef = db.collection('items').doc(itemId);

      // อ่าน stockHistory ก่อน (ไม่สามารถ get collection ใน transaction ได้)
      const histSnap = await itemRef.collection('stockHistory').get();
      const histDocsToDelete = histSnap.docs.filter(doc => keys.includes(doc.data().addedBy || ''));

      // ใช้ transaction สำหรับ item doc เพื่อ atomic read+write stock
      const result = await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        let adminStockVal = 0;
        if (itemDoc.exists) {
          const iData = itemDoc.data();
          for (const k of keys) {
            adminStockVal += typeof getAdminStockValue === 'function'
              ? getAdminStockValue(iData.adminStock || {}, k)
              : (Number((iData.adminStock || {})[k]) || 0);
          }
        }

        // ลบ stockHistory docs ภายใน transaction
        histDocsToDelete.forEach(doc => transaction.delete(doc.ref));

        // หัก stock + ลบ adminStock ของ admin คนนี้
        if (adminStockVal > 0) {
          const currentStock = itemDoc.exists ? (Number(itemDoc.data().stock) || 0) : 0;
          const deduct = Math.min(adminStockVal, currentStock);
          const updateData = { stock: firebase.firestore.FieldValue.increment(-deduct) };
          for (const k of keys) {
            updateData['adminStock.' + k] = firebase.firestore.FieldValue.delete();
          }
          transaction.update(itemRef, updateData);
        } else {
          const updateData = {};
          for (const k of keys) {
            updateData['adminStock.' + k] = firebase.firestore.FieldValue.delete();
          }
          if (Object.keys(updateData).length > 0) transaction.update(itemRef, updateData);
        }

        return { count: histDocsToDelete.length, adminStockVal, currentStock: itemDoc.exists ? (Number(itemDoc.data().stock) || 0) : 0 };
      });

      const msg = result.adminStockVal > 0
        ? 'ลบประวัติ ' + name + ' แล้ว (' + result.count + ' รายการ) — stock หัก ' + Math.min(result.adminStockVal, result.currentStock)
        : 'ลบประวัติ ' + name + ' แล้ว (' + result.count + ' รายการ)';
      showToast(msg);
      // refresh modal
      const itemName = document.getElementById('stockHistoryModal').querySelector('h2')?.textContent?.replace('ประวัติ Stock', '').trim() || '';
      openStockHistory(itemId, itemName);
    } catch (e) { showAlert('ลบไม่ได้: ' + e.message, 'ผิดพลาด'); }
  });

  // Event delegation สำหรับ pending items (owner approve/reject)
  document.getElementById('pendingItemsPanel').addEventListener('click', (e) => {
    const approveBtn = e.target.closest('.btn-pending-approve');
    if (approveBtn) return approvePendingItem(approveBtn.dataset.pendingId);
    const rejectBtn = e.target.closest('.btn-pending-reject');
    if (rejectBtn) return rejectPendingItem(rejectBtn.dataset.pendingId);
  });

  // Event delegation สำหรับ pending deletes (owner approve/reject)
  document.getElementById('pendingDeletesPanel').addEventListener('click', (e) => {
    const approveBtn = e.target.closest('.btn-pending-approve');
    if (approveBtn) return approvePendingDelete(approveBtn.dataset.deleteId, approveBtn.dataset.itemId);
    const rejectBtn = e.target.closest('.btn-pending-reject');
    if (rejectBtn) return rejectPendingDelete(rejectBtn.dataset.deleteId);
  });

  // Event delegation สำหรับ pending actions (owner approve/reject)
  document.getElementById('pendingActionsPanel').addEventListener('click', (e) => {
    const approveBtn = e.target.closest('.btn-pending-approve');
    if (approveBtn && approveBtn.dataset.actionId) return approvePendingAction(approveBtn.dataset.actionId);
    const rejectBtn = e.target.closest('.btn-pending-reject');
    if (rejectBtn && rejectBtn.dataset.actionId) return rejectPendingAction(rejectBtn.dataset.actionId);
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
    } else if (action === 'markPaid') {
      markOrderPaid(btn.dataset.id);
    }
  });

  // Unban delegation
  document.getElementById('banList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-unban]');
    if (btn) unbanFacebook(btn.dataset.unban);
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
      if (typeof unsubShopSettings !== 'undefined' && unsubShopSettings) { unsubShopSettings(); unsubShopSettings = null; }
      if (typeof unsubAdminReservations !== 'undefined' && unsubAdminReservations) { unsubAdminReservations(); unsubAdminReservations = null; }
      if (typeof unsubPendingItems !== 'undefined' && unsubPendingItems) { unsubPendingItems(); unsubPendingItems = null; }
      if (typeof unsubPendingDeletes !== 'undefined' && unsubPendingDeletes) { unsubPendingDeletes(); unsubPendingDeletes = null; }
      if (typeof unsubPendingActions !== 'undefined' && unsubPendingActions) { unsubPendingActions(); unsubPendingActions = null; }
    } else {
      if (currentAdminName) {
        if (!unsubOrders) loadOrders();
        if (!unsubProducts) loadProducts();
        if (typeof unsubCoupons !== 'undefined' && !unsubCoupons) loadCoupons();
        if (typeof unsubBans !== 'undefined' && !unsubBans) loadBanList();
        if (typeof unsubAdmins !== 'undefined' && !unsubAdmins) loadAdminRoles();
        if (typeof unsubShopSettings !== 'undefined' && !unsubShopSettings && typeof listenShopToggle === 'function') listenShopToggle();
        if (typeof unsubAdminReservations !== 'undefined' && !unsubAdminReservations && typeof loadAdminReservations === 'function') loadAdminReservations();
        if (typeof unsubPendingItems !== 'undefined' && !unsubPendingItems && typeof loadPendingItems === 'function') loadPendingItems();
        if (typeof unsubPendingDeletes !== 'undefined' && !unsubPendingDeletes && typeof loadPendingDeletes === 'function') loadPendingDeletes();
        if (typeof unsubPendingActions !== 'undefined' && !unsubPendingActions && typeof loadPendingActions === 'function') loadPendingActions();
      }
    }
  });

  // Settings sub-tabs
  document.getElementById('settingsSubTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-tab');
    if (!btn || btn.style.display === 'none') return;
    document.querySelectorAll('#settingsSubTabs .sub-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.settab;
    document.querySelectorAll('.settings-sub').forEach(el => el.classList.remove('active'));
    const card = document.getElementById(target + 'Card');
    if (card) card.classList.add('active');
  });

});

