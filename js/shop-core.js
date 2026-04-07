// ============================================
// BubbleShop - Frontend Logic
// ============================================

// Helpers
function formatPrice(v) {
  const n = Number(v) || 0;
  return n % 1 === 0 ? n.toString() : n.toFixed(2);
}
function isPromoValid(item) {
  if (item.promoPrice == null) return false;
  if (item.promoExpiresAt) {
    return Date.now() < item.promoExpiresAt.toMillis();
  }
  return true;
}
function getPrice(item) {
  return isPromoValid(item) ? Number(item.promoPrice) : Number(item.price);
}

// Promo Countdown — global function เรียกได้จากทุกที่
function updatePromoCountdowns() {
  document.querySelectorAll(".promo-countdown").forEach((el) => {
    const expiresText = el.getAttribute("data-expires");
    if (!expiresText) return;
    const remain = parseInt(expiresText, 10) - Date.now();
    if (remain <= 0) {
      el.textContent = "⏱ หมดโปรโมชั่นแล้วครับ";
      el.style.color = "#ff4444";
    } else {
      const h = Math.floor(remain / (1000 * 60 * 60)).toString().padStart(2, "0");
      const m = Math.floor((remain % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, "0");
      const s = Math.floor((remain % (1000 * 60)) / 1000).toString().padStart(2, "0");
      el.textContent = `⏰ โปรเหลือเวลา: ${h}:${m}:${s}`;
    }
  });
}

// State
let items = [];
let cart = {}; // { itemId: { item, qty } }
let currentItem = null;
let currentQty = 1;
let shopOpen = true;
let customerPayMode = 'order'; // 'pay' = โอนเลย, 'order' = สั่งก่อน
let currentPage = 1;
const ITEMS_PER_PAGE = 12;
let customerSlipAttach = true; // แนบสลิปหรือไม่
let adminPayMode = 'both'; // 'both' | 'pay_only' | 'order_only'
let currentCategory = 'all';
let categoriesList = []; // { id, name, order }

// Payment & Coupon State
let currentPromptPay = "0834405857"; // เปลี่ยนเบอร์พร้อมเพย์รับเงินตรงนี้
let appliedCoupon = null;
let slipImageBase64 = null;
const MAX_SLIP_SIZE = 200 * 1024; // 200KB limit for slip

// ============ LOAD ITEMS (Real-time) ============
function loadItems() {
  const grid = document.getElementById("itemGrid");
  grid.innerHTML =
    '<p style="grid-column:1/-1;text-align:center;color:#aaa;">กำลังโหลดสินค้า...</p>';

  const itemsQuery = db.collection("items").orderBy("createdAt", "asc");

  // Quota saving mode → ใช้ .get() ครั้งเดียว
  if (_quotaSaving) {
    itemsQuery.get().then(snapshot => processItemsSnapshot(snapshot)).catch(e => {
      console.error("โหลดสินค้าไม่ได้:", e);
      if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadItems');
    });
    return;
  }

  window.unsubItems = itemsQuery.onSnapshot(
      (snapshot) => processItemsSnapshot(snapshot),
      (e) => {
        console.error("โหลดสินค้าไม่ได้:", e);
        if (typeof handleQuotaError === 'function') handleQuotaError(e, 'loadItems');
        grid.innerHTML =
          '<p style="color:#ff6b6b;grid-column:1/-1;text-align:center;">ไม่สามารถโหลดสินค้าได้ กรุณาลองใหม่</p>';
      },
    );
}

function processItemsSnapshot(snapshot) {
  const prevItems = items;
  items = snapshot.docs
    .map((doc) => {
      const d = { id: doc.id, ...doc.data() };
      if ((Number(d.stock) || 0) < 0) d.stock = 0; // safety net: ไม่แสดง stock ติดลบ
      return d;
    })
    .filter((item) => item.active !== false);
  items.sort((a, b) => {
    const aAvail = typeof getAvailableStock === "function" ? getAvailableStock(a) : Number(a.stock) || 0;
    const bAvail = typeof getAvailableStock === "function" ? getAvailableStock(b) : Number(b.stock) || 0;
    const aOut = aAvail <= 0 ? 1 : 0;
    const bOut = bAvail <= 0 ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut; // ของหมดอยู่ล่าง
    return (Number(b.soldCount) || 0) - (Number(a.soldCount) || 0); // ขายดีอยู่บน
  });

  if (prevItems.length > 0) {
    const changed = [];
    for (const newItem of items) {
      const old = prevItems.find((i) => i.id === newItem.id);
      if (old && newItem.stock < old.stock) {
        const oldAdj = old._adminAdjust ? old._adminAdjust.seconds : 0;
        const newAdj = newItem._adminAdjust ? newItem._adminAdjust.seconds : 0;
        if (newAdj !== oldAdj) continue;
        changed.push({ name: newItem.name, qty: old.stock - newItem.stock, image: newItem.image });
      }
    }
    if (changed.length > 0) {
      const entry = { changed, time: Date.now() };
      saveToastToStorage(entry);
      showChangedToast(changed);
    }
  }

  renderItems();

  for (const [id, entry] of Object.entries(cart)) {
    const fresh = items.find((i) => i.id === id);
    if (fresh) {
      entry.item.stock = fresh.stock;
      entry.item.price = fresh.price;
      entry.item.promoPrice = fresh.promoPrice ?? null;
      entry.item.promoExpiresAt = fresh.promoExpiresAt ?? null;
    }
  }
  renderCart();

  if (document.getElementById("summaryModal").classList.contains("active")) {
    refreshSummary();
  }
}

// Manual refresh สำหรับ quota saving mode
function manualRefresh() {
  showToast('กำลังโหลดข้อมูลใหม่...');
  loadItems();
  if (typeof loadStats === 'function') loadStats();
  // admin functions
  if (typeof loadOrders === 'function') loadOrders();
  if (typeof loadProducts === 'function') loadProducts();
}

// ============ LOAD STATS ============
function loadStats() {
  if (_quotaSaving) {
    db.collection("stats").doc("sales").get().then(doc => {
      if (doc.exists) {
        const el = document.getElementById("completedOrderCount");
        if (el) el.textContent = (doc.data().completedCount || 0).toLocaleString();
      }
    }).catch(() => {});
    return;
  }
  window.unsubStats = db
    .collection("stats")
    .doc("sales")
    .onSnapshot((doc) => {
      if (doc.exists) {
        const el = document.getElementById("completedOrderCount");
        if (el)
          el.textContent = (doc.data().completedCount || 0).toLocaleString();
      }
    });
}

// ============ BUNDLE HELPER ============
function getBundleQty(item) {
  return Number(item.bundleQty) || 1;
}
function getBundleCount(stock, bundleQty) {
  return Math.floor(stock / bundleQty);
}

// ============ RENDER ITEMS ============
function renderItems() {
  const grid = document.getElementById("itemGrid");
  const totalEl = document.getElementById("totalItems");
  const pagination = document.getElementById("shopPagination");

  // filter ตาม category tab
  const filtered = currentCategory === 'all'
    ? items
    : items.filter(item => Array.isArray(item.categories) && item.categories.includes(currentCategory));

  const inStockCount = filtered.filter(item => {
    const avail = typeof getAvailableStock === "function" ? getAvailableStock(item) : Number(item.stock) || 0;
    return avail > 0;
  }).length;
  totalEl.textContent = `TOTAL ${inStockCount} ITEMS`;

  if (filtered.length === 0) {
    grid.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:#aaa;">ยังไม่มีสินค้า</p>';
    if (pagination) pagination.style.display = 'none';
    return;
  }

  // Pagination
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);

  grid.innerHTML = pageItems
    .map((item) => {
      const available =
        typeof getAvailableStock === "function"
          ? getAvailableStock(item)
          : Number(item.stock) || 0;
      const reserved =
        typeof getReservedQty === "function" ? getReservedQty(item.id) : 0;
      const bq = getBundleQty(item);
      const bundleCount = getBundleCount(available, bq);
      const outOfStock = bundleCount <= 0;
      const priceUnit = bq > 1 ? 'ชุดละ' : 'ชิ้นละ';
      const unitPrice = getPrice(item) * bq;
      return `
      <div class="item-card ${outOfStock ? "out-of-stock" : ""}"
           data-id="${item.id}">
        <div class="stock-badge">${bq > 1 ? `${bundleCount} ชุด` : `x${available}`}</div>
        ${reserved > 0 ? `<div class="reserved-badge" data-reserve-item="${item.id}">${reserved} จอง</div>` : ""}
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text fill=%22%23999%22 x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2212%22>No Image</text></svg>'">
        <div class="item-name">${escapeHtml(item.name)}${bq > 1 ? ` <span style="color:#ff9800;font-size:12px;">(ชุดละ ${bq} ชิ้น)</span>` : ''}</div>
        <div class="item-price">
          ${
            isPromoValid(item)
              ? `<div class="promo-countdown" data-expires="${item.promoExpiresAt ? item.promoExpiresAt.toMillis() : ""}"></div>
               <span class="original-price">${priceUnit} ${formatPrice(item.price * bq)} บาท</span> <span class="promo-price">${priceUnit} ${formatPrice(item.promoPrice * bq)} บาท</span>`
              : `${priceUnit} ${formatPrice(unitPrice)} บาท`
          }
        </div>
      </div>
    `;
    })
    .join("");

  // Pagination controls
  if (pagination) {
    if (totalPages > 1) {
      pagination.style.display = 'flex';
      document.getElementById('pageInfo').textContent = `${currentPage} / ${totalPages}`;
      document.getElementById('prevPageBtn').disabled = currentPage <= 1;
      document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
    } else {
      pagination.style.display = 'none';
    }
  }

  // อัปเดต countdown ทันทีหลัง render (ไม่ต้องรอ interval)
  updatePromoCountdowns();
}

