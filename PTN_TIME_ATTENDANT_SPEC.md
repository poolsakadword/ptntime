# PTN Time Attendant — Project Blueprint & Architecture Specification
> เอกสารสเปกและสถาปัตยกรรมระบบบันทึกเวลาทำงาน (PTN Time Attendant) สำหรับเชื่อมต่อกับ PTN Payroll

---

## 📌 1. ภาพรวมโปรเจกต์ (Project Overview)
**PTN Time Attendant** คือเว็บแอปพลิเคชันบันทึกเวลาทำงานแบบ Mobile-First สำหรับพนักงานองค์กร รองรับการใช้งานผ่านสมาร์ตโฟน มีหน้าที่หลัก:
1. **ลงเวลาเข้า-ออกงาน (Clock In / Clock Out)**: บันทึกเวลาพร้อมพิกัด GPS (Geofencing) และถ่ายภาพยืนยันตัวตน
2. **ยื่นคำขอลางาน (Leave Requests)**: พนักงานยื่นใบลาผ่านมือถือ พร้อมแนบรูปถ่ายใบรับรองแพทย์ (สำหรับลาป่วย) หรือเอกสารประกอบ
3. **ยื่นคำขอทำงานล่วงเวลา (OT Requests)**: ขออนุมัติทำโอทีก่อนหรือหลังเลิกงาน
4. **ระบบหัวหน้างาน/HR (Supervisor Approval Portal)**: ตรวจสอบและอนุมัติใบลา/OT แบบออนไลน์
5. **เชื่อมโยงข้อมูลกับ PTN Payroll อัตโนมัติ (Zero Friction Payroll Sync)**: สรุปยอดชั่วโมง OT, วันลาป่วยมีใบรับรองแพทย์/ไม่มีใบรับรองแพทย์, ขาด, สาย เพื่อส่งเข้าสู่การคำนวณเงินเดือนในคลิกเดียว

---

## 🗄️ 2. สถาปัตยกรรมฐานข้อมูล (Shared D1 Database)
PTN Time Attendant จะเชื่อมต่อกับ **Cloudflare D1 Database เดียวกันกับ PTN Payroll** เพื่อให้ใช้ข้อมูลพนักงานชุดเดียวกันแบบ Real-time โดยไม่มีค่าใช้จ่ายเซิร์ฟเวอร์เพิ่มเติม

### การตั้งค่า D1 Binding (`wrangler.toml`):
```toml
name = "ptn-time-attendant"
compatibility_date = "2024-08-01"
pages_build_output_dir = "public"

[[d1_databases]]
binding = "DB"
database_name = "ptn_payroll_db"
database_id = "5a72c7dd-fedb-4583-85f9-b29964845560"
```

---

## 📋 3. โครงสร้างตารางฐานข้อมูลใหม่ (Proposed Database Schema)

### 3.1 ตารางบันทึกเวลาเข้า-ออก (`time_logs`)
```sql
CREATE TABLE IF NOT EXISTS time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id TEXT NOT NULL,
  date TEXT NOT NULL,            -- รูปแบบ 'YYYY-MM-DD'
  clock_in TEXT,                 -- เวลาเข้างาน เช่น '08:25:00'
  clock_out TEXT,                -- เวลาออกงาน เช่น '17:35:00'
  in_lat REAL,                   -- พิกัดละติจูดเข้างาน
  in_lng REAL,                   -- พิกัดลองจิจูดเข้างาน
  out_lat REAL,                  -- พิกัดละติจูดออกงาน
  out_lng REAL,                  -- พิกัดลองจิจูดออกงาน
  in_photo_url TEXT,             -- รูปถ่ายเซลฟี่ตอนเข้างาน (Base64 หรือ R2 URL)
  out_photo_url TEXT,            -- รูปถ่ายเซลฟี่ตอนออกงาน
  late_minutes INTEGER DEFAULT 0,-- จำนวนนาทีที่มาสาย
  work_hours REAL DEFAULT 0,     -- ชั่วโมงทำงานจริง
  status TEXT DEFAULT 'NORMAL',  -- 'NORMAL', 'LATE', 'EARLY_DEPART', 'INCOMPLETE'
  remark TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (emp_id) REFERENCES employees(emp_id)
);
CREATE INDEX IF NOT EXISTS idx_time_logs_emp_date ON time_logs(emp_id, date);
```

