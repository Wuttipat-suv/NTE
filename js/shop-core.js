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
let paymentEnabled = true;
let customerPayMode = 'pay'; // 'pay' = โอนเลย, 'order' = สั่งก่อน

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

  window.unsubItems = db
    .collection("items")
    .orderBy("createdAt", "asc")
    .onSnapshot(
      (snapshot) => {
        const prevItems = items;
        items = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((item) => item.active !== false); // ซ่อนสินค้าที่ admin ปิดไว้
        items.sort((a, b) => {
          const aAvail =
            typeof getAvailableStock === "function"
              ? getAvailableStock(a)
              : Number(a.stock) || 0;
          const bAvail =
            typeof getAvailableStock === "function"
              ? getAvailableStock(b)
              : Number(b.stock) || 0;
          const aOut = aAvail <= 0 ? 1 : 0;
          const bOut = bAvail <= 0 ? 1 : 0;
          if (aOut !== bOut) return aOut - bOut;
          return (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity);
        });

        // ตรวจจับ stock ลดลง (มีคนซื้อไป) — toast แจ้งเตือน
        // ข้าม toast ถ้า admin เป็นคนลด stock (_adminAdjust เปลี่ยน)
        if (prevItems.length > 0) {
          const changed = [];
          for (const newItem of items) {
            const old = prevItems.find((i) => i.id === newItem.id);
            if (old && newItem.stock < old.stock) {
              const oldAdj = old._adminAdjust ? old._adminAdjust.seconds : 0;
              const newAdj = newItem._adminAdjust
                ? newItem._adminAdjust.seconds
                : 0;
              if (newAdj !== oldAdj) continue; // admin ลดเอง ไม่ toast
              changed.push({
                name: newItem.name,
                qty: old.stock - newItem.stock,
                image: newItem.image,
              });
            }
          }
          if (changed.length > 0) {
            const entry = { changed, time: Date.now() };
            saveToastToStorage(entry);
            showChangedToast(changed);
          }
        }

        renderItems();

        // อัพเดท stock/price ในตะกร้า (ไม่เปลี่ยนจำนวนที่สั่ง)
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

        // ถ้า summary modal เปิดอยู่ ให้ re-render ด้วย
        if (
          document.getElementById("summaryModal").classList.contains("active")
        ) {
          refreshSummary();
        }
      },
      (e) => {
        console.error("โหลดสินค้าไม่ได้:", e);
        grid.innerHTML =
          '<p style="color:#ff6b6b;grid-column:1/-1;text-align:center;">ไม่สามารถโหลดสินค้าได้ กรุณาลองใหม่</p>';
      },
    );
}