// ============ TAB SWITCHING ============
function setupTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.tab;
      document.getElementById("shopSection").style.display = target === "shop" ? "block" : "none";
      document.getElementById("categoryTabs").style.display = target === "shop" ? "flex" : "none";
      document.getElementById("historySubTabs").style.display = target === "history" ? "flex" : "none";
      document.getElementById("rightColumn").style.display = target === "shop" ? "" : "none";

      // ซ่อน history/feed ก่อน แล้วให้ sub-tab จัดการ
      if (target === "history") {
        // default เปิด "ประวัติสั่ง"
        const subTabs = document.querySelectorAll('#historySubTabs .sub-tab');
        subTabs.forEach(t => t.classList.toggle('active', t.dataset.historytab === 'orders'));
        document.getElementById("historySection").classList.add("active");
        document.getElementById("feedSection").style.display = "none";
      } else {
        document.getElementById("historySection").classList.remove("active");
        document.getElementById("feedSection").style.display = "none";
      }
    });
  });
}

// ============ HISTORY SUB-TABS ============
function setupHistorySubTabs() {
  document.getElementById('historySubTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-tab');
    if (!btn) return;
    document.querySelectorAll('#historySubTabs .sub-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const target = btn.dataset.historytab;
    document.getElementById("historySection").classList.toggle("active", target === "orders");
    document.getElementById("feedSection").style.display = target === "feed" ? "block" : "none";
    if (target === "feed" && typeof loadFeed === "function") loadFeed();
  });
}

