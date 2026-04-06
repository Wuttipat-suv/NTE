# Plan — ฟีเจอร์ & การปรับปรุง

## ✅ 1. หมวดหมู่สินค้า (Category Tabs)
- Shop: tab กรองสินค้าตามหมวด, sub-tabs ประวัติ (ประวัติสั่ง / ประวัติร้าน)
- Admin: CRUD หมวดหมู่ (drag เรียงลำดับ), bulk assign สินค้า (📦), checkbox ใน modal เพิ่ม/แก้ไข, rename เป็น modal
- Firestore: `settings/categories` → `{ list: [{id, name, order}] }`, items มี `categories: []`

## ✅ รวม Admin Tab (5 → 3)
- เดิม: Order Board / สินค้า / BAN / ส่วนลด / แอดมิน
- ใหม่: **Order Board** / **จัดการสินค้า** / **ตั้งค่า** (รวม BAN + คูปอง + พร้อมเพย์ + แอดมิน)
- แอดมินทั่วไปเห็นแค่ BAN, owner เห็นทั้งหมด (ใช้ class `.owner-only`)

## ✅ Bug Fixes (รอบ 1)
- ปุ่ม BAN แสดงเฉพาะ order pending + FB ยังไม่ถูก ban (เพิ่ม `bannedSet` ตรวจสอบ)
- ซ่อน side-panel (ตะกร้า) บนมือถือ — ใช้ floating cart button แทน
- แอดมินสมัครใหม่ไม่ขึ้นคำขอ → เพิ่มปุ่ม "สมัครใหม่" ใช้ `createUserWithEmailAndPassword`

---

## ✅ 2. External Admin + Item Visibility
- Role: `owner` / `admin` / `external` ใน `admin_users`
- Owner เลือก role ตอนอนุมัติ (modal pickRole) + เปลี่ยนได้ภายหลัง (ปุ่ม "เป็น Admin" / "เป็นภายนอก")
- External admin: เห็นเฉพาะสินค้าที่มี adminStock ของตัวเอง + order ที่มีสินค้าตัวเอง
- ซ่อน: tab ตั้งค่า, shop toggle, pay mode, หมวดหมู่, stock toggles
- `isMyProduct()` helper ตรวจสอบจาก `adminStock` + `getAdminAliases`

---

## ✅ 3. Quota Optimization & Auto-Close
**เป้าหมาย**: ลด Firestore quota usage + ปิดร้านอัตโนมัติเมื่อ quota หมด

### สิ่งที่ทำแล้ว
- [x] Auto-close shop เมื่อ quota error (`enterQuotaSavingMode` → set `shopState: 'force_close'`)
- [x] รวม `settings/shop` listeners ฝั่ง admin: 3 → 1 (shared listener + callback)
- [x] Page Visibility: ปิด shop settings listener เมื่อ tab hidden (ทั้ง shop + admin)
- [x] Orders listener: real-time เฉพาะ `status == 'pending'`, completed/cancelled โหลดครั้งเดียว
- [x] Reservation listener: เปิดเฉพาะเมื่อ cart มีของ (ประหยัด quota จากคนดูเฉยๆ)
- [x] เพิ่ม Firestore composite index: `orders(status, createdAt)`

---

## ✅ 4. Bug Fix: Bundle/Set Stock Deduction
**ปัญหา**: สินค้าแบบชุด (bundleQty > 1) สั่ง 6 ชุด แต่หัก stock เพียง 6 ชิ้น แทนที่จะหัก 30 ชิ้น (6×5)
**สาเหตุ**: cart cache item ไม่มี `bundleQty` (เก่า/stale) ทำให้ `getBundleQty()` return 1
**แก้ไข**:
- [x] Checkout transaction: อ่าน `bundleQty` จาก server data แทน cart cache
- [x] Cart renderCart: sync ข้อมูลล่าสุดจาก items array ทุกครั้ง
- [x] Error message แสดงเป็น "ชุด" แทน "ชิ้น" สำหรับ bundle items

---

## ✅ 5. New Order Notification (Admin)
**เป้าหมาย**: แอดมินรู้ทันทีเมื่อมี order ใหม่ แม้อยู่ tab อื่น
- [x] Badge บน tab "Order Board" แสดงจำนวน order ใหม่
- [x] เสียงแจ้งเตือน (beep 2 โน้ต)
- [x] Badge หายเมื่อกลับมาที่ tab orders

---

## ✅ 6. Shop Pagination
**เป้าหมาย**: แบ่งหน้าสินค้า ไม่ต้อง scroll ยาว
- [x] 12 items ต่อหน้า + ปุ่ม ก่อนหน้า/ถัดไป
- [x] Reset หน้า 1 เมื่อเปลี่ยน category
- [x] Scroll to top เมื่อเปลี่ยนหน้า

---

## ✅ 7. Reservation Timer + Admin Reservation Panel
**เป้าหมาย**: ลูกค้าเห็นเวลาจอง + แอดมินเห็น reservation ทั้งหมด

### สิ่งที่ทำแล้ว
- [x] เปลี่ยน TTL จาก 15 นาที → 10 นาที
- [x] ลูกค้า: reserved badge แสดง countdown `"2 จอง (3:42)"` อัปเดตทุกวินาที
- [x] Admin: reservation panel ใน Order Board แสดงทุก session พร้อม countdown
- [x] Admin: ชื่อสินค้า resolve จาก `allProducts`, timer สีเปลี่ยนตามความเร่งด่วน
- [x] Admin: reservation listener มี visibility pause/resume + quota teardown
- [x] stock กลับมาอัตโนมัติเมื่อหมดเวลาจอง (มีอยู่แล้ว — snapshot filter `expiresAt > now`)

---

## ลำดับแนะนำ
1. ~~หมวดหมู่~~ ✅
2. ~~รวม Admin Tab~~ ✅
3. ~~Bug Fixes~~ ✅
4. ~~External Admin~~ ✅
5. ~~Quota Optimization~~ ✅
6. ~~Bundle Stock Bug~~ ✅
7. ~~Order Notification~~ ✅
8. ~~Shop Pagination~~ ✅
9. ~~Reservation Timer + Admin Panel~~ ✅