### 3.2 ตารางคำขอลางาน (`leave_requests`)
```sql
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,       -- 'SICK_WITH_CERT', 'SICK_NO_CERT', 'BUSINESS', 'ANNUAL', 'WITHOUT_PAY'
  start_date TEXT NOT NULL,       -- 'YYYY-MM-DD'
  end_date TEXT NOT NULL,         -- 'YYYY-MM-DD'
  days_count REAL DEFAULT 1.0,    -- จำนวนวันลา เช่น 0.5, 1.0, 2.0
  reason TEXT,
  medical_cert_url TEXT,          -- รูปภาพใบรับรองแพทย์ (รองรับโควตาลาป่วย 10 วัน/ปี ของระบบ Payroll)
  status TEXT DEFAULT 'PENDING',  -- 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'
  approver_id TEXT,               -- รหัสผู้มีสิทธิ์อนุมัติ
  approved_at DATETIME,
  rejection_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (emp_id) REFERENCES employees(emp_id)
);
```

### 3.3 ตารางขอทำโอที (`ot_requests`)
```sql
CREATE TABLE IF NOT EXISTS ot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_id TEXT NOT NULL,
  date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  planned_hours REAL NOT NULL,    -- จำนวนชั่วโมง OT ที่ขอ
  actual_hours REAL DEFAULT 0,    -- จำนวนชั่วโมงจริงหลัง Clock Out
  ot_type REAL DEFAULT 1.5,       -- อัตรา OT เช่น 1.5x (วันปกติ) หรือ 3.0x (วันหยุด)
  reason TEXT,
  status TEXT DEFAULT 'PENDING',  -- 'PENDING', 'APPROVED', 'REJECTED'
  approver_id TEXT,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (emp_id) REFERENCES employees(emp_id)
);
```

### 3.4 ตารางตั้งค่าพิกัดสำนักงานและกะงาน (`attendance_settings`)
```sql
CREATE TABLE IF NOT EXISTS attendance_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- ตัวอย่างค่า:
-- office_lat = 13.xxxxxx
-- office_lng = 100.xxxxxx
-- geofence_radius_meters = 150
-- work_start_time = '08:30'
-- work_end_time = '17:30'
-- grace_period_minutes = 15
```

---

## 🔗 4. จุดเชื่อมโยงระหว่าง PTN Time -> PTN Payroll
เมื่อ HR ในระบบ PTN Payroll กดปุ่ม "ดึงข้อมูลเวลาจาก PTN Time" ที่รอบเดือน YYYY-MM:
- ot_hours: ผลรวม actual_hours จาก ot_requests ที่สถานะ APPROVED ในงวดนั้น
- sick_leave_days (ลาป่วยมีใบรับรอง): ผลรวม days_count จาก leave_requests ประเภท SICK_WITH_CERT ที่ได้รับอนุมัติ (คิดสิทธิ์ฟรี 10 วัน/ปี ในระบบ Payroll)
- unpaid_sick_leave_days (ลาป่วยไม่มีใบรับรอง): ผลรวม days_count จาก leave_requests ประเภท SICK_NO_CERT (หักเงิน 1.0x ทันที)
- leave_days (ลากิจ): ผลรวม days_count จาก leave_requests ประเภท BUSINESS หรือ WITHOUT_PAY
- absent_days (ขาดงาน): จำนวนวันทำงานที่ไม่มีทั้ง time_logs และไม่มีใบลาที่ได้รับอนุมัติ
- late_deduct (มาสาย): ยอดหักเงินมาสายคำนวณจากผลรวมนาทีสายใน time_logs