// ============ CATEGORY TABS ============
function loadCategories() {
  const processDoc = (doc) => {
    categoriesList = (doc.exists && Array.isArray(doc.data().list)) ? doc.data().list : [];
    categoriesList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    renderCategoryTabs();
  };

  if (_quotaSaving) {
    db.collection("settings").doc("categories").get().then(processDoc).catch(() => {});
  } else {
    if (window.unsubCategories) { window.unsubCategories(); window.unsubCategories = null; }
    window.unsubCategories = db.collection("settings").doc("categories").onSnapshot(processDoc, () => {});
  }
}

function renderCategoryTabs() {
  const container = document.getElementById('categoryTabs');
  let html = '<button class="sub-tab active" data-category="all">ทั้งหมด</button>';
  categoriesList.forEach(cat => {
    html += `<button class="sub-tab" data-category="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</button>`;
  });
  container.innerHTML = html;
  currentCategory = 'all';
}

function setupCategoryTabs() {
  document.getElementById('categoryTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-tab');
    if (!btn) return;
    document.querySelectorAll('#categoryTabs .sub-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.category;
    currentPage = 1;
    renderItems();
  });
}

// ============ ESCAPE KEY FOR MODALS ============
function setupEscapeKey() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const modals = ["summaryModal", "itemModal", "successModal", "alertModal"];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (el && el.classList.contains("active")) {
        el.classList.remove("active");
        break;
      }
    }
  });
}

// ============ SHOP HOURS ============
function updateShopHours() {
  const el = document.getElementById("shopHoursStatus");
  if (!el) return;
  const now = new Date();
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;

  // ใช้ shopOpen (รวม force_open/force_close/auto แล้ว) แทน isWithinShopHours ตรงๆ
  if (shopOpen) {
    if (currentShopState === "force_open") {
      el.textContent = "ร้านเปิดอยู่";
    } else {
      el.textContent = "ร้านเปิดอยู่";
    }
    el.className = "shop-hours-status open";
  } else {
    if (currentShopState === "force_close") {
      el.textContent = "ร้านปิดอยู่ (แอดมินปิดร้าน)";
    } else {
      el.textContent = isWeekend
        ? "ร้านปิดอยู่ — เปิด 10:00 น."
        : "ร้านปิดอยู่ — เปิด 20:00 น.";
    }
    el.className = "shop-hours-status closed";
  }
}

