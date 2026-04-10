// ============ ITEM MODAL ============
function openItemModal(itemId) {
  currentItem = items.find((i) => i.id === itemId);
  if (!currentItem) return;

  const available = typeof getAvailableStock === 'function' ? getAvailableStock(currentItem) : (Number(currentItem.stock) || 0);
  const bq = getBundleQty(currentItem);
  const inCartBundles = cart[itemId] ? cart[itemId].qty : 0;
  const usedStock = inCartBundles * bq;
  const canAddBundles = getBundleCount(available - usedStock, bq);
  const reserved = typeof getReservedQty === 'function' ? getReservedQty(itemId) : 0;

  if (canAddBundles <= 0) {
    showAlert(available <= 0 ? "สินค้าหมดแล้ว" : "สินค้านี้เลือกครบจำนวน stock แล้ว");
    return;
  }

  currentQty = 1;
  const priceUnit = bq > 1 ? 'ชุดละ' : 'ชิ้นละ';
  document.getElementById("modalItemImg").src = currentItem.image;
  document.getElementById("modalItemName").textContent = currentItem.name + (bq > 1 ? ` (ชุดละ ${bq} ชิ้น)` : '');
  document.getElementById("modalItemPriceUnit").innerHTML =
    isPromoValid(currentItem)
      ? `${currentItem.promoExpiresAt
          ? `<div class="promo-countdown" data-expires="${currentItem.promoExpiresAt.toMillis()}"></div>`
          : `<div class="promo-countdown" data-expires="${getNextCloseTimestamp()}"></div>`}
         <span class="original-price">${priceUnit} ${formatPrice(currentItem.price * bq)} บาท</span> <span class="promo-price">${priceUnit} ${formatPrice(currentItem.promoPrice * bq)} บาท</span>`
      : `${priceUnit} ${formatPrice(getPrice(currentItem) * bq)} บาท`;
  const stockLabel = bq > 1 ? `เหลือ ${canAddBundles} ชุด` : `เหลือ ${canAddBundles} ชิ้น`;
  document.getElementById("modalStockInfo").textContent =
    stockLabel + (reserved > 0 ? ` (${reserved} คนกำลังสนใจ)` : '');
  // แสดง input ว่างให้กรอกเอง
  const qtyInput = document.getElementById("qtyDisplay");
  qtyInput.value = '';
  qtyInput.placeholder = '1';
  qtyInput.max = canAddBundles;
  const bq2 = getBundleQty(currentItem);
  document.getElementById("modalTotalPrice").textContent =
    `${formatPrice(getPrice(currentItem) * bq2)} บาท`;
  document.getElementById("qtyMinus").disabled = true;
  document.getElementById("qtyPlus").disabled = currentQty >= canAddBundles;
  document.getElementById("itemModal").classList.add("active");
  qtyInput.focus();
}

function updateQtyDisplay(maxQty) {
  const qtyInput = document.getElementById("qtyDisplay");
  qtyInput.value = currentQty;
  qtyInput.max = maxQty;
  const bq = getBundleQty(currentItem);
  document.getElementById("modalTotalPrice").textContent =
    `${formatPrice(currentQty * getPrice(currentItem) * bq)} บาท`;
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
  if (!shopOpen) { showAlert('ร้านปิดอยู่ ยังไม่สามารถสั่งซื้อได้', 'ร้านปิด'); return; }

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
  if (typeof syncReservation === 'function') syncReservation();
}

function changeCartQty(itemId, delta) {
  if (!cart[itemId]) return;
  const item = cart[itemId].item;
  const available = typeof getAvailableStock === 'function' ? getAvailableStock(item) : item.stock;
  const bq = getBundleQty(item);
  const maxBundles = getBundleCount(available, bq);
  const newQty = cart[itemId].qty + delta;
  if (newQty <= 0) {
    delete cart[itemId];
  } else if (newQty > maxBundles) {
    return;
  } else {
    cart[itemId].qty = newQty;
  }
  renderCart();
  if (typeof syncReservation === 'function') syncReservation();
}

