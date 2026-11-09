/**
 * ==============================================================================
 * PTN Time Attendant - Cloudflare Pages Function Backend (Modular Router)
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

import { ensureTables, getSettings, getBangkokTimeContext } from './_modules/db.js';
import { kioskHandlers } from './_modules/kiosk.js';
import { attendanceHandlers } from './_modules/attendance.js';
import { requestHandlers } from './_modules/requests.js';
import { settingsBranchesHandlers } from './_modules/settings-branches.js';
import { payrollSyncHandlers } from './_modules/payroll-sync.js';
import { notificationHandlers } from './_modules/notifications.js';

const actionHandlers = {
  ...kioskHandlers,
  ...attendanceHandlers,
  ...requestHandlers,
  ...settingsBranchesHandlers,
  ...payrollSyncHandlers,
  ...notificationHandlers,
};

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

    const settings = await getSettings(db);

    // Maintenance Mode Check
    if (settings.system_maintenance_mode === 'true') {
      const supervisorActions = [
        'getInitialData',
        'supervisorLogin',
        'getSupervisorDashboard',
        'handleApproval',
        'saveSettings',
        'resetDeviceLock',
        'getMasterUnlockToken',
        'getBranches',
        'toggleBranchEarlyDismissal'
      ];
      if (!supervisorActions.includes(action)) {
        return new Response(JSON.stringify({
          success: false,
          maintenance: true,
          message: settings.system_maintenance_message || 'ระบบลงเวลา PTN Time อยู่ระหว่างปิดปรับปรุงชั่วคราว เพื่อเพิ่มประสิทธิภาพการทำงาน ขออภัยในความไม่สะดวก'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    const timeContext = getBangkokTimeContext();
    const handlerContext = {
      settings,
      ...timeContext
    };

    const handler = actionHandlers[action];
    if (!handler) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Unknown action: ' + action
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const result = await handler(db, params, handlerContext);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    const isBusy = /busy|locked|timeout|storage error|resource limit|abort/i.test(err.message || '');
    return new Response(JSON.stringify({
      success: false,
      retryable: isBusy,
      message: isBusy 
        ? 'ระบบฐานข้อมูลกำลังประมวลผลพร้อมกัน กรุณารอสักครู่ (ระบบกำลังลองบันทึกใหม่อัตโนมัติ)' 
        : ('Server Error: ' + err.message)
    }), {
      status: isBusy ? 503 : 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