// ============ EVENT LISTENERS ============
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupHistorySubTabs();
  setupCategoryTabs();
  loadCategories();
  setupEscapeKey();
  setupPaymentModeToggle();
  loadItems();
  loadStats();
  loadBlocklist();
  loadReservations();

  // จัดการการพับจอ (Page Visibility) เพื่อประหยัดโควต้า
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (window.unsubItems) { window.unsubItems(); window.unsubItems = null; }
      if (window.unsubStats) { window.unsubStats(); window.unsubStats = null; }
      if (window.unsubReservations) { window.unsubReservations(); window.unsubReservations = null; }
      if (window.unsubShopStatus) { window.unsubShopStatus(); window.unsubShopStatus = null; }
      if (window.unsubCategories) { window.unsubCategories(); window.unsubCategories = null; }
      _stopHeartbeat();
    } else {
      if (!window.unsubItems) loadItems();
      if (!window.unsubStats) loadStats();
      if (!window.unsubReservations) loadReservations();
      if (!window.unsubShopStatus) listenShopStatus();
      if (!window.unsubCategories) loadCategories();
      if (Object.keys(cart).length > 0) syncReservation();
    }
  });
  listenShopStatus();
  restoreToasts();
  updateShopHours();
  setInterval(updateShopHours, 60000);

  // Pagination
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderItems(); }
  });
  document.getElementById('nextPageBtn').addEventListener('click', () => {
    currentPage++; renderItems();
  });

  // Promo Countdown Loop (function อยู่ global แล้ว)
  setInterval(updatePromoCountdowns, 1000);
  // Reservation Countdown Loop
  setInterval(updateReservationCountdowns, 1000);

  // Item modal
  document.getElementById("qtyMinus").addEventListener("click", () => {
    if (!currentItem) return;
    if (currentQty > 1) {
      currentQty--;
      const bq = getBundleQty(currentItem);
      const inCart = cart[currentItem.id] ? cart[currentItem.id].qty : 0;
      updateQtyDisplay(getBundleCount(currentItem.stock - inCart * bq, bq));
    }
  });

  document.getElementById("qtyPlus").addEventListener("click", () => {
    if (!currentItem) return;
    const bq = getBundleQty(currentItem);
    const inCart = cart[currentItem.id] ? cart[currentItem.id].qty : 0;
    const maxQty = getBundleCount(currentItem.stock - inCart * bq, bq);
    if (currentQty < maxQty) {
      currentQty++;
      updateQtyDisplay(maxQty);
    }
  });

  document.getElementById("qtyDisplay").addEventListener("input", () => {
    if (!currentItem) return;
    const qtyInput = document.getElementById("qtyDisplay");
    const rawVal = qtyInput.value;
    // ปล่อยให้ช่องว่างได้ (ยังพิมพ์ไม่เสร็จ)
    if (rawVal === '') {
      currentQty = 1;
      const bq = getBundleQty(currentItem);
      document.getElementById("modalTotalPrice").textContent =
        `${formatPrice(getPrice(currentItem) * bq)} บาท`;
      return;
    }
    const bq = getBundleQty(currentItem);
    const inCart = cart[currentItem.id] ? cart[currentItem.id].qty : 0;
    const maxQty = getBundleCount(currentItem.stock - inCart * bq, bq);
    let val = parseInt(rawVal) || 1;
    if (val < 1) val = 1;
    if (val > maxQty) val = maxQty;
    currentQty = val;
    updateQtyDisplay(maxQty);
  });

  document.getElementById("modalConfirm").addEventListener("click", addToCart);
  document
    .getElementById("modalCancel")
    .addEventListener("click", closeItemModal);

  // Summary modal
  document
    .getElementById("summaryBtn")
    .addEventListener("click", openSummaryModal);
  document
    .getElementById("summaryCancel")
    .addEventListener("click", closeSummaryModal);
  document
    .getElementById("summaryConfirm")
    .addEventListener("click", submitOrder);

  // Slip Upload Listener
  document
    .getElementById("slipUpload")
    .addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) {
        slipImageBase64 = null;
        document.getElementById("slipPreview").style.display = "none";
        return;
      }
      const errEl = document.getElementById("slipUploadError");
      errEl.textContent = "";

      const reader = new FileReader();
      reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          let quality = 0.8;
          let dataUrl = canvas.toDataURL("image/jpeg", quality);
          while (dataUrl.length > MAX_SLIP_SIZE && quality > 0.1) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }
          if (dataUrl.length > MAX_SLIP_SIZE) {
            errEl.textContent =
              "รูปสลิปใหญ่เกินไปแบบผิดปกติ กรุณาลดขนาดภาพก่อน";
            slipImageBase64 = null;
            document.getElementById("slipPreview").style.display = "none";
            return;
          }
          slipImageBase64 = dataUrl;
          const preview = document.getElementById("slipPreview");
          preview.src = dataUrl;
          preview.style.display = "block";
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });

  // Coupon Apply
  document
    .getElementById("applyCouponBtn")
    .addEventListener("click", async () => {
      const code = document
        .getElementById("inputCoupon")
        .value.trim()
        .toUpperCase();
      const errEl = document.getElementById("couponError");
      if (!code) {
        errEl.textContent = "กรุณากรอกโค้ดก่อนครับ";
        return;
      }

      let rawTotal = 0;
      Object.values(cart).forEach(({ item, qty }) => {
        const bq = getBundleQty(item);
        rawTotal += getPrice(item) * qty * bq;
      });

      errEl.textContent = "กำลังตรวจสอบโค้ด...";
      errEl.style.color = "#aaa";
      try {
        const doc = await db.collection("coupons").doc(code).get({ source: 'server' }).catch(() => db.collection("coupons").doc(code).get());
        if (!doc.exists) throw new Error("ไม่พบโค้ดส่วนลดนี้");

        const c = doc.data();
        if (c.active === false) throw new Error("โค้ดนี้ถูกปิดการใช้งานแล้ว");
        if (c.maxUses > 0 && (c.usedCount || 0) >= c.maxUses)
          throw new Error("โค้ดนี้ถูกใช้ครบโควต้าแล้ว");
        if (c.minAmount > 0 && rawTotal < c.minAmount)
          throw new Error(`โค้ดนี้ต้องมียอดซื้อขั้นต่ำ ${c.minAmount} บาท`);

        const charName = document.getElementById("inputCharName").value.trim();
        if (c.limitNewCustomer) {
          if (!charName)
            throw new Error(
              "กรุณากรอก 'ชื่อตัวละคร' ก่อนกดใช้โค้ด (คูปองนี้สงวนสิทธิ์สำหรับลูกค้าใหม่เท่านั้น)",
            );
          const oSnap = await db
            .collection("orders")
            .where("characterName", "==", charName)
            .where("status", "in", ["completed", "pending"])
            .limit(1)
            .get();
          if (!oSnap.empty)
            throw new Error(
              "ลูกค้านี้มีประวัติสั่งซื้อแล้ว ไม่สามารถใช้โค้ดสำหรับลูกค้าใหม่ได้",
            );
        }

        appliedCoupon = { id: doc.id, ...c };
        errEl.textContent = "✅ โค้ดใช้งานได้!";
        errEl.style.color = "#4CAF50";
        document.getElementById("cancelCouponBtn").style.display = "";
        document.getElementById("applyCouponBtn").style.display = "none";
        document.getElementById("inputCoupon").readOnly = true;

        let disc = 0;
        if (c.type === "percent") disc = rawTotal * (c.value / 100);
        else disc = parseInt(c.value);

        let finalTotal = rawTotal - disc;
        if (finalTotal < 0) finalTotal = 0;

        const ogEl = document.getElementById("summaryOriginalPrice");
        ogEl.textContent = `ราคาปกติ ${formatPrice(rawTotal)} บาท`;
        ogEl.style.display = "block";

        document.getElementById("summaryTotalPrice").textContent =
          `${formatPrice(finalTotal)} บาท`;
        document.getElementById("qrCodeImg").src =
          `https://promptpay.io/${currentPromptPay}/${finalTotal}.png`;
      } catch (e) {
        errEl.textContent = "❌ " + e.message;
        errEl.style.color = "#f44336";
        appliedCoupon = null;
        document.getElementById("summaryOriginalPrice").style.display = "none";
        document.getElementById("summaryTotalPrice").textContent =
          `${formatPrice(rawTotal)} บาท`;
        document.getElementById("qrCodeImg").src =
          `https://promptpay.io/${currentPromptPay}/${rawTotal}.png`;
      }
    });

  // Coupon Cancel
  document.getElementById("cancelCouponBtn").addEventListener("click", () => {
    appliedCoupon = null;
    document.getElementById("inputCoupon").value = "";
    document.getElementById("inputCoupon").readOnly = false;
    document.getElementById("couponError").textContent = "";
    document.getElementById("cancelCouponBtn").style.display = "none";
    document.getElementById("applyCouponBtn").style.display = "";
    document.getElementById("summaryOriginalPrice").style.display = "none";

    let rawTotal = 0;
    Object.values(cart).forEach(({ item, qty }) => {
      const bq = getBundleQty(item);
      rawTotal += getPrice(item) * qty * bq;
    });
    document.getElementById("summaryTotalPrice").textContent =
      `${formatPrice(rawTotal)} บาท`;
    document.getElementById("qrCodeImg").src =
      `https://promptpay.io/${currentPromptPay}/${rawTotal}.png`;
  });

  // Success modal
  document.getElementById("successClose").addEventListener("click", () => {
    document.getElementById("successModal").classList.remove("active");
  });

  // History (with debounce)
  const historyFbInput = document.getElementById("historyFbInput");
  historyFbInput.value = localStorage.getItem("savedFb") || "";
  document
    .getElementById("historySearchBtn")
    .addEventListener("click", () => searchHistory(false));
  historyFbInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") searchHistory(false);
    });

  const loadMoreHistoryBtn = document.getElementById("loadMoreHistoryBtn");
  if (loadMoreHistoryBtn) {
    loadMoreHistoryBtn.addEventListener("click", () => searchHistory(true));
  }

  // Cancel order delegation
  document.getElementById("historyList").addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-cancel-order");
    if (btn) cancelOrder(btn.dataset.orderId);
  });

  // Go to feed tab from stats banner → switch to history tab, then feed sub-tab
  document.getElementById("goToFeedLink").addEventListener("click", () => {
    document.querySelector('.nav-tab[data-tab="history"]').click();
    const feedBtn = document.querySelector('#historySubTabs .sub-tab[data-historytab="feed"]');
    if (feedBtn) feedBtn.click();
  });

  // Feed load more
  const loadMoreFeedBtn = document.getElementById("loadMoreFeedBtn");
  if (loadMoreFeedBtn) {
    loadMoreFeedBtn.addEventListener("click", () => loadFeed(true));
  }

  // Floating cart: update on resize/orientation change
  window.addEventListener("resize", updateFloatingCart);

  // Item grid click delegation (แทน inline onclick)
  document.getElementById("itemGrid").addEventListener("click", (e) => {
    const card = e.target.closest(".item-card");
    if (!card || card.classList.contains("out-of-stock")) return;
    openItemModal(card.dataset.id);
  });

  // Cart click delegation (แทน inline onclick)
  document.getElementById("cartList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cart-action]");
    if (!btn) return;
    const id = btn.dataset.cartId;
    const action = btn.dataset.cartAction;
    if (action === "minus") changeCartQty(id, -1);
    else if (action === "plus") changeCartQty(id, 1);
    else if (action === "remove") removeFromCart(id);
  });

});

