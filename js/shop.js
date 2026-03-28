// ============================================
// BubbleShop - Frontend Logic
// ============================================

// Helpers
function formatPrice(v) { const n = Number(v) || 0; return n % 1 === 0 ? n.toString() : n.toFixed(2); }
function getPrice(item) { return item.promoPrice != null ? Number(item.promoPrice) : Number(item.price); }

// State
let items = [];
let cart = {}; // { itemId: { item, qty } }
let currentItem = null;
let currentQty = 1;
let shopOpen = true;

// ============ LOAD ITEMS (Real-time) ============
function loadItems() {
  const grid = document.getElementById("itemGrid");
  grid.innerHTML =
    '<p style="grid-column:1/-1;text-align:center;color:#aaa;">กำลังโหลดสินค้า...</p>';

  db.collection("items")
    .orderBy("createdAt", "asc")
    .onSnapshot((snapshot) => {
      const prevItems = items;
      items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      items.sort((a, b) => {
        const aOut = (Number(a.stock) || 0) <= 0 ? 1 : 0;
        const bOut = (Number(b.stock) || 0) <= 0 ? 1 : 0;
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
            const newAdj = newItem._adminAdjust ? newItem._adminAdjust.seconds : 0;
            if (newAdj !== oldAdj) continue; // admin ลดเอง ไม่ toast
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

      // อัพเดท stock/price ในตะกร้า (ไม่เปลี่ยนจำนวนที่สั่ง)
      for (const [id, entry] of Object.entries(cart)) {
        const fresh = items.find((i) => i.id === id);
        if (fresh) {
          entry.item.stock = fresh.stock;
          entry.item.price = fresh.price;
          entry.item.promoPrice = fresh.promoPrice ?? null;
        }
      }
      renderCart();

      // ถ้า summary modal เปิดอยู่ ให้ re-render ด้วย
      if (document.getElementById("summaryModal").classList.contains("active")) {
        refreshSummary();
      }
    }, (e) => {
      console.error("โหลดสินค้าไม่ได้:", e);
      grid.innerHTML =
        '<p style="color:#ff6b6b;grid-column:1/-1;text-align:center;">ไม่สามารถโหลดสินค้าได้ กรุณาลองใหม่</p>';
    });
}

// ============ RENDER ITEMS ============
function renderItems() {
  const grid = document.getElementById("itemGrid");
  const totalEl = document.getElementById("totalItems");
  totalEl.textContent = `TOTAL ${items.length} ITEMS`;

  if (items.length === 0) {
    grid.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:#aaa;">ยังไม่มีสินค้า</p>';
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const outOfStock = !item.stock || item.stock <= 0;
      return `
      <div class="item-card ${outOfStock ? "out-of-stock" : ""}"
           data-id="${item.id}">
        <div class="stock-badge">x${Number(item.stock) || 0}</div>
        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text fill=%22%23999%22 x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2212%22>No Image</text></svg>'">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-price">${item.promoPrice != null ? `<span class="original-price">ชิ้นละ ${formatPrice(item.price)} บาท</span> <span class="promo-price">ชิ้นละ ${formatPrice(item.promoPrice)} บาท</span>` : `ชิ้นละ ${formatPrice(item.price)} บาท`}</div>
      </div>
    `;
    })
    .join("");
}

// ============ ITEM MODAL ============
function openItemModal(itemId) {
  currentItem = items.find((i) => i.id === itemId);
  if (!currentItem || currentItem.stock <= 0) return;

  const inCart = cart[itemId] ? cart[itemId].qty : 0;
  const available = currentItem.stock - inCart;

  if (available <= 0) {
    showAlert("สินค้านี้เลือกครบจำนวน stock แล้ว");
    return;
  }

  currentQty = 1;
  document.getElementById("modalItemImg").src = currentItem.image;
  document.getElementById("modalItemName").textContent = currentItem.name;
  document.getElementById("modalItemPriceUnit").innerHTML =
    currentItem.promoPrice != null
      ? `<span class="original-price">ชิ้นละ ${formatPrice(currentItem.price)} บาท</span> <span class="promo-price">ชิ้นละ ${formatPrice(currentItem.promoPrice)} บาท</span>`
      : `ชิ้นละ ${formatPrice(currentItem.price)} บาท`;
  document.getElementById("modalStockInfo").textContent =
    `เหลือ ${available} ชิ้น`;
  updateQtyDisplay(available);
  document.getElementById("itemModal").classList.add("active");
}

function updateQtyDisplay(maxQty) {
  document.getElementById("qtyDisplay").textContent = currentQty;
  document.getElementById("modalTotalPrice").textContent =
    `${formatPrice(currentQty * getPrice(currentItem))} บาท`;
  document.getElementById("qtyMinus").disabled = currentQty <= 1;
  document.getElementById("qtyPlus").disabled = currentQty >= maxQty;
}

function closeItemModal() {
  document.getElementById("itemModal").classList.remove("active");
  currentItem = null;
}

// ============ CART ============
function addToCart() {
  if (!currentItem) return;

  if (cart[currentItem.id]) {
    cart[currentItem.id].qty += currentQty;
  } else {
    cart[currentItem.id] = {
      item: { ...currentItem },
      qty: currentQty,
    };
  }

  closeItemModal();
  renderCart();
}

function changeCartQty(itemId, delta) {
  if (!cart[itemId]) return;
  const newQty = cart[itemId].qty + delta;
  if (newQty <= 0) {
    delete cart[itemId];
  } else if (newQty > cart[itemId].item.stock) {
    return;
  } else {
    cart[itemId].qty = newQty;
  }
  renderCart();
}

function removeFromCart(itemId) {
  delete cart[itemId];
  renderCart();
}

function renderCart() {
  const cartList = document.getElementById("cartList");
  const cartTotal = document.getElementById("cartTotal");
  const cartTotalPrice = document.getElementById("cartTotalPrice");
  const summaryBtn = document.getElementById("summaryBtn");
  const entries = Object.entries(cart);

  if (entries.length === 0) {
    cartList.innerHTML = '<div class="cart-empty">ยังไม่ได้เลือกสินค้า</div>';
    cartTotal.style.display = "none";
    summaryBtn.disabled = true;
    return;
  }

  let total = 0;
  cartList.innerHTML = entries
    .map(([id, { item, qty }]) => {
      const unitPrice = getPrice(item);
      const subtotal = unitPrice * qty;
      total += subtotal;
      const maxQty = item.stock;
      const notEnough = qty > maxQty;
      const stockWarn = maxQty <= 0 ? ' cart-item-out' : notEnough ? ' cart-item-low' : maxQty <= 5 ? ' cart-item-low' : '';
      return `
      <div class="cart-item${stockWarn}">
        <div class="cart-item-top">
          <span class="cart-item-name">${escapeHtml(item.name)}</span>
          <span class="cart-item-price">${formatPrice(subtotal)}฿</span>
        </div>
        <div class="cart-item-stock">เหลือ ${maxQty} ชิ้น${maxQty <= 0 ? ' — สินค้าหมดแล้ว!' : notEnough ? ' — ไม่พอ!' : ''}</div>
        <div class="cart-item-bottom">
          <div class="cart-item-controls">
            <button class="cart-qty-btn" data-cart-action="minus" data-cart-id="${id}" ${qty <= 1 ? "disabled" : ""} aria-label="ลดจำนวน">-</button>
            <span class="cart-item-qty">${qty}</span>
            <button class="cart-qty-btn" data-cart-action="plus" data-cart-id="${id}" ${qty >= maxQty ? "disabled" : ""} aria-label="เพิ่มจำนวน">+</button>
          </div>
          <span class="cart-item-unit">ชิ้นละ ${formatPrice(unitPrice)}฿</span>
          <button class="cart-item-remove" data-cart-action="remove" data-cart-id="${id}" aria-label="ลบสินค้า">&times;</button>
        </div>
      </div>
    `;
    })
    .join("");

  cartTotal.style.display = "block";
  cartTotalPrice.textContent = total;
  summaryBtn.disabled = false;
}

// ============ SUMMARY MODAL ============
function openSummaryModal() {
  if (!shopOpen) {
    showAlert("ร้านปิดอยู่ ยังไม่สามารถสั่งซื้อได้", "ร้านปิด");
    return;
  }
  const entries = Object.entries(cart);
  if (entries.length === 0) return;

  let total = 0;
  const summaryList = document.getElementById("summaryList");
  summaryList.innerHTML = entries
    .map(([id, { item, qty }]) => {
      const subtotal = getPrice(item) * qty;
      total += subtotal;
      const stockWarn = qty > item.stock ? 'summary-item-out' : item.stock <= 5 ? 'summary-item-low' : '';
      return `
      <div class="summary-item ${stockWarn}">
        <span>${escapeHtml(item.name)} x${qty}</span>
        <span class="summary-item-right">
          <span class="summary-item-stock">เหลือ ${item.stock}</span>
          <span>${formatPrice(subtotal)} บาท</span>
        </span>
      </div>
    `;
    })
    .join("");

  document.getElementById("summaryTotalPrice").textContent = `${formatPrice(total)} บาท`;
  document.getElementById("inputFb").value = "";
  document.getElementById("inputCharName").value = "";
  document.getElementById("inputConfirmText").value = "";
  document.getElementById("confirmCheckbox").checked = false;
  generateCaptcha();
  document.getElementById("summaryModal").classList.add("active");
}

// ============ CAPTCHA ============
let currentCaptcha = "";

function generateCaptcha() {
  currentCaptcha = String(Math.floor(1000 + Math.random() * 9000));
  const display = document.getElementById("captchaDisplay");
  display.textContent = currentCaptcha;
}

function refreshSummary() {
  const entries = Object.entries(cart);
  if (entries.length === 0) {
    closeSummaryModal();
    return;
  }

  let total = 0;
  const summaryList = document.getElementById("summaryList");
  summaryList.innerHTML = entries
    .map(([id, { item, qty }]) => {
      const subtotal = getPrice(item) * qty;
      total += subtotal;
      const stockWarn = qty > item.stock ? 'summary-item-out' : item.stock <= 5 ? 'summary-item-low' : '';
      return `
      <div class="summary-item ${stockWarn}">
        <span>${escapeHtml(item.name)} x${qty}</span>
        <span class="summary-item-right">
          <span class="summary-item-stock">เหลือ ${item.stock}</span>
          <span>${formatPrice(subtotal)} บาท</span>
        </span>
      </div>
    `;
    })
    .join("");

  document.getElementById("summaryTotalPrice").textContent = `${formatPrice(total)} บาท`;
}

function closeSummaryModal() {
  document.getElementById("summaryModal").classList.remove("active");
}

// ============ FIELD ERROR HELPERS ============
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add("show");
}

