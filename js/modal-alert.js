// ============================================
// Shared Utilities
// ============================================

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML.replace(/'/g, '&#39;');
}

// ============================================
// Modal Alert & Confirm (แทน alert/confirm)
// ============================================

function showAlert(msg, title) {
  const overlay = document.getElementById('alertModal');
  document.getElementById('alertModalTitle').textContent = title || 'แจ้งเตือน';
  document.getElementById('alertModalMsg').textContent = msg;
  document.getElementById('alertModalButtons').innerHTML =
    '<button class="btn-primary" style="width:auto;margin:0 auto;padding:10px 40px;" onclick="closeAlertModal()">ตกลง</button>';
  overlay.classList.add('active');
}

function showConfirm(msg, title) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('alertModal');
    document.getElementById('alertModalTitle').textContent = title || 'ยืนยัน';
    document.getElementById('alertModalMsg').textContent = msg;
    document.getElementById('alertModalButtons').innerHTML =
      '<button class="btn-secondary" id="confirmNo">ยกเลิก</button>' +
      '<button class="btn-primary" id="confirmYes" style="width:auto;padding:10px 30px;">ยืนยัน</button>';
    overlay.classList.add('active');

    document.getElementById('confirmYes').onclick = () => { closeAlertModal(); resolve(true); };
    document.getElementById('confirmNo').onclick = () => { closeAlertModal(); resolve(false); };
  });
}

function closeAlertModal() {
  document.getElementById('alertModal').classList.remove('active');
}

// ============ Toast Notification ============
const TOAST_MAX = 3;
const _toastQueue = [];
let _activeToasts = 0;

function getToastContainer() {
  return document.getElementById('toastContainer');
}

function _processToastQueue() {
  while (_toastQueue.length > 0 && _activeToasts < TOAST_MAX) {
    const data = _toastQueue.shift();
    _showToastNow(data);
  }
}

function _showToastNow(data) {
  _activeToasts++;
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'toast-notification';

  if (data.items && data.items.length > 0) {
    // Order toast: หลายสินค้าพร้อมรูป
    const label = document.createElement('span');
    label.className = 'toast-label';
    label.textContent = 'มีลูกค้าซื้อ';
    toast.appendChild(label);
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'toast-items';
    for (const item of data.items) {
      const row = document.createElement('div');
      row.className = 'toast-item-row';
      if (item.image) {
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = '';
        img.className = 'toast-img';
        row.appendChild(img);
      }
      const name = document.createElement('span');
      name.textContent = `${item.name} x${item.qty}`;
      row.appendChild(name);
      itemsWrap.appendChild(row);
    }
    toast.appendChild(itemsWrap);
  } else {
    // Simple toast
    if (data.imgSrc) {
      const img = document.createElement('img');
      img.src = data.imgSrc;
      img.alt = '';
      img.className = 'toast-img';
      toast.appendChild(img);
    }
    const text = document.createElement('span');
    text.textContent = data.msg;
    toast.appendChild(text);
  }

  if (!container) { _activeToasts--; return; }
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
      _activeToasts--;
      _processToastQueue();
    }, 600);
  }, data.duration || 5000);
}

function showToast(msg, duration, imgSrc) {
  const data = { msg, duration, imgSrc };
  if (_activeToasts < TOAST_MAX) {
    _showToastNow(data);
  } else {
    _toastQueue.push(data);
  }
}

function showOrderToast(items, duration) {
  const data = { items, duration };
  if (_activeToasts < TOAST_MAX) {
    _showToastNow(data);
  } else {
    _toastQueue.push(data);
  }
}