// ============ SHOP OPEN/CLOSE ============
function isWithinShopHours() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  // เช็คกะดึก (เที่ยงคืนถึงตีหนึ่ง ของวัน อ.-ส. ที่เป็นช่วงต่อของคืนวันจันทร์-ศุกร์ปิด 01:00)
  if (hour === 0 && day >= 2 && day <= 6) {
    return true;
  }

  if (day === 0 || day === 6) {
    // เสาร์-อาทิตย์ ปิด 23:59:59 (เปิด 10:00)
    return hour >= 10;
  }

  // จันทร์-ศุกร์ เปิด 20:00
  return hour >= 20;
}

let currentShopState = "auto"; // 'auto' | 'force_open' | 'force_close'
let closeReason = "";
let _quotaResetAt = 0;
let _quotaResetHour = 0;
let _quotaCloseTimer = null;

function applyShopStatus() {
  const inHours = isWithinShopHours();

  if (currentShopState === "force_open") {
    shopOpen = true;
  } else if (currentShopState === "force_close") {
    shopOpen = false;
  } else {
    // auto
    shopOpen = inHours;
  }

  const banner = document.getElementById("shopClosedBanner");
  const grid = document.getElementById("itemGrid");
  const rightCol = document.getElementById("rightColumn");
  const hoursEl = document.getElementById("shopHours");
  const reasonEl = document.getElementById("closeReasonText");

  if (shopOpen) {
    if (_quotaCloseTimer) { clearInterval(_quotaCloseTimer); _quotaCloseTimer = null; }
    if (typeof restoreQuotaBadgeToOk === 'function') restoreQuotaBadgeToOk();
    banner.classList.remove("active");
    grid.style.opacity = "";
    grid.style.pointerEvents = "";
    if (rightCol) rightCol.style.display = "";
    if (hoursEl) hoursEl.style.display = "";
    updateShopHours();
  } else {
    // หยุด timer เก่าก่อน
    if (_quotaCloseTimer) { clearInterval(_quotaCloseTimer); _quotaCloseTimer = null; }

    const isQuotaClose = closeReason === '[QUOTA_CLOSE]' || closeReason.includes('ระบบขัดข้อง');
    if (isQuotaClose) {
      // Quota close: เปลี่ยน badge เป็นสีเหลือง + countdown
      if (typeof switchQuotaBadgeToError === 'function') switchQuotaBadgeToError();
      // ใช้ quotaResetAt จาก Firestore หรือคำนวณใหม่
      const resetTarget = _quotaResetAt || (typeof getNextQuotaReset === 'function' ? getNextQuotaReset() : 0);
      const hr = _quotaResetHour || (typeof getQuotaResetThaiTime === 'function' ? getQuotaResetThaiTime() : 0);
      const hrText = hr ? `${hr}:00 น.` : '';
      function updateQuotaCloseReason() {
        if (!reasonEl) return;
        const remain = resetTarget - Date.now();
        if (remain <= 0) {
          reasonEl.textContent = 'ระบบกำลังกลับมา... ลองรีเฟรชหน้า';
          reasonEl.style.color = '#76ff03';
          clearInterval(_quotaCloseTimer);
        } else {
          const h = Math.floor(remain / 3600000);
          const m = Math.floor((remain % 3600000) / 60000);
          const s = Math.floor((remain % 60000) / 1000).toString().padStart(2, '0');
          const timeStr = h > 0 ? `${h} ชม. ${m} นาที ${s} วินาที` : `${m} นาที ${s} วินาที`;
          reasonEl.textContent = `ระบบโควต้าหมด — ร้านจะกลับมาเปิดใน ${timeStr}` + (hrText ? ` (รีเซ็ตทุกวัน ${hrText})` : '');
          reasonEl.style.color = '#ff9800';
        }
      }
      updateQuotaCloseReason();
      _quotaCloseTimer = setInterval(updateQuotaCloseReason, 1000);
    } else if (currentShopState === "force_close" && closeReason) {
      if (reasonEl) reasonEl.textContent = "เหตุผล: " + closeReason;
    } else if (currentShopState === "auto" && !inHours) {
      if (reasonEl) reasonEl.textContent = "นอกเวลาเปิดร้าน";
    } else {
      if (reasonEl) reasonEl.textContent = "";
    }
    banner.classList.add("active");
    grid.style.opacity = "0.4";
    grid.style.pointerEvents = "none";
    if (rightCol) rightCol.style.display = "none";
    if (hoursEl) hoursEl.style.display = "none";
    updateShopHours();
  }
}

