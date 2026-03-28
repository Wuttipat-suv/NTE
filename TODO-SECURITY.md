# Security & Performance TODO

## 1. Firestore Rules: items & settings — ใครก็เขียนได้
- ตอนนี้ `allow write: if true` ทั้ง items และ settings
- ใครก็แก้ราคา/stock/ลบสินค้า/เปลี่ยนรหัส admin/เปิดปิดร้านได้
- **แก้**: เพิ่ม Firebase Auth แล้วเช็ค `request.auth.uid` ใน rules หรือใช้ custom claim

## 2. Order Update Rule — แก้ field อะไรก็ได้
- ตอนนี้ `allow update: if request.resource.data.status in [...]`
- ใครก็แก้ totalPrice, facebook, items ได้ ขอแค่ status ถูก
- **แก้**: จำกัดให้ update ได้แค่ `status` กับ `handledBy`

## 3. Admin Password — plaintext + อ่านได้จาก client
- เก็บ password ใน `settings/admin` เป็น plaintext
- Firestore rules `allow read: if true` ใครก็อ่านรหัสได้
- **แก้**: ย้ายไป Firebase Auth (email/password) แล้วลบ password จาก Firestore

## 4. loadOrders() ไม่มี limit
- โหลด ALL orders ทุก order ตั้งแต่เริ่มร้าน
- ยิ่ง order เยอะยิ่งช้า + ค่า Firestore reads แพง
- **แก้**: เพิ่ม `.limit()` หรือ filter เฉพาะ pending + recent