function clearFieldErrors() {
  document.querySelectorAll(".field-error").forEach((el) => {
    el.textContent = "";
    el.classList.remove("show");
  });
}

// ============ ANTI-SPAM ============
const ORDER_COOLDOWN_MS = 30 * 1000; // 30 วินาที
let blockedNames = [];

async function loadBlocklist() {
  try {
    const doc = await db.collection("settings").doc("spam").get();
    if (doc.exists && Array.isArray(doc.data().blocked)) {
      blockedNames = doc.data().blocked.map((n) => n.toLowerCase());
    }
  } catch (e) {
    console.warn("โหลด blocklist ไม่ได้:", e.message);
  }
}

function checkCooldown() {
  const last = localStorage.getItem("lastOrderTime");
  if (!last) return 0;
  const remaining = ORDER_COOLDOWN_MS - (Date.now() - parseInt(last, 10));
  return remaining > 0 ? remaining : 0;
}

async function hasPendingOrder(fbName) {
  const snapshot = await db
    .collection("orders")
    .where("facebook", "==", fbName)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return !snapshot.empty;
}

// ============ SUBMIT ORDER ============
async function submitOrder() {
  clearFieldErrors();

  // Honeypot check
  const hp = document.getElementById("inputWebsite");
  if (hp && hp.value) {
    closeSummaryModal();
    cart = {};
    renderCart();
    document.getElementById("successModal").classList.add("active");
    return;
  }

  // Cooldown check
  const cooldownLeft = checkCooldown();
  if (cooldownLeft > 0) {
    const mins = Math.ceil(cooldownLeft / 60000);
    showAlert(`กรุณารอ ${mins} นาทีก่อนสั่งซื้อครั้งถัดไป`, "กรุณารอสักครู่");
    return;
  }

  const fb = document.getElementById("inputFb").value.trim();
  const charName = document.getElementById("inputCharName").value.trim();
  const confirmText = document.getElementById("inputConfirmText").value.trim();

  let hasError = false;
  if (!fb) {
    showFieldError("inputFbError", "กรุณากรอก Facebook");
    hasError = true;
  } else if (fb.length < 3) {
    showFieldError("inputFbError", "ชื่อ Facebook ต้องมีอย่างน้อย 3 ตัวอักษร");
    hasError = true;
  } else if (fb.length > 100) {
    showFieldError("inputFbError", "ยาวเกินไป (ไม่เกิน 100 ตัวอักษร)");
    hasError = true;
  } else if (blockedNames.includes(fb.toLowerCase())) {
    showFieldError("inputFbError", "Facebook นี้ถูกระงับการสั่งซื้อ");
    hasError = true;
  }
  if (!charName) {
    showFieldError("inputCharNameError", "กรุณากรอกชื่อตัวละคร");
    hasError = true;
  } else if (charName.length < 2) {
    showFieldError(
      "inputCharNameError",
      "ชื่อตัวละครต้องมีอย่างน้อย 2 ตัวอักษร",
    );
    hasError = true;
  } else if (charName.length > 100) {
    showFieldError("inputCharNameError", "ยาวเกินไป (ไม่เกิน 100 ตัวอักษร)");
    hasError = true;
  }
  if (confirmText !== currentCaptcha) {
    showFieldError("inputConfirmTextError", "ตัวเลขไม่ถูกต้อง");
    generateCaptcha();
    document.getElementById("inputConfirmText").value = "";
    hasError = true;
  }
  if (!document.getElementById("confirmCheckbox").checked) {
    showFieldError("confirmCheckboxError", "กรุณายอมรับเงื่อนไขก่อนสั่งซื้อ");
    hasError = true;
  }
  if (hasError) return;

  const confirmBtn = document.getElementById("summaryConfirm");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "กำลังตรวจสอบ...";

  try {
    // เช็คว่ามี order pending อยู่แล้วมั้ย (best-effort)
    if (await hasPendingOrder(fb)) {
      showAlert(
        "คุณมี order ที่รอดำเนินการอยู่แล้ว กรุณารอแอดมินดำเนินการก่อน",
        "สั่งซ้ำไม่ได้",
      );
      confirmBtn.disabled = false;
      confirmBtn.textContent = "ยืนยันสั่งซื้อ";
      return;
    }
  } catch (e) {
    console.warn("เช็ค pending order ไม่ได้:", e.message);
  }

  const entries = Object.entries(cart);
  const cartItems = entries.map(([id, { item, qty }]) => ({
    itemId: id,
    name: item.name,
    qty,
  }));

  confirmBtn.textContent = "กำลังส่ง...";

  try {
    // Transaction: อ่านราคาจาก server + ตรวจ stock + หัก stock + สร้าง order
    await db.runTransaction(async (transaction) => {
      const itemRefs = cartItems.map((ci) =>
        db.collection("items").doc(ci.itemId),
      );
      const itemDocs = await Promise.all(
        itemRefs.map((ref) => transaction.get(ref)),
      );

      let totalPrice = 0;
      const orderItems = [];

      for (let i = 0; i < itemDocs.length; i++) {
        const doc = itemDocs[i];
        if (!doc.exists) throw new Error(`ไม่พบสินค้า ${cartItems[i].name}`);

        const serverData = doc.data();
        const serverPrice = serverData.promoPrice != null ? Number(serverData.promoPrice) : (Number(serverData.price) || 0);
        const serverStock = Number(serverData.stock) || 0;

        if (serverStock < cartItems[i].qty) {
          throw new Error(`${cartItems[i].name} เหลือแค่ ${serverStock} ชิ้น`);
        }

        const subtotal = serverPrice * cartItems[i].qty;
        totalPrice += subtotal;

        orderItems.push({
          itemId: cartItems[i].itemId,
          name: cartItems[i].name,
          price: serverPrice,
          qty: cartItems[i].qty,
          subtotal,
        });
      }

      // หัก stock
      for (let i = 0; i < itemDocs.length; i++) {
        transaction.update(itemRefs[i], {
          stock: firebase.firestore.FieldValue.increment(-cartItems[i].qty),
        });
      }

      // สร้าง order (ใช้ราคาจาก server)
      const orderRef = db.collection("orders").doc();
      transaction.set(orderRef, {
        facebook: fb,
        characterName: charName,
        items: orderItems,
        totalPrice,
        status: "pending",
        _hp: "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    // บันทึก cooldown
    localStorage.setItem("lastOrderTime", Date.now().toString());

    // สำเร็จ
    closeSummaryModal();
    cart = {};
    renderCart();
    document.getElementById("successModal").classList.add("active");
  } catch (e) {
    closeSummaryModal();
    cart = {};
    renderCart();
    showAlert("เกิดข้อผิดพลาด: " + e.message, "ผิดพลาด");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "ยืนยันสั่งซื้อ";
  }
}

// ============ ORDER HISTORY ============
let searchDebounceTimer = null;

async function searchHistory() {
  const fb = document.getElementById("historyFbInput").value.trim();
  if (!fb) {
    showAlert("กรุณากรอก Facebook");
    return;
  }

  const historyList = document.getElementById("historyList");
  historyList.innerHTML =
    '<p style="text-align:center;color:#aaa;">กำลังค้นหา...</p>';

  try {
    const snapshot = await db
      .collection("orders")
      .where("facebook", "==", fb)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    if (snapshot.empty) {
      historyList.innerHTML =
        '<p style="text-align:center;color:#aaa;">ไม่พบประวัติการสั่ง</p>';
      return;
    }

    historyList.innerHTML = snapshot.docs
      .map((doc) => {
        const order = doc.data();
        const date = order.createdAt
          ? order.createdAt.toDate().toLocaleString("th-TH")
          : "-";
        const statusMap = {
          pending: "รอดำเนินการ",
          completed: "เสร็จแล้ว",
          cancelled: "ยกเลิก",
        };
        const validStatuses = ["pending", "completed", "cancelled"];
        const statusClass = validStatuses.includes(order.status)
          ? order.status
          : "pending";
        const statusText = statusMap[order.status] || escapeHtml(order.status);

        const items = Array.isArray(order.items) ? order.items : [];
        const itemsText = items
          .map((i) => `${escapeHtml(i.name)} x${i.qty}`)
          .join(", ");

        const cancelBtn = order.status === 'pending'
          ? `<button class="btn-cancel-order" data-order-id="${doc.id}">ยกเลิก</button>`
          : '';

        return `
        <div class="order-card">
          <div class="order-card-header">
            <span class="order-date">${date}</span>
            <span class="order-status ${statusClass}">${statusText}</span>
          </div>
          <div class="order-card-char">ชื่อตัวละคร: <strong>${escapeHtml(order.characterName || '-')}</strong></div>
          <div class="order-card-items">${itemsText}</div>
          <div class="order-card-footer">
            <span class="order-card-total">รวม ${formatPrice(order.totalPrice)} บาท</span>
            ${cancelBtn}
          </div>
        </div>
      `;
      })
      .join("");
  } catch (e) {
    console.error(e);
    historyList.innerHTML =
      '<p style="text-align:center;color:#ff6b6b;">เกิดข้อผิดพลาด</p>';
  }
}

// ============ CANCEL ORDER (ลูกค้ายกเลิกเอง) ============
async function cancelOrder(orderId) {
  const yes = await showConfirm('ต้องการยกเลิก order นี้?', 'ยืนยันยกเลิก');
  if (!yes) return;

  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(orderId);
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) throw new Error('ไม่พบ order');

      const order = orderDoc.data();
      if (order.status !== 'pending') throw new Error('order นี้ไม่สามารถยกเลิกได้');

      // อ่าน item ทั้งหมดก่อน
      const orderItems = Array.isArray(order.items) ? order.items : [];
      const itemRefs = [];
      const itemDocs = [];
      for (const item of orderItems) {
        if (item.itemId) {
          const ref = db.collection('items').doc(item.itemId);
          itemRefs.push({ ref, qty: item.qty });
          itemDocs.push(await transaction.get(ref));
        }
      }

      // เขียนทั้งหมดทีเดียว (คืน stock)
      for (let i = 0; i < itemRefs.length; i++) {
        if (itemDocs[i].exists) {
          transaction.update(itemRefs[i].ref, {
            stock: firebase.firestore.FieldValue.increment(itemRefs[i].qty)
          });
        }
      }

      // เปลี่ยนสถานะ
      transaction.update(orderRef, { status: 'cancelled' });
    });

    // รีเซ็ต cooldown
    localStorage.removeItem('lastOrderTime');

    showAlert('ยกเลิก order สำเร็จ สามารถสั่งใหม่ได้เลย', 'สำเร็จ');
    searchHistory(); // reload history
  } catch (e) {
    showAlert('ยกเลิกไม่ได้: ' + e.message, 'ผิดพลาด');
  }
}

function debouncedSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(searchHistory, 500);
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
  const el = document.getElementById('shopHoursStatus');
  if (!el) return;
  const now = new Date();
  const day = now.getDay(); // 0=อา, 6=ส
  const hour = now.getHours();
  const isWeekend = day === 0 || day === 6;
  // จ-ศ 20:00-01:00 (ข้ามวัน) | ส-อา 10:00-23:59
  const isOpen = isWeekend ? (hour >= 10) : (hour >= 20 || hour < 1);
  if (isOpen) {
    el.textContent = 'ร้านเปิดอยู่';
    el.className = 'shop-hours-status open';
  } else {
    el.textContent = isWeekend ? 'ร้านปิดอยู่ — เปิด 10:00 น.' : 'ร้านปิดอยู่ — เปิด 20:00 น.';
    el.className = 'shop-hours-status closed';
  }
}

// ============ EVENT LISTENERS ============
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupEscapeKey();
  loadItems();
  loadBlocklist();
  listenShopStatus();
  restoreToasts();
  updateShopHours();
  setInterval(updateShopHours, 60000);

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

  // Success modal
  document.getElementById("successClose").addEventListener("click", () => {
    document.getElementById("successModal").classList.remove("active");
  });

  // History (with debounce)
  document
    .getElementById("historySearchBtn")
    .addEventListener("click", searchHistory);
  document
    .getElementById("historyFbInput")
    .addEventListener("keypress", (e) => {
      if (e.key === "Enter") searchHistory();
    });

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
function listenShopStatus() {
  db.collection("settings").doc("shop").onSnapshot((doc) => {
    shopOpen = doc.exists ? doc.data().isOpen !== false : true;
    const banner = document.getElementById("shopClosedBanner");
    const grid = document.getElementById("itemGrid");
    const rightCol = document.getElementById("rightColumn");
    const hoursEl = document.getElementById("shopHours");
    if (shopOpen) {
      banner.classList.remove("active");
      grid.style.opacity = "";
      grid.style.pointerEvents = "";
      if (rightCol) rightCol.style.display = "";
      if (hoursEl) hoursEl.style.display = "";
      updateShopHours();
    } else {
      banner.classList.add("active");
      grid.style.opacity = "0.4";
      grid.style.pointerEvents = "none";
      if (rightCol) rightCol.style.display = "none";
      if (hoursEl) hoursEl.style.display = "none";
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