function applyPaymentStatus() {
  const paymentSection = document.getElementById("paymentSection");
  const toggleWrap = document.getElementById("paymentToggleWrap");
  if (!paymentSection) return;

  if (toggleWrap) toggleWrap.style.display = adminPayMode === 'both' ? "" : "none";
  paymentSection.style.display = customerPayMode === 'pay' ? "" : "none";
}

function applyAdminPayMode() {
  const btnPay = document.getElementById("btnPayNow");
  const btnOrder = document.getElementById("btnOrderFirst");
  const notice = document.getElementById("payModeNotice");

  if (adminPayMode === 'pay_only') {
    customerPayMode = 'pay';
    if (btnPay) btnPay.classList.add("active");
    if (btnOrder) btnOrder.classList.remove("active");
    if (notice) { notice.textContent = "ช่วงนี้รับเฉพาะโอนเงินผ่านเว็บ"; notice.style.display = ""; }
  } else if (adminPayMode === 'order_only') {
    customerPayMode = 'order';
    if (btnPay) btnPay.classList.remove("active");
    if (btnOrder) btnOrder.classList.add("active");
    if (notice) { notice.textContent = "ช่วงนี้รับเฉพาะสั่งก่อนจ่ายทีหลัง"; notice.style.display = ""; }
  } else {
    if (notice) notice.style.display = "none";
  }
}

