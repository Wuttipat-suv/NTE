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
      const bq = getBundleQty(item);
      const subtotal = getPrice(item) * qty * bq;
      total += subtotal;
      const maxBundles = getBundleCount(item.stock, bq);
      const stockWarn = qty > maxBundles ? 'summary-item-out' : maxBundles <= 5 ? 'summary-item-low' : '';
      const qtyLabel = bq > 1 ? `${qty} ชุด (${qty * bq} ชิ้น)` : `x${qty}`;
      return `
      <div class="summary-item ${stockWarn}">
        <span>${escapeHtml(item.name)} ${qtyLabel}</span>
        <span class="summary-item-right">
          <span class="summary-item-stock">เหลือ ${bq > 1 ? maxBundles + ' ชุด' : item.stock}</span>
          <span>${formatPrice(subtotal)} บาท</span>
        </span>
      </div>
    `;
    })
    .join("");

  document.getElementById("summaryTotalPrice").textContent = `${formatPrice(total)} บาท`;
  
  // Reset payment & coupon
  appliedCoupon = null;
  slipImageBase64 = null;
  document.getElementById("inputCoupon").value = "";
  document.getElementById("couponError").innerHTML = "";
  document.getElementById("summaryOriginalPrice").style.display = "none";
  document.getElementById("slipUpload").value = "";
  document.getElementById("slipPreview").style.display = "none";
  document.getElementById("slipUploadError").textContent = "";
  document.getElementById("qrCodeImg").src = `https://promptpay.io/${currentPromptPay}/${total}.png`;
  document.getElementById("qrCodeText").textContent = `โอนเข้าพร้อมเพย์: ${currentPromptPay}`;

  document.getElementById("inputFb").value = "";
  document.getElementById("inputCharName").value = "";
  document.getElementById("confirmCheckbox").checked = false;
  document.getElementById("summaryModal").classList.add("active");
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
      const bq = getBundleQty(item);
      const subtotal = getPrice(item) * qty * bq;
      total += subtotal;
      const maxBundles = getBundleCount(item.stock, bq);
      const stockWarn = qty > maxBundles ? 'summary-item-out' : maxBundles <= 5 ? 'summary-item-low' : '';
      const qtyLabel = bq > 1 ? `${qty} ชุด (${qty * bq} ชิ้น)` : `x${qty}`;
      return `
      <div class="summary-item ${stockWarn}">
        <span>${escapeHtml(item.name)} ${qtyLabel}</span>
        <span class="summary-item-right">
          <span class="summary-item-stock">เหลือ ${bq > 1 ? maxBundles + ' ชุด' : item.stock}</span>
          <span>${formatPrice(subtotal)} บาท</span>
        </span>
      </div>
    `;
    })
    .join("");

  // Re-apply coupon discount + update QR code
  let finalTotal = total;
  if (appliedCoupon) {
    let disc = 0;
    if (appliedCoupon.type === 'percent') disc = total * (appliedCoupon.value / 100);
    else disc = appliedCoupon.value;
    finalTotal = total - disc;
    if (finalTotal < 0) finalTotal = 0;

    const ogEl = document.getElementById("summaryOriginalPrice");
    ogEl.textContent = `ราคาปกติ ${formatPrice(total)} บาท`;
    ogEl.style.display = "block";
  }

  document.getElementById("summaryTotalPrice").textContent = `${formatPrice(finalTotal)} บาท`;
  document.getElementById("qrCodeImg").src = `https://promptpay.io/${currentPromptPay}/${finalTotal}.png`;
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
  if (!document.getElementById("confirmCheckbox").checked) {
    showFieldError("confirmCheckboxError", "กรุณายอมรับเงื่อนไขก่อนสั่งซื้อ");
    hasError = true;
  }
  if (!slipImageBase64 && customerPayMode === 'pay' && customerSlipAttach && (typeof paymentEnabled === 'undefined' || paymentEnabled)) {
    showFieldError("slipUploadError", "กรุณาอัปโหลดรูปภาพสลิปโอนเงิน");
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
  const cartItems = entries.map(([id, { item, qty }]) => {
    const bq = getBundleQty(item);
    return {
      itemId: id,
      name: item.name,
      qty: qty * bq, // แปลงชุดเป็นชิ้นจริง
      bundles: qty,
      bundleQty: bq,
    };
  });

  confirmBtn.textContent = "กำลังส่ง...";

  try {
    let couponRef = null;
    if (appliedCoupon) {
      couponRef = db.collection("coupons").doc(appliedCoupon.id);
    }

    // Transaction: อ่านราคาจาก server + ตรวจ stock + หัก stock + สร้าง order
    await db.runTransaction(async (transaction) => {
      const itemRefs = cartItems.map((ci) =>
        db.collection("items").doc(ci.itemId),
      );
      
      const promises = itemRefs.map((ref) => transaction.get(ref));
      if (couponRef) promises.push(transaction.get(couponRef));
      
      const docs = await Promise.all(promises);
      let couponData = null;

      if (couponRef) {
        const cpDoc = docs.pop(); // The last one is coupon
        if (!cpDoc.exists) throw new Error("ไม่พบข้อมูลคูปอง กรุณาตรวจสอบรหัสใหม่");
        couponData = cpDoc.data();
        if (couponData.active === false) throw new Error("คูปองนี้เพิ่งถูกปิดการใช้งานไปเมื่อสักครู่!");
        if (couponData.maxUses > 0 && (couponData.usedCount || 0) >= couponData.maxUses) {
            throw new Error("เสียใจด้วยครับ โควต้าคูปองเพิ่งถูกคนอื่นใช้เต็มไปเมื่อกี้นี้เอง");
        }
      }

      const itemDocs = docs;
      let rawTotalPrice = 0;
      const orderItems = [];

      for (let i = 0; i < itemDocs.length; i++) {
        const doc = itemDocs[i];
        if (!doc.exists) throw new Error(`ไม่พบสินค้า ${cartItems[i].name}`);

        const serverData = doc.data();
        const serverPromoValid = serverData.promoPrice != null && 
          (!serverData.promoExpiresAt || Date.now() < serverData.promoExpiresAt.toMillis());
        const serverPrice = serverPromoValid ? Number(serverData.promoPrice) : (Number(serverData.price) || 0);
        const serverStock = Number(serverData.stock) || 0;

        if (serverStock < cartItems[i].qty) {
          throw new Error(`${cartItems[i].name} เหลือแค่ ${serverStock} ชิ้น`);
        }

        const subtotal = serverPrice * cartItems[i].qty;
        rawTotalPrice += subtotal;

        orderItems.push({
          itemId: cartItems[i].itemId,
          name: cartItems[i].name,
          price: serverPrice,
          qty: cartItems[i].qty,
          subtotal,
        });
      }

      // คำนวณส่วนลด
      let finalPrice = rawTotalPrice;
      let discountAmount = 0;
      if (couponData) {
         if (couponData.type === 'percent') {
            discountAmount = rawTotalPrice * (couponData.value / 100);
         } else {
            discountAmount = couponData.value;
         }
         finalPrice = rawTotalPrice - discountAmount;
         if (finalPrice < 0) finalPrice = 0;
      }

      // หัก stock (stockHistory จะบันทึกตอน admin กดส่งของใน admin-orders.js)
      for (let i = 0; i < itemDocs.length; i++) {
        transaction.update(itemRefs[i], {
          stock: firebase.firestore.FieldValue.increment(-cartItems[i].qty),
        });
      }
      
      // อัปเดตยอดใช้คูปอง
      if (couponRef) {
         transaction.update(couponRef, {
            usedCount: firebase.firestore.FieldValue.increment(1)
         });
      }

      // สร้าง order (ไม่เก็บ slip ใน order doc เพื่อลดขนาด document)
      const orderRef = db.collection("orders").doc();
      const orderData = {
        facebook: fb,
        characterName: charName,
        items: orderItems,
        totalPrice: finalPrice,
        originalPrice: rawTotalPrice,
        discountAmount: discountAmount,
        status: "pending",
        _hp: "",
        hasSlip: !!slipImageBase64,
        paymentMode: customerPayMode === 'pay' ? 'paid' : 'unpaid',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (couponData) {
        orderData.couponCode = appliedCoupon.id;
      }

      transaction.set(orderRef, orderData);

      // เก็บ slip แยก subcollection เพื่อไม่ให้ order doc ใหญ่เกิน
      if (slipImageBase64) {
        transaction.set(orderRef.collection('attachments').doc('slip'), {
          image: slipImageBase64,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    // บันทึก cooldown
    localStorage.setItem("lastOrderTime", Date.now().toString());

    // สำเร็จ — ลบ reservation
    if (typeof deleteReservation === 'function') deleteReservation();
    closeSummaryModal();
    cart = {};
    renderCart();
    document.getElementById("successModal").classList.add("active");
  } catch (e) {
    showAlert("เกิดข้อผิดพลาด: " + e.message, "ผิดพลาด");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "ยืนยันสั่งซื้อ";
  }
}

