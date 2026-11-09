/**
 * Database & Core Helpers Module
 */

export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function timeToMinutes(tStr) {
  if (!tStr) return 0;
  const parts = tStr.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function minutesToTime(totalMins) {
  const h = Math.floor(totalMins / 60) % 24;
  const m = Math.floor(totalMins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getMinutesDiff(tStr1, tStr2) {
  return timeToMinutes(tStr2) - timeToMinutes(tStr1);
}

export function timeStringToMinutes(t) {
  if (!t) return null;
  const p = String(t).trim().split(':');
  return p.length >= 2 ? (parseInt(p[0], 10) * 60 + parseInt(p[1], 10)) : null;
}

export function normalizeDateToIso(str) {
  if (!str) return '';
  const s = String(str).trim();
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const d = (match[1].length < 2 ? '0' : '') + match[1];
    const m = (match[2].length < 2 ? '0' : '') + match[2];
    let y = parseInt(match[3], 10);
    if (y > 2400) y -= 543;
    return `${y}-${m}-${d}`;
  }
  return s.substring(0, 10);
}

export function getBangkokTimeContext() {
  const nowUtc = new Date();
  const bangkokTime = new Date(nowUtc.getTime() + (7 * 3600 * 1000));
  const today = bangkokTime.toISOString().substring(0, 10);
  const curTimeStr = bangkokTime.toISOString().substring(11, 19);
  const dayOfWeekNumber = bangkokTime.getDay();
  return { nowUtc, bangkokTime, today, curTimeStr, dayOfWeekNumber };
}

let isTablesEnsured = false;

export async function ensureTables(db) {
  if (isTablesEnsured) return;
  isTablesEnsured = true;
  try {
    const check = await db.prepare("SELECT 1 FROM employees LIMIT 1").first().catch(() => null);
    if (check !== null && check !== undefined) {
      return;
    }
  } catch (e) {}

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS employee_devices (
      emp_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      device_name TEXT,
      bound_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_employee_devices_dev ON employee_devices(device_id)').run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT NOT NULL,
      date TEXT NOT NULL,
      clock_in TEXT,
      clock_out TEXT,
      in_lat REAL,
      in_lng REAL,
      out_lat REAL,
      out_lng REAL,
      in_photo_url TEXT,
      out_photo_url TEXT,
      late_minutes INTEGER DEFAULT 0,
      work_hours REAL DEFAULT 0,
      ot_hours REAL DEFAULT 0,
      status TEXT DEFAULT 'NORMAL',
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_time_logs_emp_date ON time_logs(emp_id, date)').run().catch(() => {});

  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_out TEXT').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_in TEXT').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_out_photo_url TEXT').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_in_photo_url TEXT').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_out_lat REAL').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_out_lng REAL').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_in_lat REAL').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_in_lng REAL').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN break_minutes INTEGER DEFAULT 0').run().catch(() => {});
  await db.prepare('ALTER TABLE time_logs ADD COLUMN overbreak_minutes INTEGER DEFAULT 0').run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_count REAL DEFAULT 1.0,
      reason TEXT,
      medical_cert_url TEXT,
      status TEXT DEFAULT 'PENDING',
      approver_id TEXT,
      approved_at DATETIME,
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ot_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT NOT NULL,
      date TEXT NOT NULL,
      planned_hours REAL NOT NULL,
      actual_hours REAL DEFAULT 0,
      ot_type REAL DEFAULT 1.5,
      reason TEXT,
      status TEXT DEFAULT 'PENDING',
      approver_id TEXT,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_ot_requests_emp_date ON ot_requests(emp_id, date)').run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS advance_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT NOT NULL,
      period TEXT NOT NULL,
      request_date TEXT NOT NULL,
      amount REAL NOT NULL,
      days_worked REAL DEFAULT 0,
      rate_per_day REAL DEFAULT 250,
      reason TEXT,
      status TEXT DEFAULT 'PENDING',
      approver_id TEXT,
      approved_at DATETIME,
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_advance_requests_emp_period ON advance_requests(emp_id, period)').run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS attendance_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS branches (
      branch_id TEXT PRIMARY KEY,
      branch_name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius_meters INTEGER DEFAULT 200,
      work_start_time TEXT DEFAULT '09:30',
      work_end_time TEXT DEFAULT '19:00',
      lunch_start_time TEXT DEFAULT '13:00',
      lunch_end_time TEXT DEFAULT '14:00',
      grace_minutes INTEGER DEFAULT 0,
      ot_start_time TEXT DEFAULT '19:00',
      kiosk_pin TEXT DEFAULT '123456',
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});

  const countRow = await db.prepare('SELECT COUNT(*) as count FROM branches').first().catch(() => null);
  if (!countRow || countRow.count === 0) {
    await db.prepare(`
      INSERT OR IGNORE INTO branches (branch_id, branch_name, lat, lng, radius_meters, work_start_time, work_end_time, lunch_start_time, lunch_end_time, grace_minutes, ot_start_time, kiosk_pin, status)
      VALUES 
        ('B01', 'สำนักงานใหญ่', 15.678794, 100.090403, 50, '09:30', '19:00', '13:00', '14:00', 0, '19:00', '123456', 'ACTIVE'),
        ('B02', 'สาขาที่ 2 (หน้าร้าน A)', 13.756300, 100.501800, 150, '09:30', '19:00', '13:00', '14:00', 0, '19:00', '123456', 'ACTIVE'),
        ('B03', 'สาขาที่ 3 (หน้าร้าน B)', 13.712000, 100.589000, 150, '10:00', '20:00', '13:30', '14:30', 0, '20:00', '123456', 'ACTIVE'),
        ('B04', 'สาขาที่ 4 (คลังสินค้า/สำรอง)', 13.789000, 100.550000, 200, '09:00', '18:00', '12:00', '13:00', 0, '18:00', '123456', 'ACTIVE')
    `).run().catch(() => {});
  }

  await db.prepare("ALTER TABLE employees ADD COLUMN branch_id TEXT DEFAULT 'B01'").run().catch(() => {});
  await db.prepare("ALTER TABLE employees ADD COLUMN allow_all_branches TEXT DEFAULT 'false'").run().catch(() => {});
  await db.prepare("ALTER TABLE employees ADD COLUMN is_ot_eligible TEXT DEFAULT 'true'").run().catch(() => {});
  await db.prepare("ALTER TABLE employees ADD COLUMN is_undertime_exempt TEXT DEFAULT 'false'").run().catch(() => {});
  await db.prepare("ALTER TABLE employees ADD COLUMN is_attendance_exempt TEXT DEFAULT 'false'").run().catch(() => {});
  await db.prepare("ALTER TABLE time_logs ADD COLUMN branch_id TEXT").run().catch(() => {});
  await db.prepare("ALTER TABLE time_logs ADD COLUMN branch_name TEXT").run().catch(() => {});
  await db.prepare("ALTER TABLE branches ADD COLUMN early_dismissal_full_pay INTEGER DEFAULT 0").run().catch(() => {});
  await db.prepare("ALTER TABLE time_logs ADD COLUMN is_full_pay INTEGER DEFAULT 0").run().catch(() => {});
  await db.prepare("UPDATE branches SET radius_meters = 100 WHERE branch_id = 'B03' AND radius_meters < 100").run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS company_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      holiday_name TEXT NOT NULL,
      holiday_type TEXT DEFAULT 'COMPANY',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_company_holidays_date ON company_holidays(date)').run().catch(() => {});

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      app_type TEXT DEFAULT 'PTNTIME',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {});
  await db.prepare("ALTER TABLE push_subscriptions ADD COLUMN app_type TEXT DEFAULT 'PTNTIME'").run().catch(() => {});

  isTablesEnsured = true;
}

