# PTN Time Attendant
> ระบบบันทึกเวลาทำงาน พิกัด GPS ขาด ลา มา สาย และขอ OT แบบ Mobile-First
> บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด

## โครงสร้างโปรเจกต์
- `public/`: ส่วนแสดงผลหน้าเว็บแอปพลิเคชัน (Mobile-First Web App)
  - `index.html`: หน้าจอลงเวลาสำหรับพนักงานและพอร์ทัลอนุมัติสำหรับหัวหน้างาน/HR
  - `css/`: สไตล์การจัดวางและการแสดงผล
  - `js/`: ระบบคำนวณพิกัด Geofence, กล้องเซลฟี่, จัดการคำขอลา และ OT
- `functions/`: Cloudflare Pages Functions Backend (เชื่อมต่อ Cloudflare D1 Database)
  - `api.js`: API Endpoint จัดการฐานข้อมูลเวลา, ตรวจสอบระยะพิกัด, และประมวลผลคำขอ
- `wrangler.toml`: ค่าคอนฟิกสำหรับ Cloudflare Pages และ D1 Binding
