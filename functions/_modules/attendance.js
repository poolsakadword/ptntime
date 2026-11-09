/**
 * Attendance & Time Tracking Handlers Module
 */
import { calculateDistanceMeters, timeToMinutes, minutesToTime, getMinutesDiff, getEmployeeBranchConfig } from './db.js';
import { verifyQrToken, validateTimeWindow } from './security.js';
import { sendPushToAdmins } from './notifications.js';

export const attendanceHandlers = {
  getTodayStatus: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const empId = params.empId;
      const date = params.date || today;
      if (!empId) return { success: false, message: 'ระบุ empId' };

      const log = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      const pendingLeave = await db.prepare('SELECT * FROM leave_requests WHERE emp_id = ? AND ? BETWEEN start_date AND end_date').bind(empId, date).first();
      const approvedOt = await db.prepare('SELECT * FROM ot_requests WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      const branchCfg = await getEmployeeBranchConfig(db, empId, null, null, settings);
      const holiday = await db.prepare('SELECT * FROM company_holidays WHERE date = ?').bind(date).first().catch(() => null);

      return {
        success: true,
        log: log || null,
        holiday: holiday || null,
        leave: pendingLeave || null,
        ot: approvedOt || null,
        settings,
        branchConfig: branchCfg || null
      };
  },

  clockIn: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, lat, lng, photoUrl, qrToken, remark } = params;
      const date = params.date || today;
      const timeStr = curTimeStr;

      if (!empId) return { success: false, message: 'ไม่พบรหัสพนักงาน' };

      // Load branch configuration for this employee
      const branchCfg = await getEmployeeBranchConfig(db, empId, lat, lng, settings);

      // Auto-detect approved leave on this date (e.g. morning leave allowing afternoon clock-in)
      let hasApprovedLeaveToday = false;
      try {
        const approvedLeaveToday = await db.prepare(`
          SELECT id, leave_type FROM leave_requests 
          WHERE emp_id = ? AND status = 'APPROVED' AND ? >= start_date AND ? <= end_date
        `).bind(empId, date, date).first();
        if (approvedLeaveToday) hasApprovedLeaveToday = true;
      } catch (e) {}

      // Check Time Window Lock
      const winErr = validateTimeWindow(settings, 'IN', timeStr, hasApprovedLeaveToday);
      if (winErr) return { success: false, message: winErr };

      // Check Device Lock
      if (settings.enable_device_lock === 'true') {
        const bound = await db.prepare('SELECT device_id, device_name FROM employee_devices WHERE emp_id = ?').bind(empId).first();
        if (bound && params.deviceId && bound.device_id !== params.deviceId) {
          return {
            success: false,
            message: 'อุปกรณ์นี้ไม่ตรงกับเครื่องที่ผูกไว้กับบัญชีของคุณ กรุณาใช้เครื่องประจำตัวของคุณ หรือขอให้หัวหน้างานปลดล็อก'
          };
        }
      }

      // Verify QR Code if provided or required
      if (!qrToken && settings.allow_direct_gps === 'false') {
        return {
          success: false,
          message: 'ระบบไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง ต้องสแกน QR Code ประจำสาขาเท่านั้น'
        };
      }

      if (qrToken) {
        const qrCheck = await verifyQrToken(qrToken, settings);
        if (!qrCheck.valid) {
          return { success: false, message: qrCheck.message };
        }
      }

      // Check existing
      const existing = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      if (existing && existing.clock_in) {
        return { success: false, message: 'คุณได้บันทึกเวลาเข้างานของวันนี้ไปแล้ว (' + existing.clock_in + ')' };
      }

      // Check distance against branch
      let distanceMeters = null;
      if (lat && lng && branchCfg.lat && branchCfg.lng) {
        distanceMeters = calculateDistanceMeters(lat, lng, branchCfg.lat, branchCfg.lng);
        if (distanceMeters > branchCfg.radiusMeters && settings.allow_outside_clockin !== 'true') {
          return {
            success: false,
            message: `อยู่นอกพื้นที่ ${branchCfg.branchName} (${distanceMeters} เมตร จากจุดที่กำหนด รัศมีอนุญาตคือ ${branchCfg.radiusMeters} ม.) ไม่สามารถลงเวลาได้`
          };
        }
      }

      // Calculate Late against branch's workStartTime with graceMinutes
      const isSunday = (dayOfWeekNumber === 0);
      const diffMinutes = getMinutesDiff(branchCfg.workStartTime, timeStr.substring(0, 5));
      const lateMinutes = isSunday ? 0 : Math.max(0, diffMinutes - (branchCfg.graceMinutes || 0));
      const status = isSunday ? 'SUNDAY_WORK' : (lateMinutes > 0 ? 'LATE' : 'NORMAL');

      // Auto-resolve any previous unclosed shifts (e.g. yesterday's clock_in without clock_out, unclosed break_out)
      try {
        const prevUnclosed = await db.prepare(`
          SELECT id, date, clock_in, break_out, break_in, break_minutes, clock_out, remark, status
          FROM time_logs
          WHERE emp_id = ? AND date < ? AND clock_in IS NOT NULL AND clock_out IS NULL
          ORDER BY date DESC LIMIT 1
        `).bind(empId, date).first();

        if (prevUnclosed) {
          let updatedPrevRemark = prevUnclosed.remark || '';
          let autoBreakIn = prevUnclosed.break_in;
          let autoBreakMinutes = prevUnclosed.break_minutes;

          // If break was left hanging open on that unclosed day, close it gracefully
          if (prevUnclosed.break_out && !prevUnclosed.break_in) {
            const bOutMins = timeToMinutes(prevUnclosed.break_out);
            autoBreakIn = minutesToTime(bOutMins + 60);
            autoBreakMinutes = 60;
            updatedPrevRemark += ' [ระบบปิดเวลาพักอัตโนมัติเนื่องจากไม่ได้สแกนกลับเข้างาน]';
          }

          if (!updatedPrevRemark.includes('ไม่ได้สแกนเลิกงาน')) {
            updatedPrevRemark = (updatedPrevRemark ? updatedPrevRemark + ' ' : '') + '[ไม่ได้สแกนเลิกงาน]';
          }

          const resolvedPrevStatus = (prevUnclosed.status === 'NORMAL' || prevUnclosed.status === 'LATE') 
            ? 'INCOMPLETE' 
            : prevUnclosed.status;

          await db.prepare(`
            UPDATE time_logs
            SET break_in = COALESCE(break_in, ?),
                break_minutes = COALESCE(break_minutes, ?),
                overbreak_minutes = 0,
                status = ?,
                remark = ?
            WHERE id = ?
          `).bind(autoBreakIn, autoBreakMinutes, resolvedPrevStatus, updatedPrevRemark.trim(), prevUnclosed.id).run();
        }
      } catch (errPrev) {
        console.warn('Auto-resolving prev unclosed log error:', errPrev);
      }

      let clockInMsg = `บันทึกเวลาเข้างานสำเร็จ (${branchCfg.branchName})`;
      let effectiveRemark = remark || '';
      if (hasApprovedLeaveToday) {
        clockInMsg += ` ⚡ มีใบลาอนุมัติไว้แต่วันนี้มาทำงานจริง (ระบบจะคำนวณเป็นเวลาทำงานปกติและยกเว้นการหักวันลาให้อัตโนมัติ)`;
        effectiveRemark = (effectiveRemark ? effectiveRemark + ' ' : '') + '[ระบบตรวจจับอัตโนมัติ: มีใบลาแต่วันนี้มาทำงานจริง]';
      }

      if (existing) {
        await db.prepare(`
          UPDATE time_logs SET clock_in = ?, in_lat = ?, in_lng = ?, in_photo_url = ?, late_minutes = ?, status = ?, remark = ?, branch_id = ?, branch_name = ?
          WHERE id = ?
        `).bind(timeStr, lat || null, lng || null, photoUrl || null, lateMinutes, status, effectiveRemark, branchCfg.branchId, branchCfg.branchName, existing.id).run();
      } else {
        await db.prepare(`
          INSERT INTO time_logs (emp_id, date, clock_in, in_lat, in_lng, in_photo_url, late_minutes, status, remark, branch_id, branch_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(empId, date, timeStr, lat || null, lng || null, photoUrl || null, lateMinutes, status, effectiveRemark, branchCfg.branchId, branchCfg.branchName).run();
      }

      if (distanceMeters && branchCfg.radiusMeters && distanceMeters > branchCfg.radiusMeters) {
        sendPushToAdmins(db, {
          title: '⚠️ แจ้งเตือน: ลงเวลาเข้างานนอกรัศมีสาขา',
          body: `พนักงาน [${empId}] ลงเวลาเข้างานที่ ${branchCfg.branchName} ระยะห่าง ${distanceMeters} ม. (กำหนดไม่เกิน ${branchCfg.radiusMeters} ม.)`,
          url: '/?tab=attendance'
        }).catch(() => {});
      }

      return {
        success: true,
        message: clockInMsg,
        hasApprovedLeaveToday,
        branchId: branchCfg.branchId,
        branchName: branchCfg.branchName,
        clockInTime: timeStr,
        lateMinutes,
        status,
        distanceMeters
      };
  },

  breakOut: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, lat, lng, photoUrl, qrToken, remark } = params;
      const date = params.date || today;
      const timeStr = curTimeStr;

      if (!empId) return { success: false, message: 'ไม่พบรหัสพนักงาน' };

      // Load branch configuration
      const branchCfg = await getEmployeeBranchConfig(db, empId, lat, lng, settings);

      // Check Time Window Lock
      const winErr = validateTimeWindow(settings, 'BREAK_OUT', timeStr);
      if (winErr) return { success: false, message: winErr };

      // Check Device Lock
      if (settings.enable_device_lock === 'true') {
        const bound = await db.prepare('SELECT device_id, device_name FROM employee_devices WHERE emp_id = ?').bind(empId).first();
        if (bound && params.deviceId && bound.device_id !== params.deviceId) {
          return {
            success: false,
            message: 'อุปกรณ์นี้ไม่ตรงกับเครื่องที่ผูกไว้กับบัญชีของคุณ กรุณาใช้เครื่องประจำตัวของคุณ หรือขอให้หัวหน้างานปลดล็อก'
          };
        }
      }

      // Verify QR Code if provided or required
      if (!qrToken && settings.allow_direct_gps === 'false') {
        return {
          success: false,
          message: 'ระบบไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง ต้องสแกน QR Code ประจำสาขาเท่านั้น'
        };
      }

      if (qrToken) {
        const qrCheck = await verifyQrToken(qrToken, settings);
        if (!qrCheck.valid) {
          return { success: false, message: qrCheck.message };
        }
      }

      const existing = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      if (!existing || !existing.clock_in) {
        return { success: false, message: 'ยังไม่ได้บันทึกเวลาเข้างานเช้า ไม่สามารถบันทึกออกไปพักได้' };
      }
      if (existing.break_out) {
        return { success: false, message: 'คุณได้บันทึกเวลาออกไปพักของวันนี้ไปแล้ว (' + existing.break_out + ')' };
      }
      if (existing.clock_out) {
        return { success: false, message: 'คุณได้บันทึกเลิกงานของวันนี้ไปแล้ว' };
      }

      // Check distance against branch
      let distanceMeters = null;
      if (lat && lng && branchCfg.lat && branchCfg.lng) {
        distanceMeters = calculateDistanceMeters(lat, lng, branchCfg.lat, branchCfg.lng);
        if (distanceMeters > branchCfg.radiusMeters && settings.allow_outside_clockin !== 'true') {
          return {
            success: false,
            message: `อยู่นอกพื้นที่ ${branchCfg.branchName} (${distanceMeters} เมตร จากจุดที่กำหนด รัศมีอนุญาตคือ ${branchCfg.radiusMeters} ม.) ไม่สามารถลงเวลาได้`
          };
        }
      }

      await db.prepare(`
        UPDATE time_logs 
        SET break_out = ?, break_out_lat = ?, break_out_lng = ?, break_out_photo_url = ?
        WHERE id = ?
      `).bind(timeStr, lat || null, lng || null, photoUrl || null, existing.id).run();

      return {
        success: true,
        message: `บันทึกเวลาออกไปพักสำเร็จ (Break OUT - ${branchCfg.branchName})`,
        breakOutTime: timeStr,
        distanceMeters
      };
  },

  breakIn: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, lat, lng, photoUrl, qrToken, remark } = params;
      const date = params.date || today;
      const timeStr = curTimeStr;

      if (!empId) return { success: false, message: 'ไม่พบรหัสพนักงาน' };

      // Load branch configuration
      const branchCfg = await getEmployeeBranchConfig(db, empId, lat, lng, settings);

      // Check Time Window Lock
      const winErr = validateTimeWindow(settings, 'BREAK_IN', timeStr);
      if (winErr) return { success: false, message: winErr };

      // Check Device Lock
      if (settings.enable_device_lock === 'true') {
        const bound = await db.prepare('SELECT device_id, device_name FROM employee_devices WHERE emp_id = ?').bind(empId).first();
        if (bound && params.deviceId && bound.device_id !== params.deviceId) {
          return {
            success: false,
            message: 'อุปกรณ์นี้ไม่ตรงกับเครื่องที่ผูกไว้กับบัญชีของคุณ กรุณาใช้เครื่องประจำตัวของคุณ หรือขอให้หัวหน้างานปลดล็อก'
          };
        }
      }

      // Verify QR Code if provided or required
      if (!qrToken && settings.allow_direct_gps === 'false') {
        return {
          success: false,
          message: 'ระบบไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง ต้องสแกน QR Code ประจำสาขาเท่านั้น'
        };
      }

      if (qrToken) {
        const qrCheck = await verifyQrToken(qrToken, settings);
        if (!qrCheck.valid) {
          return { success: false, message: qrCheck.message };
        }
      }

      const existing = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      if (!existing || !existing.clock_in) {
        return { success: false, message: 'ยังไม่ได้บันทึกเวลาเข้างานเช้า' };
      }
      if (!existing.break_out) {
        return { success: false, message: 'ยังไม่ได้บันทึกเวลาออกไปพัก กรุณาบันทึกออกไปพักก่อน' };
      }
      if (existing.break_in) {
        return { success: false, message: 'คุณได้บันทึกเวลากลับเข้าทำงานหลังพักไปแล้ว (' + existing.break_in + ')' };
      }
      if (existing.clock_out) {
        return { success: false, message: 'คุณได้บันทึกเลิกงานของวันนี้ไปแล้ว' };
      }

      // Check distance against branch
      let distanceMeters = null;
      if (lat && lng && branchCfg.lat && branchCfg.lng) {
        distanceMeters = calculateDistanceMeters(lat, lng, branchCfg.lat, branchCfg.lng);
        if (distanceMeters > branchCfg.radiusMeters && settings.allow_outside_clockin !== 'true') {
          return {
            success: false,
            message: `อยู่นอกพื้นที่ ${branchCfg.branchName} (${distanceMeters} เมตร จากจุดที่กำหนด รัศมีอนุญาตคือ ${branchCfg.radiusMeters} ม.) ไม่สามารถลงเวลาได้`
          };
        }
      }

      // Calculate break duration
      const breakOutMin = timeToMinutes(existing.break_out);
      const breakInMin = timeToMinutes(timeStr);
      const actualBreakMinutes = Math.max(0, breakInMin - breakOutMin);
      const allowedBreakMinutes = Number(settings.break_duration_minutes) || 60;
      const overBreakMinutes = Math.max(0, actualBreakMinutes - allowedBreakMinutes);

      await db.prepare(`
        UPDATE time_logs 
        SET break_in = ?, break_in_lat = ?, break_in_lng = ?, break_in_photo_url = ?, break_minutes = ?, overbreak_minutes = ?
        WHERE id = ?
      `).bind(timeStr, lat || null, lng || null, photoUrl || null, actualBreakMinutes, overBreakMinutes, existing.id).run();

      return {
        success: true,
        message: `บันทึกเวลากลับเข้าทำงานสำเร็จ (Break IN - ${branchCfg.branchName})`,
        breakInTime: timeStr,
        breakMinutes: actualBreakMinutes,
        overbreakMinutes: overBreakMinutes,
        distanceMeters
      };
  },

  clockOut: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, lat, lng, photoUrl, qrToken, remark } = params;
      const date = params.date || today;
      const timeStr = curTimeStr;

      if (!empId) return { success: false, message: 'ไม่พบรหัสพนักงาน' };

      const existing = await db.prepare('SELECT * FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, date).first();
      if (!existing || !existing.clock_in) {
        return { success: false, message: 'ยังไม่พบบันทึกเวลาเข้างานของวันนี้ กรุณาบันทึกเข้างานก่อน' };
      }

      // Determine branch configuration: if recorded at clock-in, use that branch's settings
      let effectiveBranchCfg = await getEmployeeBranchConfig(db, empId, lat, lng, settings);
      if (existing.branch_id) {
        const recordedBranch = await db.prepare("SELECT * FROM branches WHERE branch_id = ?").bind(existing.branch_id).first().catch(() => null);
        if (recordedBranch) {
          effectiveBranchCfg = {
            branchId: recordedBranch.branch_id,
            branchName: recordedBranch.branch_name,
            lat: recordedBranch.lat || effectiveBranchCfg.lat,
            lng: recordedBranch.lng || effectiveBranchCfg.lng,
            radiusMeters: recordedBranch.radius_meters || effectiveBranchCfg.radiusMeters,
            workStartTime: recordedBranch.work_start_time || effectiveBranchCfg.workStartTime,
            workEndTime: recordedBranch.work_end_time || effectiveBranchCfg.workEndTime,
            lunchStartTime: recordedBranch.lunch_start_time || effectiveBranchCfg.lunchStartTime,
            lunchEndTime: recordedBranch.lunch_end_time || effectiveBranchCfg.lunchEndTime,
            graceMinutes: recordedBranch.grace_minutes != null ? Number(recordedBranch.grace_minutes) : effectiveBranchCfg.graceMinutes,
            otStartTime: recordedBranch.ot_start_time || recordedBranch.work_end_time || effectiveBranchCfg.otStartTime,
            earlyDismissalFullPay: (recordedBranch.early_dismissal_full_pay === 1 || recordedBranch.early_dismissal_full_pay === '1' || recordedBranch.early_dismissal_full_pay === 'true' || recordedBranch.early_dismissal_full_pay === true)
          };
        }
      }

      // In BREAK_PUNCH mode, if employee forgot Break IN before clocking out, auto-close break gracefully
      let autoBreakRemark = '';
      if (existing.break_out && !existing.break_in) {
        const bOutMins = timeToMinutes(existing.break_out);
        const lEndMins = effectiveBranchCfg ? timeToMinutes(effectiveBranchCfg.lunchEndTime) : (bOutMins + 60);
        const resolvedEndMins = (lEndMins > bOutMins) ? lEndMins : (bOutMins + 60);
        const autoClosedBreakIn = minutesToTime(resolvedEndMins);
        const autoBreakMins = Math.max(0, resolvedEndMins - bOutMins) || 60;

        await db.prepare(`
          UPDATE time_logs 
          SET break_in = ?, break_minutes = ?
          WHERE id = ?
        `).bind(autoClosedBreakIn, autoBreakMins, existing.id).run();

        existing.break_in = autoClosedBreakIn;
        existing.break_minutes = autoBreakMins;
        autoBreakRemark = ' [ระบบบันทึกจบพักอัตโนมัติเมื่อลงเวลาออกงาน]';
      }

      // Check Time Window Lock (Skip OUT restriction if branch is in early dismissal full pay mode or employee is undertime exempt)
      if (!effectiveBranchCfg.earlyDismissalFullPay && !effectiveBranchCfg.isUndertimeExempt) {
        const winErr = validateTimeWindow(settings, 'OUT', timeStr);
        if (winErr) return { success: false, message: winErr };
      }

      // Check Device Lock
      if (settings.enable_device_lock === 'true') {
        const bound = await db.prepare('SELECT device_id, device_name FROM employee_devices WHERE emp_id = ?').bind(empId).first();
        if (bound && params.deviceId && bound.device_id !== params.deviceId) {
          return {
            success: false,
            message: 'อุปกรณ์นี้ไม่ตรงกับเครื่องที่ผูกไว้กับบัญชีของคุณ กรุณาใช้เครื่องประจำตัวของคุณ หรือขอให้หัวหน้างานปลดล็อก'
          };
        }
      }

      // Verify QR Code if provided or required
      if (!qrToken && settings.allow_direct_gps === 'false') {
        return {
          success: false,
          message: 'ระบบไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง ต้องสแกน QR Code ประจำสาขาเท่านั้น'
        };
      }

      if (qrToken) {
        const qrCheck = await verifyQrToken(qrToken, settings);
        if (!qrCheck.valid) {
          return { success: false, message: qrCheck.message };
        }
      }

      // Check distance against effective branch
      let distanceMeters = null;
      if (lat && lng && effectiveBranchCfg.lat && effectiveBranchCfg.lng) {
        distanceMeters = calculateDistanceMeters(lat, lng, effectiveBranchCfg.lat, effectiveBranchCfg.lng);
        if (distanceMeters > effectiveBranchCfg.radiusMeters && settings.allow_outside_clockin !== 'true') {
          return {
            success: false,
            message: `อยู่นอกพื้นที่ ${effectiveBranchCfg.branchName} (${distanceMeters} เมตร จากจุดที่กำหนด รัศมีอนุญาตคือ ${effectiveBranchCfg.radiusMeters} ม.) ไม่สามารถลงเวลาได้`
          };
        }
      }

      const isSunday = (dayOfWeekNumber === 0);
      const inMinutes = timeToMinutes(existing.clock_in);
      const outMinutes = timeToMinutes(timeStr);
      const workStartMinutes = timeToMinutes(effectiveBranchCfg.workStartTime);
      const workEndMinutes = timeToMinutes(effectiveBranchCfg.workEndTime);
      const otStartMinutes = timeToMinutes(effectiveBranchCfg.otStartTime);
      const lunchStart = timeToMinutes(effectiveBranchCfg.lunchStartTime);
      const lunchEnd = timeToMinutes(effectiveBranchCfg.lunchEndTime);

      // Early clock-in handling: if employee clocks in early before branch workStartTime,
      // start counting work hours strictly from workStartTime (preserving actual clock-in timestamp in history)
      const effectiveInMinutes = Math.max(inMinutes, workStartMinutes);

      let normalMinutes = 0;
      let calculatedOtHours = 0;

      // Determine break deduction
      let breakDeduction = 0;
      if (existing.break_minutes != null && existing.break_minutes > 0) {
        breakDeduction = existing.break_minutes;
      } else if (effectiveInMinutes <= lunchStart && (isSunday ? outMinutes >= lunchEnd : Math.min(outMinutes, workEndMinutes) >= lunchEnd)) {
        breakDeduction = Number(settings.break_duration_minutes) || 60;
      }

      if (isSunday) {
        // Sunday: All hours count as Sunday OT at sunday_ot_rate (1.0x default, starting from workStartTime)
        let totalSunMinutes = Math.max(0, outMinutes - effectiveInMinutes);
        totalSunMinutes = Math.max(0, totalSunMinutes - breakDeduction);
        if (settings.ot_rounding_mode === 'HALF_HOUR') {
          calculatedOtHours = Math.floor(totalSunMinutes / 30) * 0.5;
        } else {
          calculatedOtHours = Math.round((totalSunMinutes / 60) * 100) / 100;
        }
        normalMinutes = 0;
      } else {
        // Normal workday (Mon - Sat)
        // Normal work cut between effectiveInMinutes (branch workStartTime) and workEndMinutes
        const cappedEnd = Math.min(outMinutes, workEndMinutes);
        normalMinutes = Math.max(0, cappedEnd - effectiveInMinutes);
        normalMinutes = Math.max(0, normalMinutes - breakDeduction);

        // Automatic OT: If Clock Out is after otStartMinutes (branch-specific)
        if (outMinutes > otStartMinutes) {
          const rawOtMinutes = outMinutes - otStartMinutes;
          if (settings.ot_rounding_mode === 'HALF_HOUR') {
            calculatedOtHours = Math.floor(rawOtMinutes / 30) * 0.5;
          } else {
            calculatedOtHours = Math.round((rawOtMinutes / 60) * 100) / 100;
          }
        }
      }

      // Check employee OT eligibility & Undertime Exemption
      const empRow = await db.prepare('SELECT is_ot_eligible, is_undertime_exempt FROM employees WHERE emp_id = ?').bind(empId).first().catch(() => null);
      const isOtEligible = !(empRow && (empRow.is_ot_eligible === 'false' || empRow.is_ot_eligible === false));
      if (!isOtEligible) {
        calculatedOtHours = 0;
      }
      const isEmpUndertimeExempt = (empRow && (empRow.is_undertime_exempt === 'true' || empRow.is_undertime_exempt === true || empRow.is_undertime_exempt === 1 || empRow.is_undertime_exempt === '1'));

      const totalWorkHours = Math.round((normalMinutes / 60) * 100) / 100;
      const isEarlyDismissalFullPay = !!effectiveBranchCfg.earlyDismissalFullPay || isEmpUndertimeExempt;
      const finalIsFullPay = isEarlyDismissalFullPay ? 1 : 0;
      const earlyDismissalRemark = isEmpUndertimeExempt 
        ? ' [สิทธิ์ประจำตำแหน่ง: จ่ายค่าแรงเต็มวัน ไม่หักเวลาออกก่อน]' 
        : (isEarlyDismissalFullPay ? ' [งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน]' : '');

      await db.prepare(`
        UPDATE time_logs 
        SET clock_out = ?, out_lat = ?, out_lng = ?, out_photo_url = ?, work_hours = ?, ot_hours = ?,
            is_full_pay = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(is_full_pay, 0) END,
            status = CASE WHEN ? = 1 AND COALESCE(late_minutes, 0) = 0 THEN 'NORMAL' ELSE status END,
            remark = COALESCE(remark, '') || ?
        WHERE id = ?
      `).bind(timeStr, lat || null, lng || null, photoUrl || null, totalWorkHours, calculatedOtHours, finalIsFullPay, finalIsFullPay, (remark ? ' ' + remark : '') + earlyDismissalRemark + autoBreakRemark, existing.id).run();

      // If OT occurred and employee is eligible, record or update in ot_requests automatically
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

      let clockOutMsg = `บันทึกเวลาออกงานสำเร็จ (${effectiveBranchCfg.branchName})`;
      if (effectiveBranchCfg.earlyDismissalFullPay) {
        clockOutMsg += ` ✨ โหมดงานเสร็จ: ได้รับค่าแรงเต็มวัน`;
      }
      let hasApprovedLeaveToday = false;
      try {
        const approvedLeaveToday = await db.prepare(`
          SELECT id, leave_type FROM leave_requests 
          WHERE emp_id = ? AND status = 'APPROVED' AND ? >= start_date AND ? <= end_date
        `).bind(empId, date, date).first();
        if (approvedLeaveToday) hasApprovedLeaveToday = true;
      } catch (e) {}

      if (hasApprovedLeaveToday || (existing && existing.remark && existing.remark.includes('[ระบบตรวจจับอัตโนมัติ: มีใบลาแต่วันนี้มาทำงานจริง]'))) {
        clockOutMsg += ` ⚡ ตรวจพบมาทำงานจริง (${totalWorkHours} ชม.) ระบบจะยกเว้นการหักวันลาในวันนี้ให้อัตโนมัติ`;
      }

      return {
        success: true,
        message: clockOutMsg,
        isFullPay: isEarlyDismissalFullPay,
        hasApprovedLeaveToday,
        branchId: effectiveBranchCfg.branchId,
        branchName: effectiveBranchCfg.branchName,
        clockOutTime: timeStr,
        workHours: totalWorkHours,
        otHours: calculatedOtHours,
        isOtEligible,
        isSunday
      };
  }
};
