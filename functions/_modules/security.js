/**
 * Security, Passwords & QR Verification Module
 */
import { STATIC_QR_CODE_KEY } from './db.js';

export const DYNAMIC_QR_SALT = 'PTN_DYNAMIC_SALT_KEY_2026';
export const MASTER_UNLOCK_SALT = 'PTN_MASTER_UNLOCK_TOKEN_SALT_2026';

export async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashUserPassword(password) {
  const salt = 'PTN_PAYROLL_SECURE_SALT_2026';
  const hashed = await sha256Hex(password + ':' + salt);
  return 'sha256:' + hashed;
}

export async function verifyUserPassword(inputPassword, storedPassword) {
  if (!storedPassword) return false;
  if (storedPassword.startsWith('sha256:')) {
    const salt = 'PTN_PAYROLL_SECURE_SALT_2026';
    const inputHashed = 'sha256:' + await sha256Hex(inputPassword + ':' + salt);
    return inputHashed === storedPassword;
  }
  return inputPassword === storedPassword;
}

export async function getDynamicQrToken(windowOffset = 0) {
  const windowIndex = Math.floor(Date.now() / 20000) + windowOffset;
  const raw = `${DYNAMIC_QR_SALT}:${windowIndex}`;
  const fullHash = await sha256Hex(raw);
  return 'PTN-' + fullHash.substring(0, 10).toUpperCase();
}

export async function verifyQrToken(qrToken, settings) {
  if (!qrToken) return { valid: false, message: 'กรุณาสแกน QR Code ประจำสาขา' };
  const token = String(qrToken).trim();

  for (const offset of [0, -1, -2, -3, -4, 1]) {
    const dynToken = await getDynamicQrToken(offset);
    if (token === dynToken) return { valid: true, type: 'DYNAMIC' };
  }

  const validStatics = [
    settings.static_qr_key,
    STATIC_QR_CODE_KEY,
    'PTN-OFFICE-STATIC-QR-2026-HQ',
    'PTN-OFFICE-STATIC-QR-2026-B01',
    'PTN-OFFICE-STATIC-QR-2026-B02',
    'PTN-OFFICE-STATIC-QR-2026-B03',
    'PTN-OFFICE-STATIC-QR-2026-B04',
    'PTN-STATIC-QR-2026',
    'PTN-B01',
    'PTN-B02',
    'PTN-B03',
    'PTN-B04',
    'B01',
    'B02',
    'B03',
    'B04'
  ];
  if (validStatics.includes(token)) return { valid: true, type: 'STATIC' };

  if (token.includes('ptntime.pages.dev') || token.includes('ptn-payroll')) {
    return { valid: true, type: 'STATIC' };
  }

  return { 
    valid: false, 
    message: 'QR Code ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาสแกนใหม่อีกครั้ง (หรือขอ QR Code ใหม่จากหน้าจอเคาน์เตอร์)' 
  };
}

export async function getMasterUnlockToken(windowOffset = 0) {
  const windowIndex = Math.floor(Date.now() / 60000) + windowOffset;
  const raw = `${MASTER_UNLOCK_SALT}:${windowIndex}`;
  const fullHash = await sha256Hex(raw);
  return 'PTN-UNLOCK-' + fullHash.substring(0, 12).toUpperCase();
}

export async function isUserSuperAdmin(db, username) {
  if (!username) return false;
  const u = String(username).trim().toLowerCase();
  if (u === 'admin') return true;
  const row = await db.prepare('SELECT role, permissions FROM users WHERE LOWER(username) = ?').bind(u).first();
  if (!row) return false;
  const r = String(row.role || '').toLowerCase();
  if (r.includes('super') || r === 'admin / hr' || r === 'admin') return true;
  try {
    const perms = row.permissions ? JSON.parse(row.permissions) : [];
    if (perms.includes('all') && (r.includes('admin') || u === 'admin')) return true;
  } catch(e) {}
  return false;
}

export async function userHasPermission(db, username, requiredPerm) {
  if (!username) return false;
  const u = String(username).trim().toLowerCase();
  if (u === 'admin') return true;
  const row = await db.prepare('SELECT role, permissions FROM users WHERE LOWER(username) = ?').bind(u).first();
  if (!row) return false;
  const r = String(row.role || '').toLowerCase();
  if (r.includes('super') || r === 'admin / hr' || r === 'admin') return true;
  try {
    const perms = row.permissions ? JSON.parse(row.permissions) : [];
    if (perms.includes('all') || perms.includes(requiredPerm)) return true;
  } catch(e) {}
  return false;
}

export function validateTimeWindow(settings, actionType, curTimeStr, hasApprovedLeave = false) {
  if (String(settings.enable_time_window_restrictions) !== 'true') return null;
  let start = '00:00';
  let end = '23:59';
  let label = '';
  switch (actionType) {
    case 'IN':
      start = settings.window_in_start || '06:00';
      end = hasApprovedLeave ? (settings.work_end_time || '19:00') : (settings.window_in_end || '16:00');
      label = 'เข้างาน (IN)';
      break;
    case 'BREAK_OUT':
      start = settings.window_break_out_start || '11:30';
      end = settings.window_break_out_end || '14:30';
      label = 'เริ่มพัก (Break OUT)';
      break;
    case 'BREAK_IN':
      start = settings.window_break_in_start || '12:00';
      end = settings.window_break_in_end || '15:30';
      label = 'กลับเข้าทำงาน (Break IN)';
      break;
    case 'OUT':
      start = settings.window_out_start || '17:00';
      end = settings.window_out_end || '23:59';
      label = 'เลิกงาน (Clock OUT)';
      break;
  }
  if (curTimeStr < start || curTimeStr > end) {
    return `อยู่นอกช่วงเวลาที่กำหนด: ระบบอนุญาตให้ลงเวลา ${label} เฉพาะช่วง ${start} - ${end} น. เท่านั้น (ขณะนี้เวลา ${curTimeStr} น.)`;
  }
  return null;
}
