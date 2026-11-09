/**
 * Settings & Branch Controls Handlers Module
 */
import { isUserSuperAdmin, userHasPermission } from './security.js';

export const settingsBranchesHandlers = {
  saveSettings: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const newSettings = params.settings || {};
      for (const [k, v] of Object.entries(newSettings)) {
        await db.prepare('INSERT OR REPLACE INTO attendance_settings (key, value) VALUES (?, ?)').bind(k, String(v)).run();
      }
      return { success: true, message: 'บันทึกการตั้งค่าระบบลงเวลาเรียบร้อยแล้ว' };
  },

  adminResetEmployeeTodayLog: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, date } = params;
      const targetDate = date || today;
      await db.prepare('DELETE FROM time_logs WHERE emp_id = ? AND date = ?').bind(empId, targetDate).run();
      return { success: true, message: `ล้างประวัติการลงเวลาของ [${empId}] วันที่ ${targetDate} สำเร็จ` };
  },

  adminAdjustEmployeeTodayLog: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, date, clockIn, lateMinutes, status, remark } = params;
      const targetDate = date || today;
      await db.prepare(`
        UPDATE time_logs 
        SET clock_in = COALESCE(?, clock_in),
            late_minutes = COALESCE(?, late_minutes),
            status = COALESCE(?, status),
            remark = COALESCE(?, remark)
        WHERE emp_id = ? AND date = ?
      `).bind(clockIn !== undefined ? clockIn : null, lateMinutes !== undefined ? lateMinutes : null, status || null, remark || null, empId, targetDate).run();
      return { success: true, message: `ปรับปรุงเวลาเข้างานของ [${empId}] วันที่ ${targetDate} สำเร็จ` };
  },

  toggleBranchEarlyDismissal: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const branchId = String(params.branchId || params.branch_id || '').trim();
      const callerUser = params.username || '';
      if (callerUser) {
        const allowed = (await isUserSuperAdmin(db, callerUser)) ||
                        (await userHasPermission(db, callerUser, 'manage_attendance_settings')) ||
                        (await userHasPermission(db, callerUser, 'toggle_early_dismissal')) ||
                        (await userHasPermission(db, callerUser, 'toggle_early_dismissal:' + branchId));
        if (!allowed) return { success: false, message: 'สิทธิ์ไม่เพียงพอ: บัญชีของคุณไม่ได้รับสิทธิ์เปิด/ปิดโหมดงานเสร็จของสาขานี้' };
      }
      const enabled = (params.enabled === true || params.enabled === 'true' || params.enabled === 1 || params.enabled === '1') ? 1 : 0;
      if (!branchId) return { success: false, message: 'กรุณาระบุรหัสสาขา' };

      await db.prepare('UPDATE branches SET early_dismissal_full_pay = ? WHERE branch_id = ?').bind(enabled, branchId).run();
      const branch = await db.prepare('SELECT branch_name FROM branches WHERE branch_id = ?').bind(branchId).first();
      const branchName = branch?.branch_name || branchId;
      const statusText = enabled ? 'เปิดโหมดงานเสร็จ-เลิกงานก่อน (จ่ายค่าแรงเต็มวัน)' : 'ปิดโหมดงานเสร็จ (กลับสู่โหมดปกติ)';

      return {
        success: true,
        branchId,
        enabled: enabled === 1,
        message: `${statusText} สำหรับสาขา ${branchName} เรียบร้อยแล้ว`
      };
  },

  batchSetAttendanceEarlyDismissal: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const callerUser = params.username || 'Admin';
      const isSuper = await isUserSuperAdmin(db, callerUser);
      const canManage = await userHasPermission(db, callerUser, 'manage_attendance_settings');
      const canAll = await userHasPermission(db, callerUser, 'toggle_early_dismissal');
      if (!isSuper && !canManage && !canAll) {
        const uRow = await db.prepare('SELECT permissions FROM users WHERE LOWER(username) = ?').bind(String(callerUser).toLowerCase()).first();
        const uPerms = uRow && uRow.permissions ? (typeof uRow.permissions === 'string' ? JSON.parse(uRow.permissions) : uRow.permissions) : [];
        const hasAnyEarlyBranch = uPerms.some(p => String(p).startsWith('toggle_early_dismissal:'));
        if (!hasAnyEarlyBranch) return { success: false, message: 'สิทธิ์ไม่เพียงพอ: บัญชีของคุณไม่ได้รับสิทธิ์จัดการโหมดงานเสร็จ' };
      }

      const ids = Array.isArray(params.ids) ? params.ids : [];
      if (ids.length === 0) return { success: false, message: 'กรุณาเลือกรายการที่ต้องการดำเนินการ' };

      const enabled = (params.enabled === true || params.enabled === 'true' || params.enabled === 1 || params.enabled === '1') ? 1 : 0;
      let updatedCount = 0;

      const branchesRes = await db.prepare('SELECT branch_id, work_start_time, work_end_time, lunch_start_time, lunch_end_time FROM branches').all().catch(() => ({ results: [] }));
      const bMap = {};
      (branchesRes.results || []).forEach(b => { bMap[b.branch_id] = b; });

      for (const id of ids) {
        const log = await db.prepare('SELECT * FROM time_logs WHERE id = ?').bind(id).first();
        if (!log) continue;

        let curRemark = String(log.remark || '').trim();
        const tag = 'งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน';

        if (enabled === 1) {
          if (!curRemark.includes(tag)) {
            curRemark = curRemark ? (curRemark + ' | ' + tag) : tag;
          }
          const branch = bMap[log.branch_id] || {};
          const sMin = timeStringToMinutes(branch.work_start_time || '09:30') || 570;
          const eMin = timeStringToMinutes(branch.work_end_time || '19:00') || 1140;
          const lStart = timeStringToMinutes(branch.lunch_start_time || '13:00') || 780;
          const lEnd = timeStringToMinutes(branch.lunch_end_time || '14:00') || 840;
          const breakMin = (lEnd > lStart) ? (lEnd - lStart) : 60;
          const fullShiftHours = Math.max(0, Math.round(((eMin - sMin - breakMin) / 60) * 10) / 10) || 8.5;

          const newWorkHours = Math.max(Number(log.work_hours) || 0, fullShiftHours);

          await db.prepare('UPDATE time_logs SET is_full_pay = 1, work_hours = ?, remark = ? WHERE id = ?')
            .bind(newWorkHours, curRemark, id).run();
          updatedCount++;
        } else {
          curRemark = curRemark.replace(new RegExp('\s*\|\s*' + tag, 'g'), '')
                               .replace(new RegExp(tag, 'g'), '').trim();
          await db.prepare('UPDATE time_logs SET is_full_pay = 0, remark = ? WHERE id = ?')
            .bind(curRemark, id).run();
          updatedCount++;
        }
      }

      const actionText = enabled === 1 ? 'อนุมัติโหมดงานเสร็จ (จ่ายเต็มวัน)' : 'ยกเลิกโหมดงานเสร็จ';
      return {
        success: true,
        count: updatedCount,
        message: `${actionText} สำหรับ ${updatedCount} รายการเรียบร้อยแล้ว`
      };
  }
};