export const STATIC_QR_CODE_KEY = 'PTN-OFFICE-STATIC-QR-2026-HQ';

export async function getSettings(db) {
  const rows = await db.prepare('SELECT key, value FROM attendance_settings').all().catch(() => ({ results: [] }));
  const defaults = {
    office_name: 'บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด',
    office_lat: 13.7278956,
    office_lng: 100.5241234,
    geofence_radius_meters: 200,
    cutoff_day: 25,
    work_start_time: '09:30',
    grace_period_morning_minutes: 0,
    lunch_start_time: '13:00',
    lunch_end_time: '14:00',
    grace_period_afternoon_minutes: 0,
    work_end_time: '19:00',
    ot_start_time: '19:00',
    sunday_ot_rate: 1.0,
    ot_rounding_mode: 'HALF_HOUR',
    advance_day_of_week: 'SATURDAY',
    advance_start_time: '09:00',
    advance_end_time: '18:00',
    advance_daily_rate: 250,
    advance_max_amount: 3000,
    enable_leave_requests: 'true',
    enable_ot_requests: 'true',
    enable_advance_requests: 'true',
    qr_mode: 'HYBRID',
    static_qr_key: STATIC_QR_CODE_KEY,
    allow_outside_clockin: 'false',
    enable_device_lock: 'true',
    allow_direct_gps: 'true',
    break_tracking_mode: 'AUTO_DEDUCT',
    break_duration_minutes: 60,
    enable_face_detection: 'true',
    unlock_method_password: 'true',
    unlock_method_qr: 'true',
    unlock_method_remote: 'true',
    leave_type_sick_with_cert: 'true',
    leave_type_sick_no_cert: 'true',
    leave_type_business: 'false',
    leave_type_annual: 'false',
    leave_type_without_pay: 'false',
    enable_time_window_restrictions: 'false',
    window_in_start: '06:00',
    window_in_end: '12:00',
    window_break_out_start: '11:30',
    window_break_out_end: '14:30',
    window_break_in_start: '12:00',
    window_break_in_end: '15:30',
    window_out_start: '17:00',
    window_out_end: '23:59',
    enable_kiosk_lock: 'true',
    kiosk_pin: '123456',
    kiosk_require_geofence: 'true',
    system_maintenance_mode: 'false',
    system_maintenance_message: 'ระบบลงเวลา PTN Time อยู่ระหว่างปิดปรับปรุงชั่วคราว เพื่อเพิ่มประสิทธิภาพการทำงาน ขออภัยในความไม่สะดวก',
    enable_payslip: 'true',
    payslip_release_mode: 'CLOSED_PERIODS_ONLY',
    enable_selfie_greetings: 'true',
    enable_selfie_clockin_greetings: 'true',
    enable_selfie_break_greetings: 'true',
    enable_selfie_clockout_greetings: 'true',
    enable_birthday_greeting: 'true',
    enable_saturday_greeting: 'true',
    selfie_custom_messages: 'สวัสดีตอนเช้าค่ะ วันนี้ยิ้มสดใสมาก ขอให้เป็นวันที่ราบรื่นและมีความสุขนะคะ 🌸\nพร้อมลุยงานวันนี้! ยิ้มรับลูกค้าด้วยหัวใจบริการค่ะ ✨\nเริ่มต้นวันใหม่ด้วยพลังบวก ขอให้การทำงานวันนี้ราบรื่นสำเร็จทุกสิ่งนะคะ 💖',
    selfie_custom_messages_break: 'ทานอาหารกลางวันให้อร่อยนะคะ ชาร์จพลังให้เต็มที่ 🍜🍱\nพักสายตาและผ่อนคลายความเหนื่อยล้าสักครู่ค่ะ ☕🍰\nชาร์จพลังเต็มที่แล้ว พร้อมลุยงานช่วงบ่ายอย่างสดชื่นค่ะ 💪✨',
    selfie_custom_messages_out: 'ขอบคุณสำหรับความทุ่มเทในวันนี้นะคะ ทำงานเหนื่อยมาทั้งวันแล้ว เก่งมากๆ ค่ะ 👏💖\nเดินทางกลับบ้านโดยสวัสดิภาพนะคะ พักผ่อนให้เต็มที่ พรุ่งนี้พบกันใหม่ค่ะ 🚗🏠\nทำงานสำเร็จไปอีกวันแล้ว วันนี้คุณทำได้ยอดเยี่ยมมากค่ะ 🌟'
  };

  const map = { ...defaults };
  for (const r of rows.results || []) {
    if (r.key in defaults && typeof defaults[r.key] === 'number') {
      map[r.key] = Number(r.value);
    } else {
      map[r.key] = r.value;
    }
  }
  return map;
}

