/**
 * Leave, OT & Salary Advance Requests Handlers Module
 */
import { normalizeDateToIso, timeStringToMinutes, logSystemActivity } from './db.js';
import { sendPushToAdmins, sendPushToEmployee } from './notifications.js';

function getAdvanceWeekWindow(bangkokTime, cutoffDayRaw) {
  const d = new Date(bangkokTime);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const mondayDate = new Date(d.setDate(diffToMonday));
  const mondayStr = mondayDate.toISOString().substring(0, 10);

  const saturdayDate = new Date(mondayDate);
  saturdayDate.setDate(mondayDate.getDate() + 5);
  const saturdayStr = saturdayDate.toISOString().substring(0, 10);

  const cutoffDay = Number(cutoffDayRaw) || 25;
  const curY = bangkokTime.getFullYear();
  const curM = bangkokTime.getMonth() + 1;
  const curD = bangkokTime.getDate();

  let periodStartStr = '';
  if (cutoffDay >= 30) {
    periodStartStr = `${curY}-${String(curM).padStart(2, '0')}-01`;
  } else if (curD > cutoffDay) {
    const startDay = cutoffDay + 1;
    const maxDays = new Date(curY, curM, 0).getDate();
    const safeDay = startDay > maxDays ? 1 : startDay;
    periodStartStr = `${curY}-${String(curM).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
  } else {
    let prevM = curM - 1;
    let prevY = curY;
    if (prevM < 1) { prevM = 12; prevY -= 1; }
    const startDay = cutoffDay + 1;
    const maxDays = new Date(prevY, prevM, 0).getDate();
    const safeDay = startDay > maxDays ? 1 : startDay;
    periodStartStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
  }

  const isCutoffSplitWeek = Boolean(periodStartStr && periodStartStr > mondayStr && periodStartStr <= saturdayStr);
  const effectiveStartStr = isCutoffSplitWeek ? periodStartStr : mondayStr;

  return {
    mondayStr,
    saturdayStr,
    effectiveStartStr,
    isCutoffSplitWeek
  };
}

export const requestHandlers = {
  getAdvanceEligibility: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const empId = params.empId;
      if (!empId) return { success: false, message: 'ระบุ empId' };

      const { mondayStr, saturdayStr, effectiveStartStr, isCutoffSplitWeek } = getAdvanceWeekWindow(bangkokTime, settings.cutoff_day);

      // Count actual work days logged in the eligible window (respecting payroll cutoff boundary)
      const logsThisWeek = await db.prepare(`
        SELECT date, clock_in FROM time_logs 
        WHERE emp_id = ? AND date >= ? AND date <= ? AND clock_in IS NOT NULL
      `).bind(empId, effectiveStartStr, saturdayStr).all().catch(() => ({ results: [] }));

      const daysWorked = (logsThisWeek.results || []).length;
      const dailyRate = Number(settings.advance_daily_rate || 250);
      const maxAllowed = Math.min(daysWorked * dailyRate, Number(settings.advance_max_amount || 3000));

      const isSaturday = (dayOfWeekNumber === 6);
      const isFriday = (dayOfWeekNumber === 5);
      let isAllowedDay = false;
      if (settings.advance_day_of_week === 'ANY') isAllowedDay = true;
      else if (settings.advance_day_of_week === 'FRIDAY') isAllowedDay = isFriday;
      else if (settings.advance_day_of_week === 'FRIDAY_SATURDAY') isAllowedDay = (isFriday || isSaturday);
      else isAllowedDay = isSaturday;

      // Check Time Window
      const startTime = settings.advance_start_time || '09:00';
      const endTime = settings.advance_end_time || '18:00';
      const curTime = curTimeStr.substring(0, 5); // "HH:MM"
      const isAllowedTime = (curTime >= startTime && curTime <= endTime);
      const isOpen = (settings.enable_advance_requests === 'true') && isAllowedDay && isAllowedTime;

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
        isAllowedTime,
        isOpen,
        advanceStartTime: startTime,
        advanceEndTime: endTime,
        advanceDayOfWeek: settings.advance_day_of_week || 'SATURDAY',
        currentTime: curTime,
        weekRange: `${effectiveStartStr} ถึง ${saturdayStr}`,
        isCutoffSplitWeek,
        existingRequest: existingReq || null,
        enabled: (settings.enable_advance_requests === 'true')
      };
  },

  submitAdvanceRequest: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, amount, reason } = params;
      if (settings.enable_advance_requests !== 'true') {
        return { success: false, message: 'ระบบขอเบิกเงินล่วงหน้าปิดให้บริการชั่วคราว' };
      }

      // Check Allowed Day
      const isSaturday = (dayOfWeekNumber === 6);
      const isFriday = (dayOfWeekNumber === 5);
      let isAllowedDay = false;
      if (settings.advance_day_of_week === 'ANY') isAllowedDay = true;
      else if (settings.advance_day_of_week === 'FRIDAY') isAllowedDay = isFriday;
      else if (settings.advance_day_of_week === 'FRIDAY_SATURDAY') isAllowedDay = (isFriday || isSaturday);
      else isAllowedDay = isSaturday;

      if (!isAllowedDay) {
        let dayMsg = 'วันเสาร์';
        if (settings.advance_day_of_week === 'FRIDAY') dayMsg = 'วันศุกร์';
        else if (settings.advance_day_of_week === 'FRIDAY_SATURDAY') dayMsg = 'วันศุกร์และวันเสาร์';
        return { success: false, message: `ระบบเปิดให้ยื่นขอเบิกเงินล่วงหน้าเฉพาะ "${dayMsg}" เท่านั้น` };
      }

      // Check Time Window
      const startTime = settings.advance_start_time || '09:00';
      const endTime = settings.advance_end_time || '18:00';
      const curTime = curTimeStr.substring(0, 5);
      if (curTime < startTime || curTime > endTime) {
        return { success: false, message: `ขณะนี้อยู่นอกช่วงเวลาเปิดรับคำขอเบิกเงิน (ระบบเปิดรับเวลา ${startTime} - ${endTime} น.)` };
      }

      const numAmount = Number(amount);
      if (!numAmount || numAmount <= 0) {
        return { success: false, message: 'กรุณาระบุจำนวนเงินที่ต้องการขอเบิก' };
      }

      // Check eligibility (respecting payroll cutoff boundary)
      const { saturdayStr, effectiveStartStr } = getAdvanceWeekWindow(bangkokTime, settings.cutoff_day);

      const logsThisWeek = await db.prepare(`
        SELECT COUNT(*) as count FROM time_logs 
        WHERE emp_id = ? AND date >= ? AND date <= ? AND clock_in IS NOT NULL
      `).bind(empId, effectiveStartStr, saturdayStr).first();

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

      sendPushToAdmins(db, {
        title: '💵 คำขอเบิกเงินล่วงหน้าใหม่',
        body: `พนักงาน [${empId}] ยื่นขอเบิกเงิน ${numAmount.toLocaleString()} บาท`,
        url: '/?tab=attendance&sub=requests',
        tag: `advance-new-${empId}-${Date.now()}`
      }).catch(() => {});

      await logSystemActivity(
        db,
        empId,
        'PTN_TIME_REQ_ADVANCE',
        `ยื่นขอเบิกเงินล่วงหน้า จำนวน ฿${numAmount.toLocaleString()}${reason ? ` (เหตุผล: ${reason})` : ''}`
      );

      return { success: true, message: `ยื่นขอเบิกเงินล่วงหน้าจำนวน ${numAmount} บาท เรียบร้อยแล้ว` };
  },

  submitLeaveRequest: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      if (settings.enable_leave_requests !== 'true') {
        return { success: false, message: 'ระบบขอลางานปิดให้บริการชั่วคราว' };
      }
      const { empId, leaveType, startDate, endDate, daysCount, timeSlot, time_slot, reason, medicalCertUrl } = params;
      if (!empId || !leaveType || !startDate || !endDate) {
        return { success: false, message: 'กรุณากรอกข้อมูลการลาให้ครบถ้วน' };
      }

      const cleanStart = normalizeDateToIso(startDate);
      const cleanEnd = normalizeDateToIso(endDate);
      const numDays = Number(daysCount) || 1.0;
      const rawSlot = timeSlot || time_slot;
      const finalSlot = rawSlot ? String(rawSlot).toUpperCase() : (numDays === 0.5 ? 'MORNING' : 'FULL');

      await db.prepare(`
        INSERT INTO leave_requests (emp_id, leave_type, start_date, end_date, days_count, time_slot, reason, medical_cert_url, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).bind(empId, leaveType, cleanStart, cleanEnd, numDays, finalSlot, reason || '', medicalCertUrl || null).run();

      sendPushToAdmins(db, {
        title: '📋 คำขอยื่นใบลาใหม่',
        body: `พนักงาน [${empId}] ยื่นขอลา ${leaveType || ''} (${Number(daysCount) || 1} วัน: ${cleanStart} ถึง ${cleanEnd})`,
        url: '/?tab=attendance&sub=requests',
        tag: `leave-new-${empId}-${Date.now()}`
      }).catch(() => {});

      await logSystemActivity(
        db,
        empId,
        'PTN_TIME_REQ_LEAVE',
        `ยื่นขอลางาน (${leaveType}) ${numDays} วัน (${cleanStart} ถึง ${cleanEnd})${reason ? ` [เหตุผล: ${reason}]` : ''}`
      );

      return { success: true, message: 'ส่งคำขอลางานเรียบร้อยแล้ว รอการอนุมัติ' };
  },

  submitOtRequest: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      if (settings.enable_ot_requests !== 'true') {
        return { success: false, message: 'ระบบขอทำ OT ปิดให้บริการชั่วคราว' };
      }
      const { empId, date, plannedHours, otType, reason } = params;
      if (!empId || !date || !plannedHours) {
        return { success: false, message: 'กรุณากรอกข้อมูลขอทำ OT ให้ครบถ้วน' };
      }

      const emp = await db.prepare('SELECT is_ot_eligible FROM employees WHERE emp_id = ?').bind(empId).first().catch(() => null);
      if (emp && (emp.is_ot_eligible === 'false' || emp.is_ot_eligible === false)) {
        return { success: false, message: 'ตำแหน่งงานของคุณไม่ได้รับสิทธิ์เบิกค่าล่วงเวลา (OT)' };
      }

      const cleanOtDate = normalizeDateToIso(date);

      await db.prepare(`
        INSERT INTO ot_requests (emp_id, date, planned_hours, ot_type, reason, status)
        VALUES (?, ?, ?, ?, ?, 'PENDING')
      `).bind(empId, cleanOtDate, Number(plannedHours), Number(otType) || 1.5, reason || '').run();

      sendPushToAdmins(db, {
        title: '⏰ คำขอยื่นทำ OT ใหม่',
        body: `พนักงาน [${empId}] ขอทำ OT ${plannedHours} ชม. (วันที่ ${cleanOtDate})`,
        url: '/?tab=attendance&sub=requests',
        tag: `ot-new-${empId}-${Date.now()}`
      }).catch(() => {});

      await logSystemActivity(
        db,
        empId,
        'PTN_TIME_REQ_OT',
        `ยื่นขอทำ OT วันที่ ${cleanOtDate} จำนวน ${plannedHours} ชม.${reason ? ` [เหตุผล: ${reason}]` : ''}`
      );

      return { success: true, message: 'ส่งคำขอทำงานล่วงเวลาเรียบร้อยแล้ว' };
  },

  getEmployeeHistory: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const empId = params.empId;
      const cutoffDay = Number(settings.cutoff_day) || 25;

      // Auto-advance cutoff period if today > cutoff day
      let defaultMonth = today.substring(0, 7);
      const curDay = parseInt(today.substring(8, 10), 10);
      if (cutoffDay < 30 && curDay > cutoffDay) {
        let m = parseInt(today.substring(5, 7), 10) + 1;
        let y = parseInt(today.substring(0, 4), 10);
        if (m > 12) { m = 1; y += 1; }
        defaultMonth = `${y}-${String(m).padStart(2, '0')}`;
      }
      const month = params.month || defaultMonth;

      // Determine cycle date range (26th of previous month to 25th of current month)
      const [pYear, pMonth] = month.split('-').map(Number);
      let startDateStr, endDateStr;

      if (cutoffDay >= 30) {
        const daysInMonth = new Date(pYear, pMonth, 0).getDate();
        const endDay = Math.min(cutoffDay, daysInMonth);
        startDateStr = `${pYear}-${String(pMonth).padStart(2, '0')}-01`;
        endDateStr = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
      } else {
        const prevMonth = pMonth === 1 ? 12 : pMonth - 1;
        const prevYear = pMonth === 1 ? pYear - 1 : pYear;
        const startDay = cutoffDay + 1;
        startDateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        endDateStr = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(cutoffDay).padStart(2, '0')}`;
      }

      // 1. Time logs within cycle range
      const logs = await db.prepare(`
        SELECT * FROM time_logs 
        WHERE emp_id = ? AND date >= ? AND date <= ? 
        ORDER BY date DESC
      `).bind(empId, startDateStr, endDateStr).all().catch(() => ({ results: [] }));

      // 2. Leave requests overlapping cycle range, plus pending or upcoming future leaves when viewing current/future period
      const curMonth = today.substring(0, 7);
      const isCurrentOrFuture = (month >= curMonth);

      let leavesQuery;
      if (isCurrentOrFuture) {
        leavesQuery = db.prepare(`
          SELECT * FROM leave_requests 
          WHERE emp_id = ? AND (
            (start_date >= ? AND start_date <= ?) OR 
            (end_date >= ? AND end_date <= ?) OR 
            (start_date <= ? AND end_date >= ?) OR
            status = 'PENDING' OR
            start_date >= ?
          )
          ORDER BY start_date DESC
        `).bind(empId, startDateStr, endDateStr, startDateStr, endDateStr, startDateStr, endDateStr, today);
      } else {
        leavesQuery = db.prepare(`
          SELECT * FROM leave_requests 
          WHERE emp_id = ? AND (
            (start_date >= ? AND start_date <= ?) OR 
            (end_date >= ? AND end_date <= ?) OR 
            (start_date <= ? AND end_date >= ?)
          )
          ORDER BY start_date DESC
        `).bind(empId, startDateStr, endDateStr, startDateStr, endDateStr, startDateStr, endDateStr);
      }
      const leaves = await leavesQuery.all().catch(() => ({ results: [] }));

      // 3. OT requests within cycle range (แสดงเฉพาะคำขอที่พนักงานเป็นผู้ยื่นคำขอเอง ไม่รวมรายการที่ระบบสร้างให้อัตโนมัติหรือ Admin ปรับปรุงเวลา)
      let otsQuery;
      if (isCurrentOrFuture) {
        otsQuery = db.prepare(`
          SELECT * FROM ot_requests 
          WHERE emp_id = ? AND (
            (date >= ? AND date <= ?) OR
            status = 'PENDING' OR
            date >= ?
          )
            AND (COALESCE(reason, '') NOT LIKE '%(Admin ปรับปรุงเวลา)%'
             AND COALESCE(reason, '') NOT LIKE '%OT งานเสร็จประจำวัน%'
             AND COALESCE(reason, '') NOT LIKE '%(HR ลงเวลาแทน)%')
          ORDER BY date DESC
        `).bind(empId, startDateStr, endDateStr, today);
      } else {
        otsQuery = db.prepare(`
          SELECT * FROM ot_requests 
          WHERE emp_id = ? AND date >= ? AND date <= ? 
            AND (COALESCE(reason, '') NOT LIKE '%(Admin ปรับปรุงเวลา)%'
             AND COALESCE(reason, '') NOT LIKE '%OT งานเสร็จประจำวัน%'
             AND COALESCE(reason, '') NOT LIKE '%(HR ลงเวลาแทน)%')
          ORDER BY date DESC
        `).bind(empId, startDateStr, endDateStr);
      }
      const ots = await otsQuery.all().catch(() => ({ results: [] }));

      // 4. Advance requests within cycle range (or matching period), plus pending
      let advancesQuery;
      if (isCurrentOrFuture) {
        advancesQuery = db.prepare(`
          SELECT * FROM advance_requests 
          WHERE emp_id = ? AND (
            (request_date >= ? AND request_date <= ?) OR period = ? OR status = 'PENDING'
          )
          ORDER BY request_date DESC
        `).bind(empId, startDateStr, endDateStr, month);
      } else {
        advancesQuery = db.prepare(`
          SELECT * FROM advance_requests 
          WHERE emp_id = ? AND (
            (request_date >= ? AND request_date <= ?) OR period = ?
          )
          ORDER BY request_date DESC
        `).bind(empId, startDateStr, endDateStr, month);
      }
      const advances = await advancesQuery.all().catch(() => ({ results: [] }));

      let totalWorkDays = 0;
      let totalLateMinutes = 0;
      let totalWorkHours = 0;
      let totalOtHours = 0;

      const overbreakSetting = await db.prepare('SELECT value FROM settings WHERE key = "CountOverbreakAsLate"').first().catch(() => null);
      const countOverbreakAsLate = overbreakSetting ? (overbreakSetting.value !== 'false' && overbreakSetting.value !== '0') : true;

      for (const l of logs.results || []) {
        if (l.clock_in) totalWorkDays++;
        const morningLate = Number(l.late_minutes) || 0;
        const overbreak = countOverbreakAsLate ? (Number(l.overbreak_minutes) || 0) : 0;
        totalLateMinutes += (morningLate + overbreak);
        totalWorkHours += (Number(l.work_hours) || 0);
        totalOtHours += (Number(l.ot_hours) || 0);
      }

      const holidays = await db.prepare(`
        SELECT * FROM company_holidays 
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC
      `).bind(startDateStr, endDateStr).all().catch(() => ({ results: [] }));

      return {
        success: true,
        month,
        startDate: startDateStr,
        endDate: endDateStr,
        stats: {
          totalWorkDays,
          totalLateMinutes,
          totalWorkHours: Math.round(totalWorkHours * 10) / 10,
          totalOtHours: Math.round(totalOtHours * 10) / 10,
          totalLeaves: (leaves.results || []).filter(lv => lv.status === 'APPROVED' && (lv.start_date <= endDateStr && lv.end_date >= startDateStr)).length,
          totalAdvances: (advances.results || []).filter(ad => ad.status === 'APPROVED' && ((ad.request_date >= startDateStr && ad.request_date <= endDateStr) || ad.period === month)).reduce((sum, a) => sum + (a.amount || 0), 0)
        },
        logs: logs.results || [],
        holidays: holidays.results || [],
        leaves: leaves.results || [],
        ots: ots.results || [],
        advances: advances.results || []
      };
  },

  getSupervisorDashboard: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const date = params.date || today;

      const empTotal = await db.prepare(`
        SELECT COUNT(*) as count 
        FROM employees 
        WHERE (is_confidential IS NULL OR is_confidential = 0)
          AND (status IS NULL OR (UPPER(status) != 'RESIGNED'))
      `).first();
      const logsToday = await db.prepare(`
        SELECT t.*, e.full_name, e.department, e.position 
        FROM time_logs t
        LEFT JOIN employees e ON t.emp_id = e.emp_id
        WHERE t.date = ? 
          AND (e.is_confidential IS NULL OR e.is_confidential = 0)
          AND (e.status IS NULL OR (UPPER(e.status) != 'RESIGNED'))
        ORDER BY t.clock_in ASC
      `).bind(date).all().catch(() => ({ results: [] }));

      const pendingLeavesRes = await db.prepare(`
        SELECT l.*, e.full_name, e.nickname, e.department 
        FROM leave_requests l
        LEFT JOIN employees e ON l.emp_id = e.emp_id
        WHERE l.status = 'PENDING' 
          AND (e.is_confidential IS NULL OR e.is_confidential = 0)
          AND (e.status IS NULL OR (UPPER(e.status) != 'RESIGNED'))
        ORDER BY l.created_at DESC
      `).all().catch(() => ({ results: [] }));
      const pendingLeavesList = pendingLeavesRes.results || [];
      if (pendingLeavesList.length > 0) {
        const curYr = String(bangkokTime.getFullYear());
        const quotaRow = await db.prepare("SELECT value FROM settings WHERE key = 'SickLeaveQuota'").first().catch(() => null);
        const sickQuota = (quotaRow && !isNaN(Number(quotaRow.value))) ? Number(quotaRow.value) : 10;
        const appSickRows = await db.prepare(`
          SELECT emp_id, leave_type, days_count, medical_cert_url
          FROM leave_requests
          WHERE UPPER(TRIM(status)) = 'APPROVED'
            AND substr(start_date, 1, 4) = ?
            AND UPPER(leave_type) LIKE '%SICK%'
        `).bind(curYr).all().catch(() => ({ results: [] }));
        const sickUsedMap = {};
        for (const r of (appSickRows.results || [])) {
          const eid = String(r.emp_id || '').trim();
          if (!sickUsedMap[eid]) sickUsedMap[eid] = { withCert: 0, noCert: 0 };
          const d = Number(r.days_count) || 1;
          const lt = String(r.leave_type || '').toUpperCase();
          if (lt === 'SICK_NO_CERT' || (lt !== 'SICK_WITH_CERT' && !r.medical_cert_url)) {
            sickUsedMap[eid].noCert += d;
          } else {
            sickUsedMap[eid].withCert += d;
          }
        }
        for (const lv of pendingLeavesList) {
          if (String(lv.leave_type || '').toUpperCase().includes('SICK')) {
            const u = sickUsedMap[String(lv.emp_id || '').trim()] || { withCert: 0, noCert: 0 };
            const withCert = Math.round(u.withCert * 100) / 100;
            const noCert = Math.round(u.noCert * 100) / 100;
            lv.ytdSickInfo = {
              withCert,
              noCert,
              total: Math.round((withCert + noCert) * 100) / 100,
              quota: sickQuota,
              remaining: Math.max(0, Math.round((sickQuota - withCert) * 100) / 100)
            };
          }
        }
      }
      const pendingLeaves = { results: pendingLeavesList };

      const pendingOts = await db.prepare(`
        SELECT o.*, e.full_name, e.nickname, e.department 
        FROM ot_requests o
        LEFT JOIN employees e ON o.emp_id = e.emp_id
        WHERE o.status = 'PENDING' 
          AND (e.is_confidential IS NULL OR e.is_confidential = 0)
          AND (e.status IS NULL OR (UPPER(e.status) != 'RESIGNED'))
        ORDER BY o.created_at DESC
      `).all().catch(() => ({ results: [] }));

      const pendingAdvances = await db.prepare(`
        SELECT a.*, e.full_name, e.nickname, e.department 
        FROM advance_requests a
        LEFT JOIN employees e ON a.emp_id = e.emp_id
        WHERE a.status = 'PENDING' 
          AND (e.is_confidential IS NULL OR e.is_confidential = 0)
          AND (e.status IS NULL OR (UPPER(e.status) != 'RESIGNED'))
        ORDER BY a.created_at DESC
      `).all().catch(() => ({ results: [] }));

      const overbreakSettingDash = await db.prepare('SELECT value FROM settings WHERE key = "CountOverbreakAsLate"').first().catch(() => null);
      const countOverbreakDash = overbreakSettingDash ? (overbreakSettingDash.value !== 'false' && overbreakSettingDash.value !== '0') : true;

      const clockedInCount = (logsToday.results || []).filter(l => l.clock_in).length;
      const lateCount = (logsToday.results || []).filter(l => (Number(l.late_minutes || 0) > 0 || (countOverbreakDash && Number(l.overbreak_minutes || 0) > 0))).length;

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
  },

  handleApproval: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { type, id, decision, approverId, rejectionReason } = params;
      if (decision === 'DELETE') {
        if (type === 'leave') {
          await db.prepare('DELETE FROM leave_requests WHERE id = ?').bind(id).run();
        } else if (type === 'ot') {
          await db.prepare('DELETE FROM ot_requests WHERE id = ?').bind(id).run();
        } else if (type === 'advance') {
          await db.prepare('DELETE FROM advance_requests WHERE id = ?').bind(id).run();
        }
        return { success: true, message: `ลบคำขอเรียบร้อยแล้ว` };
      }

      // Fetch request details before update to get target employee
      let targetEmpId = null;
      let reqDesc = '';
      let leaveRowForRecalc = null;
      if (type === 'leave') {
        const row = await db.prepare('SELECT emp_id, leave_type, days_count, start_date, end_date, time_slot FROM leave_requests WHERE id = ?').bind(id).first().catch(() => null);
        if (row) {
          targetEmpId = row.emp_id;
          reqDesc = `ขอลางาน (${row.leave_type || ''}) ${row.days_count || 1} วัน`;
          leaveRowForRecalc = row;
        }
      } else if (type === 'ot') {
        const row = await db.prepare('SELECT emp_id, planned_hours, date FROM ot_requests WHERE id = ?').bind(id).first().catch(() => null);
        if (row) { targetEmpId = row.emp_id; reqDesc = `ขอทำ OT ${row.planned_hours || ''} ชม. (${row.date || ''})`; }
      } else if (type === 'advance') {
        const row = await db.prepare('SELECT emp_id, amount FROM advance_requests WHERE id = ?').bind(id).first().catch(() => null);
        if (row) { targetEmpId = row.emp_id; reqDesc = `ขอเบิกเงินล่วงหน้า ${Number(row.amount || 0).toLocaleString()} บาท`; }
      }

      const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const now = new Date().toISOString();

      if (type === 'leave') {
        await db.prepare(`
          UPDATE leave_requests 
          SET status = ?, approver_id = ?, approved_at = ?, rejection_reason = ?
          WHERE id = ?
        `).bind(status, approverId || 'Supervisor', now, rejectionReason || '', id).run();

        // Retroactively recalculate late_minutes on existing time_logs if approved leave covers morning
        if (status === 'APPROVED' && leaveRowForRecalc) {
          const lvDays = Number(leaveRowForRecalc.days_count) || 1;
          const lvSlot = String(leaveRowForRecalc.time_slot || 'FULL').toUpperCase();
          if ((lvSlot === 'FULL' && lvDays >= 1.0) || lvSlot === 'MORNING' || (lvDays > 0 && lvDays < 1.0 && lvSlot !== 'AFTERNOON')) {
            const sD = String(leaveRowForRecalc.start_date || '').substring(0, 10);
            const eD = String(leaveRowForRecalc.end_date || '').substring(0, 10);
            if (sD && eD) {
              const logsRes = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date >= ? AND date <= ?')
                .bind(leaveRowForRecalc.emp_id, sD, eD).all().catch(() => ({ results: [] }));
              const empRow = await db.prepare('SELECT branch_id FROM employees WHERE emp_id = ?')
                .bind(leaveRowForRecalc.emp_id).first().catch(() => null);
              const branchRows = await db.prepare('SELECT * FROM branches').all().catch(() => ({ results: [] }));
              const branchMap = {};
              for (const b of (branchRows.results || [])) branchMap[b.branch_id] = b;

              for (const log of (logsRes.results || [])) {
                const branch = branchMap[log.branch_id || (empRow && empRow.branch_id)] || null;
                const lStart = timeStringToMinutes(branch && branch.lunch_start_time) || (13 * 60);
                const lEnd = timeStringToMinutes(branch && branch.lunch_end_time) || (14 * 60);
                const graceMin = branch ? (Number(branch.grace_minutes) || 0) : 0;
                const inMin = timeStringToMinutes(log.clock_in);
                const coversMorning = (lvSlot === 'FULL' && lvDays >= 1.0) || lvSlot === 'MORNING' || (inMin !== null && inMin >= lStart);
                if (coversMorning) {
                  const newLate = (inMin !== null && inMin >= lStart)
                    ? ((lEnd && inMin > (lEnd + graceMin)) ? (inMin - lEnd) : 0)
                    : 0;
                  if (newLate !== (Number(log.late_minutes) || 0)) {
                    const newStatus = (newLate === 0 && (Number(log.overbreak_minutes) || 0) === 0 && log.status === 'LATE')
                      ? 'NORMAL'
                      : log.status;
                    await db.prepare('UPDATE time_logs SET late_minutes = ?, status = ? WHERE id = ?')
                      .bind(newLate, newStatus, log.id).run().catch(() => {});
                  }
                }
              }
            }
          }
        }
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

      // Send Real Web Push to employee
      if (targetEmpId) {
        const isApproved = status === 'APPROVED';
        const notifTitle = isApproved ? '✅ คำขอได้รับการอนุมัติแล้ว' : '❌ คำขอไม่ได้รับการอนุมัติ';
        const notifBody = isApproved
          ? `คำขอ${reqDesc} ได้รับการอนุมัติแล้วโดย ${approverId || 'หัวหน้างาน'}`
          : `คำขอ${reqDesc} ไม่ได้รับการอนุมัติ ${rejectionReason ? `(เหตุผล: ${rejectionReason})` : ''}`;
        sendPushToEmployee(db, targetEmpId, {
          title: notifTitle,
          body: notifBody,
          url: '/?tab=history',
          tag: `approval-${type}-${id}`
        }).catch(err => console.error('sendPushToEmployee error:', err));
      }

      await logSystemActivity(
        db,
        approverId || 'Supervisor',
        'PTN_TIME_APPROVAL',
        `${status} คำขอ ${type} ID: ${id} (พนักงาน ${targetEmpId || '-'})`
      );

      return { success: true, message: `ดำเนินการ ${decision === 'APPROVE' ? 'อนุมัติ' : 'ปฏิเสธ'} เรียบร้อยแล้ว` };
  },

  cancelMyRequest: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, type, id } = params;
      if (!empId || !type || !id) {
        return { success: false, message: 'ข้อมูลไม่ครบถ้วน' };
      }

      let res;
      if (type === 'leave') {
        res = await db.prepare('DELETE FROM leave_requests WHERE id = ? AND emp_id = ? AND status = "PENDING"').bind(id, empId).run();
      } else if (type === 'ot') {
        res = await db.prepare('DELETE FROM ot_requests WHERE id = ? AND emp_id = ? AND status = "PENDING"').bind(id, empId).run();
      } else if (type === 'advance') {
        res = await db.prepare('DELETE FROM advance_requests WHERE id = ? AND emp_id = ? AND status = "PENDING"').bind(id, empId).run();
      } else {
        return { success: false, message: 'ประเภทคำขอไม่ถูกต้อง' };
      }

      if (res && res.meta && res.meta.changes === 0) {
        return { success: false, message: 'ไม่สามารถยกเลิกคำขอนี้ได้ (อาจได้รับการอนุมัติแล้วหรือไม่มีอยู่ในระบบ)' };
      }

      await logSystemActivity(
        db,
        empId,
        'PTN_TIME_REQ_CANCEL',
        `ยกเลิกคำขอ ${type} (ID: ${id})`
      );

      return { success: true, message: 'ยกเลิกคำขอเรียบร้อยแล้ว' };
  }
};
