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
import { incidentHandlers } from './_modules/incidents.js';

const actionHandlers = {
  ...kioskHandlers,
  ...attendanceHandlers,
  ...requestHandlers,
  ...settingsBranchesHandlers,
  ...payrollSyncHandlers,
  ...notificationHandlers,
  ...incidentHandlers,
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

  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.get('action') === 'getPhoto') {
    const key = url.searchParams.get('key');
    const r2 = env.PHOTOS_BUCKET || env.R2 || env.BUCKET;
    if (key && r2 && typeof r2.get === 'function') {
      try {
        const object = await r2.get(key);
        if (object) {
          const headers = new Headers();
          headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          headers.set('Access-Control-Allow-Origin', '*');
          return new Response(object.body, { headers });
        }
      } catch (e) {
        console.warn('R2 getPhoto error:', e);
      }
    }
    return new Response('Photo not found', { status: 404, headers: corsHeaders });
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
      env,
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