// ============ LOAD STATS ============
function loadStats() {
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

// ============ RENDER ITEMS ============
function renderItems() {
  const grid = document.getElementById("itemGrid");
  const totalEl = document.getElementById("totalItems");
  const inStockCount = items.filter(item => {
    const avail = typeof getAvailableStock === "function" ? getAvailableStock(item) : Number(item.stock) || 0;
    return avail > 0;
  }).length;
  totalEl.textContent = `TOTAL ${inStockCount} ITEMS`;

  if (items.length === 0) {
    grid.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:#aaa;">ยังไม่มีสินค้า</p>';
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const available =
        typeof getAvailableStock === "function"
          ? getAvailableStock(item)
          : Number(item.stock) || 0;
      const reserved =
        typeof getReservedQty === "function" ? getReservedQty(item.id) : 0;
      const outOfStock = available <= 0;
      return `
      <div class="item-card ${outOfStock ? "out-of-stock" : ""}"
           data-id="${item.id}">
        <div class="stock-badge">x${available}</div>
        ${reserved > 0 ? `<div class="reserved-badge">${reserved} จอง</div>` : ""}
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text fill=%22%23999%22 x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2212%22>No Image</text></svg>'">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-price">
          ${
            isPromoValid(item)
              ? `<div class="promo-countdown" data-expires="${item.promoExpiresAt ? item.promoExpiresAt.toMillis() : ""}"></div>
               <span class="original-price">ชิ้นละ ${formatPrice(item.price)} บาท</span> <span class="promo-price">ชิ้นละ ${formatPrice(item.promoPrice)} บาท</span>`
              : `ชิ้นละ ${formatPrice(item.price)} บาท`
          }
        </div>
      </div>
    `;
    })
    .join("");

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
      document.getElementById("shopSection").style.display =
        target === "shop" ? "block" : "none";
      document
        .getElementById("historySection")
        .classList.toggle("active", target === "history");
      document.getElementById("rightColumn").style.display =
        target === "shop" ? "" : "none";
    });
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
  setupEscapeKey();
  setupPaymentModeToggle();
  loadItems();
  loadStats();
  loadBlocklist();
  loadReservations();

  // จัดการการพับจอ (Page Visibility) เพื่อประหยัดโควต้า
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (window.unsubItems) {
        window.unsubItems();
        window.unsubItems = null;
      }
      if (window.unsubStats) {
        window.unsubStats();
        window.unsubStats = null;
      }
      if (window.unsubReservations) {
        window.unsubReservations();
        window.unsubReservations = null;
      }
      _stopHeartbeat();
    } else {
      if (!window.unsubItems) loadItems();
      if (!window.unsubStats) loadStats();
      if (!window.unsubReservations) loadReservations();
      if (Object.keys(cart).length > 0) syncReservation();
    }
  });
  listenShopStatus();
  restoreToasts();
  updateShopHours();
  setInterval(updateShopHours, 60000);

  // Promo Countdown Loop (function อยู่ global แล้ว)
  setInterval(updatePromoCountdowns, 1000);

  // Item modal
  document.getElementById("qtyMinus").addEventListener("click", () => {
    if (!currentItem) return;
    if (currentQty > 1) {
      currentQty--;
      const inCart = cart[currentItem.id] ? cart[currentItem.id].qty : 0;
      updateQtyDisplay(currentItem.stock - inCart);
    }
  });

  document.getElementById("qtyPlus").addEventListener("click", () => {
    if (!currentItem) return;
    const inCart = cart[currentItem.id] ? cart[currentItem.id].qty : 0;
    const maxQty = currentItem.stock - inCart;
    if (currentQty < maxQty) {
      currentQty++;
      updateQtyDisplay(maxQty);
    }
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
        rawTotal += getPrice(item) * qty;
      });

      errEl.textContent = "กำลังตรวจสอบโค้ด...";
      errEl.style.color = "#aaa";
      try {
        const doc = await db.collection("coupons").doc(code).get();
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
      rawTotal += getPrice(item) * qty;
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
  document
    .getElementById("historySearchBtn")
    .addEventListener("click", () => searchHistory(false));
  document
    .getElementById("historyFbInput")
    .addEventListener("keypress", (e) => {
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

  // Close modals on overlay click (ยกเว้น summaryModal)
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && overlay.id !== "summaryModal") {
        overlay.classList.remove("active");
      }
    });
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
    banner.classList.remove("active");
    grid.style.opacity = "";
    grid.style.pointerEvents = "";
    if (rightCol) rightCol.style.display = "";
    if (hoursEl) hoursEl.style.display = "";
    updateShopHours();
  } else {
    if (currentShopState === "force_close" && closeReason) {
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

  // แสดง toggle เสมอ ให้ลูกค้าเลือกเอง
  if (toggleWrap) toggleWrap.style.display = "";
  paymentSection.style.display = customerPayMode === 'pay' ? "" : "none";
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

  btnPay.addEventListener("click", () => setMode("pay"));
  btnOrder.addEventListener("click", () => setMode("order"));
}

function listenShopStatus() {
  db.collection("settings")
    .doc("shop")
    .onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (data.shopState) {
          currentShopState = data.shopState;
        } else if (data.isOpen === false) {
          currentShopState = "force_close";
        } else {
          currentShopState = "auto";
        }
        closeReason = data.closeReason || "";
        if (data.promptpay) currentPromptPay = data.promptpay;
        paymentEnabled = data.paymentEnabled !== false;
      } else {
        currentShopState = "auto";
        closeReason = "";
        paymentEnabled = true;
      }
      applyShopStatus();
      applyPaymentStatus();
    });
  setInterval(applyShopStatus, 60000);
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
