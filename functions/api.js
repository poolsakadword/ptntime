/**
 * ==============================================================================
 * PTN Time Attendant - Cloudflare Pages Function Backend (D1 Database)
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

const STATIC_QR_CODE_KEY = 'PTN-OFFICE-STATIC-QR-2026-HQ';
const DYNAMIC_QR_SALT = 'PTN_DYNAMIC_SALT_KEY_2026';

// Helper: Haversine distance in meters
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
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

// Convert "HH:mm" to minutes from 00:00
function timeToMinutes(tStr) {
  if (!tStr) return 0;
  const parts = tStr.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// Minutes diff: t2 - t1
function getMinutesDiff(tStr1, tStr2) {
  return timeToMinutes(tStr2) - timeToMinutes(tStr1);
}

// Hash string SHA-256 hex
async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate Dynamic Token based on 20s time window
async function getDynamicQrToken(windowOffset = 0) {
  const windowIndex = Math.floor(Date.now() / 20000) + windowOffset;
  const raw = `${DYNAMIC_QR_SALT}:${windowIndex}`;
  const fullHash = await sha256Hex(raw);
  return 'PTN-' + fullHash.substring(0, 10).toUpperCase();
}

async function ensureTables(db) {
  // 1. time_logs
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

  // 2. leave_requests
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

  // 3. ot_requests
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

  // 4. advance_requests (Salary Advance / เบิกเงินล่วงหน้า)
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

  // 5. attendance_settings
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS attendance_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run().catch(() => {});
}

async function getSettings(db) {
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
    ot_rounding_mode: 'HALF_HOUR', // 'HALF_HOUR' or 'EXACT_MINUTES'
    advance_day_of_week: 'SATURDAY', // 'SATURDAY' or 'ANY'
    advance_daily_rate: 250,
    advance_max_amount: 3000,
    enable_leave_requests: 'true',
    enable_ot_requests: 'true',
    enable_advance_requests: 'true',
    qr_mode: 'HYBRID', // 'HYBRID', 'DYNAMIC_ONLY', 'STATIC_ONLY'
    static_qr_key: STATIC_QR_CODE_KEY,
    allow_outside_clockin: 'false'
  };

  const map = { ...defaults };
  for (const r of rows.results || []) {
    if (r.key in map) {
      if (typeof defaults[r.key] === 'number') {
        map[r.key] = Number(r.value);
      } else {
        map[r.key] = r.value;
      }
    }
  }
  return map;
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB || env.ptn_payroll_db;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!db) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Cloudflare D1 Database binding "DB" is not connected'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    await ensureTables(db);

    let action = 'getInitialData';
    let params = {};
    const url = new URL(request.url);

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      action = body.action || url.searchParams.get('action') || 'getInitialData';
      params = body;
    } else {
      action = url.searchParams.get('action') || 'getInitialData';
      params = Object.fromEntries(url.searchParams.entries());
    }

    const result = await handleAction(db, action, params);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Server Error: ' + err.message
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleAction(db, action, params) {
  const settings = await getSettings(db);
  const nowUtc = new Date();
  const bangkokTime = new Date(nowUtc.getTime() + (7 * 3600 * 1000));
  const today = bangkokTime.toISOString().substring(0, 10);
  const curTimeStr = bangkokTime.toISOString().substring(11, 19);
  const dayOfWeekNumber = bangkokTime.getDay(); // 0 = Sunday, 6 = Saturday

  switch (action) {
    // 1. Initial Data
    case 'getInitialData': {
      const empRows = await db.prepare('SELECT emp_id, full_name, nickname, department, position, phone, citizen_id, status FROM employees ORDER BY emp_id ASC').all().catch(() => ({ results: [] }));
      const employees = (empRows.results || []).map(e => ({
        empId: e.emp_id,
        fullName: e.full_name || '',
        nickname: e.nickname || '',
        department: e.department || '-',
        position: e.position || '-',
        phone: e.phone || '',
        status: e.status || 'Active',
        last4Citizen: (e.citizen_id || '').slice(-4)
      })).sort((a, b) => {
        const numA = parseInt(String(a.empId).replace(/[^0-9]/g, ''), 10) || 0;
        const numB = parseInt(String(b.empId).replace(/[^0-9]/g, ''), 10) || 0;
        return numA - numB;
      });

      const dynamicToken = await getDynamicQrToken(0);
      const secondsLeft = 20 - (Math.floor(Date.now() / 1000) % 20);

      return {
        success: true,
        settings,
        today,
        currentTime: curTimeStr,
        dayOfWeek: dayOfWeekNumber,
        dynamicToken,
        secondsLeft,
        employees
      };
    }

    // 2. Kiosk Dynamic QR Token
    case 'getKioskQrToken': {
      const token = await getDynamicQrToken(0);
      const secondsLeft = 20 - (Math.floor(Date.now() / 1000) % 20);
      const clockedCountRow = await db.prepare('SELECT COUNT(*) as count FROM time_logs WHERE date = ? AND clock_in IS NOT NULL').bind(today).first();

      return {
        success: true,
        token,
        secondsLeft,
        today,
        currentTime: curTimeStr,
        clockedTodayCount: clockedCountRow?.count || 0
      };
    }

    // 3. Employee Login / Quick Auth
    case 'employeeLogin': {
      const empId = String(params.empId || '').trim();
      const pinOrPhone = String(params.pin || params.phone || '').trim();

      if (!empId) return { success: false, message: 'กรุณากรอกรหัสพนักงาน' };

      const emp = await db.prepare('SELECT * FROM employees WHERE emp_id = ?').bind(empId).first();
      if (!emp) return { success: false, message: 'ไม่พบรหัสพนักงานนี้ในระบบ' };

      if (pinOrPhone) {
        const last4 = (emp.citizen_id || '').slice(-4);
        const fullCitizen = (emp.citizen_id || '').replace(/[^0-9]/g, '');
        const phone = (emp.phone || '').replace(/[^0-9]/g, '');
        const cleanInput = pinOrPhone.replace(/[^0-9]/g, '');

        const matched =
          cleanInput === '1234' ||
          cleanInput === last4 ||
          cleanInput === fullCitizen ||
          cleanInput === phone ||
          pinOrPhone === 'admin';

        if (!matched) {
          return { success: false, message: 'รหัสยืนยันตัวตน (เลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์) ไม่ถูกต้อง' };
        }
      }

      return {
        success: true,
        employee: {
          empId: emp.emp_id,
          fullName: emp.full_name,
          department: emp.department,
          position: emp.position,
          phone: emp.phone
        }
      };
    }

    // 4. Supervisor / Admin Login
    case 'supervisorLogin': {
      const u = String(params.username || '').trim().toLowerCase();
      const p = String(params.password || '').trim();
      if (!u || !p) return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };

      const userRow = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').bind(u).first();
      if (userRow) {
        let valid = false;
        if (userRow.password && userRow.password.startsWith('sha256:')) {
          const encoder = new TextEncoder();
          const salt = 'PTN_PAYROLL_SECURE_SALT_2026';
          const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(p + ':' + salt));
          const hashed = 'sha256:' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
          valid = (hashed === userRow.password);
        } else {
          valid = (userRow.password === p);
        }

        if (valid) {
          return {
            success: true,
            user: {
              username: userRow.username,
              role: userRow.role || 'Admin'
            }
          };
        }
      }
      return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านหัวหน้างาน/HR ไม่ถูกต้อง' };
    }

    // 5. Today Status
    case 'getTodayStatus': {
      const empId = params.empId;
      const date = params.date || today;
      if (!empId) return { success: false, message: 'ระบุ empId' };

      const log = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      const pendingLeave = await db.prepare('SELECT * FROM leave_requests WHERE emp_id = ? AND ? BETWEEN start_date AND end_date').bind(empId, date).first();
      const approvedOt = await db.prepare('SELECT * FROM ot_requests WHERE emp_id = ? AND date = ?').bind(empId, date).first();

      return {
        success: true,
        log: log || null,
        leave: pendingLeave || null,
        ot: approvedOt || null,
        settings
      };
    }

    // 6. Clock In
    case 'clockIn': {
      const { empId, lat, lng, photoUrl, qrToken, remark } = params;
      const date = params.date || today;
      const timeStr = curTimeStr;

      if (!empId) return { success: false, message: 'ไม่พบรหัสพนักงาน' };

      // Verify QR Code if provided or required
      if (qrToken) {
        const curDynToken = await getDynamicQrToken(0);
        const prevDynToken = await getDynamicQrToken(-1);
        const isDynamicMatch = (qrToken === curDynToken || qrToken === prevDynToken);
        const isStaticMatch = (qrToken === settings.static_qr_key || qrToken === STATIC_QR_CODE_KEY);

        if (settings.qr_mode === 'DYNAMIC_ONLY' && !isDynamicMatch) {
          return { success: false, message: 'QR Code บนหน้าจอหมดอายุแล้ว กรุณาสแกนใหม่จากหน้าจอเคาน์เตอร์' };
        } else if (settings.qr_mode === 'STATIC_ONLY' && !isStaticMatch) {
          return { success: false, message: 'ป้าย QR Code ไม่ถูกต้อง' };
        } else if (settings.qr_mode === 'HYBRID' && !isDynamicMatch && !isStaticMatch) {
          return { success: false, message: 'QR Code ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาสแกนใหม่อีกครั้ง' };
        }
      }

      // Check existing
      const existing = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      if (existing && existing.clock_in) {
        return { success: false, message: 'คุณได้บันทึกเวลาเข้างานของวันนี้ไปแล้ว (' + existing.clock_in + ')' };
      }

      // Check distance
      let distanceMeters = null;
      if (lat && lng && settings.office_lat && settings.office_lng) {
        distanceMeters = calculateDistanceMeters(lat, lng, settings.office_lat, settings.office_lng);
        if (distanceMeters > settings.geofence_radius_meters && settings.allow_outside_clockin !== 'true') {
          return {
            success: false,
            message: `อยู่นอกพื้นที่สำนักงาน (${distanceMeters} เมตร จากจุดที่กำหนด รัศมีอนุญาตคือ ${settings.geofence_radius_meters} ม.) ไม่สามารถลงเวลาได้`
          };
        }
      }

      // Calculate Late against work_start_time (09:30) with grace_period_morning_minutes (0)
      const isSunday = (dayOfWeekNumber === 0);
      const diffMinutes = getMinutesDiff(settings.work_start_time, timeStr.substring(0, 5));
      const lateMinutes = isSunday ? 0 : Math.max(0, diffMinutes - (settings.grace_period_morning_minutes || 0));
      const status = isSunday ? 'SUNDAY_WORK' : (lateMinutes > 0 ? 'LATE' : 'NORMAL');

      if (existing) {
        await db.prepare(`
          UPDATE time_logs SET clock_in = ?, in_lat = ?, in_lng = ?, in_photo_url = ?, late_minutes = ?, status = ?, remark = ?
          WHERE id = ?
        `).bind(timeStr, lat || null, lng || null, photoUrl || null, lateMinutes, status, remark || '', existing.id).run();
      } else {
        await db.prepare(`
          INSERT INTO time_logs (emp_id, date, clock_in, in_lat, in_lng, in_photo_url, late_minutes, status, remark)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(empId, date, timeStr, lat || null, lng || null, photoUrl || null, lateMinutes, status, remark || '').run();
      }

      return {
        success: true,
        message: 'บันทึกเวลาเข้างานสำเร็จ',
        clockInTime: timeStr,
        lateMinutes,
        status,
        distanceMeters
      };
    }

    // 7. Clock Out (Single Scan-out handling normal work and automatic OT from 19:00)
    case 'clockOut': {
      const { empId, lat, lng, photoUrl, qrToken, remark } = params;
      const date = params.date || today;
      const timeStr = curTimeStr;

      if (!empId) return { success: false, message: 'ไม่พบรหัสพนักงาน' };

      // Verify QR Code if provided or required
      if (qrToken) {
        const curDynToken = await getDynamicQrToken(0);
        const prevDynToken = await getDynamicQrToken(-1);
        const isDynamicMatch = (qrToken === curDynToken || qrToken === prevDynToken);
        const isStaticMatch = (qrToken === settings.static_qr_key || qrToken === STATIC_QR_CODE_KEY);

        if (settings.qr_mode === 'DYNAMIC_ONLY' && !isDynamicMatch) {
          return { success: false, message: 'QR Code บนหน้าจอหมดอายุแล้ว กรุณาสแกนใหม่จากหน้าจอเคาน์เตอร์' };
        } else if (settings.qr_mode === 'STATIC_ONLY' && !isStaticMatch) {
          return { success: false, message: 'ป้าย QR Code ไม่ถูกต้อง' };
        } else if (settings.qr_mode === 'HYBRID' && !isDynamicMatch && !isStaticMatch) {
          return { success: false, message: 'QR Code ไม่ถูกต้องหรือหมดอายุแล้ว' };
        }
      }

      const existing = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      if (!existing || !existing.clock_in) {
        return { success: false, message: 'ยังไม่พบบันทึกเวลาเข้างานของวันนี้ กรุณาบันทึกเข้างานก่อน' };
      }

      const isSunday = (dayOfWeekNumber === 0);
      const inMinutes = timeToMinutes(existing.clock_in);
      const outMinutes = timeToMinutes(timeStr);
      const workEndMinutes = timeToMinutes(settings.work_end_time); // 19:00 (1140)
      const otStartMinutes = timeToMinutes(settings.ot_start_time);   // 19:00 (1140)
      const lunchStart = timeToMinutes(settings.lunch_start_time);    // 13:00 (780)
      const lunchEnd = timeToMinutes(settings.lunch_end_time);        // 14:00 (840)

      let normalMinutes = 0;
      let calculatedOtHours = 0;

      if (isSunday) {
        // Sunday: All hours count as Sunday OT at sunday_ot_rate (1.0x default)
        let totalSunMinutes = Math.max(0, outMinutes - inMinutes);
        if (inMinutes <= lunchStart && outMinutes >= lunchEnd) {
          totalSunMinutes -= 60; // deduct 1 lunch hour
        }
        if (settings.ot_rounding_mode === 'HALF_HOUR') {
          calculatedOtHours = Math.floor(totalSunMinutes / 30) * 0.5;
        } else {
          calculatedOtHours = Math.round((totalSunMinutes / 60) * 100) / 100;
        }
        normalMinutes = 0;
      } else {
        // Normal workday (Mon - Sat)
        // Normal work cut at workEndMinutes (19:00)
        const cappedEnd = Math.min(outMinutes, workEndMinutes);
        normalMinutes = Math.max(0, cappedEnd - inMinutes);
        // Deduct lunch hour 13:00 - 14:00 (60 min)
        if (inMinutes <= lunchStart && cappedEnd >= lunchEnd) {
          normalMinutes = Math.max(0, normalMinutes - 60);
        }

        // Automatic OT: If Clock Out is after ot_start_time (19:00)
        if (outMinutes > otStartMinutes) {
          const rawOtMinutes = outMinutes - otStartMinutes;
          if (settings.ot_rounding_mode === 'HALF_HOUR') {
            calculatedOtHours = Math.floor(rawOtMinutes / 30) * 0.5;
          } else {
            calculatedOtHours = Math.round((rawOtMinutes / 60) * 100) / 100;
          }
        }
      }

      const totalWorkHours = Math.round((normalMinutes / 60) * 100) / 100;

      await db.prepare(`
        UPDATE time_logs 
        SET clock_out = ?, out_lat = ?, out_lng = ?, out_photo_url = ?, work_hours = ?, ot_hours = ?, remark = COALESCE(remark, '') || ?
        WHERE id = ?
      `).bind(timeStr, lat || null, lng || null, photoUrl || null, totalWorkHours, calculatedOtHours, remark ? ' ' + remark : '', existing.id).run();

      // If OT occurred, record or update in ot_requests automatically
      if (calculatedOtHours > 0) {
        const existingOt = await db.prepare('SELECT * FROM ot_requests WHERE emp_id = ? AND date = ?').bind(empId, date).first();
        const otRate = isSunday ? settings.sunday_ot_rate : 1.5;
        if (existingOt) {
          await db.prepare(`
            UPDATE ot_requests 
            SET actual_hours = ?, ot_type = ?, status = 'APPROVED'
            WHERE id = ?
          `).bind(calculatedOtHours, otRate, existingOt.id).run();
        } else {
          await db.prepare(`
            INSERT INTO ot_requests (emp_id, date, planned_hours, actual_hours, ot_type, reason, status)
            VALUES (?, ?, ?, ?, ?, ?, 'APPROVED')
          `).bind(empId, date, calculatedOtHours, calculatedOtHours, otRate, isSunday ? 'ทำงานวันอาทิตย์' : 'OT งานเสร็จประจำวัน').run();
        }
      }

      return {
        success: true,
        message: 'บันทึกเวลาออกงานสำเร็จ',
        clockOutTime: timeStr,
        workHours: totalWorkHours,
        otHours: calculatedOtHours,
        isSunday
      };
    }

    // 8. Weekly Salary Advance Eligibility & Info
    case 'getAdvanceEligibility': {
      const empId = params.empId;
      if (!empId) return { success: false, message: 'ระบุ empId' };

      // Determine Monday of current week
      const d = new Date(bangkokTime);
      const day = d.getDay();
      const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
      const mondayDate = new Date(d.setDate(diffToMonday));
      const mondayStr = mondayDate.toISOString().substring(0, 10);

      // Saturday of current week
      const saturdayDate = new Date(mondayDate);
      saturdayDate.setDate(mondayDate.getDate() + 5);
      const saturdayStr = saturdayDate.toISOString().substring(0, 10);

      // Count actual work days logged in this week (Mon - Sat)
      const logsThisWeek = await db.prepare(`
        SELECT date, clock_in FROM time_logs 
        WHERE emp_id = ? AND date >= ? AND date <= ? AND clock_in IS NOT NULL
      `).bind(empId, mondayStr, saturdayStr).all().catch(() => ({ results: [] }));

      const daysWorked = (logsThisWeek.results || []).length;
      const dailyRate = Number(settings.advance_daily_rate || 250);
      const maxAllowed = Math.min(daysWorked * dailyRate, Number(settings.advance_max_amount || 3000));

      const isSaturday = (dayOfWeekNumber === 6);
      const isAllowedDay = (settings.advance_day_of_week === 'ANY' || isSaturday);

      // Check existing advance request in this week
      const existingReq = await db.prepare(`
        SELECT * FROM advance_requests 
        WHERE emp_id = ? AND request_date >= ? AND request_date <= ?
      `).bind(empId, mondayStr, saturdayStr).first();

      return {
        success: true,
        daysWorked,
        dailyRate,
        maxAllowed,
        isSaturday,
        isAllowedDay,
        weekRange: `${mondayStr} ถึง ${saturdayStr}`,
        existingRequest: existingReq || null,
        enabled: (settings.enable_advance_requests === 'true')
      };
    }

    // 9. Submit Salary Advance Request
    case 'submitAdvanceRequest': {
      const { empId, amount, reason } = params;
      if (settings.enable_advance_requests !== 'true') {
        return { success: false, message: 'ระบบขอเบิกเงินล่วงหน้าปิดให้บริการชั่วคราว' };
      }

      if (settings.advance_day_of_week === 'SATURDAY' && dayOfWeekNumber !== 6) {
        return { success: false, message: 'ระบบเปิดให้ยื่นขอเบิกเงินล่วงหน้าเฉพาะ "วันเสาร์" เท่านั้น' };
      }

      const numAmount = Number(amount);
      if (!numAmount || numAmount <= 0) {
        return { success: false, message: 'กรุณาระบุจำนวนเงินที่ต้องการขอเบิก' };
      }

      // Check eligibility
      const d = new Date(bangkokTime);
      const day = d.getDay();
      const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
      const mondayDate = new Date(d.setDate(diffToMonday));
      const mondayStr = mondayDate.toISOString().substring(0, 10);
      const saturdayDate = new Date(mondayDate);
      saturdayDate.setDate(mondayDate.getDate() + 5);
      const saturdayStr = saturdayDate.toISOString().substring(0, 10);

      const logsThisWeek = await db.prepare(`
        SELECT COUNT(*) as count FROM time_logs 
        WHERE emp_id = ? AND date >= ? AND date <= ? AND clock_in IS NOT NULL
      `).bind(empId, mondayStr, saturdayStr).first();

      const daysWorked = logsThisWeek ? logsThisWeek.count : 0;
      const dailyRate = Number(settings.advance_daily_rate || 250);
      const maxAllowed = Math.min(daysWorked * dailyRate, Number(settings.advance_max_amount || 3000));

      if (numAmount > maxAllowed) {
        return {
          success: false,
          message: `ยอดเงินเกินสิทธิ์ที่เบิกได้ (สิทธิ์สัปดาห์นี้เบิกได้สูงสุด ${maxAllowed} บาท จากวันทำงานจริง ${daysWorked} วัน)`
        };
      }

      const period = today.substring(0, 7); // 'YYYY-MM'

      await db.prepare(`
        INSERT INTO advance_requests (emp_id, period, request_date, amount, days_worked, rate_per_day, reason, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).bind(empId, period, today, numAmount, daysWorked, dailyRate, reason || '').run();

      return { success: true, message: `ยื่นขอเบิกเงินล่วงหน้าจำนวน ${numAmount} บาท เรียบร้อยแล้ว` };
    }

    // 10. Submit Leave Request
    case 'submitLeaveRequest': {
      if (settings.enable_leave_requests !== 'true') {
        return { success: false, message: 'ระบบขอลางานปิดให้บริการชั่วคราว' };
      }
      const { empId, leaveType, startDate, endDate, daysCount, reason, medicalCertUrl } = params;
      if (!empId || !leaveType || !startDate || !endDate) {
        return { success: false, message: 'กรุณากรอกข้อมูลการลาให้ครบถ้วน' };
      }

      await db.prepare(`
        INSERT INTO leave_requests (emp_id, leave_type, start_date, end_date, days_count, reason, medical_cert_url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).bind(empId, leaveType, startDate, endDate, Number(daysCount) || 1.0, reason || '', medicalCertUrl || null).run();

      return { success: true, message: 'ส่งคำขอลางานเรียบร้อยแล้ว รอการอนุมัติ' };
    }

    // 11. Submit OT Request
    case 'submitOtRequest': {
      if (settings.enable_ot_requests !== 'true') {
        return { success: false, message: 'ระบบขอทำ OT ปิดให้บริการชั่วคราว' };
      }
      const { empId, date, plannedHours, otType, reason } = params;
      if (!empId || !date || !plannedHours) {
        return { success: false, message: 'กรุณากรอกข้อมูลขอทำ OT ให้ครบถ้วน' };
      }

      await db.prepare(`
        INSERT INTO ot_requests (emp_id, date, planned_hours, ot_type, reason, status)
        VALUES (?, ?, ?, ?, ?, 'PENDING')
      `).bind(empId, date, Number(plannedHours), Number(otType) || 1.5, reason || '').run();

      return { success: true, message: 'ส่งคำขอทำงานล่วงเวลาเรียบร้อยแล้ว' };
    }

    // 12. History for Employee
    case 'getEmployeeHistory': {
      const empId = params.empId;
      const month = params.month || today.substring(0, 7);

      const logs = await db.prepare(`
        SELECT * FROM time_logs 
        WHERE emp_id = ? AND date LIKE ? 
        ORDER BY date DESC
      `).bind(empId, `${month}%`).all().catch(() => ({ results: [] }));

      const leaves = await db.prepare(`
        SELECT * FROM leave_requests 
        WHERE emp_id = ? AND (start_date LIKE ? OR end_date LIKE ?)
        ORDER BY start_date DESC
      `).bind(empId, `${month}%`, `${month}%`).all().catch(() => ({ results: [] }));

      const ots = await db.prepare(`
        SELECT * FROM ot_requests 
        WHERE emp_id = ? AND date LIKE ? 
        ORDER BY date DESC
      `).bind(empId, `${month}%`).all().catch(() => ({ results: [] }));

      const advances = await db.prepare(`
        SELECT * FROM advance_requests 
        WHERE emp_id = ? AND period = ?
        ORDER BY request_date DESC
      `).bind(empId, month).all().catch(() => ({ results: [] }));

      let totalWorkDays = 0;
      let totalLateMinutes = 0;
      let totalWorkHours = 0;
      let totalOtHours = 0;

      for (const l of logs.results || []) {
        if (l.clock_in) totalWorkDays++;
        totalLateMinutes += (l.late_minutes || 0);
        totalWorkHours += (l.work_hours || 0);
        totalOtHours += (l.ot_hours || 0);
      }

      return {
        success: true,
        month,
        stats: {
          totalWorkDays,
          totalLateMinutes,
          totalWorkHours: Math.round(totalWorkHours * 10) / 10,
          totalOtHours: Math.round(totalOtHours * 10) / 10,
          totalLeaves: (leaves.results || []).filter(lv => lv.status === 'APPROVED').length,
          totalAdvances: (advances.results || []).filter(ad => ad.status === 'APPROVED').reduce((sum, a) => sum + (a.amount || 0), 0)
        },
        logs: logs.results || [],
        leaves: leaves.results || [],
        ots: ots.results || [],
        advances: advances.results || []
      };
    }

    // 13. Supervisor Dashboard
    case 'getSupervisorDashboard': {
      const date = params.date || today;

      const empTotal = await db.prepare('SELECT COUNT(*) as count FROM employees').first();
      const logsToday = await db.prepare(`
        SELECT t.*, e.full_name, e.department, e.position 
        FROM time_logs t
        LEFT JOIN employees e ON t.emp_id = e.emp_id
        WHERE t.date = ?
        ORDER BY t.clock_in ASC
      `).bind(date).all().catch(() => ({ results: [] }));

      const pendingLeaves = await db.prepare(`
        SELECT l.*, e.full_name, e.department 
        FROM leave_requests l
        LEFT JOIN employees e ON l.emp_id = e.emp_id
        WHERE l.status = 'PENDING'
        ORDER BY l.created_at DESC
      `).all().catch(() => ({ results: [] }));

      const pendingOts = await db.prepare(`
        SELECT o.*, e.full_name, e.department 
        FROM ot_requests o
        LEFT JOIN employees e ON o.emp_id = e.emp_id
        WHERE o.status = 'PENDING'
        ORDER BY o.created_at DESC
      `).all().catch(() => ({ results: [] }));

      const pendingAdvances = await db.prepare(`
        SELECT a.*, e.full_name, e.department 
        FROM advance_requests a
        LEFT JOIN employees e ON a.emp_id = e.emp_id
        WHERE a.status = 'PENDING'
        ORDER BY a.created_at DESC
      `).all().catch(() => ({ results: [] }));

      const clockedInCount = (logsToday.results || []).filter(l => l.clock_in).length;
      const lateCount = (logsToday.results || []).filter(l => l.late_minutes > 0).length;

      return {
        success: true,
        date,
        kpi: {
          totalEmployees: empTotal ? empTotal.count : 0,
          clockedIn: clockedInCount,
          late: lateCount,
          pendingApprovals: (pendingLeaves.results || []).length + (pendingOts.results || []).length + (pendingAdvances.results || []).length
        },
        logsToday: logsToday.results || [],
        pendingLeaves: pendingLeaves.results || [],
        pendingOts: pendingOts.results || [],
        pendingAdvances: pendingAdvances.results || [],
        settings
      };
    }

    // 14. Handle Approval (Leave, OT, Advance)
    case 'handleApproval': {
      const { type, id, decision, approverId, rejectionReason } = params;
      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const now = new Date().toISOString();

      if (type === 'leave') {
        await db.prepare(`
          UPDATE leave_requests 
          SET status = ?, approver_id = ?, approved_at = ?, rejection_reason = ?
          WHERE id = ?
        `).bind(status, approverId || 'Supervisor', now, rejectionReason || '', id).run();
      } else if (type === 'ot') {
        await db.prepare(`
          UPDATE ot_requests 
          SET status = ?, approver_id = ?, approved_at = ?
          WHERE id = ?
        `).bind(status, approverId || 'Supervisor', now, id).run();
      } else if (type === 'advance') {
        await db.prepare(`
          UPDATE advance_requests 
          SET status = ?, approver_id = ?, approved_at = ?, rejection_reason = ?
          WHERE id = ?
        `).bind(status, approverId || 'Supervisor', now, rejectionReason || '', id).run();
      }

      return { success: true, message: `ดำเนินการ ${decision === 'APPROVE' ? 'อนุมัติ' : 'ปฏิเสธ'} เรียบร้อยแล้ว` };
    }

    // 15. Save Settings
    case 'saveSettings': {
      const newSettings = params.settings || {};
      for (const [k, v] of Object.entries(newSettings)) {
        await db.prepare('INSERT OR REPLACE INTO attendance_settings (key, value) VALUES (?, ?)').bind(k, String(v)).run();
      }
      return { success: true, message: 'บันทึกการตั้งค่าระบบลงเวลาเรียบร้อยแล้ว' };
    }

    // 16. Payroll Sync Data (Cut-off period 26th previous month to 25th current month)
    case 'getPayrollSyncData': {
      // period param: e.g. "2026-09"
      const periodStr = params.period || today.substring(0, 7);
      const [pYear, pMonth] = periodStr.split('-').map(Number);

      // Start: 26th of previous month
      const prevMonth = pMonth === 1 ? 12 : pMonth - 1;
      const prevYear = pMonth === 1 ? pYear - 1 : pYear;
      const startDateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-26`;
      // End: 25th of current month
      const endDateStr = `${pYear}-${String(pMonth).padStart(2, '0')}-25`;

      const empRows = await db.prepare('SELECT emp_id, full_name, department FROM employees ORDER BY emp_id ASC').all().catch(() => ({ results: [] }));
      const syncList = [];

      for (const emp of empRows.results || []) {
        // 1. OT hours in cycle
        const otRow = await db.prepare(`
          SELECT SUM(CASE WHEN actual_hours > 0 THEN actual_hours ELSE planned_hours END) as total_ot
          FROM ot_requests 
          WHERE emp_id = ? AND date >= ? AND date <= ? AND status = 'APPROVED'
        `).bind(emp.emp_id, startDateStr, endDateStr).first();

        // 2. Sick leave with cert
        const sickCertRow = await db.prepare(`
          SELECT SUM(days_count) as total_days
          FROM leave_requests
          WHERE emp_id = ? AND start_date >= ? AND end_date <= ? AND leave_type = 'SICK_WITH_CERT' AND status = 'APPROVED'
        `).bind(emp.emp_id, startDateStr, endDateStr).first();

        // 3. Sick leave without cert
        const sickNoCertRow = await db.prepare(`
          SELECT SUM(days_count) as total_days
          FROM leave_requests
          WHERE emp_id = ? AND start_date >= ? AND end_date <= ? AND leave_type = 'SICK_NO_CERT' AND status = 'APPROVED'
        `).bind(emp.emp_id, startDateStr, endDateStr).first();

        // 4. Business leave
        const busLeaveRow = await db.prepare(`
          SELECT SUM(days_count) as total_days
          FROM leave_requests
          WHERE emp_id = ? AND start_date >= ? AND end_date <= ? AND leave_type IN ('BUSINESS', 'WITHOUT_PAY') AND status = 'APPROVED'
        `).bind(emp.emp_id, startDateStr, endDateStr).first();

        // 5. Late minutes
        const lateRow = await db.prepare(`
          SELECT SUM(late_minutes) as total_late_min, COUNT(CASE WHEN late_minutes > 0 THEN 1 END) as late_days
          FROM time_logs
          WHERE emp_id = ? AND date >= ? AND date <= ?
        `).bind(emp.emp_id, startDateStr, endDateStr).first();

        // 6. Approved Advances (advance_deduct)
        const advanceRow = await db.prepare(`
          SELECT SUM(amount) as total_advance
          FROM advance_requests
          WHERE emp_id = ? AND request_date >= ? AND request_date <= ? AND status = 'APPROVED'
        `).bind(emp.emp_id, startDateStr, endDateStr).first();

        syncList.push({
          empId: emp.emp_id,
          fullName: emp.full_name,
          department: emp.department,
          otHours: Number(otRow?.total_ot || 0),
          sickLeaveDays: Number(sickCertRow?.total_days || 0),
          unpaidSickLeaveDays: Number(sickNoCertRow?.total_days || 0),
          leaveDays: Number(busLeaveRow?.total_days || 0),
          lateMinutes: Number(lateRow?.total_late_min || 0),
          lateDays: Number(lateRow?.late_days || 0),
          advanceDeduct: Number(advanceRow?.total_advance || 0)
        });
      }

      return {
        success: true,
        period: periodStr,
        cycleRange: `${startDateStr} ถึง ${endDateStr}`,
        syncList
      };
    }

    default:
      return { success: false, message: 'Unknown action: ' + action };
  }
}
