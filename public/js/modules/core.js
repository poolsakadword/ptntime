/**
 * ==============================================================================
 * PTN Time Attendant - Core Module (State, API Client, Clock & Utilities)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

/**
 * PTN Time Attendant — Main Frontend Application Engine
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 * Website: https://ptntime.pages.dev
 */

const API_URL = '/api';

/**
 * Generic API Client for PTN Time (with retry capability for transient network/server issues)
 */
async function callApi(action, payload = {}, retryCount = 0) {
  if (typeof action === 'object' && action !== null) {
    payload = action;
    action = payload.action;
  }
  payload = payload || {};
  const bodyData = { action, ...payload };
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
    if (!res.ok) {
      if ((res.status === 502 || res.status === 503 || res.status === 504) && retryCount < 3) {
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
        return callApi(action, payload, retryCount + 1);
      }
      throw new Error(`HTTP Error: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (retryCount < 3 && err && err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('503'))) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return callApi(action, payload, retryCount + 1);
    }
    throw err;
  }
}
window.callApi = callApi;

function timeToMinutes(tStr) {
  if (!tStr) return 0;
  const parts = String(tStr).split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function minutesToTime(totalMins) {
  const h = Math.floor(totalMins / 60) % 24;
  const m = Math.floor(totalMins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getActiveCutoffPeriodString() {
  const bkk = new Date(Date.now() + 7 * 3600 * 1000);
  let curY = bkk.getUTCFullYear();
  let curM = bkk.getUTCMonth() + 1; // 1-12
  const curD = bkk.getUTCDate();
  const cutDay = Number(appSettings?.cutoff_day) || 25;

  if (cutDay < 30 && curD > cutDay) {
    curM += 1;
    if (curM > 12) {
      curM = 1;
      curY += 1;
    }
  }
  return `${curY}-${String(curM).padStart(2, '0')}`;
}

function formatDateThaiBE(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const s = String(dateStr).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const parts = s.substring(0, 10).split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parts[1];
    const d = parts[2];
    if (!isNaN(y) && y > 0) {
      const beYear = y < 2400 ? (y + 543) : y;
      return `${d}/${m}/${beYear}`;
    }
  }
  return dateStr;
}

function formatThaiDateTimeBE(dtStr) {
  if (!dtStr || dtStr === '-') return '-';
  const s = String(dtStr).trim();
  if (s.indexOf('T') !== -1 || s.indexOf('Z') !== -1) {
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const bkk = new Date(d.getTime() + (7 * 3600 * 1000) + (d.getTimezoneOffset() * 60 * 1000));
        const y = bkk.getFullYear() + 543;
        const m = (bkk.getMonth() + 1 < 10 ? '0' : '') + (bkk.getMonth() + 1);
        const day = (bkk.getDate() < 10 ? '0' : '') + bkk.getDate();
        const hh = (bkk.getHours() < 10 ? '0' : '') + bkk.getHours();
        const mm = (bkk.getMinutes() < 10 ? '0' : '') + bkk.getMinutes();
        return `${day}/${m}/${y} ${hh}:${mm} น.`;
      }
    } catch(e) {}
  }
  if (s.length >= 16) {
    const datePart = s.substring(0, 10);
    const timePart = s.substring(11, 16);
    return `${formatDateThaiBE(datePart)} ${timePart} น.`;
  }
  return formatDateThaiBE(s);
}

function normalizeDateToIso(str) {
  if (!str) return '';
  const s = String(str).trim();
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const d = (match[1].length < 2 ? '0' : '') + match[1];
    const m = (match[2].length < 2 ? '0' : '') + match[2];
    let y = parseInt(match[3], 10);
    if (y > 2400) y -= 543;
    return `${y}-${m}-${d}`;
  }
  return s.substring(0, 10);
}

function updateLeaveStartDateThaiHint() {
  const el = document.getElementById('leaveStartDate');
  const hint = document.getElementById('leaveStartDateThaiHint');
  if (el && hint) {
    hint.textContent = el.value ? ('📅 (พ.ศ.): ' + formatDateThaiBE(el.value)) : '';
  }
}

function updateLeaveEndDateThaiHint() {
  const el = document.getElementById('leaveEndDate');
  const hint = document.getElementById('leaveEndDateThaiHint');
  if (el && hint) {
    hint.textContent = el.value ? ('📅 (พ.ศ.): ' + formatDateThaiBE(el.value)) : '';
  }
}

function updateOtDateThaiHint() {
  const el = document.getElementById('otDate');
  const hint = document.getElementById('otDateThaiHint');
  if (el && hint) {
    hint.textContent = el.value ? ('📅 (พ.ศ.): ' + formatDateThaiBE(el.value)) : '';
  }
}

// Global State
var currentEmployee = null;
var employeeList = [];
var branchList = [];
var appSettings = {
  office_lat: 13.7278956,
  office_lng: 100.5241234,
  geofence_radius_meters: 200,
  cutoff_day: 25,
  work_start_time: '09:30',
  grace_period_morning_minutes: 0,
  lunch_start_time: '13:00',
  lunch_end_time: '14:00',
  grace_period_afternoon_minutes: 0,
  work_end_time: '19:00',
  ot_start_time: '19:00',
  sunday_ot_rate: 1.0,
  ot_rounding_mode: 'HALF_HOUR',
  advance_day_of_week: 'SATURDAY',
  advance_start_time: '09:00',
  advance_end_time: '18:00',
  advance_daily_rate: 250,
  advance_max_amount: 3000,
  enable_leave_requests: 'true',
  enable_ot_requests: 'true',
  enable_advance_requests: 'true',
  allow_direct_gps: 'true',
  qr_mode: 'HYBRID',
  break_tracking_mode: 'AUTO_DEDUCT',
  break_duration_minutes: 60,
  enable_face_detection: 'true',
  unlock_method_password: 'true',
  unlock_method_qr: 'true',
  unlock_method_remote: 'true',
  leave_type_sick_with_cert: 'true',
  leave_type_sick_no_cert: 'true',
  leave_type_business: 'false',
  leave_type_annual: 'false',
  leave_type_without_pay: 'false',
  enable_payslip: 'true',
  payslip_release_mode: 'CLOSED_PERIODS_ONLY',
  system_maintenance_mode: 'false',
  system_maintenance_message: 'ระบบลงเวลา PTN Time อยู่ระหว่างปิดปรับปรุงชั่วคราว เพื่อเพิ่มประสิทธิภาพการทำงาน ขออภัยในความไม่สะดวก',
  enable_selfie_greetings: 'true',
  enable_selfie_clockin_greetings: 'true',
  enable_selfie_break_greetings: 'true',
  enable_selfie_clockout_greetings: 'true',
  enable_birthday_greeting: 'true',
  enable_saturday_greeting: 'true',
  selfie_custom_messages: 'สวัสดีตอนเช้าค่ะ วันนี้ยิ้มสดใสมาก ขอให้เป็นวันที่ราบรื่นและมีความสุขนะคะ 🌸\nพร้อมลุยงานวันนี้! ยิ้มรับลูกค้าด้วยหัวใจบริการค่ะ ✨\nเริ่มต้นวันใหม่ด้วยพลังบวก ขอให้การทำงานวันนี้ราบรื่นสำเร็จทุกสิ่งนะคะ 💖',
  selfie_custom_messages_break: 'ทานอาหารกลางวันให้อร่อยนะคะ ชาร์จพลังให้เต็มที่ 🍜🍱\nพักสายตาและผ่อนคลายความเหนื่อยล้าสักครู่ค่ะ ☕🍰\nชาร์จพลังเต็มที่แล้ว พร้อมลุยงานช่วงบ่ายอย่างสดชื่นค่ะ 💪✨',
  selfie_custom_messages_out: 'ขอบคุณสำหรับความทุ่มเทในวันนี้นะคะ ทำงานเหนื่อยมาทั้งวันแล้ว เก่งมากๆ ค่ะ 👏💖\nเดินทางกลับบ้านโดยสวัสดิภาพนะคะ พักผ่อนให้เต็มที่ พรุ่งนี้พบกันใหม่ค่ะ 🚗🏠\nทำงานสำเร็จไปอีกวันแล้ว วันนี้คุณทำได้ยอดเยี่ยมมากค่ะ 🌟'
};
var currentLocation = null;
var currentDistanceMeters = null;
var cameraStream = null;
var capturedPhoto = null;
var supervisorSession = null;
var html5QrScannerInstance = null;
var pendingScanType = 'IN'; // 'IN', 'OUT', or 'UNLOCK'
var pendingClockData = null; // { type, qrToken } for two-step clock-in/out
var isDeviceLocked = false;
var masterQrInterval = null;
var isPayslipUnlocked = false;
var currentPayslipData = null;
var isClockSubmitting = false; // High-concurrency debounce flag

const LEAVE_TYPES_MASTER = [
  { key: 'leave_type_sick_with_cert', value: 'SICK_WITH_CERT', label: 'ลาป่วยมีใบรับรองแพทย์' },
  { key: 'leave_type_sick_no_cert', value: 'SICK_NO_CERT', label: 'ลาป่วยไม่มีใบรับรองแพทย์' },
  { key: 'leave_type_business', value: 'BUSINESS', label: 'ลากิจส่วนตัว' },
  { key: 'leave_type_annual', value: 'ANNUAL', label: 'ลาพักร้อน' },
  { key: 'leave_type_without_pay', value: 'WITHOUT_PAY', label: 'ลาไม่รับค่าจ้าง' }
];

const LEAVE_TYPE_LABELS = {
  'SICK_WITH_CERT': 'ลาป่วยมีใบรับรองแพทย์',
  'SICK_NO_CERT': 'ลาป่วยไม่มีใบรับรองแพทย์',
  'BUSINESS': 'ลากิจส่วนตัว',
  'ANNUAL': 'ลาพักร้อน',
  'WITHOUT_PAY': 'ลาไม่รับค่าจ้าง'
};

function renderLeaveTypeOptions() {
  const sel = document.getElementById('leaveType');
  if (!sel) return;

  const currentVal = sel.value;
  sel.innerHTML = '';

  const activeTypes = LEAVE_TYPES_MASTER.filter(item => {
    if (item.key === 'leave_type_sick_with_cert' || item.key === 'leave_type_sick_no_cert') {
      return appSettings[item.key] !== 'false';
    }
    return appSettings[item.key] === 'true';
  });

  if (activeTypes.length === 0) {
    activeTypes.push(LEAVE_TYPES_MASTER[0], LEAVE_TYPES_MASTER[1]);
  }

  activeTypes.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.value;
    opt.textContent = t.label;
    sel.appendChild(opt);
  });

  if (currentVal && activeTypes.some(t => t.value === currentVal)) {
    sel.value = currentVal;
  }
}

// Synchronously hydrate cached settings & employee immediately to prevent initial UI flash
try {
  const cachedSettings = localStorage.getItem('ptn_app_settings');
  if (cachedSettings) {
    appSettings = { ...appSettings, ...JSON.parse(cachedSettings) };
  }
  const cachedEmp = localStorage.getItem('ptn_time_emp');
  if (cachedEmp) {
    currentEmployee = JSON.parse(cachedEmp);
  }
  const cachedFont = localStorage.getItem('ptn_time_font_size') || 'lg';
  document.documentElement.setAttribute('data-font-size', cachedFont);
} catch(e) {}

function getOrCreateDeviceId() {
  let id = localStorage.getItem('ptn_device_id');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
    localStorage.setItem('ptn_device_id', id);
  }
  return id;
}



function initLiveClock() {
  const thaiDays = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  function update() {
    const now = new Date();
    const dStr = thaiDays[now.getDay()] + 'ที่ ' + now.getDate() + ' ' + thaiMonths[now.getMonth()] + ' ' + (now.getFullYear() + 543);
    const dateEl = document.getElementById('liveDateThai');
    if (dateEl) dateEl.textContent = dStr;

    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
  }

  update();
  setInterval(update, 1000);
}


// ==============================================================================
// 2. DATA LOADING & STATE
// ==============================================================================
async function loadInitialData() {
  try {
    const empParam = (currentEmployee && currentEmployee.empId) ? ('&empId=' + encodeURIComponent(currentEmployee.empId)) : '';
    const res = await fetch(API_URL + '?action=getInitialData' + empParam);
    const data = await res.json();
    if (data.success) {
      if (data.settings) {
        appSettings = { ...appSettings, ...data.settings };
        try {
          localStorage.setItem('ptn_app_settings', JSON.stringify(appSettings));
        } catch(e) {}
      }
      employeeList = data.employees || [];
      if (data.branches) {
        branchList = data.branches;
      }
      if (data.companyHolidays && Array.isArray(data.companyHolidays)) {
        window.companyHolidays = data.companyHolidays;
      }

      // Synchronize currentEmployee with updated data from employeeList
      if (currentEmployee && currentEmployee.empId) {
        const freshEmp = employeeList.find(e => e.empId === currentEmployee.empId);
        if (freshEmp) {
          currentEmployee = { ...currentEmployee, ...freshEmp };
          try {
            localStorage.setItem('ptn_time_emp', JSON.stringify(currentEmployee));
          } catch(e) {}
        }
      }

      populateEmployeeDropdown();
      updateHeaderEmployeeView();
      applyFeatureToggles();
      checkMaintenanceMode();
      checkAppAnnouncement(data.announcement);

      // Recalculate GPS location for this employee's branch
      if (currentLocation) {
        getCurrentLocation(true, false);
      }
    }
  } catch (e) {
    console.warn('Backend API connection note:', e);
  }
}

// ==============================================================================
// MAINTENANCE MODE CONTROLLERS
// ==============================================================================
function checkMaintenanceMode() {
  const isMaint = appSettings && (appSettings.system_maintenance_mode === 'true' || appSettings.system_maintenance_mode === true);
  const isBypassed = sessionStorage.getItem('ptn_admin_maintenance_bypass') === 'true';
  const maintScreen = document.getElementById('maintenanceScreen');
  const msgEl = document.getElementById('maintenanceMessageDisplay');

  if (msgEl && appSettings && appSettings.system_maintenance_message) {
    msgEl.textContent = appSettings.system_maintenance_message;
  }

  if (isMaint && !isBypassed) {
    if (maintScreen) maintScreen.classList.remove('hidden');
    removeAdminMaintenanceBanner();
  } else {
    if (maintScreen) maintScreen.classList.add('hidden');
    if (isMaint && isBypassed) {
      showAdminMaintenanceBanner();
    } else {
      removeAdminMaintenanceBanner();
    }
  }
}


function showAdminMaintenanceBanner() {
  let banner = document.getElementById('adminMaintenanceBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'adminMaintenanceBanner';
    banner.className = 'w-full bg-rose-600 text-white text-xs font-bold py-2 px-4 flex items-center justify-between shadow-md z-40 sticky top-0';
    banner.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="animate-pulse">⚠️</span>
        <span>โหมดปิดปรับปรุงระบบทำงานอยู่ (พนักงานทั่วไปจะไม่สามารถใช้งานได้)</span>
      </div>
      <button onclick="exitAdminMaintenanceBypass()" class="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-[11px] font-semibold transition active:scale-95">
        ออกจากโหมดผู้ดูแล
      </button>
    `;
    const header = document.querySelector('header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(banner, header);
    } else {
      document.body.prepend(banner);
    }
  }
}

function removeAdminMaintenanceBanner() {
  const banner = document.getElementById('adminMaintenanceBanner');
  if (banner) banner.remove();
}

function exitAdminMaintenanceBypass() {
  sessionStorage.removeItem('ptn_admin_maintenance_bypass');
  sessionStorage.removeItem('ptn_admin_user');
  checkMaintenanceMode();
}

async function promptAdminMaintenanceBypass() {
  const { value: formValues } = await Swal.fire({
    title: '🔑 ล็อกอินผู้ดูแลระบบ (Admin / Supervisor)',
    html: `
      <div class="space-y-3 text-left">
        <div>
          <label class="text-xs font-bold text-slate-700">ชื่อผู้ใช้งาน (Username):</label>
          <input id="swalAdminUser" class="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none mt-1" value="admin">
        </div>
        <div>
          <label class="text-xs font-bold text-slate-700">รหัสผ่าน (Password):</label>
          <input id="swalAdminPass" type="password" class="w-full text-xs p-2.5 border border-slate-300 rounded-xl outline-none mt-1" placeholder="รหัสผ่านผู้ดูแลระบบ">
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'เข้าสู่ระบบ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#0284c7',
    cancelButtonColor: '#64748b',
    preConfirm: () => {
      const u = document.getElementById('swalAdminUser').value.trim();
      const p = document.getElementById('swalAdminPass').value.trim();
      if (!u || !p) {
        Swal.showValidationMessage('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
        return false;
      }
      return { u, p };
    }
  });

  if (!formValues) return;

  try {
    Swal.fire({ title: 'กำลังตรวจสอบสิทธิ์...', didOpen: () => Swal.showLoading() });
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'supervisorLogin',
        username: formValues.u,
        password: formValues.p
      })
    });
    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem('ptn_admin_maintenance_bypass', 'true');
      sessionStorage.setItem('ptn_admin_user', data.user ? data.user.username : formValues.u);
      checkMaintenanceMode();
      Swal.fire({
        icon: 'success',
        title: 'ยืนยันสิทธิ์สำเร็จ!',
        text: 'คุณสามารถเข้าใช้งานและทดสอบระบบได้ตามปกติในระหว่างปิดปรับปรุง',
        timer: 1800,
        showConfirmButton: false
      });
    } else {
      Swal.fire('เข้าสู่ระบบไม่สำเร็จ', data.message || 'รหัสผ่านไม่ถูกต้อง', 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

function handleMaintenanceResponse(data) {
  if (data && data.maintenance) {
    if (data.settings) {
      appSettings = { ...appSettings, ...data.settings };
      try {
        localStorage.setItem('ptn_app_settings', JSON.stringify(appSettings));
      } catch(e) {}
    }
    checkMaintenanceMode();
    Swal.fire({
      icon: 'warning',
      title: 'ระบบปิดปรับปรุงชั่วคราว',
      text: data.message || 'อยู่ระหว่างปิดปรับปรุงระบบ'
    });
    return true;
  }
  return false;
}

function getCurrentEmployeeTargetBranch() {
  if (!currentEmployee) {
    return branchList[0] || {
      branch_id: 'B01',
      branch_name: 'สำนักงานใหญ่',
      lat: appSettings.office_lat,
      lng: appSettings.office_lng,
      radius_meters: appSettings.geofence_radius_meters || 200,
      work_start_time: appSettings.work_start_time || '09:30',
      work_end_time: appSettings.work_end_time || '19:00',
      lunch_start_time: appSettings.lunch_start_time || '13:00',
      lunch_end_time: appSettings.lunch_end_time || '14:00'
    };
  }

  const isRoaming = (currentEmployee.allowAllBranches === true || currentEmployee.allow_all_branches === 'true');

  if (isRoaming && currentLocation && branchList.length > 0) {
    let closest = null;
    let minDistance = Infinity;
    for (const b of branchList) {
      if (b.lat && b.lng && b.status !== 'INACTIVE') {
        const dist = calculateHaversineMeters(currentLocation.lat, currentLocation.lng, b.lat, b.lng);
        if (dist !== null && dist < minDistance) {
          minDistance = dist;
          closest = b;
        }
      }
    }
    if (closest) return closest;
  }

  const bId = currentEmployee.branchId || currentEmployee.branch_id || 'B01';
  const target = branchList.find(b => b.branch_id === bId);
  if (target) return target;

  return branchList[0] || {
    branch_id: 'B01',
    branch_name: 'สำนักงานใหญ่',
    lat: appSettings.office_lat,
    lng: appSettings.office_lng,
    radius_meters: appSettings.geofence_radius_meters || 200,
    work_start_time: appSettings.work_start_time || '09:30',
    work_end_time: appSettings.work_end_time || '19:00',
    lunch_start_time: appSettings.lunch_start_time || '13:00',
    lunch_end_time: appSettings.lunch_end_time || '14:00'
  };
}

function updateShiftDisplay() {
  const shiftEl = document.getElementById('shiftTickerText');
  const lunchEl = document.getElementById('shiftLunchText');
  const branchBadge = document.getElementById('shiftBranchBadge');
  const lateEl = document.getElementById('todayLateInfo');

  const targetBranch = window.currentBranchConfig || getCurrentEmployeeTargetBranch();
  const isRoaming = currentEmployee && (currentEmployee.allowAllBranches === true || currentEmployee.allow_all_branches === 'true');

  const startTime = targetBranch ? (targetBranch.workStartTime || targetBranch.work_start_time || appSettings.work_start_time || '09:30') : (appSettings.work_start_time || '09:30');
  const endTime = targetBranch ? (targetBranch.workEndTime || targetBranch.work_end_time || appSettings.work_end_time || '19:00') : (appSettings.work_end_time || '19:00');
  const lunchStart = targetBranch ? (targetBranch.lunchStartTime || targetBranch.lunch_start_time || appSettings.lunch_start_time || '13:00') : (appSettings.lunch_start_time || '13:00');
  const lunchEnd = targetBranch ? (targetBranch.lunchEndTime || targetBranch.lunch_end_time || appSettings.lunch_end_time || '14:00') : (appSettings.lunch_end_time || '14:00');
  const bName = targetBranch ? (targetBranch.branchName || targetBranch.branch_name || 'สำนักงานใหญ่') : 'สำนักงานใหญ่';
  const branchName = isRoaming ? `${bName} (Roaming)` : bName;

  if (shiftEl) {
    shiftEl.textContent = `${startTime} - ${endTime} น.`;
  }
  if (lunchEl) {
    lunchEl.textContent = `🍱 พัก ${lunchStart} - ${lunchEnd} น.`;
  }
  if (branchBadge) {
    branchBadge.textContent = branchName;
    if (isRoaming) {
      branchBadge.className = 'text-[11px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full border border-amber-200';
    } else {
      branchBadge.className = 'text-[11px] bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded-full border border-sky-200';
    }
  }
  if (lateEl && (!window.currentTodayLog || !window.currentTodayLog.clock_in)) {
    lateEl.textContent = `เกณฑ์ ${startTime} น.`;
    lateEl.className = 'text-xs sm:text-sm text-emerald-700 font-normal';
  }
}


function applyFeatureToggles() {
  const leaveBtn = document.getElementById('subTabBtnLeave');
  const otBtn = document.getElementById('subTabBtnOt');
  const advBtn = document.getElementById('subTabBtnAdvance');

  const leaveContent = document.getElementById('subTabLeaveContent');
  const otContent = document.getElementById('subTabOtContent');
  const advContent = document.getElementById('subTabAdvanceContent');

  if (leaveBtn) {
    if (appSettings.enable_leave_requests === 'false') {
      leaveBtn.classList.add('hidden');
      leaveContent?.classList.add('hidden');
    } else {
      leaveBtn.classList.remove('hidden');
    }
  }
  if (otBtn) {
    if (appSettings.enable_ot_requests === 'false') {
      otBtn.classList.add('hidden');
      otContent?.classList.add('hidden');
    } else {
      otBtn.classList.remove('hidden');
    }
  }
  if (advBtn) {
    if (appSettings.enable_advance_requests === 'false') {
      advBtn.classList.add('hidden');
      advContent?.classList.add('hidden');
    } else {
      advBtn.classList.remove('hidden');
    }
  }

  const quickAdv = document.getElementById('quickBtnAdvance');
  if (quickAdv) {
    if (appSettings.enable_advance_requests === 'false') quickAdv.classList.add('hidden');
    else quickAdv.classList.remove('hidden');
  }
  const quickLeave = document.getElementById('quickBtnLeave');
  if (quickLeave) {
    if (appSettings.enable_leave_requests === 'false') quickLeave.classList.add('hidden');
    else quickLeave.classList.remove('hidden');
  }

  const directGpsContainer = document.getElementById('containerDirectGps');
  if (directGpsContainer) {
    if (appSettings.allow_direct_gps === 'false') {
      directGpsContainer.classList.add('hidden');
    } else {
      directGpsContainer.classList.remove('hidden');
    }
  }

  const breakDirectGpsContainer = document.getElementById('containerBreakDirectGps');
  if (breakDirectGpsContainer) {
    if (appSettings.allow_direct_gps === 'false') {
      breakDirectGpsContainer.classList.add('hidden');
    } else {
      breakDirectGpsContainer.classList.remove('hidden');
    }
  }

  const heroDirectGps = document.getElementById('containerHeroDirectGps');
  if (heroDirectGps) {
    if (appSettings.allow_direct_gps === 'false') {
      heroDirectGps.classList.add('hidden');
    }
  }

  // Device unlock methods toggles
  const pwContainer = document.getElementById('unlockMethodPasswordContainer');
  const qrContainer = document.getElementById('unlockMethodQrContainer');
  const remoteContainer = document.getElementById('unlockMethodRemoteContainer');
  const noMethodNotice = document.getElementById('unlockNoMethodNotice');

  const pwEnabled = appSettings.unlock_method_password !== 'false';
  const qrEnabled = appSettings.unlock_method_qr !== 'false';
  const remoteEnabled = appSettings.unlock_method_remote !== 'false';

  if (pwContainer) pwContainer.classList.toggle('hidden', !pwEnabled);
  if (qrContainer) qrContainer.classList.toggle('hidden', !qrEnabled);
  if (remoteContainer) remoteContainer.classList.toggle('hidden', !remoteEnabled);
  if (noMethodNotice) noMethodNotice.classList.toggle('hidden', pwEnabled || qrEnabled || remoteEnabled);

  const clockSub = document.getElementById('liveClockSubtext');
  if (clockSub) {
    clockSub.textContent = 'ระบบพร้อมลงเวลา';
  }

  const histCutoff = document.getElementById('historyCutoffLabel');
  if (histCutoff) {
    const cutDay = Number(appSettings.cutoff_day) || 25;
    if (cutDay >= 30) {
      histCutoff.textContent = 'รอบตัดวิก วันที่ 1 ถึงสิ้นเดือน ประจำเดือน';
    } else {
      histCutoff.textContent = `รอบตัดวิก ${cutDay + 1} ถึง ${cutDay} ประจำเดือน`;
    }
  }

  // Payslip Feature Toggle
  const payslipEnabled = (appSettings.enable_payslip !== 'false');
  const navPayslip = document.getElementById('navBtnPayslip');
  if (navPayslip) {
    if (!payslipEnabled) {
      navPayslip.classList.add('hidden');
    } else {
      navPayslip.classList.remove('hidden');
    }
  }

  const quickPayslip = document.getElementById('quickBtnPayslip');
  if (quickPayslip) {
    if (!payslipEnabled) {
      quickPayslip.classList.add('hidden');
    } else {
      quickPayslip.classList.remove('hidden');
    }
  }

  const payslipDisabledNotice = document.getElementById('payslipDisabledNotice');
  const payslipPinGate = document.getElementById('payslipPinGate');
  const payslipDetailContainer = document.getElementById('payslipDetailContainer');
  if (!payslipEnabled) {
    if (payslipDisabledNotice) payslipDisabledNotice.classList.remove('hidden');
    if (payslipPinGate) payslipPinGate.classList.add('hidden');
    if (payslipDetailContainer) payslipDetailContainer.classList.add('hidden');
  } else {
    if (payslipDisabledNotice) payslipDisabledNotice.classList.add('hidden');
  }

  renderLeaveTypeOptions();
}


// ==============================================================================
// 15. DYNAMIC FONT SIZE CONTROLLER (3 SIZES: MD, LG, XL)
// ==============================================================================

function initFontSizePreference() {
  const saved = localStorage.getItem('ptn_time_font_size') || 'lg'; // Default to Large (+15%)
  applyAppFontSize(saved);
}

function changeAppFontSize(size) {
  localStorage.setItem('ptn_time_font_size', size);
  applyAppFontSize(size);
}

function applyAppFontSize(size) {
  document.documentElement.setAttribute('data-font-size', size);
  const btnMd = document.getElementById('btnFontMd');
  const btnLg = document.getElementById('btnFontLg');
  const btnXl = document.getElementById('btnFontXl');

  if (btnMd && btnLg && btnXl) {
    btnMd.className = 'px-1.5 py-0.5 rounded transition text-slate-600 hover:bg-sky-50';
    btnLg.className = 'px-1.5 py-0.5 rounded transition text-slate-600 hover:bg-sky-50';
    btnXl.className = 'px-1.5 py-0.5 rounded transition text-slate-600 hover:bg-sky-50';

    if (size === 'md') {
      btnMd.className = 'px-1.5 py-0.5 rounded bg-sky-600 text-white font-black shadow-sm';
    } else if (size === 'xl') {
      btnXl.className = 'px-1.5 py-0.5 rounded bg-indigo-600 text-white font-black shadow-sm';
    } else {
      btnLg.className = 'px-1.5 py-0.5 rounded bg-sky-600 text-white font-black shadow-sm';
    }
  }
}
