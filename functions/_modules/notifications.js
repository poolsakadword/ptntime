/**
 * Push Notifications Engine & Broadcast Handlers Module
 */
import { timeToMinutes } from './db.js';
export const VAPID_PUBLIC_KEY = 'BFIl918yWYb9YE1JrQvdjqVIDumstq7AoG68thcEd-eeVbOIMA5uhUO6SAlBaO7Ulj2CR3mcJQNHUrx1Crg4g7A';
export const VAPID_PRIVATE_KEY = 'LlUhEMxj03FGhpNmJ854Ht5XjxT7aOAFTEDWDs_SxIw';
export const VAPID_SUBJECT = 'mailto:admin@ptn-pharma.com';

export function base64UrlToBytes(b64url) {
  const b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createVapidJwt(audience) {
  const pubBytes = base64UrlToBytes(VAPID_PUBLIC_KEY);
  const x = bytesToBase64Url(pubBytes.slice(1, 33));
  const y = bytesToBase64Url(pubBytes.slice(33, 65));

  const privKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d: VAPID_PRIVATE_KEY },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToBase64Url(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT
  })));

  const data = encoder.encode(header + '.' + claims);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, data);
  return header + '.' + claims + '.' + bytesToBase64Url(new Uint8Array(sig));
}

export async function encryptWebPushPayload(clientP256dhB64, clientAuthB64, payloadString) {
  const clientPublicKeyBytes = base64UrlToBytes(clientP256dhB64);
  const clientAuthBytes = base64UrlToBytes(clientAuthB64);

  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const clientKeyJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(clientPublicKeyBytes.slice(1, 33)),
    y: bytesToBase64Url(clientPublicKeyBytes.slice(33, 65))
  };
  const clientPublicKey = await crypto.subtle.importKey(
    'jwk',
    clientKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    localKeyPair.privateKey,
    256
  );

  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  const encoder = new TextEncoder();
  const authInfoPrefix = encoder.encode('WebPush: info\0');
  const authInfo = new Uint8Array(authInfoPrefix.length + clientPublicKeyBytes.length + localPublicKeyRaw.length);
  authInfo.set(authInfoPrefix, 0);
  authInfo.set(clientPublicKeyBytes, authInfoPrefix.length);
  authInfo.set(localPublicKeyRaw, authInfoPrefix.length + clientPublicKeyBytes.length);

  const ikmKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const prkBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: clientAuthBytes, info: authInfo },
    ikmKey,
    256
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const prkKey = await crypto.subtle.importKey('raw', prkBits, 'HKDF', false, ['deriveBits']);
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: encoder.encode('Content-Encoding: aes128gcm\0') },
    prkKey,
    128
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: encoder.encode('Content-Encoding: nonce\0') },
    prkKey,
    96
  );

  const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt']);
  const payloadBytes = encoder.encode(payloadString);
  const record = new Uint8Array(payloadBytes.length + 1);
  record.set(payloadBytes, 0);
  record[payloadBytes.length] = 2;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits, tagLength: 128 },
    cek,
    record
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(localPublicKeyRaw, 21);

  const finalBody = new Uint8Array(header.length + ciphertext.byteLength);
  finalBody.set(header, 0);
  finalBody.set(new Uint8Array(ciphertext), header.length);

  return finalBody;
}

export async function sendWebPush(subscription, payload) {
  try {
    const endpoint = subscription.endpoint;
    const url = new URL(endpoint);
    const audience = url.protocol + '//' + url.host;

    const jwt = await createVapidJwt(audience);
    const bodyBytes = await encryptWebPushPayload(subscription.p256dh, subscription.auth, typeof payload === 'string' ? payload : JSON.stringify(payload));

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Urgency': 'high',
        'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`
      },
      body: bodyBytes
    });

    if (res.status === 404 || res.status === 410) {
      return { success: false, expired: true, status: res.status };
    }
    return { success: res.ok, status: res.status };
  } catch(e) {
    console.error('sendWebPush error:', e);
    return { success: false, error: e.message };
  }
}

export async function sendPushToEmployee(db, empId, payload) {
  if (!empId) return 0;
  try {
    const subs = (await db.prepare('SELECT * FROM push_subscriptions WHERE emp_id = ?').bind(empId).all().catch(() => ({ results: [] }))).results || [];
    let count = 0;
    for (const sub of subs) {
      const res = await sendWebPush(sub, payload);
      if (res.success) count++;
      else if (res.expired) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
      }
    }
    return count;
  } catch(e) {
    console.error('sendPushToEmployee error:', e);
    return 0;
  }
}