export async function getEmployeeBranchConfig(db, empId, lat, lng, defaultSettings) {
  const emp = await db.prepare('SELECT emp_id, branch_id, allow_all_branches, is_undertime_exempt FROM employees WHERE emp_id = ?').bind(empId).first().catch(() => null);
  const allowAll = (emp && (emp.allow_all_branches === 'true' || emp.allow_all_branches === true));
  const isUndertimeExempt = (emp && (emp.is_undertime_exempt === 'true' || emp.is_undertime_exempt === true || emp.is_undertime_exempt === 1 || emp.is_undertime_exempt === '1'));
  const assignedBranchId = emp?.branch_id || 'B01';

  const branchRows = await db.prepare("SELECT * FROM branches WHERE status != 'INACTIVE' ORDER BY branch_id ASC").all().catch(() => ({ results: [] }));
  const branches = branchRows.results || [];

  let chosenBranch = null;

  if (branches.length > 0) {
    if (allowAll && lat && lng) {
      let closest = null;
      let minDistance = Infinity;
      for (const b of branches) {
        if (b.lat && b.lng) {
          const dist = calculateDistanceMeters(lat, lng, b.lat, b.lng);
          if (dist !== null && dist < minDistance) {
            minDistance = dist;
            closest = b;
          }
        }
      }
      chosenBranch = closest || branches.find(b => b.branch_id === assignedBranchId) || branches[0];
    } else {
      chosenBranch = branches.find(b => b.branch_id === assignedBranchId) || branches[0];
    }
  }

  if (chosenBranch) {
    return {
      branchId: chosenBranch.branch_id,
      branchName: chosenBranch.branch_name,
      lat: chosenBranch.lat || defaultSettings.office_lat,
      lng: chosenBranch.lng || defaultSettings.office_lng,
      radiusMeters: chosenBranch.radius_meters || defaultSettings.geofence_radius_meters,
      workStartTime: chosenBranch.work_start_time || defaultSettings.work_start_time,
      workEndTime: chosenBranch.work_end_time || defaultSettings.work_end_time,
      lunchStartTime: chosenBranch.lunch_start_time || defaultSettings.lunch_start_time,
      lunchEndTime: chosenBranch.lunch_end_time || defaultSettings.lunch_end_time,
      graceMinutes: (chosenBranch.grace_minutes !== undefined && chosenBranch.grace_minutes !== null) ? Number(chosenBranch.grace_minutes) : (Number(defaultSettings.grace_period_morning_minutes) || 0),
      otStartTime: chosenBranch.ot_start_time || chosenBranch.work_end_time || defaultSettings.ot_start_time,
      kioskPin: chosenBranch.kiosk_pin || defaultSettings.kiosk_pin || '123456',
      isUndertimeExempt,
      earlyDismissalFullPay: (chosenBranch.early_dismissal_full_pay === 1 || chosenBranch.early_dismissal_full_pay === '1' || chosenBranch.early_dismissal_full_pay === 'true' || chosenBranch.early_dismissal_full_pay === true)
    };
  }

  return {
    branchId: 'B01',
    branchName: 'สำนักงานใหญ่',
    lat: defaultSettings.office_lat,
    lng: defaultSettings.office_lng,
    radiusMeters: defaultSettings.geofence_radius_meters,
    workStartTime: defaultSettings.work_start_time,
    workEndTime: defaultSettings.work_end_time,
    lunchStartTime: defaultSettings.lunch_start_time,
    lunchEndTime: defaultSettings.lunch_end_time,
    graceMinutes: Number(defaultSettings.grace_period_morning_minutes) || 0,
    otStartTime: defaultSettings.ot_start_time,
    kioskPin: defaultSettings.kiosk_pin || '123456'
  };
}