function removeFromCart(itemId) {
  delete cart[itemId];
  renderCart();
  if (typeof syncReservation === 'function') syncReservation();
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
    updateFloatingCart();
    return;
  }

  let total = 0;
  cartList.innerHTML = entries
    .map(([id, { item, qty }]) => {
      // ซิงค์ข้อมูลล่าสุดจาก items array (ป้องกัน cart cache เก่า)
      const liveItem = items.find(i => i.id === id);
      if (liveItem) {
        item.bundleQty = liveItem.bundleQty;
        item.stock = liveItem.stock;
        item.price = liveItem.price;
        item.promoPrice = liveItem.promoPrice;
        item.promoExpiresAt = liveItem.promoExpiresAt;
      }
      const bq = getBundleQty(item);
      const unitPrice = getPrice(item) * bq;
      const subtotal = unitPrice * qty;
      total += subtotal;
      const available = typeof getAvailableStock === 'function' ? getAvailableStock(item) : (Number(item.stock) || 0);
      const maxBundles = getBundleCount(available, bq);
      const notEnough = qty > maxBundles;
      const stockWarn = maxBundles <= 0 ? ' cart-item-out' : notEnough ? ' cart-item-low' : maxBundles <= 5 ? ' cart-item-low' : '';
      const unitLabel = bq > 1 ? 'ชุดละ' : 'ชิ้นละ';
      const stockLabel = bq > 1 ? `เหลือ ${maxBundles} ชุด` : `เหลือ ${available} ชิ้น`;
      const qtyLabel = bq > 1 ? `${qty} ชุด (${qty * bq} ชิ้น)` : `${qty}`;
      return `
      <div class="cart-item${stockWarn}">
        <div class="cart-item-top">
          <span class="cart-item-name">${escapeHtml(item.name)}</span>
          <span class="cart-item-price">${formatPrice(subtotal)}฿</span>
        </div>
        <div class="cart-item-stock">${stockLabel}${maxBundles <= 0 ? ' — สินค้าหมดแล้ว!' : notEnough ? ' — ไม่พอ!' : ''}</div>
        <div class="cart-item-bottom">
          <div class="cart-item-controls">
            <button class="cart-qty-btn" data-cart-action="minus" data-cart-id="${id}" ${qty <= 1 ? "disabled" : ""} aria-label="ลดจำนวน">-</button>
            <span class="cart-item-qty">${qtyLabel}</span>
            <button class="cart-qty-btn" data-cart-action="plus" data-cart-id="${id}" ${qty >= maxBundles ? "disabled" : ""} aria-label="เพิ่มจำนวน">+</button>
          </div>
          <span class="cart-item-unit">${unitLabel} ${formatPrice(unitPrice)}฿</span>
          <button class="cart-item-remove" data-cart-action="remove" data-cart-id="${id}" aria-label="ลบสินค้า">&times;</button>
        </div>
      </div>
    `;
    })
    .join("");

  cartTotal.style.display = "block";
  cartTotalPrice.textContent = formatPrice(total);
  summaryBtn.disabled = false;

  // แสดงเวลาจองที่เหลือ
  const timerEl = document.getElementById("cartReserveTimer");
  if (timerEl && typeof getMyReservationRemaining === 'function') {
    const remaining = getMyReservationRemaining();
    if (remaining > 0) {
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `ตะกร้าหมดอายุใน ${mins}:${secs.toString().padStart(2, '0')} นาที`;
      timerEl.style.display = "block";
    } else {
      timerEl.style.display = "none";
    }
  }

  // อัพเดท floating cart badge
  updateFloatingCart();
}

function updateFloatingCart() {
  const badge = document.getElementById("floatingCartBadge");
  const btn = document.getElementById("floatingCartBtn");
  if (!badge || !btn) return;
  const count = Object.keys(cart).length;
  badge.textContent = count;
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  btn.style.display = count > 0 && isMobile ? "flex" : "none";
}

function scrollToCart() {
  const panel = document.getElementById("sidePanel");
  if (!panel) return;
  // Mobile: toggle แสดง/ซ่อนตะกร้า
  if (window.matchMedia("(max-width: 768px)").matches) {
    const isHidden = getComputedStyle(panel).display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// อัปเดต countdown ทุกวินาที (ตะกร้า + modal สรุป)
setInterval(() => {
  if (typeof getMyReservationRemaining !== 'function') return;
  const remaining = getMyReservationRemaining();
  const hasItems = Object.keys(cart).length > 0;
  const text = remaining > 0 && hasItems
    ? `ตะกร้าหมดอายุใน ${Math.floor(remaining / 60000)}:${Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')} นาที`
    : '';
  ['cartReserveTimer', 'summaryReserveTimer'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (text) { el.textContent = text; el.style.display = 'block'; }
    else { el.style.display = 'none'; }
  });
}, 1000);