export async function sendPushToAdmins(db, payload) {
  try {
    const subs = (await db.prepare("SELECT * FROM push_subscriptions WHERE app_type = 'PAYROLL' OR emp_id = 'ADMIN' OR emp_id LIKE 'ADMIN%'").all().catch(() => ({ results: [] }))).results || [];
    let count = 0;
    for (const sub of subs) {
      const res = await sendWebPush(sub, payload);
      if (res.success) count++;
      else if (res.expired) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
      }
    }
    return count;
  } catch(e) {
    console.error('sendPushToAdmins error:', e);
    return 0;
  }
}

export async function broadcastPushNotification(db, payload, appTypeFilter = null) {
  try {
    let sql = 'SELECT * FROM push_subscriptions';
    let binds = [];
    if (appTypeFilter) {
      sql += ' WHERE app_type = ? OR app_type = "ALL"';
      binds.push(appTypeFilter);
    }
    const subs = (await db.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }))).results || [];
    let count = 0;
    for (const sub of subs) {
      const res = await sendWebPush(sub, payload);
      if (res.success) count++;
      else if (res.expired) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
      }
    }
    return count;
  } catch(e) {
    console.error('broadcastPushNotification error:', e);
    return 0;
  }
}

export const notificationHandlers = {
  broadcastPayslipNotification: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const caller = params.username || 'Admin';
      const period = params.period ? String(params.period).trim() : 'ล่าสุด';
      const title = params.title || `💰 สลิปเงินเดือนงวด ${period} ออกแล้ว!`;
      const body = params.body || `พนักงานสามารถตรวจสอบยอดเงินเดือนสุทธิและรายการหักได้แล้วในแท็บ สลิปเงินเดือน`;

      await db.prepare(`
        CREATE TABLE IF NOT EXISTS broadcast_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          tag TEXT DEFAULT 'payslip',
          target_emp_id TEXT DEFAULT 'ALL',
          period TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run().catch(() => {});

      await db.prepare(`
        INSERT INTO broadcast_notifications (title, body, tag, target_emp_id, period)
        VALUES (?, ?, 'payslip', 'ALL', ?)
      `).bind(title, body, period).run();

      // Dispatch Web Push notification to all employees
      broadcastPushNotification(db, {
        title,
        body,
        url: '/?tab=payslip',
        tag: 'payslip-' + period
      }).catch(err => console.error('broadcastPushNotification error:', err));

      return {
        success: true,
        period,
        title,
        body,
        message: `ส่งแจ้งเตือนสลิปเงินเดือนงวด ${period} ไปยังพนักงานทุกคนเรียบร้อยแล้ว`
      };
  },

  getBroadcastNotifications: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS broadcast_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          tag TEXT DEFAULT 'general',
          target_emp_id TEXT DEFAULT 'ALL',
          period TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run().catch(() => {});

      const rows = await db.prepare(`
        SELECT * FROM broadcast_notifications
        ORDER BY id DESC
        LIMIT 20
      `).all().catch(() => ({ results: [] }));

      return {
        success: true,
        notifications: rows.results || []
      };
  },

  getAppAnnouncement: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      let announcement = null;
      try {
        const annRow = await db.prepare("SELECT value FROM settings WHERE key = 'app_announcement'").first();
        if (annRow && annRow.value) {
          announcement = JSON.parse(annRow.value);
        }
      } catch (e) {}
      return { success: true, announcement };
  },

  saveAppAnnouncement: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const ann = params.announcement || {};
      const val = typeof ann === 'string' ? ann : JSON.stringify(ann);
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES ("app_announcement", ?)').bind(val).run();
      return { success: true, message: 'บันทึกประกาศเรียบร้อยแล้ว' };
  },

  getVapidPublicKey: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      return {
        success: true,
        publicKey: VAPID_PUBLIC_KEY
      };
  },

  savePushSubscription: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const { empId, endpoint, p256dh, auth, userAgent, appType } = params;
      if (!endpoint || !p256dh || !auth) {
        return { success: false, message: 'ข้อมูล Subscription ไม่ครบถ้วน' };
      }

      const finalAppType = appType || 'PTNTIME';
      await db.prepare(`
        INSERT INTO push_subscriptions (emp_id, endpoint, p256dh, auth, user_agent, app_type, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(endpoint) DO UPDATE SET
          emp_id = COALESCE(excluded.emp_id, push_subscriptions.emp_id),
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          app_type = excluded.app_type,
          updated_at = datetime('now')
      `).bind(empId || null, endpoint, p256dh, auth, userAgent || '', finalAppType).run();

      return { success: true, message: 'บันทึกอุปกรณ์เพื่อรับการแจ้งเตือน Real Web Push สำเร็จ' };
  },

  removePushSubscription: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const endpoint = params.endpoint;
      if (endpoint) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
      }
      return { success: true, message: 'ยกเลิกการรับแจ้งเตือนบนอุปกรณ์นี้เรียบร้อยแล้ว' };
  },

  getPushSubscriptionStatus: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const empId = params.empId;
      const countRow = await db.prepare('SELECT COUNT(*) as count FROM push_subscriptions').first().catch(() => ({ count: 0 }));
      let isEmpSubscribed = false;
      if (empId) {
        const empSub = await db.prepare('SELECT id FROM push_subscriptions WHERE emp_id = ?').bind(empId).first().catch(() => null);
        if (empSub) isEmpSubscribed = true;
      }
      return {
        success: true,
        totalSubscribers: countRow ? Number(countRow.count) : 0,
        isEmpSubscribed
      };
  },

  sendTestPushNotification: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const endpoint = params.endpoint;
      const empId = params.empId;
      let subs = [];

      if (endpoint) {
        const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first();
        if (row) subs.push(row);
      } else if (empId) {
        const rows = await db.prepare('SELECT * FROM push_subscriptions WHERE emp_id = ?').bind(empId).all().catch(() => ({ results: [] }));
        subs = rows.results || [];
      }

      if (subs.length === 0) {
        subs = (await db.prepare('SELECT * FROM push_subscriptions').all().catch(() => ({ results: [] }))).results || [];
      }

      if (subs.length === 0) {
        return {
          success: false,
          message: 'ยังไม่มีอุปกรณ์ที่ลงทะเบียนรับแจ้งเตือน กรุณากดปุ่มเปิดรับการแจ้งเตือนบนอุปกรณ์นี้ก่อน'
        };
      }

      const testPayload = {
        title: '🔔 ทดสอบแจ้งเตือน PTN Time',
        body: 'ระบบ Real Web Push เชื่อมต่อสำเร็จ! เด้งเตือนทันทีแม้ปิดหน้าจอหรือล็อคเครื่อง',
        url: '/',
        tag: 'ptntime-test-' + Date.now()
      };

      let successCount = 0;
      for (const s of subs) {
        const res = await sendWebPush(s, testPayload);
        if (res.success) {
          successCount++;
        } else if (res.expired) {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run().catch(() => {});
        }
      }

      return {
        success: true,
        sentCount: successCount,
        message: `ส่งการแจ้งเตือนทดสอบสำเร็จไปยัง ${successCount} อุปกรณ์ (เด้งเตือนทันทีภายใน 1-3 วินาที)`
      };
  },

  checkAndSendMissingClockOutAlerts: async (db, params, context) => {
    const { settings, today, curTimeStr, dayOfWeekNumber, bangkokTime, nowUtc } = context;
      const curMins = timeToMinutes(curTimeStr);
      // Only alert within post-work evening window (19:00 - 21:30)
      // Do NOT alert during daytime or late night past cutoff
      if (curMins < timeToMinutes('19:00') || curMins > timeToMinutes('21:30')) {
        return { success: true, message: 'ไม่อยู่ในช่วงเวลาเตือนออกงาน (เตือนเฉพาะช่วง 19:00 - 21:30 น.)', sentCount: 0 };
      }

      const logs = await db.prepare(`
        SELECT l.emp_id, l.clock_in, l.clock_out, l.status, e.full_name, e.nickname
        FROM time_logs l
        LEFT JOIN employees e ON l.emp_id = e.emp_id
        WHERE l.date = ? 
          AND l.clock_in IS NOT NULL 
          AND (l.clock_out IS NULL OR l.clock_out = '')
          AND (l.status IS NULL OR l.status NOT IN ('ABSENT', 'INCOMPLETE'))
      `).bind(today).all().catch(() => ({ results: [] }));

      let sentCount = 0;
      for (const log of (logs.results || [])) {
        const empName = log.nickname || log.full_name || log.emp_id;
        const res = await sendPushToEmployee(db, log.emp_id, {
          title: '🔔 แจ้งเตือน: ยังไม่ได้สแกนออกงาน',
          body: `สวัสดีครับคุณ ${empName} ขณะนี้เลยเวลาเลิกงานแล้ว ระบบตรวจพบว่าคุณยังไม่ได้สแกนออกงาน กรุณาสแกนออกหรือแจ้งหัวหน้างาน`,
          url: '/',
          tag: `missing-out-${log.emp_id}-${today}`
        });
        if (res > 0) sentCount += res;
      }

      return {
        success: true,
        missingCount: (logs.results || []).length,
        sentCount,
        message: `ส่งการแจ้งเตือนเตือนสแกนออกงานไปยัง ${sentCount} อุปกรณ์เรียบร้อยแล้ว`
      };
  }
};
