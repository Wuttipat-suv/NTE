const itemCard = `
    <div class="item-card">
        <div class="stock-badge">คงเหลือ ${item.stock}</div>
        <img src="${item.image}" alt="${item.name}">
        <div class="item-name">${item.name}</div>
        <div class="item-price">
            <span class="promo-price">${item.price} บาท</span>
        </div>
        <button class="btn-primary" style="padding: 8px; margin-top: 10px;" onclick="addToCart('${key}')">
            เพิ่มลงตะกร้า
        </button>
    </div>
`;