function setupPaymentModeToggle() {
  const btnPay = document.getElementById("btnPayNow");
  const btnOrder = document.getElementById("btnOrderFirst");
  if (!btnPay || !btnOrder) return;

  function setMode(mode) {
    customerPayMode = mode;
    btnPay.classList.toggle("active", mode === "pay");
    btnOrder.classList.toggle("active", mode === "order");
    applyPaymentStatus();
  }

  btnPay.addEventListener("click", () => { if (adminPayMode === 'both') setMode("pay"); });
  btnOrder.addEventListener("click", () => { if (adminPayMode === 'both') setMode("order"); });

  // Slip toggle
  const btnSlipOn = document.getElementById("btnSlipOn");
  const btnSlipOff = document.getElementById("btnSlipOff");
  const slipWrap = document.getElementById("slipUploadWrap");
  const slipSkipMsg = document.getElementById("slipSkipMsg");
  if (btnSlipOn && btnSlipOff && slipWrap) {
    function setSlip(show) {
      customerSlipAttach = show;
      btnSlipOn.classList.toggle("active", show);
      btnSlipOff.classList.toggle("active", !show);
      slipWrap.style.display = show ? "" : "none";
      if (slipSkipMsg) slipSkipMsg.style.display = show ? "none" : "";
    }
    btnSlipOn.addEventListener("click", () => setSlip(true));
    btnSlipOff.addEventListener("click", () => setSlip(false));
  }
}

