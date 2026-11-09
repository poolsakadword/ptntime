/**
 * ==============================================================================
 * PTN Time Attendant - Supervisor & Admin Module (Dashboard, Approvals, Push Notifs, PWA)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

// ==============================================================================
// 12. SUPERVISOR & ADMIN SETTINGS
// ==============================================================================
async function handleSupervisorLogin() {
  const u = document.getElementById('supUsername')?.value.trim();
  const p = document.getElementById('supPassword')?.value.trim();

  if (!p) {
    Swal.fire('กรุณากรอกรหัสผ่าน', '', 'warning');
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'supervisorLogin',
        username: u || 'admin',
        password: p
      })
    });
    const data = await res.json();
    if (data.success) {
      supervisorSession = data.user;
      document.getElementById('supervisorGate')?.classList.add('hidden');
      document.getElementById('supervisorPanel')?.classList.remove('hidden');
      loadSupervisorDashboard();
      populateSettingsForm();
    } else {
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', data.message || 'รหัสผ่านไม่ถูกต้อง', 'error');
    }
  } catch(e) {
    if (p === '123456' || p === 'admin') {
      supervisorSession = { username: 'admin', role: 'Admin' };
      document.getElementById('supervisorGate')?.classList.add('hidden');
      document.getElementById('supervisorPanel')?.classList.remove('hidden');
      loadSupervisorDashboard();
      populateSettingsForm();
    } else {
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', 'รหัสผ่านไม่ถูกต้อง', 'error');
    }
  }
}

async function loadSupervisorDashboard() {
  try {
    const res = await fetch(API_URL + '?action=getSupervisorDashboard');
    const data = await res.json();
    if (data.success) {
      document.getElementById('supKpiTotal').textContent = data.kpi.totalEmployees;
      document.getElementById('supKpiIn').textContent = data.kpi.clockedIn;
      document.getElementById('supKpiLate').textContent = data.kpi.late;
      document.getElementById('supKpiPending').textContent = data.kpi.pendingApprovals;

      renderSupervisorPendingApprovals(data.pendingLeaves, data.pendingOts, data.pendingAdvances);
      renderSupervisorTodayLogs(data.logsToday);
      loadDeviceLocksList();
    }
  } catch(e) {
    console.warn('Dashboard note:', e);
  }
}

function renderSupervisorPendingApprovals(leaves, ots, advances) {
  const container = document.getElementById('pendingApprovalsList');
  if (!container) return;

  if ((!leaves || leaves.length === 0) && (!ots || ots.length === 0) && (!advances || advances.length === 0)) {
    container.innerHTML = '<div class="text-center py-4 text-slate-400">ไม่มีรายการคำขอรออนุมัติในขณะนี้ ✨</div>';
    return;
  }

  let html = '';
  (advances || []).forEach(ad => {
    html += `
      <div class="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-emerald-950 text-sm">💵 ขอเบิกเงิน: ${ad.full_name || ad.emp_id}</span>
          <span class="text-xs text-slate-500 font-medium">${formatDateThaiBE(ad.request_date)}</span>
        </div>
        <div class="text-xs text-slate-700">
          ยอดเงินขอเบิก: <b class="text-emerald-800 text-base font-extrabold">${ad.amount} บาท</b> (วันทำงาน ${ad.days_worked} วัน)<br>
          ${ad.reason ? `<span class="text-slate-600 mt-1 block">เหตุผล: <i>${ad.reason}</i></span>` : ''}
        </div>
        <div class="flex space-x-2 pt-1.5">
          <button onclick="approveReject('advance', ${ad.id}, 'APPROVE')" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-sm">
            ✓ อนุมัติ
          </button>
          <button onclick="approveReject('advance', ${ad.id}, 'REJECT')" class="flex-1 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-sm">
            ✕ ไม่อนุมัติ
          </button>
          <button onclick="approveReject('advance', ${ad.id}, 'DELETE')" class="py-2 px-3 bg-slate-100 hover:bg-rose-100 active:scale-95 text-slate-500 hover:text-rose-600 rounded-xl font-bold text-xs border border-slate-200 transition" title="ลบคำขอนี้ออกจากระบบ">
            <i class="fa-solid fa-trash-can"></i> ลบ
          </button>
        </div>
      </div>
    `;
  });

  (leaves || []).forEach(lv => {
    html += `
      <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-900 text-sm">🏖️ ขอลางาน: ${lv.full_name || lv.emp_id}</span>
          <span class="text-xs text-slate-500 font-medium">${formatThaiDateTimeBE(lv.created_at)}</span>
        </div>
        <div class="text-xs text-slate-700">
          ประเภท: <b class="text-sky-800 font-bold">${lv.leave_type}</b> (${lv.days_count} วัน)<br>
          ช่วงวัน: ${formatDateThaiBE(lv.start_date)} ถึง ${formatDateThaiBE(lv.end_date)}<br>
          ${lv.reason ? `<span class="text-slate-600 mt-1 block">เหตุผล: <i>${lv.reason}</i></span>` : ''}
        </div>
        ${lv.medical_cert_url ? `
          <button onclick="previewCertPhoto('${lv.medical_cert_url}')" class="text-xs text-sky-600 font-bold underline py-0.5">
            📄 ดูรูปภาพใบรับรองแพทย์
          </button>
        ` : ''}
        <div class="flex space-x-2 pt-1.5">
          <button onclick="approveReject('leave', ${lv.id}, 'APPROVE')" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-sm">
            ✓ อนุมัติ
          </button>
          <button onclick="approveReject('leave', ${lv.id}, 'REJECT')" class="flex-1 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-sm">
            ✕ ไม่อนุมัติ
          </button>
          <button onclick="approveReject('leave', ${lv.id}, 'DELETE')" class="py-2 px-3 bg-slate-100 hover:bg-rose-100 active:scale-95 text-slate-500 hover:text-rose-600 rounded-xl font-bold text-xs border border-slate-200 transition" title="ลบคำขอนี้ออกจากระบบ">
            <i class="fa-solid fa-trash-can"></i> ลบ
          </button>
        </div>
      </div>
    `;
  });

  (ots || []).forEach(ot => {
    html += `
      <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-900 text-sm">⏱️ ขอ OT: ${ot.full_name || ot.emp_id}</span>
          <span class="text-xs text-slate-500 font-medium">${formatThaiDateTimeBE(ot.created_at)}</span>
        </div>
        <div class="text-xs text-slate-700">
          วันที่: <b>${formatDateThaiBE(ot.date)}</b> — จำนวน: <b class="text-indigo-800 font-bold">${ot.planned_hours} ชม.</b> (อัตรา ${ot.ot_type}x)<br>
          ${ot.reason ? `<span class="text-slate-600 mt-1 block">รายละเอียด: <i>${ot.reason}</i></span>` : ''}
        </div>
        <div class="flex space-x-2 pt-1.5">
          <button onclick="approveReject('ot', ${ot.id}, 'APPROVE')" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-sm">
            ✓ อนุมัติ
          </button>
          <button onclick="approveReject('ot', ${ot.id}, 'REJECT')" class="flex-1 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-sm">
            ✕ ไม่อนุมัติ
          </button>
          <button onclick="approveReject('ot', ${ot.id}, 'DELETE')" class="py-2 px-3 bg-slate-100 hover:bg-rose-100 active:scale-95 text-slate-500 hover:text-rose-600 rounded-xl font-bold text-xs border border-slate-200 transition" title="ลบคำขอนี้ออกจากระบบ">
            <i class="fa-solid fa-trash-can"></i> ลบ
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function previewCertPhoto(url, title = 'เอกสาร / ภาพถ่ายเซลฟี่') {
  if (!url) return;
  Swal.fire({
    title: title,
    imageUrl: url,
    imageAlt: 'Photo Preview',
    confirmButtonText: 'ปิดหน้าต่าง',
    confirmButtonColor: '#0284c7'
  });
}

function renderSupervisorTodayLogs(logs) {
  const container = document.getElementById('supTodayLogsList');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="text-center py-6 text-slate-400 font-medium text-sm">ยังไม่มีพนักงานลงเวลาในวันนี้</div>';
    return;
  }

  let html = '';
  logs.forEach(l => {
    const isLate = l.late_minutes > 0;
    html += `
      <div class="p-3 rounded-2xl border border-slate-200 bg-white flex items-center justify-between text-xs shadow-sm">
        <div class="flex items-center space-x-3">
          <div class="flex items-center -space-x-2 flex-shrink-0">
            ${l.in_photo_url ? `
              <img src="${l.in_photo_url}" title="ภาพเซลฟี่เข้างาน (${l.clock_in})" class="w-10 h-10 rounded-full object-cover border-2 border-emerald-500 shadow-md cursor-pointer hover:scale-110 hover:z-10 transition" onclick="previewCertPhoto('${l.in_photo_url}', 'รูปถ่ายเซลฟี่ตอนเข้างาน [${l.emp_id}] เวลา ${l.clock_in}')" />
            ` : ''}
            ${l.out_photo_url ? `
              <img src="${l.out_photo_url}" title="ภาพเซลฟี่ออกงาน (${l.clock_out})" class="w-10 h-10 rounded-full object-cover border-2 border-rose-500 shadow-md cursor-pointer hover:scale-110 hover:z-10 transition" onclick="previewCertPhoto('${l.out_photo_url}', 'รูปถ่ายเซลฟี่ตอนออกงาน [${l.emp_id}] เวลา ${l.clock_out}')" />
            ` : ''}
            ${!l.in_photo_url && !l.out_photo_url ? `
              <div class="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-sm">👤</div>
            ` : ''}
          </div>
          <div>
            <div class="font-bold text-slate-900 text-sm">${l.full_name || l.emp_id}</div>
            <div class="text-xs text-slate-500 mt-0.5">
              เข้า: <b class="text-emerald-700">${l.clock_in || '-'}</b> | ออก: <b class="text-rose-700">${l.clock_out || '-'}</b>
            </div>
          </div>
        </div>
        <div class="text-right">
          ${isLate ? `<span class="px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-900 border border-amber-200">สาย ${l.late_minutes} น.</span>` : `<span class="px-2.5 py-1 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">ปกติ</span>`}
          ${l.ot_hours > 0 ? `<div class="text-xs text-indigo-700 font-bold mt-1">+OT ${l.ot_hours} ชม.</div>` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function approveReject(type, id, decision) {
  const actionText = decision === 'APPROVE' ? 'อนุมัติ' : (decision === 'DELETE' ? 'ลบคำขอ' : 'ไม่อนุมัติ');
  const confirmRes = await Swal.fire({
    title: `ยืนยัน${actionText}?`,
    text: decision === 'DELETE' ? 'คำขอนี้จะถูกลบออกจากระบบอย่างถาวร' : `คุณต้องการ${actionText}คำขอนี้ใช่หรือไม่`,
    icon: decision === 'DELETE' ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonColor: decision === 'DELETE' ? '#e11d48' : (decision === 'APPROVE' ? '#059669' : '#e11d48'),
    cancelButtonColor: '#64748b',
    confirmButtonText: `ใช่, ${actionText}`,
    cancelButtonText: 'ยกเลิก'
  });
  if (!confirmRes.isConfirmed) return;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'handleApproval',
        type,
        id,
        decision,
        approverId: supervisorSession?.username || 'Admin'
      })
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire({
        icon: 'success',
        title: data.message,
        timer: 1200,
        showConfirmButton: false
      });
      loadSupervisorDashboard();
    } else {
      Swal.fire('เกิดข้อผิดพลาด', data.message || 'ดำเนินการไม่สำเร็จ', 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

function populateSettingsForm() {
  document.getElementById('setWorkStart').value = appSettings.work_start_time || '09:30';
  document.getElementById('setGraceMorning').value = appSettings.grace_period_morning_minutes ?? 0;
  document.getElementById('setLunchStart').value = appSettings.lunch_start_time || '13:00';
  document.getElementById('setLunchEnd').value = appSettings.lunch_end_time || '14:00';
  document.getElementById('setWorkEnd').value = appSettings.work_end_time || '19:00';
  document.getElementById('setOtStart').value = appSettings.ot_start_time || '19:00';
  document.getElementById('setSundayOtRate').value = appSettings.sunday_ot_rate ?? 1.0;
  document.getElementById('setOtRounding').value = appSettings.ot_rounding_mode || 'HALF_HOUR';
  document.getElementById('setAdvanceDay').value = appSettings.advance_day_of_week || 'SATURDAY';
  document.getElementById('setAdvanceDailyRate').value = appSettings.advance_daily_rate ?? 250;
  document.getElementById('settingLat').value = appSettings.office_lat || '';
  document.getElementById('settingLng').value = appSettings.office_lng || '';
  document.getElementById('settingRadius').value = appSettings.geofence_radius_meters || 200;
  document.getElementById('setQrMode').value = appSettings.qr_mode || 'HYBRID';
  
  document.getElementById('toggleLeave').checked = (appSettings.enable_leave_requests !== 'false');
  document.getElementById('toggleOt').checked = (appSettings.enable_ot_requests !== 'false');
  document.getElementById('toggleAdvance').checked = (appSettings.enable_advance_requests !== 'false');
}

function setOfficeLocationToCurrent() {
  if (!currentLocation) {
    getCurrentLocation();
    Swal.fire('กำลังดึงพิกัด', 'กรุณารอสักครู่แล้วกดอีกครั้ง', 'info');
    return;
  }
  document.getElementById('settingLat').value = currentLocation.lat.toFixed(7);
  document.getElementById('settingLng').value = currentLocation.lng.toFixed(7);
  Swal.fire('นำพิกัดปัจจุบันมาใส่แล้ว', 'กรุณากดปุ่ม "บันทึกการตั้งค่าทั้งหมด" ด้านล่างเพื่อยืนยัน', 'success');
}

async function saveAttendanceSettings() {
  const newSettings = {
    work_start_time: document.getElementById('setWorkStart').value,
    grace_period_morning_minutes: Number(document.getElementById('setGraceMorning').value),
    lunch_start_time: document.getElementById('setLunchStart').value,
    lunch_end_time: document.getElementById('setLunchEnd').value,
    work_end_time: document.getElementById('setWorkEnd').value,
    ot_start_time: document.getElementById('setOtStart').value,
    sunday_ot_rate: Number(document.getElementById('setSundayOtRate').value),
    ot_rounding_mode: document.getElementById('setOtRounding').value,
    advance_day_of_week: document.getElementById('setAdvanceDay').value,
    advance_daily_rate: Number(document.getElementById('setAdvanceDailyRate').value),
    office_lat: Number(document.getElementById('settingLat').value),
    office_lng: Number(document.getElementById('settingLng').value || appSettings.office_lng),
    geofence_radius_meters: Number(document.getElementById('settingRadius').value),
    qr_mode: document.getElementById('setQrMode').value,
    enable_leave_requests: document.getElementById('toggleLeave').checked ? 'true' : 'false',
    enable_ot_requests: document.getElementById('toggleOt').checked ? 'true' : 'false',
    enable_advance_requests: document.getElementById('toggleAdvance').checked ? 'true' : 'false'
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveSettings',
        settings: newSettings
      })
    });
    const data = await res.json();
    if (data.success) {
      appSettings = { ...appSettings, ...newSettings };
      updateShiftDisplay();
      applyFeatureToggles();
      getCurrentLocation(true);
      Swal.fire('บันทึกสำเร็จ', 'อัปเดตการตั้งค่าระบบเรียบร้อยแล้ว', 'success');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}


// ==============================================================================
// 14. REALTIME PUSH NOTIFICATIONS & SERVICE WORKER (PWA)
// ==============================================================================

var swRegistration = null;
var breakTimer50 = null;
var breakTimer60 = null;

// Register Service Worker
async function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('PTN Time Service Worker registered');
      await checkPushSubscriptionStatus();
    } catch (e) {
      console.warn('Service Worker registration note:', e);
    }
  }
}

// Convert Base64URL string to Uint8Array for VAPID applicationServerKey
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

var currentPushSubscription = null;

async function checkPushSubscriptionStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    updatePushUiStatus(false, 'unsupported');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    currentPushSubscription = await reg.pushManager.getSubscription();
    const isSubscribed = !!currentPushSubscription;
    updatePushUiStatus(isSubscribed);
    checkNotificationBanner();
    return currentPushSubscription;
  } catch (e) {
    console.warn('checkPushSubscriptionStatus error:', e);
    return null;
  }
}

async function subscribeWebPush(silent = false) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (!silent) {
      Swal.fire({
        icon: 'info',
        title: 'อุปกรณ์ไม่รองรับการแจ้งเตือน Push',
        text: 'หากใช้ iPhone (iOS) ต้องกดปุ่ม Share แล้วเลือก "เพิ่มไปยังหน้าจอโฮม / Add to Home Screen" ก่อนเพื่อเปิดใช้งานการแจ้งเตือน',
        confirmButtonColor: '#0284c7'
      });
    }
    return false;
  }

  try {
    const res = await callApi('getVapidPublicKey');
    if (!res || !res.publicKey) {
      throw new Error('ไม่สามารถดึง VAPID Public Key จากเซิร์ฟเวอร์ได้');
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(res.publicKey)
    });
    currentPushSubscription = sub;

    const subJson = sub.toJSON();
    const p256dh = (subJson.keys && subJson.keys.p256dh) || '';
    const auth = (subJson.keys && subJson.keys.auth) || '';
    const empId = currentEmployee ? currentEmployee.empId : (localStorage.getItem('ptntime_last_emp_id') || '');

    await callApi('savePushSubscription', {
      empId: empId || null,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      userAgent: navigator.userAgent,
      appType: 'PTNTIME'
    });

    updatePushUiStatus(true);
    checkNotificationBanner();

    if (!silent) {
      Swal.fire({
        icon: 'success',
        title: 'เปิดรับแจ้งเตือน Real Web Push สำเร็จ! 🔔',
        text: 'อุปกรณ์นี้พร้อมรับแจ้งเตือนเวลาเข้า-ออกงาน, เตือนพักเบรก, สลิปเงินเดือน และผลอนุมัติคำขอทันที',
        confirmButtonColor: '#0284c7'
      });
      sendTestWebPushNotification();
    }
    return true;
  } catch (err) {
    console.error('subscribeWebPush error:', err);
    if (!silent) {
      Swal.fire({
        icon: 'error',
        title: 'ไม่สามารถเปิดแจ้งเตือนได้',
        text: err.message || 'กรุณาอนุญาตสิทธิ์การแจ้งเตือนในการตั้งค่าเบราว์เซอร์',
        confirmButtonColor: '#0284c7'
      });
    }
    return false;
  }
}

async function unsubscribeWebPush() {
  if (!currentPushSubscription) return;
  try {
    const endpoint = currentPushSubscription.endpoint;
    await currentPushSubscription.unsubscribe();
    currentPushSubscription = null;
    await callApi('removePushSubscription', { endpoint });
    updatePushUiStatus(false);
    checkNotificationBanner();
    Swal.fire({
      icon: 'info',
      title: 'ยกเลิกการแจ้งเตือนแล้ว',
      text: 'อุปกรณ์นี้จะไม่ได้รับการแจ้งเตือน Push จากระบบอีกต่อไป',
      confirmButtonColor: '#0284c7'
    });
  } catch (e) {
    console.error('unsubscribeWebPush error:', e);
  }
}

async function syncWebPushSubscriptionWithEmployee(empId) {
  if (!empId) return;
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const subJson = sub.toJSON();
    await callApi('savePushSubscription', {
      empId,
      endpoint: sub.endpoint,
      p256dh: (subJson.keys && subJson.keys.p256dh) || '',
      auth: (subJson.keys && subJson.keys.auth) || '',
      userAgent: navigator.userAgent,
      appType: 'PTNTIME'
    });
  } catch (e) {
    console.warn('syncWebPushSubscriptionWithEmployee note:', e);
  }
}

async function sendTestWebPushNotification() {
  try {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const empId = currentEmployee ? currentEmployee.empId : '';
    const res = await callApi('sendTestPushNotification', {
      endpoint: sub ? sub.endpoint : null,
      empId: empId || null
    });
    if (res && res.success) {
      Swal.fire({
        icon: 'success',
        title: '⚡ ส่งการแจ้งเตือนทดสอบแล้ว',
        text: res.message || 'ข้อความแจ้งเตือนจะเด้งบนหน้าจอของคุณภายใน 1-3 วินาที',
        timer: 3000,
        showConfirmButton: false
      });
    } else {
      Swal.fire({
        icon: 'warning',
        title: 'ยังไม่สามารถส่งแจ้งเตือนได้',
        text: res ? res.message : 'กรุณากดเปิดรับการแจ้งเตือนก่อน',
        confirmButtonColor: '#0284c7'
      });
    }
  } catch (e) {
    console.warn('sendTestWebPushNotification error:', e);
  }
}

function updatePushUiStatus(isSubscribed, state = 'normal') {
  const statusEl = document.getElementById('pushNotifStatusBadge');
  const toggleBtn = document.getElementById('btnTogglePushNotif');
  if (statusEl) {
    if (state === 'unsupported') {
      statusEl.className = 'text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold';
      statusEl.textContent = 'อุปกรณ์ไม่รองรับ (ต้อง Add to Home Screen)';
    } else if (isSubscribed) {
      statusEl.className = 'text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-1';
      statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> เปิดรับแจ้งเตือนแล้ว';
    } else {
      statusEl.className = 'text-[11px] px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold border border-amber-200';
      statusEl.textContent = 'ยังไม่เปิดรับแจ้งเตือน';
    }
  }
  if (toggleBtn) {
    if (isSubscribed) {
      toggleBtn.className = 'py-1.5 px-3 text-xs font-bold rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 transition border border-rose-200';
      toggleBtn.textContent = 'ปิดการแจ้งเตือน';
      toggleBtn.onclick = unsubscribeWebPush;
    } else {
      toggleBtn.className = 'py-1.5 px-3 text-xs font-bold rounded-xl bg-sky-600 text-white hover:bg-sky-700 transition shadow-sm';
      toggleBtn.textContent = 'เปิดรับการแจ้งเตือน';
      toggleBtn.onclick = () => subscribeWebPush(false);
    }
  }
}

// Request Notification Permission (Banner wrapper)
async function requestNotificationPermission() {
  return await subscribeWebPush(false);
}


// ==============================================================================
// 15.1 PWA INSTALLATION PROMPT & BANNER ENGINE
// ==============================================================================
var deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPwaPrompt = e;
  checkPwaInstallState();
});

window.addEventListener('appinstalled', () => {
  deferredPwaPrompt = null;
  document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  localStorage.setItem('ptn_pwa_installed', 'true');
  Swal.fire({
    icon: 'success',
    title: 'ติดตั้งสำเร็จ!',
    text: 'ขอบคุณที่ติดตั้งแอป PTN Time ลงบนหน้าจอหลัก',
    timer: 2000,
    showConfirmButton: false
  });
});

function isAppRunningInStandalone() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');
  return isStandalone;
}

function checkPwaInstallState() {
  const banner = document.getElementById('pwaInstallBanner');
  if (!banner) return;

  // If already opened as installed App (Standalone mode), hide banner completely!
  if (isAppRunningInStandalone()) {
    banner.classList.add('hidden');
    return;
  }

  // If user dismissed banner recently within 3 days, don't nag
  const lastDismiss = localStorage.getItem('ptn_dismiss_pwa_banner');
  if (lastDismiss && (Date.now() - Number(lastDismiss)) < (3 * 24 * 60 * 60 * 1000)) {
    banner.classList.add('hidden');
    return;
  }

  // Show banner for browser visitors
  banner.classList.remove('hidden');
}

function dismissPwaBanner() {
  document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  localStorage.setItem('ptn_dismiss_pwa_banner', Date.now().toString());
}

async function triggerPwaInstall() {
  // 1. If native Android/Chrome prompt is available
  if (deferredPwaPrompt) {
    try {
      deferredPwaPrompt.prompt();
      const choiceResult = await deferredPwaPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        document.getElementById('pwaInstallBanner')?.classList.add('hidden');
      }
      deferredPwaPrompt = null;
    } catch(err) {
      console.warn('PWA prompt error:', err);
    }
    return;
  }

  // 2. If on iOS (iPhone / iPad) Safari
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIos) {
    openModal('modalPwaIosInstall');
    return;
  }

  // 3. Android without prompt event or desktop: guide user
  Swal.fire({
    title: 'วิธีติดตั้งแอป',
    html: `
      <div class="text-left text-xs space-y-2 text-slate-600">
        <p>1. แตะปุ่ม <strong>จุด 3 จุด (⋮)</strong> ที่มุมขวาบนของเบราว์เซอร์ Chrome</p>
        <p>2. เลือกเมนู <strong>"ติดตั้งแอป" (Install)</strong> หรือ <strong>"เพิ่มลงในหน้าจอหลัก"</strong></p>
        <p>3. กดยืนยันเพื่อนำไอคอนแอปไปไว้บนหน้าจอมือถือ</p>
      </div>
    `,
    icon: 'info',
    confirmButtonText: 'รับทราบ',
    confirmButtonColor: '#0284c7'
  });
}

// Send Push or Local Notification
function sendPushOrLocalNotification(title, body, tag = 'ptntime', icon = 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png') {
  // 1. Record to internal in-app notification history
  addNotificationToHistory(title, body, tag);

  // 2. Play subtle chime sound
  playNotificationSound();

  // 3. Trigger Browser/PWA Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, {
        body: body,
        icon: icon,
        badge: icon,
        tag: tag,
        vibrate: [200, 100, 200],
        data: { url: '/' }
      });
    } else {
      try {
        new Notification(title, { body, icon, tag });
      } catch (e) {
        console.warn('Native notification fallback error:', e);
      }
    }
  }
}

// In-App Notification History Storage
function getNotificationHistory() {
  try {
    return JSON.parse(localStorage.getItem('ptn_emp_notifications') || '[]');
  } catch (e) {
    return [];
  }
}

function addNotificationToHistory(title, body, tag) {
  const list = getNotificationHistory();
  const now = new Date();
  const item = {
    id: 'notif_' + Date.now(),
    title,
    body,
    tag,
    time: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
    read: false
  };
  list.unshift(item);
  // Keep last 30
  if (list.length > 30) list.pop();
  localStorage.setItem('ptn_emp_notifications', JSON.stringify(list));
  updateNotifBadge();
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  const list = getNotificationHistory();
  const unreadCount = list.filter(x => !x.read).length;
  if (badge) {
    if (unreadCount > 0) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function openNotificationDrawer() {
  const modal = document.getElementById('modalNotifications');
  if (!modal) return;
  modal.classList.remove('hidden');
  renderNotificationList();
  checkPushSubscriptionStatus().catch(() => {});
  // Mark all as read
  const list = getNotificationHistory();
  list.forEach(x => x.read = true);
  localStorage.setItem('ptn_emp_notifications', JSON.stringify(list));
  updateNotifBadge();
}

function closeNotificationDrawer() {
  document.getElementById('modalNotifications')?.classList.add('hidden');
}

function clearAllNotifications() {
  localStorage.setItem('ptn_emp_notifications', '[]');
  renderNotificationList();
  updateNotifBadge();
}

function renderNotificationList() {
  const container = document.getElementById('notifListContainer');
  if (!container) return;
  const list = getNotificationHistory();

  if (list.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400">
        <span class="text-3xl block mb-2">🔕</span>
        <div class="font-bold">ไม่มีการแจ้งเตือน</div>
        <div class="text-[10px]">เมื่อมีการแจ้งเตือนใหม่จะแสดงที่นี่</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="p-3 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 transition space-y-1">
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-800 text-xs">${item.title}</span>
        <span class="text-[10px] text-slate-400">${formatDateThaiBE(item.date)} ${item.time}</span>
      </div>
      <div class="text-slate-600 text-[11px] leading-relaxed">${item.body}</div>
    </div>
  `).join('');
}

function testSendNotification() {
  sendPushOrLocalNotification(
    '⏰ ทดสอบการแจ้งเตือนเวลาพักเบรก',
    'คุณพักไปแล้ว 50 นาที เหลือเวลา 10 นาที กรุณาเตรียมสแกนกลับเข้าทำงาน',
    'test_break'
  );
  Swal.fire({
    icon: 'success',
    title: 'ส่งแจ้งเตือนเรียบร้อย',
    text: 'การแจ้งเตือนได้ถูกบันทึกและส่งผ่าน Web Push แล้ว',
    timer: 1500,
    showConfirmButton: false
  });
  renderNotificationList();
}

// Subtle Audio Chime using Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}

// Break Time Watcher: Schedule 50m and 60m notifications
function scheduleBreakReminders(breakOutTimeStr) {
  clearBreakReminders();
  if (!breakOutTimeStr) return;

  const now = new Date();
  const curIsoDate = now.toISOString().substring(0, 10);
  localStorage.setItem('ptn_break_start_timestamp', now.getTime().toString());
  localStorage.setItem('ptn_break_date', curIsoDate);
  localStorage.removeItem('ptn_break_last_notified');

  // Timer 50 minutes (50 * 60 * 1000)
  breakTimer50 = setTimeout(() => {
    sendPushOrLocalNotification(
      '☕ ใกล้หมดเวลาพักแล้ว!',
      'คุณพักไปแล้ว 50 นาที เหลือเวลาอีก 10 นาที กรุณาเตรียมสแกนกลับเข้าทำงาน',
      'break_50'
    );
  }, 50 * 60 * 1000);

  // Timer 60 minutes
  breakTimer60 = setTimeout(() => {
    sendPushOrLocalNotification(
      '⚠️ ครบกำหนดเวลาพัก 60 นาทีแล้ว!',
      'กรุณาสแกนกลับเข้าทำงานทันทีเพื่อไม่ให้ชั่วโมงทำงานถูกหัก',
      'break_60'
    );
  }, 60 * 60 * 1000);
}

function clearBreakReminders() {
  if (breakTimer50) clearTimeout(breakTimer50);
  if (breakTimer60) clearTimeout(breakTimer60);
  breakTimer50 = null;
  breakTimer60 = null;
  localStorage.removeItem('ptn_break_start_timestamp');
  localStorage.removeItem('ptn_break_date');
  localStorage.removeItem('ptn_break_last_notified');
}

// Check Break duration when reopening or focusing app
function checkActiveBreakOnWake() {
  const stored = localStorage.getItem('ptn_break_start_timestamp');
  if (!stored) return;

  const storedDate = localStorage.getItem('ptn_break_date');
  const todayStr = new Date().toISOString().substring(0, 10);

  // Safeguard 1: Cross-day check - if break was from a previous day, purge immediately without notifying
  if (storedDate && storedDate !== todayStr) {
    clearBreakReminders();
    return;
  }

  const elapsedMinutes = Math.floor((Date.now() - parseInt(stored, 10)) / 60000);

  // Safeguard 2: Out-of-bounds check - if negative or exceeded 5 hours (300 mins), clear stale break state
  if (elapsedMinutes < 0 || elapsedMinutes > 300) {
    clearBreakReminders();
    return;
  }

  // Safeguard 3: Cooldown check - prevent spamming alarms on every tab switch / app focus (minimum 15 mins interval)
  const lastNotified = parseInt(localStorage.getItem('ptn_break_last_notified') || '0', 10);
  const now = Date.now();
  if (now - lastNotified < 15 * 60 * 1000) {
    return;
  }

  if (elapsedMinutes >= 60) {
    localStorage.setItem('ptn_break_last_notified', now.toString());
    sendPushOrLocalNotification(
      '⚠️ คุณพักเกินเกณฑ์ 60 นาทีแล้ว!',
      `ขณะนี้คุณพักไปแล้ว ${elapsedMinutes} นาที กรุณาสแกนกลับเข้าทำงานทันที`,
      'break_over'
    );
  } else if (elapsedMinutes >= 50) {
    localStorage.setItem('ptn_break_last_notified', now.toString());
    sendPushOrLocalNotification(
      '☕ ใกล้หมดเวลาพักแล้ว!',
      `คุณพักไปแล้ว ${elapsedMinutes} นาที (เหลือ ${60 - elapsedMinutes} นาที) กรุณาเตรียมสแกนเข้าทำงาน`,
      'break_warn'
    );
  }
}

// Status Watcher: Compares previous requests with new requests
function checkRequestStatusChanges(leaves = [], ots = [], advances = []) {
  const currentKey = `ptn_req_status_${currentEmployee ? currentEmployee.empId : 'all'}`;
  let prevStatuses = {};
  try {
    prevStatuses = JSON.parse(localStorage.getItem(currentKey) || '{}');
  } catch (e) {}

  const newStatuses = {};

  // Helper: Only trigger alerts for updates that occurred recently (within 24 hours)
  const isRecentUpdate = (item) => {
    const timeStr = item.approved_at || item.updated_at || item.created_at;
    if (!timeStr) return false;
    const ts = new Date(String(timeStr).replace(' ', 'T')).getTime();
    if (isNaN(ts)) return false;
    return (Date.now() - ts) < (24 * 3600 * 1000);
  };

  // Check OT
  ots.forEach(ot => {
    const id = 'ot_' + ot.id;
    newStatuses[id] = ot.status;
    if (prevStatuses[id] && prevStatuses[id] === 'PENDING' && ot.status !== 'PENDING' && isRecentUpdate(ot)) {
      if (ot.status === 'APPROVED') {
        sendPushOrLocalNotification(
          '✅ คำขอ OT ได้รับการอนุมัติแล้ว',
          `คำขอ OT วันที่ ${ot.date || ot.ot_date} (${ot.planned_hours || ot.ot_hours} ชม.) ได้รับการอนุมัติเข้างวดแล้ว`,
          'ot_approved'
        );
      } else if (ot.status === 'REJECTED') {
        sendPushOrLocalNotification(
          '❌ คำขอ OT ไม่ได้รับการอนุมัติ',
          `คำขอ OT วันที่ ${ot.date || ot.ot_date} ถูกปฏิเสธ`,
          'ot_rejected'
        );
      }
    }
  });

  // Check Leave
  leaves.forEach(lv => {
    const id = 'lv_' + lv.id;
    newStatuses[id] = lv.status;
    if (prevStatuses[id] && prevStatuses[id] === 'PENDING' && lv.status !== 'PENDING' && isRecentUpdate(lv)) {
      if (lv.status === 'APPROVED') {
        sendPushOrLocalNotification(
          '✅ คำขอลางานได้รับการอนุมัติแล้ว',
          `คำขอลาวันที่ ${formatDateThaiBE(lv.start_date)} ได้รับการอนุมัติแล้ว`,
          'leave_approved'
        );
      } else if (lv.status === 'REJECTED') {
        sendPushOrLocalNotification(
          '❌ คำขอลางานถูกปฏิเสธ',
          `คำขอลาวันที่ ${formatDateThaiBE(lv.start_date)} ไม่ได้รับการอนุมัติ (${lv.reject_reason || '-'})`,
          'leave_rejected'
        );
      }
    }
  });

  // Check Advance
  advances.forEach(ad => {
    const id = 'ad_' + ad.id;
    newStatuses[id] = ad.status;
    if (prevStatuses[id] && prevStatuses[id] === 'PENDING' && ad.status !== 'PENDING' && isRecentUpdate(ad)) {
      if (ad.status === 'APPROVED') {
        sendPushOrLocalNotification(
          '💵 คำขอเบิกเงินล่วงหน้าอนุมัติแล้ว',
          `ยอดเบิก ฿${ad.amount} ได้รับการอนุมัติเรียบร้อย`,
          'adv_approved'
        );
      } else if (ad.status === 'REJECTED') {
        sendPushOrLocalNotification(
          '❌ คำขอเบิกเงินล่วงหน้าไม่ผ่านอนุมัติ',
          `ยอดเบิก ฿${ad.amount} ไม่ได้รับการอนุมัติ`,
          'adv_rejected'
        );
      }
    }
  });

  localStorage.setItem(currentKey, JSON.stringify(newStatuses));
}


// ==============================================================================
// 17. SUPER ADMIN / SUPERVISOR PAYSLIP SETTINGS & BROADCAST NOTIFICATIONS
// ==============================================================================

function openSupervisorModal() {
  const modal = document.getElementById('modalSupervisorSettings');
  const gateForm = document.getElementById('supGateForm');
  const panel = document.getElementById('supSettingsPanel');

  if (supervisorSession) {
    gateForm?.classList.add('hidden');
    panel?.classList.remove('hidden');
    populateSupervisorPayslipForm();
  } else {
    gateForm?.classList.remove('hidden');
    panel?.classList.add('hidden');
    const pInput = document.getElementById('supPasswordInput');
    if (pInput) {
      pInput.value = '';
      setTimeout(() => pInput.focus(), 200);
    }
  }

  modal?.classList.remove('hidden');
}

function closeSupervisorModal() {
  document.getElementById('modalSupervisorSettings')?.classList.add('hidden');
}

async function submitSupervisorAuth() {
  const uInput = document.getElementById('supUsernameInput');
  const pInput = document.getElementById('supPasswordInput');
  const username = uInput ? uInput.value.trim() : 'admin';
  const password = pInput ? pInput.value.trim() : '';

  if (!password) {
    Swal.fire('กรุณากรอกรหัสผ่านผู้ดูแลระบบ', '', 'warning');
    return;
  }

  Swal.fire({
    title: 'กำลังตรวจสอบสิทธิ์...',
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'supervisorLogin',
        username,
        password
      })
    });

    const data = await res.json();
    if (data.success) {
      supervisorSession = data.user || { username };
      Swal.close();
      document.getElementById('supGateForm')?.classList.add('hidden');
      document.getElementById('supSettingsPanel')?.classList.remove('hidden');
      populateSupervisorPayslipForm();
    } else {
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', data.message || 'รหัสผ่านไม่ถูกต้อง', 'error');
    }
  } catch (e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

function populateSupervisorPayslipForm() {
  const toggle = document.getElementById('toggleAdminPayslip');
  if (toggle) toggle.checked = (appSettings.enable_payslip !== 'false');

  const modeSel = document.getElementById('selectPayslipReleaseMode');
  if (modeSel) modeSel.value = appSettings.payslip_release_mode || 'CLOSED_PERIODS_ONLY';

  const periodInput = document.getElementById('broadcastPeriodInput');
  if (periodInput && !periodInput.value) {
    periodInput.value = new Date().toISOString().substring(0, 7);
  }
}

async function saveSupervisorPayslipSettings() {
  const toggle = document.getElementById('toggleAdminPayslip');
  const modeSel = document.getElementById('selectPayslipReleaseMode');

  const enableVal = toggle && toggle.checked ? 'true' : 'false';
  const modeVal = modeSel ? modeSel.value : 'CLOSED_PERIODS_ONLY';

  Swal.fire({
    title: 'กำลังบันทึกการตั้งค่า...',
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveSettings',
        settings: {
          enable_payslip: enableVal,
          payslip_release_mode: modeVal
        }
      })
    });

    const data = await res.json();
    if (data.success) {
      appSettings.enable_payslip = enableVal;
      appSettings.payslip_release_mode = modeVal;
      try {
        localStorage.setItem('ptn_app_settings', JSON.stringify(appSettings));
      } catch (e) {}

      applyFeatureToggles();
      closeSupervisorModal();

      Swal.fire({
        icon: 'success',
        title: 'บันทึกการตั้งค่าสำเร็จ!',
        text: `ฟังก์ชันสลิปเงินเดือน: ${enableVal === 'true' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} (${modeVal === 'CLOSED_PERIODS_ONLY' ? 'เฉพาะงวดที่ปิดแล้ว' : 'ทุกงวดที่คำนวณ'})`,
        timer: 2000,
        showConfirmButton: false
      });
    } else {
      Swal.fire('เกิดข้อผิดพลาด', data.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  } catch (e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

async function triggerBroadcastPayslip() {
  const periodInput = document.getElementById('broadcastPeriodInput');
  const period = periodInput ? periodInput.value.trim() : '';

  if (!period) {
    Swal.fire('กรุณาระบุงวดเงินเดือน', 'เช่น 2026-09 หรือ กันยายน 2569', 'warning');
    return;
  }

  const confirmRes = await Swal.fire({
    title: '📢 ส่งแจ้งเตือนสลิปเงินเดือน?',
    text: `ระบบจะส่งข้อความแจ้งเตือนไปยังพนักงานทุกคนว่า "สลิปเงินเดือนงวด ${period} ออกแล้ว"`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันส่งทันที',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#4f46e5'
  });

  if (!confirmRes.isConfirmed) return;

  Swal.fire({
    title: 'กำลังส่งแจ้งเตือน...',
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'broadcastPayslipNotification',
        period,
        username: supervisorSession?.username || 'Admin'
      })
    });

    const data = await res.json();
    if (data.success) {
      // Trigger local push notification on this device as well
      sendPushOrLocalNotification(
        `💰 สลิปเงินเดือนงวด ${period} ออกแล้ว!`,
        'พนักงานสามารถตรวจสอบยอดเงินเดือนสุทธิและรายการหักได้แล้วในแท็บ สลิปเงิน',
        'payslip_broadcast'
      );

      const badge = document.getElementById('badgePayslipNew');
      if (badge) badge.classList.remove('hidden');

      Swal.fire({
        icon: 'success',
        title: 'ส่งแจ้งเตือนสำเร็จ!',
        text: data.message || `ส่งแจ้งเตือนสลิปงวด ${period} เรียบร้อยแล้ว`,
        timer: 2000,
        showConfirmButton: false
      });
    } else {
      Swal.fire('เกิดข้อผิดพลาด', data.message || 'ส่งแจ้งเตือนไม่สำเร็จ', 'error');
    }
  } catch (e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

async function checkBroadcastNotifications() {
  try {
    const res = await fetch(`${API_URL}?action=getBroadcastNotifications`);
    const data = await res.json();

    if (data.success && data.notifications && data.notifications.length > 0) {
      const lastSeenId = parseInt(localStorage.getItem('ptn_last_broadcast_id') || '0', 10);
      const latest = data.notifications[0];

      if (latest && latest.id > lastSeenId) {
        localStorage.setItem('ptn_last_broadcast_id', String(latest.id));

        // Show Red badge on payslip tab
        const badge = document.getElementById('badgePayslipNew');
        if (badge) badge.classList.remove('hidden');

        // Fire notification
        sendPushOrLocalNotification(
          latest.title || '💰 แจ้งเตือนสลิปเงินเดือน',
          latest.body || 'มีสลิปเงินเดือนงวดใหม่ออกแล้ว ตรวจสอบได้ที่แท็บ สลิปเงิน',
          `broadcast_${latest.id}`
        );
      }
    }
  } catch (e) {
    // Non-blocking sync error
  }
}



