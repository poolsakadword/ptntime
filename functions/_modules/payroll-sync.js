/**
 * Payroll Sync & Initial Data Handlers Module
 */
import { normalizeDateToIso } from './db.js';
import { getDynamicQrToken } from './security.js';

export const payrollSyncHandlers = {
  getInitialData: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const targetEmpId = params.empId ? String(params.empId).trim() : '';
      let employees = [];

      if (targetEmpId) {
        const empRow = await db.prepare("SELECT emp_id, full_name, nickname, department, position, phone, status, photo_url, branch_id, allow_all_branches, is_ot_eligible, birth_date FROM employees WHERE UPPER(emp_id) = UPPER(?) AND status != 'Resigned' AND (is_confidential IS NULL OR is_confidential = 0)").bind(targetEmpId).first().catch(() => null);
        if (empRow) {
          const devRow = await db.prepare('SELECT emp_id, device_id, device_name, bound_at FROM employee_devices WHERE UPPER(emp_id) = UPPER(?)').bind(targetEmpId).first().catch(() => null);
          employees = [{
            empId: empRow.emp_id,
            fullName: empRow.full_name || '',
            nickname: empRow.nickname || '',
            photoUrl: empRow.photo_url || '',
            department: empRow.department || '-',
            position: empRow.position || '-',
            phone: empRow.phone || '',
            branchId: empRow.branch_id || 'B01',
            allowAllBranches: (empRow.allow_all_branches === 'true' || empRow.allow_all_branches === true),
            isOtEligible: !(empRow.is_ot_eligible === 'false' || empRow.is_ot_eligible === false),
            status: empRow.status || 'Active',
            birthDate: empRow.birth_date || '',
            boundDevice: devRow ? {
              deviceId: devRow.device_id,
              deviceName: devRow.device_name,
              boundAt: devRow.bound_at,
              updatedAt: devRow.bound_at
            } : null
          }];
        }
      }

      const branchRows = await db.prepare("SELECT * FROM branches ORDER BY branch_id ASC").all().catch(() => ({ results: [] }));
      const deviceRows = targetEmpId ? (await db.prepare('SELECT emp_id, device_id, device_name, bound_at FROM employee_devices WHERE UPPER(emp_id) = UPPER(?)').bind(targetEmpId).all().catch(() => ({ results: [] }))) : { results: [] };

      const dynamicToken = await getDynamicQrToken(0);
      const secondsLeft = 20 - (Math.floor(Date.now() / 1000) % 20);

      const safeSettings = { ...settings };
      delete safeSettings.kiosk_pin;

      let announcement = null;
      try {
        const annRow = await db.prepare("SELECT value FROM settings WHERE key = 'app_announcement'").first();
        if (annRow && annRow.value) {
          announcement = JSON.parse(annRow.value);
        }
      } catch (e) {
        console.warn('Announcement fetch error:', e);
      }

      const holidaysRows = await db.prepare('SELECT * FROM company_holidays ORDER BY date ASC').all().catch(() => ({ results: [] }));
      const companyHolidays = holidaysRows.results || [];

      return {
        success: true,
        settings: safeSettings,
        branches: branchRows.results || [],
        today,
        currentTime: curTimeStr,
        dayOfWeek: dayOfWeekNumber,
        dynamicToken,
        secondsLeft,
        employees,
        devices: deviceRows.results || [],
        announcement,
        companyHolidays
      };
  },

  getPayrollSyncData: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      // period param: e.g. "2026-09"
      const periodStr = params.period || today.substring(0, 7);
      const [pYear, pMonth] = periodStr.split('-').map(Number);

      // Start: 26th of previous month
      const prevMonth = pMonth === 1 ? 12 : pMonth - 1;
      const prevYear = pMonth === 1 ? pYear - 1 : pYear;
      const startDateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-26`;
      // End: 25th of current month
      const endDateStr = `${pYear}-${String(pMonth).padStart(2, '0')}-25`;

      const empRows = await db.prepare('SELECT emp_id, full_name, department, status, resign_date FROM employees WHERE (is_confidential IS NULL OR is_confidential = 0) ORDER BY emp_id ASC').all().catch(() => ({ results: [] }));
      const syncList = [];

      const overbreakSettingSync = await db.prepare('SELECT value FROM settings WHERE key = "CountOverbreakAsLate"').first().catch(() => null);
      const countOverbreakSync = overbreakSettingSync ? (overbreakSettingSync.value !== 'false' && overbreakSettingSync.value !== '0') : true;

      for (const emp of empRows.results || []) {
        if (emp.status === 'Resigned') {
          const rDate = emp.resign_date ? String(emp.resign_date).trim().substring(0, 10) : '';
          const hasLogs = await db.prepare('SELECT 1 FROM time_logs WHERE emp_id = ? AND date >= ? AND date <= ? LIMIT 1').bind(emp.emp_id, startDateStr, endDateStr).first().catch(() => null);
          if (rDate && rDate < startDateStr && !hasLogs) {
            continue;
          }
        }
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

        // 5. Late minutes (including morning late and afternoon overbreak if enabled)
        const lateRow = countOverbreakSync
          ? await db.prepare(`
              SELECT SUM(COALESCE(late_minutes, 0) + COALESCE(overbreak_minutes, 0)) as total_late_min,
                     SUM(CASE WHEN COALESCE(late_minutes, 0) > 0 THEN 1 ELSE 0 END + CASE WHEN COALESCE(overbreak_minutes, 0) > 0 THEN 1 ELSE 0 END) as late_days
              FROM time_logs
              WHERE emp_id = ? AND date >= ? AND date <= ?
            `).bind(emp.emp_id, startDateStr, endDateStr).first()
          : await db.prepare(`
              SELECT SUM(COALESCE(late_minutes, 0)) as total_late_min,
                     SUM(CASE WHEN COALESCE(late_minutes, 0) > 0 THEN 1 ELSE 0 END) as late_days
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
  },

  getMyPayslips: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const empId = params.empId ? String(params.empId).trim() : null;
      if (!empId) {
        return { success: false, message: 'กรุณาระบุรหัสพนักงาน' };
      }

      // Check confidential status
      const confEmpCheck = await db.prepare('SELECT is_confidential FROM employees WHERE emp_id = ?').bind(empId).first().catch(() => null);
      if (confEmpCheck && (confEmpCheck.is_confidential === 1 || confEmpCheck.is_confidential === '1')) {
        return { success: false, message: 'ไม่พบข้อมูลพนักงาน' };
      }

      // 1. Check feature toggle in attendance_settings
      const payslipSetting = await db.prepare('SELECT value FROM attendance_settings WHERE key = "enable_payslip"').first().catch(() => null);
      if (payslipSetting && payslipSetting.value === 'false') {
        return {
          success: false,
          disabled: true,
          message: 'ฟังก์ชันสลิปเงินเดือนถูกปิดใช้งานชั่วคราวโดยผู้ดูแลระบบ'
        };
      }

      const releaseModeSetting = await db.prepare('SELECT value FROM attendance_settings WHERE key = "payslip_release_mode"').first().catch(() => null);
      const releaseMode = releaseModeSetting?.value || 'CLOSED_PERIODS_ONLY';

      // 1.1 Validate PIN (Disallow '1234', require last 4 digits of citizen ID or phone)
      const pin = params.pin ? String(params.pin).trim() : null;
      if (pin) {
        const cleanPin = pin.replace(/[^0-9]/g, '');
        if (cleanPin === '1234') {
          return { success: false, message: 'รหัส 1234 ถูกยกเลิกแล้ว กรุณากรอกเลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์' };
        }
        const empRow = await db.prepare('SELECT citizen_id, phone FROM employees WHERE emp_id = ?').bind(empId).first();
        if (empRow) {
          const last4 = (empRow.citizen_id || '').slice(-4);
          const fullCitizen = (empRow.citizen_id || '').replace(/[^0-9]/g, '');
          const phone = (empRow.phone || '').replace(/[^0-9]/g, '');
          const phoneLast4 = phone.length >= 4 ? phone.slice(-4) : '';
          const matched =
            (cleanPin && cleanPin === last4) ||
            (cleanPin && cleanPin === fullCitizen) ||
            (cleanPin && cleanPin === phone) ||
            (phoneLast4 && phoneLast4.length === 4 && cleanPin === phoneLast4) ||
            pin === 'admin';
          if (!matched) {
            return { success: false, message: 'รหัส PIN ไม่ถูกต้อง (กรุณากรอกเลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์)' };
          }
        }
      }

      // 2. Query company info from settings
      const compRows = await db.prepare('SELECT key, value FROM settings WHERE key IN ("CompanyName", "Address", "CompanyAddress", "TaxId", "CompanyTaxId", "Phone")').all().catch(() => ({ results: [] }));
      const compMap = {};
      for (const r of (compRows.results || [])) compMap[r.key] = r.value;
      const companyInfo = {
        name: compMap.CompanyName || 'บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด',
        address: compMap.Address || compMap.CompanyAddress || '919/30 ม.10 ต.นครสวรรค์ตก อ.เมือง จ.นครสวรรค์ 60000',
        phone: compMap.Phone || '056-345625, 056-371370',
        taxId: compMap.TaxId || compMap.CompanyTaxId || '0605556001337'
      };

      // 3. Query all periods where this employee has calculations in payroll_calcs
      const calcsQuery = await db.prepare(`
        SELECT p.*, e.citizen_id, e.birth_date, e.join_date, e.photo_url, e.nickname
        FROM payroll_calcs p
        LEFT JOIN employees e ON p.emp_id = e.emp_id
        WHERE p.emp_id = ?
      `).bind(empId).all().catch(() => ({ results: [] }));

      const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      const getPeriodSortKey = (periodStr) => {
        if (!periodStr) return 0;
        const s = String(periodStr).trim();
        const ymMatch = s.match(/^(\d{4})-(\d{1,2})/);
        if (ymMatch) {
          let y = parseInt(ymMatch[1], 10);
          const m = parseInt(ymMatch[2], 10);
          if (y < 2400) y += 543;
          return y * 100 + m;
        }
        let monthIdx = 0;
        for (let i = 0; i < thaiMonths.length; i++) {
          if (s.includes(thaiMonths[i])) {
            monthIdx = i + 1;
            break;
          }
        }
        const yearMatch = s.match(/(\d{4})/);
        let year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
        if (year > 0 && year < 2400) year += 543;
        if (year > 0 && monthIdx > 0) return year * 100 + monthIdx;
        return 0;
      };

      const allCalcs = (calcsQuery.results || []).sort((a, b) => getPeriodSortKey(b.period) - getPeriodSortKey(a.period));
      if (allCalcs.length === 0) {
        return {
          success: true,
          empId,
          companyInfo,
          periods: [],
          payslip: null,
          message: 'ยังไม่มีประวัติสลิปเงินเดือนที่คำนวณในระบบ'
        };
      }

      // Check closed status for each period
      const closedSettings = await db.prepare('SELECT key, value FROM settings WHERE key LIKE "Period_Closed_%" OR key LIKE "Period_Status_%"').all().catch(() => ({ results: [] }));
      const closedMap = {};
      for (const r of (closedSettings.results || [])) {
        if (r.key.startsWith('Period_Closed_')) {
          const periodKey = r.key.replace('Period_Closed_', '');
          closedMap[periodKey] = true;
        } else if (r.key.startsWith('Period_Status_') && r.value && r.value.startsWith('CLOSED')) {
          const periodKey = r.key.replace('Period_Status_', '');
          closedMap[periodKey] = true;
        }
      }

      // Filter periods based on releaseMode
      const availablePeriods = [];
      for (const c of allCalcs) {
        const isClosed = closedMap[c.period] || false;
        if (releaseMode === 'CLOSED_PERIODS_ONLY' && !isClosed) {
          // If only closed periods allowed and this period is not closed, skip
          continue;
        }
        availablePeriods.push(c.period);
      }

      if (availablePeriods.length === 0) {
        return {
          success: true,
          empId,
          companyInfo,
          periods: [],
          payslip: null,
          message: 'ยังไม่มีสลิปเงินเดือนที่สรุปและปิดงวดแล้ว'
        };
      }

      // Select target period: params.period or the latest available period
      const targetPeriod = params.period ? String(params.period).trim() : availablePeriods[0];
      const targetCalc = allCalcs.find(c => c.period === targetPeriod) || allCalcs.find(c => c.period === availablePeriods[0]);

      // Also get monthly_inputs breakdown (days absent, leave, sick, late deduction, etc.)
      const inputRow = await db.prepare('SELECT * FROM monthly_inputs WHERE period = ? AND emp_id = ?').bind(targetCalc.period, empId).first().catch(() => null);

      // Mask bank account for privacy (e.g. ***-*-*458-2)
      const rawBankAcc = targetCalc.bank_account || '';
      let maskedBankAcc = '';
      if (rawBankAcc.length >= 6) {
        maskedBankAcc = '***-*-*' + rawBankAcc.slice(-4);
      } else if (rawBankAcc) {
        maskedBankAcc = '***' + rawBankAcc.slice(-2);
      }

      const payslipData = {
        period: targetCalc.period,
        empId: targetCalc.emp_id,
        fullName: targetCalc.full_name,
        nickname: targetCalc.nickname || '',
        department: targetCalc.department || '-',
        position: targetCalc.position || '-',
        bankName: targetCalc.bank_name || '-',
        bankAccount: maskedBankAcc,
        rawBankAccount: rawBankAcc,
        
        // Earnings
        baseSalary: Number(targetCalc.base_salary) || 0,
        otHours: Number(targetCalc.ot_hours) || 0,
        otRate: Number(targetCalc.ot_rate) || 0,
        otPay: Number(targetCalc.ot_pay) || 0,
        allowance: Number(targetCalc.allowance) || 0,
        bonus: Number(targetCalc.bonus) || 0,
        totalEarnings: (Number(targetCalc.base_salary) || 0) + (Number(targetCalc.ot_pay) || 0) + (Number(targetCalc.allowance) || 0) + (Number(targetCalc.bonus) || 0),
        
        // Deductions
        leaveDeduct: Number(targetCalc.leave_deduction) || 0,
        leaveDeduction: Number(targetCalc.leave_deduction) || 0,
        sso: Number(targetCalc.sso) || 0,
        pf: Number(targetCalc.pf) || 0,
        tax: Number(targetCalc.tax) || 0,
        advanceDeduct: Number(targetCalc.advance_deduct) || 0,
        otherDeduct: Number(targetCalc.other_deduct) || 0,
        lateDeduct: Number(inputRow?.late_deduct) || 0,
        totalDeductions: (Number(targetCalc.total_deductions) || 0) + (Number(targetCalc.leave_deduction) || 0),
        
        // Net
        grossPay: Number(targetCalc.gross_pay) || 0,
        netPay: Number(targetCalc.net_pay) || 0,
        
        // Attendance stats in this period
        absentDays: Number(inputRow?.absent_days) || 0,
        leaveDays: Number(inputRow?.leave_days) || 0,
        sickLeaveDays: Number(inputRow?.sick_leave_days) || 0,
        unpaidSickLeaveDays: Number(inputRow?.unpaid_sick_leave_days) || 0,
        
        isClosed: closedMap[targetCalc.period] || false
      };

      return {
        success: true,
        empId,
        companyInfo,
        periods: availablePeriods,
        payslip: payslipData
      };
  }
};