function processShopSettings(doc) {
  if (doc.exists) {
    const data = doc.data();
    if (data.shopState) currentShopState = data.shopState;
    else if (data.isOpen === false) currentShopState = "force_close";
    else currentShopState = "auto";
    closeReason = data.closeReason || "";
    _quotaResetAt = data.quotaResetAt || 0;
    _quotaResetHour = data.quotaResetHour || 0;
    if (data.promptpay) currentPromptPay = data.promptpay;
    adminPayMode = data.payMode || 'both';
  } else {
    currentShopState = "auto";
    closeReason = "";
    adminPayMode = 'both';
  }
  applyShopStatus();
  applyAdminPayMode();
  applyPaymentStatus();
}

let _shopStatusInterval = null;
function listenShopStatus() {
  if (window.unsubShopStatus) { window.unsubShopStatus(); window.unsubShopStatus = null; }
  if (_quotaSaving) {
    db.collection("settings").doc("shop").get()
      .then(doc => processShopSettings(doc))
      .catch(() => {});
  } else {
    window.unsubShopStatus = db.collection("settings").doc("shop").onSnapshot(
      (doc) => processShopSettings(doc),
      (e) => { if (typeof handleQuotaError === 'function') handleQuotaError(e, 'shopStatus'); }
    );
  }
  if (!_shopStatusInterval) {
    _shopStatusInterval = setInterval(applyShopStatus, 60000);
  }
}

// ============ RESERVATION COUNTDOWN ============
function updateReservationCountdowns() {
  document.querySelectorAll('[data-reserve-item]').forEach(el => {
    const itemId = el.getAttribute('data-reserve-item');
    const reserved = typeof getReservedQty === 'function' ? getReservedQty(itemId) : 0;
    if (reserved <= 0) { el.style.display = 'none'; return; }
    el.style.display = '';
    const maxExp = typeof getReservationMaxExpiry === 'function' ? getReservationMaxExpiry(itemId) : 0;
    if (maxExp > 0) {
      const remain = maxExp - Date.now();
      if (remain > 0) {
        const m = Math.floor(remain / 60000);
        const s = Math.floor((remain % 60000) / 1000).toString().padStart(2, '0');
        el.textContent = `${reserved} จอง (${m}:${s})`;
      } else {
        el.textContent = `${reserved} จอง`;
      }
    } else {
      el.textContent = `${reserved} จอง`;
    }
  });
}

// ============ TOAST PERSISTENCE ============
const TOAST_DURATION = 300000; // 5 นาที

function showChangedToast(changed) {
  showOrderToast(changed, TOAST_DURATION);
}

function saveToastToStorage(entry) {
  try {
    const stored = JSON.parse(localStorage.getItem("toastQueue") || "[]");
    stored.push(entry);
    const valid = stored.filter((e) => Date.now() - e.time < TOAST_DURATION);
    localStorage.setItem("toastQueue", JSON.stringify(valid));
  } catch (e) {}
}

function restoreToasts() {
  try {
    const stored = JSON.parse(localStorage.getItem("toastQueue") || "[]");
    const now = Date.now();
    const valid = stored.filter((e) => now - e.time < TOAST_DURATION);
    localStorage.setItem("toastQueue", JSON.stringify(valid));
    for (const entry of valid) {
      const remaining = TOAST_DURATION - (now - entry.time);
      if (remaining > 1000 && entry.changed) {
        showOrderToast(entry.changed, remaining);
      }
    }
  } catch (e) {}
}
