/**
 * Incident & Damage Deductions Module for PTN Time
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 */
import { normalizeDateToIso } from './db.js';
import { isUserSuperAdmin, userHasPermission } from './security.js';

export const incidentHandlers = {
  submitIncidentReport: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
    const callerUser = params.username || 'Supervisor';

    const incidentDate = normalizeDateToIso(params.incidentDate) || today;
    const branchId = params.branchId || params.branch_id || 'B01';
    const category = params.category || 'OTHER';
    const title = String(params.title || '').trim();
    const description = String(params.description || '').trim();
    const evidencePhotoUrl = params.evidencePhotoUrl || params.photoUrl || '';
    const totalAmount = Math.max(0, Number(params.totalIncidentAmount !== undefined ? params.totalIncidentAmount : (params.amount || 0)));

    let involvedEmpIds = Array.isArray(params.involvedEmpIds) ? params.involvedEmpIds.filter(Boolean) : [];
    if (involvedEmpIds.length === 0 && params.empId) {
      involvedEmpIds = [String(params.empId).trim()];
    }
    if (involvedEmpIds.length === 0) {
      return { success: false, message: 'กรุณาเลือกพนักงานผู้รับผิดชอบอย่างน้อย 1 ท่าน' };
    }
    if (totalAmount <= 0) {
      return { success: false, message: 'กรุณาระบุจำนวนเงินความเสียหาย' };
    }
    if (!title) {
      return { success: false, message: 'กรุณาระบุหัวข้อหรือสาเหตุของเหตุการณ์' };
    }

    const splitCount = involvedEmpIds.length;
    const splitAmount = Math.round((totalAmount / splitCount) * 100) / 100;

    // Generate incident_code (e.g. INC-202611-001)
    const ym = incidentDate.replace(/-/g, '').substring(0, 6);
    const countRow = await db.prepare('SELECT COUNT(*) as c FROM incident_deductions WHERE incident_date LIKE ?').bind(incidentDate.substring(0, 7) + '%').first().catch(() => ({ c: 0 }));
    const nextNum = (countRow?.c || 0) + 1;
    const code = `INC-${ym}-${String(nextNum).padStart(3, '0')}`;

    const insertRes = await db.prepare(`
      INSERT INTO incident_deductions
      (incident_code, incident_date, branch_id, category, title, description, evidence_photo_url, total_incident_amount, company_absorbed_amount, net_employee_amount, split_count, status, reporter_username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'PENDING', ?)
    `).bind(
      code, incidentDate, branchId, category, title, description, evidencePhotoUrl || '',
      totalAmount, totalAmount, splitCount, callerUser
    ).run();
    const savedIncidentId = insertRes.meta?.last_row_id || insertRes.lastRowId;

    // Create tentative pending schedule for current active month
    const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const d = new Date(bangkokTime);
    const defaultPeriod = months[d.getMonth()] + ' ' + (d.getFullYear() + 543);

    for (const empId of involvedEmpIds) {
      await db.prepare(`
        INSERT INTO incident_deduction_schedules
        (incident_id, emp_id, target_period, installment_no, total_installments, amount, status)
        VALUES (?, ?, ?, 1, 1, ?, 'PENDING')
      `).bind(savedIncidentId, empId, defaultPeriod, splitAmount).run();
    }

    return {
      success: true,
      incidentCode: code,
      incidentId: savedIncidentId,
      message: `บันทึกรายงานความเสียหาย [${code}] เรียบร้อยแล้ว (ส่งเรื่องไปยัง HR เพื่อตรวจสอบและอนุมัติ)`
    };
  },

  getBranchIncidents: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
    const branchId = params.branchId || params.branch_id || 'B01';

    let sql = `
      SELECT i.*, b.branch_name
      FROM incident_deductions i
      LEFT JOIN branches b ON i.branch_id = b.branch_id
      WHERE 1=1
    `;
    const binds = [];
    if (branchId && branchId !== 'ALL') {
      sql += ' AND i.branch_id = ?';
      binds.push(branchId);
    }
    sql += ' ORDER BY i.id DESC LIMIT 50';

    const incidentsRes = await db.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
    const incidents = incidentsRes.results || [];

    const schedulesRes = await db.prepare(`
      SELECT s.*, e.full_name, e.nickname
      FROM incident_deduction_schedules s
      LEFT JOIN employees e ON s.emp_id = e.emp_id
      ORDER BY s.incident_id DESC
    `).all().catch(() => ({ results: [] }));

    const schedMap = {};
    for (const s of (schedulesRes.results || [])) {
      if (!schedMap[s.incident_id]) schedMap[s.incident_id] = [];
      schedMap[s.incident_id].push(s);
    }

    const items = incidents.map(inc => {
      const incScheds = schedMap[inc.id] || [];
      const empSet = new Set(incScheds.map(s => s.emp_id));
      const empNames = Array.from(empSet).map(empId => {
        const item = incScheds.find(s => s.emp_id === empId);
        return item ? `[${empId}] ${item.full_name}${item.nickname ? ' (' + item.nickname + ')' : ''}` : empId;
      });

      return {
        ...inc,
        schedules: incScheds,
        involvedEmpCount: empSet.size || inc.split_count || 1,
        involvedEmployeesList: empNames,
        involvedEmployeesText: empNames.join(', ')
      };
    });

    return {
      success: true,
      incidents: items
    };
  },

  getEmployeeIncidentBreakdown: async (db, params, context) => {
    const empId = params.empId ? String(params.empId).trim() : '';
    const period = params.period ? String(params.period).trim() : '';
    if (!empId) return { success: false, message: 'ระบุ empId' };

    let sql = `
      SELECT s.*, i.incident_code, i.incident_date, i.branch_id, i.category, i.title, i.description, i.evidence_photo_url, b.branch_name
      FROM incident_deduction_schedules s
      JOIN incident_deductions i ON s.incident_id = i.id
      LEFT JOIN branches b ON i.branch_id = b.branch_id
      WHERE s.emp_id = ? AND s.status = 'SCHEDULED'
    `;
    const binds = [empId];
    if (period) {
      sql += ' AND s.target_period = ?';
      binds.push(period);
    }
    sql += ' ORDER BY i.incident_date ASC';

    const rows = await db.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
    const items = rows.results || [];
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    return {
      success: true,
      empId,
      period,
      totalAmount,
      items
    };
  }
};
