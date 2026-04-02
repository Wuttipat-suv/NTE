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
  const unitPrice = bq;
  document.getElementById("modalItemImg").src = currentItem.image;
  document.getElementById("modalItemName").textContent = currentItem.name + (bq > 1 ? ` (ชุดละ ${bq} ชิ้น)` : '');
  document.getElementById("modalItemPriceUnit").innerHTML =
    isPromoValid(currentItem)
      ? `<div class="promo-countdown" data-expires="${currentItem.promoExpiresAt ? currentItem.promoExpiresAt.toMillis() : ''}"></div>
         <span class="original-price">${priceUnit} ${formatPrice(currentItem.price * bq)} บาท</span> <span class="promo-price">${priceUnit} ${formatPrice(currentItem.promoPrice * bq)} บาท</span>`
      : `${priceUnit} ${formatPrice(getPrice(currentItem) * bq)} บาท`;
  const stockLabel = bq > 1 ? `เหลือ ${canAddBundles} ชุด` : `เหลือ ${canAddBundles} ชิ้น`;
  document.getElementById("modalStockInfo").textContent =
    stockLabel + (reserved > 0 ? ` (${reserved} ถูกจองโดยคนอื่น)` : '');
  updateQtyDisplay(canAddBundles);
  document.getElementById("itemModal").classList.add("active");
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
    return;
  }

  let total = 0;
  cartList.innerHTML = entries
    .map(([id, { item, qty }]) => {
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
}
