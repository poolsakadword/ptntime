/**
 * PTN Time Attendant — Main Frontend Application Engine
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 * Website: https://ptntime.pages.dev
 */

const API_URL = '/api';

// Global State
let currentEmployee = null;
let employeeList = [];
let branchList = [];
let appSettings = {
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
  system_maintenance_message: 'ระบบลงเวลา PTN Time อยู่ระหว่างปิดปรับปรุงชั่วคราว เพื่อเพิ่มประสิทธิภาพการทำงาน ขออภัยในความไม่สะดวก'
};
let currentLocation = null;
let currentDistanceMeters = null;
let cameraStream = null;
let capturedPhoto = null;
let supervisorSession = null;
let html5QrScannerInstance = null;
let pendingScanType = 'IN'; // 'IN', 'OUT', or 'UNLOCK'
let pendingClockData = null; // { type, qrToken } for two-step clock-in/out
let isDeviceLocked = false;
let masterQrInterval = null;
let isPayslipUnlocked = false;
let currentPayslipData = null;
let isClockSubmitting = false; // High-concurrency debounce flag

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

// ==============================================================================
// 1. INITIALIZATION & LIVE CLOCK
// ==============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Instant paint cached state (0ms - prevents initial UI flash!)
  initFontSizePreference();
  updateHeaderEmployeeView();
  updateShiftDisplay();
  applyFeatureToggles();
  renderLeaveTypeOptions();
  checkMaintenanceMode();
  if (appSettings.break_tracking_mode === 'BREAK_PUNCH') {
    document.getElementById('containerStandardPunch')?.classList.add('hidden');
    document.getElementById('containerBreakPunch')?.classList.remove('hidden');
    document.getElementById('todayBreakSummaryRow')?.classList.remove('hidden');
  }

  initLiveClock();
  await loadInitialData();
  restoreSavedEmployee();
  getCurrentLocation();
  
  // Initialize PWA Service Worker & Push Notification Handlers
  initServiceWorker().catch(() => {});
  checkNotificationBanner();
  updateNotifBadge();
  checkActiveBreakOnWake();
  checkBroadcastNotifications().catch(() => {});
  setInterval(checkBroadcastNotifications, 30000);
  if (currentEmployee) {
    loadMyRequests().catch(() => {});
  }
  
  // Preload face detection engine in background
  initFaceDetectionEngine().catch(() => {});
  window.addEventListener('mediapipe-loaded', () => {
    initFaceDetectionEngine().catch(() => {});
  });

  // Set default month for history
  const today = new Date().toISOString().substring(0, 10);
  const curMonth = today.substring(0, 7);
  const histPicker = document.getElementById('historyMonthPicker');
  if (histPicker) histPicker.value = curMonth;

  // Set default dates for forms
  const leaveStart = document.getElementById('leaveStartDate');
  const leaveEnd = document.getElementById('leaveEndDate');
  const otDate = document.getElementById('otDate');
  if (leaveStart) leaveStart.value = today;
  if (leaveEnd) leaveEnd.value = today;
  if (otDate) otDate.value = today;
});

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
    const res = await fetch(API_URL + '?action=getInitialData');
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

// ==============================================================================
// 2.1 APP ANNOUNCEMENT CONTROLLERS (GRAPHIC BANNER CARD - DESIGN 2)
// ==============================================================================
let activeAppAnnouncement = null;

function checkAppAnnouncement(announcement) {
  if (!announcement || announcement.active === false || announcement.active === 'false') {
    return;
  }

  activeAppAnnouncement = announcement;
  const annId = announcement.id || 'ann_default';
  const todayStr = new Date().toISOString().substring(0, 10);

  // Check if dismissed for today
  try {
    const dismissedRaw = localStorage.getItem('ptn_dismissed_announcement');
    if (dismissedRaw) {
      const dismissed = JSON.parse(dismissedRaw);
      if (dismissed && dismissed.id === annId && dismissed.date === todayStr) {
        return; // Don't show again today
      }
    }
  } catch(e) {}

  // Populate data into Graphic Banner Card
  const tagEl = document.getElementById('popupAnnTagText');
  if (tagEl) tagEl.textContent = announcement.tag || 'อัปเดตใหม่';

  const bannerTitleEl = document.getElementById('popupAnnBannerTitle');
  if (bannerTitleEl) bannerTitleEl.textContent = announcement.bannerTitle || 'PTN TIME GO LIVE!';

  const titleEl = document.getElementById('popupAnnTitle');
  if (titleEl) titleEl.textContent = announcement.title || 'ประกาศจากบริษัทฯ';

  const bodyEl = document.getElementById('popupAnnBody');
  if (bodyEl) bodyEl.textContent = announcement.body || '';

  const subnoteBox = document.getElementById('popupAnnSubnoteBox');
  const subnoteText = document.getElementById('popupAnnSubnoteText');
  if (subnoteBox && subnoteText) {
    if (announcement.subnote) {
      subnoteText.textContent = announcement.subnote;
      subnoteBox.classList.remove('hidden');
      subnoteBox.classList.add('flex');
    } else {
      subnoteBox.classList.add('hidden');
      subnoteBox.classList.remove('flex');
    }
  }

  // Reset checkbox
  const chk = document.getElementById('chkDontShowAnnouncement');
  if (chk) chk.checked = false;

  // Show modal with a short gentle delay (400ms)
  setTimeout(() => {
    const modal = document.getElementById('modalAppAnnouncement');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }, 400);
}

function closeAppAnnouncementModal() {
  const chk = document.getElementById('chkDontShowAnnouncement');
  if (chk && chk.checked && activeAppAnnouncement) {
    const annId = activeAppAnnouncement.id || 'ann_default';
    const todayStr = new Date().toISOString().substring(0, 10);
    try {
      localStorage.setItem('ptn_dismissed_announcement', JSON.stringify({ id: annId, date: todayStr }));
    } catch(e) {}
  }

  const modal = document.getElementById('modalAppAnnouncement');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function handleAppAnnouncementConfirm() {
  closeAppAnnouncementModal();
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

  const targetBranch = getCurrentEmployeeTargetBranch();
  const isRoaming = currentEmployee && (currentEmployee.allowAllBranches === true || currentEmployee.allow_all_branches === 'true');

  const startTime = targetBranch ? (targetBranch.work_start_time || appSettings.work_start_time) : appSettings.work_start_time;
  const endTime = targetBranch ? (targetBranch.work_end_time || appSettings.work_end_time) : appSettings.work_end_time;
  const lunchStart = targetBranch ? (targetBranch.lunch_start_time || appSettings.lunch_start_time) : appSettings.lunch_start_time;
  const lunchEnd = targetBranch ? (targetBranch.lunch_end_time || appSettings.lunch_end_time) : appSettings.lunch_end_time;
  const branchName = isRoaming ? `${targetBranch.branch_name} (Roaming)` : (targetBranch ? targetBranch.branch_name : 'สำนักงานใหญ่');

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

async function restoreSavedEmployee() {
  const saved = localStorage.getItem('ptn_time_emp');
  if (saved) {
    try {
      currentEmployee = JSON.parse(saved);
      const devId = getOrCreateDeviceId();
      // Verify with backend if device is still bound
      try {
        const res = await fetch(API_URL + '?action=checkDeviceBinding&empId=' + encodeURIComponent(currentEmployee.empId) + '&deviceId=' + encodeURIComponent(devId));
        const data = await res.json();
        if (data.success) {
          if (data.isResigned) {
            currentEmployee = null;
            isDeviceLocked = false;
            localStorage.removeItem('ptn_time_emp');
            updateHeaderEmployeeView();
            Swal.fire({
              icon: 'error',
              title: 'พ้นสภาพการเป็นพนักงาน',
              text: 'รหัสพนักงานนี้พ้นสภาพการเป็นพนักงานแล้ว (ลาออก)'
            });
            return;
          }
          if (data.isBound) {
            if (data.isThisDevice) {
              isDeviceLocked = true;
            } else {
              // Account bound to another device!
              currentEmployee = null;
              isDeviceLocked = false;
              localStorage.removeItem('ptn_time_emp');
              updateHeaderEmployeeView();
              Swal.fire({
                icon: 'warning',
                title: 'บัญชีถูกผูกกับเครื่องอื่น',
                text: 'บัญชีนี้ถูกผูกไว้กับอุปกรณ์เครื่องอื่นแล้ว หากต้องการใช้เครื่องนี้ กรุณาแจ้งหัวหน้างานเพื่อปลดล็อก'
              });
              setTimeout(openEmployeePickerModal, 600);
              return;
            }
          } else {
            // Unbound (e.g. remote reset by admin!)
            isDeviceLocked = false;
          }

          if (data.branchId) {
            currentEmployee.branchId = data.branchId;
            currentEmployee.allowAllBranches = data.allowAllBranches;
            try {
              localStorage.setItem('ptn_time_emp', JSON.stringify(currentEmployee));
            } catch(e) {}
          }
        }
      } catch(err) {
        // Offline or fallback, retain lock
        isDeviceLocked = true;
      }

      updateHeaderEmployeeView();
      loadTodayStatus();
      loadAdvanceEligibility();

      // Recalculate GPS location for this employee's branch
      if (currentLocation) {
        getCurrentLocation(true, false);
      }
    } catch(e) {}
  } else {
    setTimeout(openEmployeePickerModal, 500);
  }
}

function updateHeaderEmployeeView() {
  const btnText = document.getElementById('headerEmpName');
  const avatarEl = document.getElementById('headerEmpAvatar');
  const subEl = document.getElementById('headerEmpSub');
  const lockBadge = document.getElementById('headerLockBadge');
  const btnTagText = document.getElementById('headerEmpBtnText');
  const btnTagIcon = document.getElementById('headerEmpBtnIcon');

  const stepEmpName = document.getElementById('step1EmpName');
  const stepEmpId = document.getElementById('step1EmpId');
  const stepEmpAvatar = document.getElementById('step1EmpAvatar');
  const stepLockBadge = document.getElementById('step1LockBadge');
  const stepStatusIcon = document.getElementById('step1StatusIcon');

  if (btnText) {
    if (currentEmployee) {
      const nick = currentEmployee.nickname ? ` (${currentEmployee.nickname})` : '';
      btnText.textContent = `${currentEmployee.empId} ${currentEmployee.fullName}${nick}`;
      if (avatarEl) {
        if (currentEmployee.photoUrl) {
          avatarEl.innerHTML = `<img src="${currentEmployee.photoUrl}" alt="Avatar" class="w-full h-full object-cover rounded-xl">`;
        } else {
          const numPart = currentEmployee.empId.replace(/[^0-9]/g, '');
          avatarEl.textContent = numPart ? numPart.slice(-2) : 'PTN';
        }
      }

      const targetBranch = getCurrentEmployeeTargetBranch();
      const bTag = (currentEmployee.allowAllBranches === true || currentEmployee.allow_all_branches === 'true') 
        ? ' • ทุกสาขา (Roaming)' 
        : (targetBranch ? ` • ${targetBranch.branch_name}` : '');

      if (subEl) {
        subEl.textContent = (currentEmployee.department || 'พนักงาน') + bTag;
      }

      if (isDeviceLocked) {
        lockBadge?.classList.remove('hidden');
        if (btnTagText) btnTagText.textContent = 'ปลดล็อก';
        if (btnTagIcon) btnTagIcon.innerHTML = '<span class="text-xs">🔒</span>';
      } else {
        lockBadge?.classList.add('hidden');
        if (btnTagText) btnTagText.textContent = 'เปลี่ยน';
        if (btnTagIcon) btnTagIcon.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
      }
    } else {
      btnText.textContent = 'กรุณาแตะเพื่อเลือกรหัสพนักงาน';
      if (avatarEl) avatarEl.textContent = '⏱️';
      if (subEl) subEl.textContent = 'แตะเพื่อระบุตัวตนเข้าใช้งาน';
      lockBadge?.classList.add('hidden');
      if (btnTagText) btnTagText.textContent = 'เลือก';
      if (btnTagIcon) btnTagIcon.innerHTML = '<span class="text-xs">👉</span>';
    }
  }

  // Update Step 1 Employee Card
  if (stepEmpName) {
    if (currentEmployee) {
      const nick = currentEmployee.nickname ? ` (${currentEmployee.nickname})` : '';
      stepEmpName.textContent = `${currentEmployee.fullName}${nick}`;
      const targetBranch = getCurrentEmployeeTargetBranch();
      const bTag = (currentEmployee.allowAllBranches === true || currentEmployee.allow_all_branches === 'true') 
        ? ' • ทุกสาขา (Roaming)' 
        : (targetBranch ? ` • ${targetBranch.branch_name}` : '');
      if (stepEmpId) stepEmpId.textContent = `${currentEmployee.empId} • ${currentEmployee.department || 'พนักงาน'}${bTag}`;
      if (stepEmpAvatar) {
        if (currentEmployee.photoUrl) {
          stepEmpAvatar.innerHTML = `<img src="${currentEmployee.photoUrl}" alt="Avatar" class="w-full h-full object-cover rounded-xl">`;
        } else {
          const numPart = currentEmployee.empId.replace(/[^0-9]/g, '');
          stepEmpAvatar.textContent = numPart ? numPart.slice(-2) : '👤';
        }
      }
      if (isDeviceLocked) {
        stepLockBadge?.classList.remove('hidden');
      } else {
        stepLockBadge?.classList.add('hidden');
      }
      if (stepStatusIcon) stepStatusIcon.innerHTML = '✅';
    } else {
      stepEmpName.textContent = 'กรุณาแตะเลือกชื่อพนักงาน';
      if (stepEmpId) stepEmpId.textContent = 'ยังไม่ระบุ';
      if (stepEmpAvatar) stepEmpAvatar.textContent = '👤';
      stepLockBadge?.classList.add('hidden');
      if (stepStatusIcon) stepStatusIcon.innerHTML = '👉';
    }
  }

  // Refresh dynamic branch/shift display
  updateShiftDisplay();
}

// ==============================================================================
// 3. EMPLOYEE PICKER / LOGIN (AUTO-REMEMBER & INTERACTIVE SEARCH)
// ==============================================================================
let selectedPickerEmpId = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmployeeCards(filterText = '') {
  const container = document.getElementById('empCardsScrollArea');
  if (!container) return;

  const currentDevId = getOrCreateDeviceId();
  const search = String(filterText || '').trim().toLowerCase();

  const filtered = employeeList.filter(e => {
    if (!search) return true;
    const empId = String(e.empId || '').toLowerCase();
    const name = String(e.fullName || '').toLowerCase();
    const nick = String(e.nickname || '').toLowerCase();
    const dept = String(e.department || '').toLowerCase();
    return empId.includes(search) || name.includes(search) || nick.includes(search) || dept.includes(search);
  });

  if (employeeList.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-slate-500 text-xs flex flex-col items-center justify-center gap-2">
        <span class="animate-spin text-2xl">⏳</span>
        <span>กำลังโหลดรายชื่อพนักงานจากระบบ...</span>
        <button type="button" onclick="loadInitialData()" class="mt-2 px-3 py-1.5 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded-xl font-bold text-xs transition">
          🔄 กดเพื่อโหลดรายชื่อใหม่อีกครั้ง
        </button>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-6 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-1">
        <span class="text-xl">🔍</span>
        <span>ไม่พบพนักงานที่ตรงกับ "${escapeHtml(filterText)}"</span>
        <button type="button" onclick="clearEmployeeSearch()" class="mt-1 text-sky-600 font-bold hover:underline">
          ล้างคำค้นหา
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(e => {
    const isSelected = (selectedPickerEmpId === e.empId);
    const nick = e.nickname ? ` (${e.nickname})` : '';
    const bObj = branchList.find(b => b.branch_id === (e.branchId || e.branch_id));
    const branchName = (e.allowAllBranches === true || e.allow_all_branches === 'true')
      ? 'ทุกสาขา'
      : (bObj ? bObj.branch_name : 'สำนักงานใหญ่');

    // Device binding badge
    let deviceBadge = '';
    if (e.boundDevice && e.boundDevice.deviceId) {
      if (e.boundDevice.deviceId === currentDevId) {
        deviceBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-semibold border border-sky-200">📱 เครื่องนี้</span>`;
      } else {
        deviceBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold border border-amber-200">🔒 เครื่องอื่น</span>`;
      }
    } else {
      deviceBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200">พร้อมใช้งาน</span>`;
    }

    const cardClass = isSelected
      ? 'bg-sky-50 border-2 border-sky-500 shadow-sm ring-2 ring-sky-200'
      : 'bg-slate-50/80 hover:bg-slate-100/90 border border-slate-200';

    html += `
      <div onclick="selectEmployeeCard('${escapeHtml(e.empId)}')" class="p-2.5 rounded-2xl cursor-pointer transition-all active:scale-[0.98] flex items-center justify-between ${cardClass}">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${isSelected ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'}">
            ${isSelected ? '✓' : (e.photoUrl ? `<img src="${e.photoUrl}" class="w-full h-full rounded-xl object-cover">` : e.empId.replace(/[^0-9]/g, ''))}
          </div>
          <div class="min-w-0">
            <div class="text-xs md:text-sm font-bold text-slate-800 truncate flex items-center gap-1">
              <span>[${escapeHtml(e.empId)}] ${escapeHtml(e.fullName)}${escapeHtml(nick)}</span>
            </div>
            <div class="text-[11px] text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
              <span>${escapeHtml(e.department || 'พนักงาน')}</span>
              <span class="text-slate-300">•</span>
              <span class="text-sky-700 font-medium">${escapeHtml(branchName)}</span>
            </div>
          </div>
        </div>
        <div class="flex-shrink-0 ml-2 flex flex-col items-end gap-1">
          ${deviceBadge}
          ${(e.isOtEligible === false || e.is_ot_eligible === 'false') ? `<span class="text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 font-medium">เหมาจ่าย (ไม่มี OT)</span>` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function selectEmployeeCard(empId) {
  selectedPickerEmpId = empId;
  const sel = document.getElementById('empSelectDropdown');
  if (sel) sel.value = empId;

  const found = employeeList.find(e => e.empId === empId);
  const banner = document.getElementById('selectedEmpBanner');
  const nameEl = document.getElementById('selectedEmpName');
  const deptEl = document.getElementById('selectedEmpDept');
  const avatarEl = document.getElementById('selectedEmpAvatar');
  const pinSec = document.getElementById('pinEntrySection');

  if (found) {
    if (nameEl) nameEl.textContent = `[${found.empId}] ${found.fullName}${found.nickname ? ` (${found.nickname})` : ''}`;
    if (deptEl) deptEl.textContent = `${found.department || 'พนักงาน'} • กรอกรหัสยืนยันด้านล่าง`;
    if (avatarEl) avatarEl.textContent = '✓';
    banner?.classList.remove('hidden');
    pinSec?.classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('empPinInput')?.focus();
    }, 150);
  } else {
    banner?.classList.add('hidden');
    pinSec?.classList.add('hidden');
  }

  // Re-render cards to show active selection highlight
  const search = document.getElementById('empSearchInput')?.value || '';
  renderEmployeeCards(search);
}

function resetSelectedEmployee() {
  selectedPickerEmpId = null;
  const sel = document.getElementById('empSelectDropdown');
  if (sel) sel.value = '';
  document.getElementById('selectedEmpBanner')?.classList.add('hidden');
  document.getElementById('pinEntrySection')?.classList.add('hidden');
  const pinInput = document.getElementById('empPinInput');
  if (pinInput) pinInput.value = '';
  const search = document.getElementById('empSearchInput')?.value || '';
  renderEmployeeCards(search);
}

function filterEmployeePicker(val) {
  const clearBtn = document.getElementById('btnClearEmpSearch');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !val);
  }
  renderEmployeeCards(val);
}

function clearEmployeeSearch() {
  const input = document.getElementById('empSearchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  const clearBtn = document.getElementById('btnClearEmpSearch');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderEmployeeCards('');
}

function populateEmployeeDropdown() {
  const sel = document.getElementById('empSelectDropdown');
  if (sel) {
    sel.innerHTML = '<option value="">-- กรุณาเลือกพนักงาน --</option>';
    employeeList.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.empId;
      const nick = e.nickname ? ` (${e.nickname})` : '';
      const bObj = branchList.find(b => b.branch_id === (e.branchId || e.branch_id));
      const bTag = (e.allowAllBranches === true || e.allow_all_branches === 'true')
        ? ' [ทุกสาขา]'
        : (bObj ? ` [${bObj.branch_name}]` : '');
      opt.textContent = `[${e.empId}] ${e.fullName}${nick} - ${e.department || 'พนักงาน'}${bTag}`;
      sel.appendChild(opt);
    });
  }

  // Always refresh card list
  const search = document.getElementById('empSearchInput')?.value || '';
  renderEmployeeCards(search);
}

function handleHeaderEmployeeCardClick() {
  if (isDeviceLocked) {
    openDeviceUnlockModal();
  } else {
    openEmployeePickerModal();
  }
}

function openEmployeePickerModal() {
  document.getElementById('modalEmployeePicker')?.classList.remove('hidden');

  // Pre-select current employee if available
  if (currentEmployee && currentEmployee.empId) {
    selectedPickerEmpId = currentEmployee.empId;
  }

  // Clear search on open
  const searchInput = document.getElementById('empSearchInput');
  if (searchInput) {
    searchInput.value = '';
    document.getElementById('btnClearEmpSearch')?.classList.add('hidden');
  }

  renderEmployeeCards('');

  if (selectedPickerEmpId) {
    selectEmployeeCard(selectedPickerEmpId);
  } else {
    resetSelectedEmployee();
  }

  // Sync latest employees from D1 in real-time
  loadInitialData();
}

function closeEmployeePickerModal() {
  document.getElementById('modalEmployeePicker')?.classList.add('hidden');
}

function onSelectEmployeeDropdown(val) {
  if (val) {
    selectEmployeeCard(val);
  } else {
    resetSelectedEmployee();
  }
}

async function confirmEmployeeLogin() {
  const sel = document.getElementById('empSelectDropdown');
  const pinInput = document.getElementById('empPinInput');
  const empId = sel?.value || selectedPickerEmpId;
  const pin = pinInput ? pinInput.value.trim() : '';
  const deviceId = getOrCreateDeviceId();

  if (!empId) {
    Swal.fire('กรุณาเลือกพนักงาน', '', 'warning');
    return;
  }

  if (!pin) {
    Swal.fire('กรุณากรอกรหัสยืนยันตัวตน', 'ใช้เลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์', 'warning');
    return;
  }

  if (pin === '1234') {
    Swal.fire('รหัสไม่ถูกต้อง', 'รหัส 1234 ถูกยกเลิกแล้ว กรุณากรอกเลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์', 'error');
    return;
  }

  Swal.fire({ title: 'กำลังยืนยันตัวตน...', didOpen: () => Swal.showLoading() });

  try {
    // 1. Employee Login verification
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'employeeLogin',
        empId,
        pin
      })
    });
    const data = await res.json();
    if (!data.success) {
      Swal.fire('เข้าใช้งานไม่สำเร็จ', data.message || 'รหัสยืนยันไม่ถูกต้อง', 'error');
      return;
    }

    // 2. Bind Device (Device Lock)
    const bindRes = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bindDevice',
        empId,
        deviceId,
        deviceName: navigator.userAgent.indexOf('iPhone') !== -1 ? 'iPhone' : (navigator.userAgent.indexOf('Android') !== -1 ? 'Android' : 'Web Browser')
      })
    });
    const bindData = await bindRes.json();

    if (!bindData.success && bindData.code === 'BOUND_TO_OTHER_DEVICE') {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถเลือกผู้ใช้นี้ได้',
        html: `
          <div class="text-xs text-slate-600 text-left space-y-2">
            <p class="font-bold text-rose-700">${bindData.message}</p>
            <p>เพื่อความถูกต้องของเวลาทำงาน พนักงานแต่ละท่านจะถูกผูกไว้กับเครื่องประจำตัว หากทำเครื่องหายหรือเปลี่ยนเครื่องใหม่ กรุณาติดต่อหัวหน้างานเพื่อปลดล็อก</p>
          </div>
        `
      });
      return;
    }

    // Success
    currentEmployee = data.employee;
    isDeviceLocked = true;
    localStorage.setItem('ptn_time_emp', JSON.stringify(currentEmployee));
    updateHeaderEmployeeView();
    closeEmployeePickerModal();
    loadTodayStatus();
    loadAdvanceEligibility();

    // Recalculate GPS location for this employee's branch
    getCurrentLocation(true, false);

    Swal.fire({
      icon: 'success',
      title: `ผูกอุปกรณ์สำเร็จ!`,
      text: `${currentEmployee.fullName} (${currentEmployee.empId}) ระบบได้ล็อกเครื่องนี้ไว้กับคุณเรียบร้อยแล้ว`,
      timer: 2000,
      showConfirmButton: false
    });
  } catch(e) {
    const found = employeeList.find(x => x.empId === empId);
    if (found) {
      currentEmployee = found;
      isDeviceLocked = true;
      localStorage.setItem('ptn_time_emp', JSON.stringify(currentEmployee));
      updateHeaderEmployeeView();
      closeEmployeePickerModal();
      loadTodayStatus();
      loadAdvanceEligibility();
      getCurrentLocation(true, false);
    }
  }
}

// ==============================================================================
// 4. GEOLOCATION & GEOFENCING
// ==============================================================================
function calculateHaversineMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ/2)*Math.sin(Δφ/2) + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)*Math.sin(Δλ/2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function refreshGpsLocation() {
  const icon = document.getElementById('iconRefreshGps');
  if (icon) icon.classList.add('animate-spin');
  getCurrentLocation(false, true);
}

function getCurrentLocation(silent = false, isManual = false) {
  const statusText = document.getElementById('gpsStatusText');
  const distText = document.getElementById('gpsDistanceText');
  const badge = document.getElementById('gpsBadge');
  const pulse = document.getElementById('gpsPulseDot');
  const icon = document.getElementById('iconRefreshGps');

  if (!navigator.geolocation) {
    if (icon) icon.classList.remove('animate-spin');
    if (statusText) statusText.textContent = 'เบราว์เซอร์ไม่รองรับ GPS';
    if (isManual) {
      Swal.fire({
        icon: 'error',
        title: 'ไม่รองรับ GPS',
        text: 'เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับระบบพิกัด Geolocation'
      });
    }
    return;
  }

  if (statusText) statusText.textContent = 'กำลังค้นหาพิกัด GPS...';
  if (distText && isManual) distText.textContent = 'กำลังคำนวณระยะห่างล่าสุด...';
  if (badge && isManual) {
    badge.className = 'px-3.5 py-1.5 rounded-xl text-xs md:text-sm font-black bg-slate-200 text-slate-700 border border-slate-300';
    badge.textContent = 'กำลังตรวจพิกัด...';
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (icon) icon.classList.remove('animate-spin');
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      currentLocation = { lat, lng, accuracy: pos.coords.accuracy };

      const targetBranch = getCurrentEmployeeTargetBranch();
      const targetLat = targetBranch.lat || appSettings.office_lat;
      const targetLng = targetBranch.lng || appSettings.office_lng;
      const targetRadius = targetBranch.radius_meters || appSettings.geofence_radius_meters || 200;
      const targetBranchName = targetBranch.branch_name || 'สำนักงานใหญ่';

      const dist = calculateHaversineMeters(lat, lng, targetLat, targetLng);
      currentDistanceMeters = dist;

      const isInside = dist <= targetRadius;

      if (statusText) statusText.textContent = `พิกัด GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (distText) distText.textContent = `ห่างจาก${targetBranchName}: ${dist} ม. (รัศมีอนุญาต ${targetRadius} ม.)`;

      if (badge && pulse) {
        if (isInside) {
          badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700';
          badge.textContent = `🟢 อยู่ในพื้นที่ ${targetBranchName}`;
          pulse.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping';
        } else {
          badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-100 text-rose-700';
          badge.textContent = `🔴 อยู่นอกพื้นที่ ${targetBranchName}`;
          pulse.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
        }
      }

      if (isManual) {
        const Toast = Swal.mixin({
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2500,
          timerProgressBar: false
        });
        Toast.fire({
          icon: isInside ? 'success' : 'warning',
          title: isInside ? `อยู่ในพื้นที่ ${targetBranchName}` : `อยู่นอกพื้นที่ ${targetBranchName} (${dist} ม.)`
        });
      }
    },
    (err) => {
      if (icon) icon.classList.remove('animate-spin');
      console.warn('Geolocation notice:', err.message);
      if (statusText) statusText.textContent = 'ไม่พบพิกัด (กรุณาเปิด GPS/อนุญาตเข้าถึงตำแหน่ง)';
      if (badge) {
        badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-700';
        badge.textContent = '⚠️ GPS ปิดอยู่';
      }
      if (isManual) {
        Swal.fire({
          icon: 'warning',
          title: 'ไม่สามารถอ่านพิกัด GPS ได้',
          text: 'กรุณาเปิด Location Service (GPS) บนมือถือ หรือกดอนุญาตให้เบราว์เซอร์เข้าถึงตำแหน่ง แล้วลองใหม่อีกครั้ง'
        });
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ==============================================================================
// 5. FULLSCREEN SELFIE CAMERA & AI FACE DETECTION SYSTEM
// ==============================================================================
let fsCameraStream = null;
let currentCameraFacing = 'user'; // 'user' (front) or 'environment' (back)
let activePendingClock = null; // { type: 'IN' | 'OUT', qrToken: string | null }

// Face Detection Engine State
let faceDetectorEngine = null; // Native FaceDetector or MediaPipe FaceDetector
let isInitializingFaceEngine = false;
let faceDetectionTimer = null;
let faceDetectionFallbackTimer = null;
let isFaceDetected = false;
let isFaceDetectionFallbackActive = false;
let faceConsecutiveLossCount = 0;
let faceConsecutiveErrorCount = 0;
let offscreenFaceCanvas = null;
let offscreenFaceCtx = null;

async function initFaceDetectionEngine() {
  if (faceDetectorEngine) return faceDetectorEngine;
  if (isInitializingFaceEngine) return null;
  isInitializingFaceEngine = true;

  try {
    // 1. Try Native Hardware FaceDetector API (Chrome / Android / Chromium)
    if ('FaceDetector' in window) {
      try {
        const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
        faceDetectorEngine = { type: 'native', detector };
        console.log('PTN Time: Hardware Native FaceDetector initialized');
        isInitializingFaceEngine = false;
        return faceDetectorEngine;
      } catch (nativeErr) {
        console.warn('Native FaceDetector init error, trying MediaPipe fallback:', nativeErr);
      }
    }

    // 2. Try Google MediaPipe Tasks Vision (iOS Safari / Cross-browser)
    if (window.MediaPipeFaceTasks) {
      const { FilesetResolver, FaceDetector } = window.MediaPipeFaceTasks;
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      const detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          delegate: "CPU" // Use CPU for rock-solid stability and prevent WebGL texture crashes on mobile
        },
        runningMode: "IMAGE"
      });
      faceDetectorEngine = { type: 'mediapipe', detector };
      console.log('PTN Time: Google MediaPipe FaceDetector (CPU) initialized');
      isInitializingFaceEngine = false;
      return faceDetectorEngine;
    }
  } catch (err) {
    console.warn('Face detection model init note:', err);
  }

  isInitializingFaceEngine = false;
  return null;
}

function setFaceDetectionUIState(found, isFallback = false) {
  isFaceDetected = found;
  const oval = document.getElementById('camFaceOval');
  const topHint = document.getElementById('camGuideTopHint');
  const shutterBtn = document.getElementById('btnShutterTrigger');
  const shutterHint = document.getElementById('camShutterHintText');

  const OVAL_SIZE = 'w-[295px] h-[400px] sm:w-[335px] sm:h-[450px] md:w-[375px] md:h-[490px]';

  // Strict Real-Time: Only unlock shutter if face is actually present OR if fallback is active
  if (found || (isFallback && isFaceDetectionFallbackActive)) {
    if (shutterBtn) {
      shutterBtn.disabled = false;
      shutterBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      shutterBtn.classList.add('cursor-pointer');
    }

    if (isFallback || isFaceDetectionFallbackActive) {
      if (oval) {
        oval.className = `pointer-events-none relative z-10 ${OVAL_SIZE} rounded-[50%] border-3 border-dashed border-sky-400 face-guide-oval flex flex-col items-center justify-between py-6 transition-all duration-300`;
      }
      if (topHint) {
        topHint.className = 'text-white text-xs md:text-sm font-bold drop-shadow bg-sky-600/90 border border-sky-300 px-4 py-1.5 rounded-full backdrop-blur-md transition-all duration-200 shadow-md';
        topHint.innerHTML = '📸 ปลดล็อกชัตเตอร์ (ระบบสำรอง)';
      }
      if (shutterHint) {
        shutterHint.className = 'text-xs text-sky-200 font-bold tracking-wider drop-shadow transition-colors';
        shutterHint.innerHTML = 'พร้อมบันทึกภาพ — แตะปุ่มชัตเตอร์ได้เลย';
      }
    } else {
      if (oval) {
        oval.className = `pointer-events-none relative z-10 ${OVAL_SIZE} rounded-[50%] border-4 border-solid border-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.85)] face-guide-oval flex flex-col items-center justify-between py-6 transition-all duration-300 animate-pulse`;
      }
      if (topHint) {
        topHint.className = 'text-white text-xs md:text-sm font-bold drop-shadow bg-emerald-600/90 border border-emerald-300 px-4 py-1.5 rounded-full backdrop-blur-md transition-all duration-200 shadow-lg';
        topHint.innerHTML = '✅ ตรวจพบใบหน้าเรียบร้อย';
      }
      if (shutterHint) {
        shutterHint.className = 'text-xs text-emerald-300 font-bold tracking-wider drop-shadow transition-colors';
        shutterHint.innerHTML = '✨ พร้อมบันทึกภาพ — แตะปุ่มชัตเตอร์ได้เลย';
      }
    }
  } else {
    // Face absent: IMMEDIATELY lock shutter and turn oval amber
    if (oval) {
      oval.className = `pointer-events-none relative z-10 ${OVAL_SIZE} rounded-[50%] border-2.5 border-dashed border-amber-400 face-guide-oval flex flex-col items-center justify-between py-6 transition-all duration-300`;
    }
    if (topHint) {
      topHint.className = 'text-white text-xs md:text-sm font-bold drop-shadow bg-amber-600/90 border border-amber-300 px-4 py-1.5 rounded-full backdrop-blur-md transition-all duration-200 shadow-md';
      topHint.innerHTML = '🔍 ส่องใบหน้าให้อยู่ในกรอบ...';
    }
    if (shutterBtn) {
      shutterBtn.disabled = true;
      shutterBtn.classList.add('opacity-40', 'cursor-not-allowed');
      shutterBtn.classList.remove('cursor-pointer');
    }
    if (shutterHint) {
      shutterHint.className = 'text-xs text-amber-200 font-bold tracking-wider drop-shadow transition-colors';
      shutterHint.innerHTML = '⚠️ ส่องใบหน้าให้อยู่ในกรอบเพื่อปลดล็อกชัตเตอร์';
    }
  }
}

function enableFaceDetectionFallback() {
  if (isFaceDetected && !isFaceDetectionFallbackActive) return;
  isFaceDetectionFallbackActive = true;
  setFaceDetectionUIState(true, true);
}

// Reusable single-frame face detection helper (Fast 320x240 offscreen canvas)
async function detectFaceInVideo(video) {
  if (!video || video.readyState < 2) return false;
  if (!faceDetectorEngine) {
    await initFaceDetectionEngine();
  }
  if (!faceDetectorEngine) return false;

  if (!offscreenFaceCanvas) {
    offscreenFaceCanvas = document.createElement('canvas');
    offscreenFaceCanvas.width = 320;
    offscreenFaceCanvas.height = 240;
    offscreenFaceCtx = offscreenFaceCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    offscreenFaceCtx.drawImage(video, 0, 0, 320, 240);
  }

  const minFaceDimension = 24; // 10% of 240, captures face accurately
  let detected = false;

  if (faceDetectorEngine.type === 'native') {
    try {
      const faces = await faceDetectorEngine.detector.detect(offscreenFaceCanvas);
      if (faces && faces.length > 0) {
        for (const f of faces) {
          const box = f.boundingBox;
          if (box && box.width >= minFaceDimension && box.height >= minFaceDimension) {
            detected = true;
            break;
          }
        }
      }
    } catch (nativeErr) {
      console.warn('Native FaceDetector error:', nativeErr);
      faceDetectorEngine = null;
    }
  } else if (faceDetectorEngine.type === 'mediapipe') {
    try {
      const result = faceDetectorEngine.detector.detect(offscreenFaceCanvas);
      if (result && result.detections && result.detections.length > 0) {
        for (const d of result.detections) {
          const box = d.boundingBox;
          if (box && box.width >= minFaceDimension && box.height >= minFaceDimension) {
            detected = true;
            break;
          }
        }
      }
    } catch (mpErr) {
      console.warn('MediaPipe detection error:', mpErr);
    }
  }

  return detected;
}

function startFaceDetectionLoop() {
  stopFaceDetectionLoop();

  const video = document.getElementById('fsVideoPreview');
  if (!video) return;

  const runDetection = async () => {
    if (!fsCameraStream || video.ended) {
      faceDetectionTimer = setTimeout(runDetection, 250);
      return;
    }

    if (video.paused) {
      try {
        await video.play();
        document.getElementById('camLoadingSpinner')?.classList.add('hidden');
      } catch(e) {}
      faceDetectionTimer = setTimeout(runDetection, 250);
      return;
    }

    if (video.readyState < 2) {
      faceDetectionTimer = setTimeout(runDetection, 150);
      return;
    }

    // If disabled via Admin settings, skip detection and unlock shutter immediately
    if (appSettings.enable_face_detection === 'false') {
      setFaceDetectionUIState(true, false);
      return;
    }

    try {
      const detected = await detectFaceInVideo(video);

      if (detected) {
        faceConsecutiveLossCount = 0;
        faceConsecutiveErrorCount = 0;
        setFaceDetectionUIState(true, false);
      } else {
        faceConsecutiveLossCount++;
        // Strict Real-Time: allow only 1 missed tick (~200ms for natural blink), then immediately lock
        if (!isFaceDetectionFallbackActive && faceConsecutiveLossCount >= 2) {
          setFaceDetectionUIState(false, false);
        }
      }
    } catch (e) {
      console.warn('Face detection cycle note:', e);
      faceConsecutiveErrorCount++;
      if (faceConsecutiveErrorCount >= 5 && !faceDetectorEngine) {
        enableFaceDetectionFallback();
      }
    }

    faceDetectionTimer = setTimeout(runDetection, 200);
  };

  runDetection();
}

function stopFaceDetectionLoop() {
  if (faceDetectionTimer) {
    clearTimeout(faceDetectionTimer);
    faceDetectionTimer = null;
  }
  if (faceDetectionFallbackTimer) {
    clearTimeout(faceDetectionFallbackTimer);
    faceDetectionFallbackTimer = null;
  }
}

async function openFullscreenCamera(type, qrToken) {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  // Geofence check before opening camera
  if (!currentLocation) {
    getCurrentLocation();
    Swal.fire({
      icon: 'info',
      title: 'กำลังตรวจสอบพิกัด GPS',
      text: 'กรุณารอสักครู่เพื่อให้ระบบตรวจพิกัดสาขา แล้วกดใหม่อีกครั้ง'
    });
    return;
  }

  const targetBranch = getCurrentEmployeeTargetBranch();
  const maxRadius = targetBranch.radius_meters || appSettings.geofence_radius_meters || 200;
  const branchName = targetBranch.branch_name || 'สำนักงาน';

  if (currentDistanceMeters > maxRadius && appSettings.allow_outside_clockin !== 'true') {
    Swal.fire({
      icon: 'error',
      title: `อยู่นอกพื้นที่ ${branchName}`,
      text: `คุณอยู่ห่างจาก ${branchName} ${currentDistanceMeters} เมตร (อนุญาตไม่เกิน ${maxRadius} ม.)`
    });
    return;
  }

  activePendingClock = { type, qrToken };

  const modal = document.getElementById('modalCameraFullscreen');
  const titleEl = document.getElementById('camModalTitle');
  const subEl = document.getElementById('camModalSubtitle');

  if (titleEl) {
    if (type === 'IN') {
      titleEl.textContent = '📸 ถ่ายรูปเซลฟี่เข้างาน (IN)';
    } else if (type === 'BREAK_OUT') {
      titleEl.textContent = '☕ ถ่ายรูปเซลฟี่ออกไปพัก (Break OUT)';
    } else if (type === 'BREAK_IN') {
      titleEl.textContent = '💼 ถ่ายรูปเซลฟี่กลับเข้าทำงาน (Break IN)';
    } else {
      titleEl.textContent = '📸 ถ่ายรูปเซลฟี่ออกงาน (OUT)';
    }
  }
  if (subEl) {
    subEl.textContent = qrToken ? 'สแกน QR สำเร็จ! จัดใบหน้าในกรอบ แล้วกดปุ่มถ่ายรูป' : 'จัดใบหน้าในกรอบ แล้วกดปุ่มถ่ายรูปเพื่อลงเวลา';
  }

  // Reset face & submit state
  isClockSubmitting = false;
  isFaceDetected = false;
  isFaceDetectionFallbackActive = false;
  faceConsecutiveLossCount = 0;
  faceConsecutiveErrorCount = 0;

  const shutterBtn = document.getElementById('fsShutterBtn');
  if (shutterBtn) {
    shutterBtn.disabled = false;
    shutterBtn.style.opacity = '1';
    shutterBtn.style.pointerEvents = 'auto';
  }

  modal?.classList.remove('hidden');

  // Add click/tap to resume video playback if mobile browser delayed autoplay
  const viewport = document.getElementById('camViewportContainer');
  if (viewport && !viewport._hasPlayListener) {
    viewport._hasPlayListener = true;
    const resumePlay = () => {
      const vid = document.getElementById('fsVideoPreview');
      if (vid && vid.paused && fsCameraStream) {
        vid.play().then(() => {
          document.getElementById('camLoadingSpinner')?.classList.add('hidden');
        }).catch(() => {});
      }
    };
    viewport.addEventListener('click', resumePlay);
    viewport.addEventListener('touchstart', resumePlay, { passive: true });
  }

  await initFullscreenCameraStream();

  // Setup Detection or Direct Unlock based on settings
  if (appSettings.enable_face_detection === 'false') {
    setFaceDetectionUIState(true, false);
  } else {
    setFaceDetectionUIState(false, false);
    // Graceful fallback timer ONLY if AI engine completely failed to initialize after 8 seconds
    faceDetectionFallbackTimer = setTimeout(() => {
      if (!isFaceDetected && !faceDetectorEngine) {
        enableFaceDetectionFallback();
      }
    }, 8000);
    startFaceDetectionLoop();
  }
}

async function getCameraStreamWithFallback(facing) {
  const constraintsTier1 = {
    video: {
      facingMode: facing ? { ideal: facing } : 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  const tryAcquire = async (constraints) => {
    // Retry up to 3 times if previous camera session was literally just stopped
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        const isBusy = (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.name === 'AbortError');
        if (isBusy && attempt < 2) {
          console.warn(`Camera hardware releasing previous session (attempt ${attempt + 1}), waiting 300ms...`);
          await new Promise(r => setTimeout(r, 300));
        } else {
          throw err;
        }
      }
    }
  };

  try {
    return await tryAcquire(constraintsTier1);
  } catch (e1) {
    console.warn('Camera constraints Tier 1 failed:', e1);
    try {
      return await tryAcquire({
        video: { facingMode: facing ? { ideal: facing } : 'user' },
        audio: false
      });
    } catch (e2) {
      console.warn('Camera constraints Tier 2 failed:', e2);
      return await tryAcquire({ video: true, audio: false });
    }
  }
}

async function initFullscreenCameraStream() {
  const video = document.getElementById('fsVideoPreview');
  const spinner = document.getElementById('camLoadingSpinner');
  if (!video) return;

  if (spinner) spinner.classList.remove('hidden');

  try {
    // 1. Thoroughly terminate previous tracks if any
    if (fsCameraStream) {
      fsCameraStream.getTracks().forEach(t => {
        try { 
          t.stop();
          t.enabled = false;
        } catch(e) {}
      });
      fsCameraStream = null;
      await new Promise(r => setTimeout(r, 150));
    }

    // 2. Reset Video Element Media Engine (Crucial for 2nd+ times in Safari/Chrome!)
    try { video.pause(); } catch(e) {}
    video.onloadedmetadata = null;
    video.oncanplay = null;
    video.onloadeddata = null;
    video.srcObject = null;
    video.removeAttribute('src');
    try { video.load(); } catch(e) {}

    // 3. Acquire Stream with Multi-tier & Hardware Release Retry
    fsCameraStream = await getCameraStreamWithFallback(currentCameraFacing);

    // 4. Critical DOM properties for iOS Safari / Android WebKit to render video stream inline
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('autoplay', 'true');

    video.srcObject = fsCameraStream;

    // 5. Trigger video playback and hide loading spinner
    const startPlayback = async () => {
      try {
        await video.play();
        if (spinner) spinner.classList.add('hidden');
      } catch (playErr) {
        console.warn('Video playback deferred by browser:', playErr);
      }
    };

    video.onloadedmetadata = startPlayback;
    video.oncanplay = startPlayback;
    video.onloadeddata = startPlayback;
    startPlayback();

    if (currentCameraFacing === 'user') {
      video.classList.add('cam-video-mirrored');
      video.classList.remove('cam-video-normal');
    } else {
      video.classList.add('cam-video-normal');
      video.classList.remove('cam-video-mirrored');
    }
  } catch (err) {
    console.error('Camera access error:', err);
    if (spinner) spinner.classList.add('hidden');
    closeFullscreenCamera();
    Swal.fire({
      icon: 'warning',
      title: 'ไม่สามารถเปิดกล้องได้',
      text: 'กรุณาอนุญาตให้เบราว์เซอร์เข้าถึงกล้องหน้า และตรวจสอบว่าไม่มีแอปอื่นเปิดใช้งานกล้องอยู่'
    });
  }
}

function toggleCameraFacing() {
  currentCameraFacing = (currentCameraFacing === 'user') ? 'environment' : 'user';
  initFullscreenCameraStream();
}

function closeFullscreenCamera() {
  stopFaceDetectionLoop();

  const modal = document.getElementById('modalCameraFullscreen');
  modal?.classList.add('hidden');

  const spinner = document.getElementById('camLoadingSpinner');
  if (spinner) spinner.classList.add('hidden');

  const video = document.getElementById('fsVideoPreview');
  if (video) {
    try { video.pause(); } catch(e) {}
    video.onloadedmetadata = null;
    video.oncanplay = null;
    video.onloadeddata = null;
    video.srcObject = null;
    video.removeAttribute('src');
    try { video.load(); } catch(e) {}
  }

  if (fsCameraStream) {
    fsCameraStream.getTracks().forEach(t => {
      try { 
        t.stop();
        t.enabled = false;
      } catch(e) {}
    });
    fsCameraStream = null;
  }
  activePendingClock = null;
  isFaceDetected = false;
  isFaceDetectionFallbackActive = false;
}

function drawCanvasRoundRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function drawAttendanceWatermark(ctx, width, height, clockType) {
  const bannerH = 140;
  const startY = height - bannerH;

  // 1. Dark Gradient Background from transparent to 95% opacity
  const grad = ctx.createLinearGradient(0, startY - 20, 0, height);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.3, 'rgba(15, 23, 42, 0.80)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0.96)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, startY - 20, width, bannerH + 20);

  // 2. Action Badge Info
  let badgeText = 'เข้างาน (IN)';
  let badgeColor = '#10b981'; // Emerald
  if (clockType === 'OUT') {
    badgeText = 'ออกงาน (OUT)';
    badgeColor = '#ef4444'; // Rose
  } else if (clockType === 'BREAK_OUT') {
    badgeText = 'พักเบรก (BREAK OUT)';
    badgeColor = '#f59e0b'; // Amber
  } else if (clockType === 'BREAK_IN') {
    badgeText = 'กลับเข้างาน (BREAK IN)';
    badgeColor = '#06b6d4'; // Cyan
  }

  // 3. Date & Time String
  const now = new Date();
  const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const day = now.getDate();
  const mon = thMonths[now.getMonth()];
  const yr = now.getFullYear() + 543;
  const hr = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  const dateStr = `${day} ${mon} ${yr}`;
  const timeStr = `${hr}:${min}:${sec} น.`;

  // 4. Employee & Location Info
  const empName = currentEmployee ? (currentEmployee.full_name || currentEmployee.empId) : 'พนักงาน';
  const empId = currentEmployee ? currentEmployee.empId : '';
  const empDisplay = empId ? `${empName} • ${empId}` : empName;

  const targetBranch = (typeof getCurrentEmployeeTargetBranch === 'function') ? getCurrentEmployeeTargetBranch() : null;
  const branchName = targetBranch ? (targetBranch.branch_name || targetBranch.branch_id || 'สำนักงานใหญ่') : 'สำนักงานใหญ่';

  let distText = '';
  if (currentDistanceMeters !== null && currentDistanceMeters !== undefined) {
    distText = `ห่าง ${Math.round(currentDistanceMeters)} ม.`;
  }
  const branchDisplay = `🏢 สาขา: ${branchName}${distText ? ' (' + distText + ')' : ''}`;

  let gpsDisplay = '📍 GPS: ไม่พบพิกัดดาวเทียม';
  if (currentLocation && currentLocation.lat && currentLocation.lng) {
    gpsDisplay = `📍 GPS: ${Number(currentLocation.lat).toFixed(6)}, ${Number(currentLocation.lng).toFixed(6)}`;
  }

  ctx.save();

  // Draw Badge Pill
  const fontSans = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.font = `bold 12px ${fontSans}`;
  const badgeTextWidth = ctx.measureText(badgeText).width;
  const badgeW = badgeTextWidth + 24;
  const badgeH = 22;
  const badgeX = 14;
  const badgeY = startY + 6;

  ctx.fillStyle = badgeColor;
  drawCanvasRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 11);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(badgeText, badgeX + 12, badgeY + 15);

  // Timestamp next to badge
  ctx.font = `bold 12.5px ${fontSans}`;
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`📅 ${dateStr} • ${timeStr}`, badgeX + badgeW + 10, badgeY + 16);

  // Line 2: Employee Name
  ctx.font = `bold 15px ${fontSans}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`👤 ${empDisplay}`, 16, startY + 52);

  // Line 3: Branch & Distance
  ctx.font = `12px ${fontSans}`;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(branchDisplay, 16, startY + 74);

  // Line 4: GPS Coordinates
  ctx.font = 'bold 12.5px "Courier New", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(gpsDisplay, 16, startY + 97);

  // Line 5: Verification text & Brand
  ctx.font = `10.5px ${fontSans}`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('✓ ยืนยันพิกัดผ่านระบบ PTN Time Attendant', 16, startY + 118);

  ctx.font = `bold 11px ${fontSans}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillText('PTN TIME', width - 70, startY + 118);

  ctx.restore();
}

async function triggerShutterCapture() {
  if (isClockSubmitting) return;

  const video = document.getElementById('fsVideoPreview');
  const canvas = document.getElementById('fsPhotoCanvas');
  const flash = document.getElementById('camFlashOverlay');

  if (!video || !canvas || !activePendingClock) return;

  // 0. Pre-Shutter Real-Time AI Verification: Strictly ensure face is present at the exact instant of shutter press!
  if (appSettings.enable_face_detection !== 'false' && !isFaceDetectionFallbackActive) {
    if (!isFaceDetected) {
      Swal.fire({
        icon: 'warning',
        title: 'ยังไม่พบใบหน้าในกรอบ',
        text: 'กรุณาขยับใบหน้าให้อยู่กึ่งกลางกรอบวงรีให้ชัดเจนก่อนกดถ่ายรูป',
        timer: 1800,
        showConfirmButton: false
      });
      return;
    }

    // Instant verification on the current live video frame
    const liveFacePresent = await detectFaceInVideo(video);
    if (!liveFacePresent) {
      setFaceDetectionUIState(false, false);
      Swal.fire({
        icon: 'warning',
        title: 'ไม่พบใบหน้าขณะกดถ่ายรูป',
        text: 'กรุณาหันหน้ามองกล้องให้อยู่ในกรอบวงรี แล้วลองกดถ่ายใหม่อีกครั้ง',
        timer: 2000,
        showConfirmButton: false
      });
      return;
    }
  }

  // Double-submission lock & disable shutter button immediately
  isClockSubmitting = true;
  const shutterBtn = document.getElementById('fsShutterBtn');
  if (shutterBtn) {
    shutterBtn.disabled = true;
    shutterBtn.style.opacity = '0.5';
    shutterBtn.style.pointerEvents = 'none';
  }

  // 1. Shutter Flash Effect & Haptic Vibration
  if (flash) {
    flash.style.opacity = '0.85';
    setTimeout(() => { flash.style.opacity = '0'; }, 180);
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(50); } catch(e) {}
  }

  // 2. Crop and Compress Frame from Video
  const targetSize = 480; // 480x480 square crop for crisp photo and watermark
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const cropSize = Math.min(vw, vh);
  const startX = (vw - cropSize) / 2;
  const startY = (vh - cropSize) / 2;

  ctx.save();
  if (currentCameraFacing === 'user') {
    ctx.translate(targetSize, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, startX, startY, cropSize, cropSize, 0, 0, targetSize, targetSize);
  ctx.restore();

  // Overlay GPS Watermark (Style 1: Modern Gradient Banner)
  drawAttendanceWatermark(ctx, targetSize, targetSize, activePendingClock ? activePendingClock.type : 'IN');

  // Smart Concurrency Optimization: 0.65 JPEG Quality (~30-40KB, saves ~70% disk & network payload)
  const photoBase64 = canvas.toDataURL('image/jpeg', 0.65);

  const pendingData = Object.assign({}, activePendingClock);
  closeFullscreenCamera();

  // 3. Immediately Submit Clock Action with Photo & Auto-Retry
  submitClockWithPhoto(pendingData.type, pendingData.qrToken, photoBase64);
}

// Time Window Lock Helper
function isActionWithinTimeWindow(actionType) {
  if (actionType === 'OUT' && window.currentBranchConfig && window.currentBranchConfig.earlyDismissalFullPay) {
    return { allowed: true };
  }
  if (!appSettings || appSettings.enable_time_window_restrictions !== 'true') {
    return { allowed: true };
  }

  const now = new Date();
  const curTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  let start = '00:00';
  let end = '23:59';
  let label = '';

  switch (actionType) {
    case 'IN':
      start = appSettings.window_in_start || '06:00';
      end = appSettings.window_in_end || '12:00';
      label = 'เข้างาน (IN)';
      break;
    case 'BREAK_OUT':
      start = appSettings.window_break_out_start || '11:30';
      end = appSettings.window_break_out_end || '14:30';
      label = 'เริ่มพัก (Break OUT)';
      break;
    case 'BREAK_IN':
      start = appSettings.window_break_in_start || '12:00';
      end = appSettings.window_break_in_end || '15:30';
      label = 'กลับเข้าทำงาน (Break IN)';
      break;
    case 'OUT':
      start = appSettings.window_out_start || '17:00';
      end = appSettings.window_out_end || '23:59';
      label = 'เลิกงาน (Clock OUT)';
      break;
    default:
      return { allowed: true };
  }

  const allowed = (curTime >= start && curTime <= end);
  return {
    allowed,
    start,
    end,
    curTime,
    label
  };
}

function startDirectGpsClock(type) {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  const winCheck = isActionWithinTimeWindow(type);
  if (!winCheck.allowed) {
    Swal.fire({
      icon: 'warning',
      title: 'อยู่นอกช่วงเวลาที่กำหนด',
      html: `<div class="text-left text-sm space-y-2">
        <p>ระบบกำหนดช่วงเวลาสำหรับ <strong>${winCheck.label}</strong>:</p>
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl font-mono text-center text-amber-800 font-bold text-base">
          ⏰ ${winCheck.start} - ${winCheck.end} น.
        </div>
        <p class="text-xs text-slate-500 text-center">ขณะนี้เวลาในระบบคือ <strong>${winCheck.curTime} น.</strong></p>
      </div>`,
      confirmButtonText: 'เข้าใจแล้ว',
      confirmButtonColor: '#2563eb'
    });
    return;
  }

  if (appSettings && appSettings.allow_direct_gps === 'false') {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง',
      text: 'ระบบตั้งค่าให้พนักงานต้องสแกน QR Code ประจำสาขาเท่านั้น กรุณาสแกน QR Code เพื่อบันทึกเวลา'
    });
    return;
  }

  openFullscreenCamera(type, null);
}

// Legacy helper for direct GPS dialog
function handleDirectGpsClock() {
  if (appSettings && appSettings.allow_direct_gps === 'false') {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง',
      text: 'ระบบเปิดให้ลงเวลาผ่านการสแกน QR Code ประจำสาขาเท่านั้น กรุณาสแกน QR Code เพื่อบันทึกเวลา'
    });
    return;
  }

  Swal.fire({
    title: 'เลือกการลงเวลาด้วย GPS',
    text: 'กรุณาเลือกบันทึกเวลาเข้างาน หรือ ออกงาน',
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: 'บันทึกเข้างาน (IN)',
    denyButtonText: 'บันทึกออกงาน (OUT)',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#059669',
    denyButtonColor: '#dc2626'
  }).then((result) => {
    if (result.isConfirmed) {
      startDirectGpsClock('IN');
    } else if (result.isDenied) {
      startDirectGpsClock('OUT');
    }
  });
}

// ==============================================================================
// 6. QR SCANNER MODAL (html5-qrcode)
// ==============================================================================
function openQrScannerModal(type) {
  if (type !== 'UNLOCK' && !currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  if (type !== 'UNLOCK') {
    const winCheck = isActionWithinTimeWindow(type);
    if (!winCheck.allowed) {
      Swal.fire({
        icon: 'warning',
        title: 'อยู่นอกช่วงเวลาที่กำหนด',
        html: `<div class="text-left text-sm space-y-2">
          <p>ระบบกำหนดช่วงเวลาสำหรับ <strong>${winCheck.label}</strong>:</p>
          <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl font-mono text-center text-amber-800 font-bold text-base">
            ⏰ ${winCheck.start} - ${winCheck.end} น.
          </div>
          <p class="text-xs text-slate-500 text-center">ขณะนี้เวลาในระบบคือ <strong>${winCheck.curTime} น.</strong></p>
        </div>`,
        confirmButtonText: 'เข้าใจแล้ว',
        confirmButtonColor: '#2563eb'
      });
      return;
    }
  }

  pendingScanType = type;
  if (type === 'UNLOCK') {
    document.getElementById('qrScannerTitle').textContent = 'สแกน QR ปลดล็อกของหัวหน้างาน';
  } else if (type === 'BREAK_OUT') {
    document.getElementById('qrScannerTitle').textContent = 'สแกน QR Code ออกไปพัก (Break OUT)';
  } else if (type === 'BREAK_IN') {
    document.getElementById('qrScannerTitle').textContent = 'สแกน QR Code กลับเข้าทำงาน (Break IN)';
  } else {
    document.getElementById('qrScannerTitle').textContent = type === 'IN' ? 'สแกน QR Code เข้างาน' : 'สแกน QR Code ออกงาน';
  }
  document.getElementById('modalQrScanner')?.classList.remove('hidden');

  try {
    if (html5QrScannerInstance) {
      html5QrScannerInstance.stop().catch(() => {});
    }

    html5QrScannerInstance = new Html5Qrcode("qrReader");
    html5QrScannerInstance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        html5QrScannerInstance.stop().then(() => {
          closeQrScannerModal();
          if (pendingScanType === 'UNLOCK') {
            submitScanMasterQrUnlock(decodedText);
          } else {
            // Small pause ensures phone camera hardware releases back camera before opening front camera
            setTimeout(() => {
              openFullscreenCamera(pendingScanType, decodedText);
            }, 250);
          }
        }).catch(() => {
          closeQrScannerModal();
          setTimeout(() => {
            openFullscreenCamera(pendingScanType, decodedText);
          }, 250);
        });
      },
      (error) => {
        // scan progress
      }
    ).catch(err => {
      console.warn('QR camera error:', err);
    });
  } catch (e) {
    console.error('Failed to init QR scanner:', e);
  }
}

function closeQrScannerModal() {
  document.getElementById('modalQrScanner')?.classList.add('hidden');
  if (html5QrScannerInstance) {
    try {
      html5QrScannerInstance.stop().then(() => {
        try { html5QrScannerInstance.clear(); } catch(e) {}
        html5QrScannerInstance = null;
      }).catch(() => {
        try { html5QrScannerInstance.clear(); } catch(e) {}
        html5QrScannerInstance = null;
      });
    } catch(e) {
      html5QrScannerInstance = null;
    }
  }
}

// ==============================================================================
// 7. SUBMIT CLOCK IN / OUT ACTION (High-Concurrency Optimized with Retry & Jitter)
// ==============================================================================
async function submitClockWithPhoto(type, qrToken, photoUrl) {
  if (!currentEmployee) {
    isClockSubmitting = false;
    openEmployeePickerModal();
    return;
  }

  // Check allow direct GPS
  if (!qrToken && appSettings && appSettings.allow_direct_gps === 'false') {
    isClockSubmitting = false;
    Swal.fire({
      icon: 'warning',
      title: 'ไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง',
      text: 'ระบบตั้งค่าให้พนักงานต้องสแกน QR Code ประจำสาขาหรือหน้าจอเคาน์เตอร์เท่านั้น'
    });
    return;
  }

  // Geofence check
  if (!currentLocation) {
    isClockSubmitting = false;
    getCurrentLocation();
    Swal.fire('กำลังตรวจพิกัด GPS', 'กรุณารอระบบยืนยันพิกัด GPS สักครู่ แล้วกดอีกครั้ง', 'info');
    return;
  }

  const targetBranch = getCurrentEmployeeTargetBranch();
  const maxRadius = targetBranch.radius_meters || appSettings.geofence_radius_meters || 200;
  const branchName = targetBranch.branch_name || 'สำนักงาน';

  if (currentDistanceMeters > maxRadius && appSettings.allow_outside_clockin !== 'true') {
    isClockSubmitting = false;
    Swal.fire({
      icon: 'error',
      title: `อยู่นอกพื้นที่ ${branchName}`,
      text: `คุณอยู่ห่างจาก ${branchName} ${currentDistanceMeters} เมตร (อนุญาตไม่เกิน ${maxRadius} ม.)`
    });
    return;
  }

  let actionName = 'clockIn';
  if (type === 'IN') actionName = 'clockIn';
  else if (type === 'OUT') actionName = 'clockOut';
  else if (type === 'BREAK_OUT') actionName = 'breakOut';
  else if (type === 'BREAK_IN') actionName = 'breakIn';

  isClockSubmitting = true;

  Swal.fire({
    title: 'กำลังบันทึกเวลา...',
    html: '<span class="text-sm text-slate-500">กำลังเชื่อมต่อระบบและส่งข้อมูล...</span>',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const MAX_RETRIES = 3;
    let lastError = null;
    let data = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          Swal.update({
            title: `กำลังบันทึกเวลา... (ลองใหม่อัตโนมัติ ${attempt}/${MAX_RETRIES})`,
            html: '<span class="text-xs text-amber-600">ระบบกำลังประมวลผลพร้อมกัน กำลังบันทึกซ้ำให้อัตโนมัติ...</span>'
          });
        }

        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: actionName,
            empId: currentEmployee.empId,
            lat: currentLocation ? currentLocation.lat : null,
            lng: currentLocation ? currentLocation.lng : null,
            photoUrl: photoUrl || null,
            qrToken: qrToken || null,
            deviceId: getOrCreateDeviceId()
          })
        });

        if (!res.ok && (res.status >= 500 || res.status === 429)) {
          throw new Error(`HTTP ${res.status}: Server Busy`);
        }

        const parsed = await res.json();
        if (!parsed.success && parsed.retryable) {
          throw new Error(parsed.message || 'Transient DB busy');
        }

        data = parsed;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          // Exponential backoff + Jitter (random 200-500ms + attempt * 250ms)
          const jitter = Math.floor(Math.random() * 300) + 200;
          await new Promise(r => setTimeout(r, jitter + attempt * 250));
        }
      }
    }

    if (!data) {
      throw lastError || new Error('ไม่สามารถเชื่อมต่อระบบบันทึกเวลาได้');
    }

    if (data.success) {
      if (type === 'IN') {
        Swal.fire({
          icon: 'success',
          title: 'บันทึกเวลาเข้างานสำเร็จ!',
          html: `
            <div class="text-sm space-y-1">
              <p>เวลา: <b class="text-emerald-700">${data.clockInTime}</b></p>
              <p>สถานะ: <b>${data.status === 'LATE' ? 'มาสาย (' + data.lateMinutes + ' นาที)' : 'ตรงเวลา ปกติ'}</b></p>
              <p class="text-xs text-slate-500 pt-1">📸 บันทึกรูปถ่ายและพิกัด GPS สำเร็จ</p>
            </div>
          `
        });
      } else if (type === 'BREAK_OUT') {
        scheduleBreakReminders(data.breakOutTime || new Date().toLocaleTimeString('th-TH'));
        Swal.fire({
          icon: 'success',
          title: 'บันทึกเวลาออกไปพักสำเร็จ!',
          html: `
            <div class="text-sm space-y-1">
              <p>เวลาเริ่มพัก: <b class="text-amber-700">${data.breakOutTime}</b></p>
              <p class="text-xs text-slate-500 pt-1">☕ พักผ่อนตามอัธยาศัย ระบบจะแจ้งเตือนเมื่อใกล้หมดเวลาพัก</p>
            </div>
          `
        });
      } else if (type === 'BREAK_IN') {
        clearBreakReminders();
        Swal.fire({
          icon: 'success',
          title: 'บันทึกเวลากลับเข้าทำงานสำเร็จ!',
          html: `
            <div class="text-sm space-y-1">
              <p>เวลากลับเข้างาน: <b class="text-emerald-700">${data.breakInTime}</b></p>
              <p>ใช้เวลาพัก: <b>${data.breakMinutes} นาที</b> ${data.overbreakMinutes > 0 ? `<span class="text-rose-600 font-bold">(เกินเวลา ${data.overbreakMinutes} นาที)</span>` : '<span class="text-emerald-600 font-bold">(อยู่ในเกณฑ์)</span>'}</p>
              <p class="text-xs text-slate-500 pt-1">💼 ขอให้มีความสุขกับการทำงานช่วงบ่ายครับ</p>
            </div>
          `
        });
      } else {
        const isEligible = (data.isOtEligible !== false) && (!currentEmployee || currentEmployee.isOtEligible !== false);
        Swal.fire({
          icon: 'success',
          title: 'บันทึกเวลาออกงานสำเร็จ!',
          html: `
            <div class="text-sm space-y-1">
              <p>เวลาออกงาน: <b class="text-rose-700">${data.clockOutTime}</b></p>
              ${isEligible
                ? `<p>งานปกติ: <b>${data.workHours} ชม.</b> | OT วันนี้: <b class="text-indigo-700">${data.otHours} ชม.</b></p>`
                : `<p>งานปกติ: <b>${data.workHours} ชม.</b> <span class="text-xs text-slate-500 font-normal">(ตำแหน่งเหมาจ่าย ไม่คิดค่า OT)</span></p>`
              }
              <p class="text-xs text-slate-500 pt-1">📸 บันทึกรูปถ่ายและพิกัด GPS สำเร็จ</p>
            </div>
          `
        });
      }
      loadTodayStatus();
      loadAdvanceEligibility();
    } else {
      if (handleMaintenanceResponse(data)) return;
      Swal.fire('ไม่สามารถลงเวลาได้', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message || 'ไม่สามารถลงเวลาได้ กรุณาลองใหม่อีกครั้ง', 'error');
  } finally {
    isClockSubmitting = false;
    const shutterBtn = document.getElementById('fsShutterBtn');
    if (shutterBtn) {
      shutterBtn.disabled = false;
      shutterBtn.style.opacity = '1';
      shutterBtn.style.pointerEvents = 'auto';
    }
  }
}

// Backward compatibility alias
async function executeClockAction(type, qrToken) {
  openFullscreenCamera(type, qrToken);
}

// ==============================================================================
// 8. TODAY STATUS LOAD (Dual Mode: 2-punch AUTO_DEDUCT & 4-punch BREAK_PUNCH)
// ==============================================================================
async function loadTodayStatus() {
  if (!currentEmployee) return;

  try {
    const res = await fetch(`${API_URL}?action=getTodayStatus&empId=${currentEmployee.empId}`);
    const data = await res.json();
    if (data.success) {
      if (data.settings) {
        appSettings = { ...appSettings, ...data.settings };
        try {
          localStorage.setItem('ptn_app_settings', JSON.stringify(appSettings));
        } catch(e) {}
        checkMaintenanceMode();
      }

      const log = data.log;
      const isBreakMode = (appSettings.break_tracking_mode === 'BREAK_PUNCH');
      const clockInEl = document.getElementById('todayClockInTime');
      const clockOutEl = document.getElementById('todayClockOutTime');
      const lateEl = document.getElementById('todayLateInfo');
      const workSummaryEl = document.getElementById('todayWorkSummary');
      const badge = document.getElementById('todayStatusBadge');

      const breakSummaryRow = document.getElementById('todayBreakSummaryRow');
      const breakOutEl = document.getElementById('todayBreakOutTime');
      const breakInEl = document.getElementById('todayBreakInTime');
      const breakDurationEl = document.getElementById('todayBreakDurationInfo');

      const stdPunchBox = document.getElementById('containerStandardPunch');
      const breakPunchBox = document.getElementById('containerBreakPunch');

      // Update Basic Times
      if (clockInEl) clockInEl.textContent = (log && log.clock_in) ? log.clock_in : '--:--:--';
      if (clockOutEl) clockOutEl.textContent = (log && log.clock_out) ? log.clock_out : '--:--:--';
      if (breakOutEl) breakOutEl.textContent = (log && log.break_out) ? log.break_out : '--:--:--';
      if (breakInEl) breakInEl.textContent = (log && log.break_in) ? log.break_in : '--:--:--';

      // Toggle Break Boxes in Timeline
      const boxBreakOut = document.getElementById('timeBoxBreakOut');
      const boxBreakIn = document.getElementById('timeBoxBreakIn');
      if (boxBreakOut && boxBreakIn) {
        if (isBreakMode) {
          boxBreakOut.classList.remove('hidden');
          boxBreakIn.classList.remove('hidden');
        } else {
          boxBreakOut.classList.add('hidden');
          boxBreakIn.classList.add('hidden');
        }
      }

      if (log && log.clock_in) {
        if (lateEl) {
          lateEl.textContent = log.late_minutes > 0 ? `สาย ${log.late_minutes} นาที` : 'ตรงเวลา ปกติ';
          lateEl.className = log.late_minutes > 0 ? 'text-xs text-amber-700 font-bold' : 'text-xs text-emerald-700 font-semibold';
        }
      } else {
        if (lateEl) {
          lateEl.textContent = 'เกณฑ์ ' + (appSettings.work_start_time || '09:30') + ' น.';
          lateEl.className = 'text-[11px] md:text-xs text-emerald-700 font-medium';
        }
      }

      if (log && log.clock_out) {
        if (workSummaryEl) workSummaryEl.textContent = `ปกติ ${log.work_hours} ชม. + OT ${log.ot_hours || 0} ชม.`;
      } else {
        if (workSummaryEl) workSummaryEl.textContent = 'ปกติ 0 ชม.';
      }

      window.currentBranchConfig = data.branchConfig || null;

      // =========================================================================
      // CONCEPT 3: HERO ONE-TAP ACTION LOGIC
      // =========================================================================
      const heroBtn = document.getElementById('heroActionButton');
      const heroIcon = document.getElementById('heroActionIcon');
      const heroTitle = document.getElementById('heroActionTitle');
      const heroSub = document.getElementById('heroActionSubtitle');
      const statusText = document.getElementById('todayStatusText');
      const statusIcon = document.getElementById('todayStatusIcon');
      const secBox = document.getElementById('heroSecondaryActionBox');
      const secBtn = document.getElementById('btnHeroSecondaryAction');
      const directGpsContainer = document.getElementById('containerHeroDirectGps');
      const directGpsBtn = document.getElementById('btnHeroDirectGps');
      const directGpsText = document.getElementById('txtHeroDirectGps');

      let currentAction = 'IN';
      let secAction = null;
      let secText = '';

      if (isBreakMode) {
        // Mode 2: 4-Punch (BREAK_PUNCH)
        if (!log || !log.clock_in) {
          // State 1: Not clocked in
          currentAction = 'IN';
          if (statusText) statusText.textContent = 'ยังไม่ได้ลงเวลาวันนี้';
          if (statusIcon) statusIcon.textContent = '🌅';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
            badge.textContent = 'พร้อมลงเวลา';
          }
          if (heroTitle) heroTitle.textContent = 'แตะเพื่อลงเวลาเข้างาน';
          if (heroSub) heroSub.textContent = 'สแกน QR Code ประจำสาขา หรือถ่ายรูปเซลฟี่';
          if (heroIcon) heroIcon.textContent = '☀️';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-xl transition-all duration-200 transform active:scale-[0.98] flex flex-col items-center justify-center space-y-2.5 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30 hero-pulse';
            heroBtn.disabled = false;
            heroBtn.onclick = () => openQrScannerModal('IN');
          }
          if (directGpsText) directGpsText.textContent = 'ถ่ายรูปเข้างานด้วย GPS โดยตรง (IN)';
          if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('IN');

        } else if (log.clock_in && !log.break_out && !log.clock_out) {
          // State 2: Working morning shift -> ready to Break Out
          currentAction = 'BREAK_OUT';
          secAction = 'OUT';
          secText = 'หรือแตะเพื่อลงเวลาออกงานทันที (Clock OUT)';

          if (statusText) statusText.textContent = `กำลังทำงาน (เข้างานเมื่อ ${log.clock_in})`;
          if (statusIcon) statusIcon.textContent = '💼';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
            badge.textContent = 'กำลังปฏิบัติงาน';
          }
          if (heroTitle) heroTitle.textContent = 'แตะเพื่อลงเวลาเริ่มพัก';
          if (heroSub) heroSub.textContent = 'บันทึกเวลาพักกลางวัน (Break OUT - 2/4)';
          if (heroIcon) heroIcon.textContent = '☕';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-xl transition-all duration-200 transform active:scale-[0.98] flex flex-col items-center justify-center space-y-2.5 bg-amber-600 hover:bg-amber-700 shadow-amber-600/30 hero-pulse-amber';
            heroBtn.disabled = false;
            heroBtn.onclick = () => openQrScannerModal('BREAK_OUT');
          }
          if (directGpsText) directGpsText.textContent = 'ถ่ายรูปออกไปพักด้วย GPS โดยตรง (Break OUT)';
          if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('BREAK_OUT');

        } else if (log.break_out && !log.break_in && !log.clock_out) {
          // State 3: On Break -> ready to Break In
          currentAction = 'BREAK_IN';
          if (statusText) statusText.textContent = `กำลังอยู่ในช่วงพักผ่อน (เริ่มพัก ${log.break_out})`;
          if (statusIcon) statusIcon.textContent = '☕';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
            badge.textContent = 'กำลังพักผ่อน';
          }
          if (heroTitle) heroTitle.textContent = 'แตะเพื่อกลับเข้าทำงานบ่าย';
          if (heroSub) heroSub.textContent = 'สิ้นสุดเวลาพัก พร้อมปฏิบัติงานช่วงบ่าย (Break IN - 3/4)';
          if (heroIcon) heroIcon.textContent = '💼';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-xl transition-all duration-200 transform active:scale-[0.98] flex flex-col items-center justify-center space-y-2.5 bg-sky-600 hover:bg-sky-700 shadow-sky-600/30 hero-pulse-sky';
            heroBtn.disabled = false;
            heroBtn.onclick = () => openQrScannerModal('BREAK_IN');
          }
          if (directGpsText) directGpsText.textContent = 'ถ่ายรูปกลับเข้าทำงานด้วย GPS โดยตรง (Break IN)';
          if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('BREAK_IN');

        } else if (log.break_in && !log.clock_out) {
          // State 4: Afternoon shift -> ready to Clock Out
          currentAction = 'OUT';
          if (statusText) statusText.textContent = `ปฏิบัติงานช่วงบ่าย (พักไป ${log.break_minutes || 0} นาที)`;
          if (statusIcon) statusIcon.textContent = '🏢';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
            badge.textContent = 'ปฏิบัติงานช่วงบ่าย';
          }
          if (heroTitle) heroTitle.textContent = 'แตะเพื่อลงเวลาเลิกงาน';
          if (heroSub) heroSub.textContent = 'เลิกงานประจำวัน / สรุปเวลางาน (Clock OUT - 4/4)';
          if (data.branchConfig && data.branchConfig.earlyDismissalFullPay) {
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse';
              badge.textContent = '✨ งานเสร็จ (จ่ายเต็มวัน)';
            }
            if (heroSub) heroSub.textContent = '⚡ โหมดงานเสร็จประจำสาขา (ได้รับค่าแรงเต็มวัน ไม่หักเงิน)';
          }
          if (heroIcon) heroIcon.textContent = '🚪';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-xl transition-all duration-200 transform active:scale-[0.98] flex flex-col items-center justify-center space-y-2.5 bg-rose-600 hover:bg-rose-700 shadow-rose-600/30 hero-pulse-rose';
            heroBtn.disabled = false;
            heroBtn.onclick = () => openQrScannerModal('OUT');
          }
          if (directGpsText) directGpsText.textContent = 'ถ่ายรูปออกงานด้วย GPS โดยตรง (Clock OUT)';
          if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('OUT');

        } else if (log.clock_out) {
          // State 5: Completed
          currentAction = 'DONE';
          if (statusText) statusText.textContent = `เลิกงานเรียบร้อยแล้ว (ออกเวลา ${log.clock_out})`;
          if (statusIcon) statusIcon.textContent = '🎉';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-emerald-100 text-emerald-800 border border-emerald-200';
            badge.textContent = 'เสร็จสมบูรณ์';
          }
          if (heroTitle) heroTitle.textContent = 'ลงเวลาครบทุกขั้นตอนแล้ว';
          if (heroSub) heroSub.textContent = 'บันทึกเวลาทำงานของวันนี้เรียบร้อยแล้ว พักผ่อนได้เลยครับ';
          const isBranchEarly = (log.remark && log.remark.includes('งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน'));
          if (isBranchEarly) {
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
              badge.textContent = '✨ งานเสร็จ (เต็มวัน)';
            }
            if (heroSub) heroSub.textContent = `เลิกงานในโหมดงานเสร็จเรียบร้อยแล้ว (ออกเวลา ${log.clock_out}) ได้รับค่าแรงเต็มวัน`;
          }
          if (heroIcon) heroIcon.textContent = '✅';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-lg flex flex-col items-center justify-center space-y-2.5 bg-slate-700 hover:bg-slate-800 cursor-default';
            heroBtn.disabled = false;
            heroBtn.onclick = () => {
              Swal.fire({
                icon: 'success',
                title: 'บันทึกเวลาวันนี้ครบถ้วนแล้ว',
                html: `<div class="text-sm text-slate-600">เข้า: ${log.clock_in} | ออก: ${log.clock_out}</div>`,
                timer: 2000,
                showConfirmButton: false
              });
            };
          }
        }

      } else {
        // Mode 1: Standard 2-Punch (AUTO_DEDUCT)
        if (!log || !log.clock_in) {
          currentAction = 'IN';
          secAction = 'OUT';
          secText = 'หรือแตะเพื่อลงเวลาออกงาน (OUT)';

          if (statusText) statusText.textContent = 'ยังไม่ได้ลงเวลาวันนี้';
          if (statusIcon) statusIcon.textContent = '🌅';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
            badge.textContent = 'พร้อมลงเวลา';
          }
          if (heroTitle) heroTitle.textContent = 'แตะเพื่อลงเวลาเข้างาน';
          if (heroSub) heroSub.textContent = 'สแกน QR Code ประจำสาขา หรือถ่ายรูปเซลฟี่';
          if (heroIcon) heroIcon.textContent = '☀️';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-xl transition-all duration-200 transform active:scale-[0.98] flex flex-col items-center justify-center space-y-2.5 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30 hero-pulse';
            heroBtn.disabled = false;
            heroBtn.onclick = () => openQrScannerModal('IN');
          }
          if (directGpsText) directGpsText.textContent = 'ถ่ายรูปเข้างานด้วย GPS โดยตรง (IN)';
          if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('IN');

        } else if (log.clock_in && !log.clock_out) {
          currentAction = 'OUT';
          secAction = 'IN';
          secText = 'หรือแตะเพื่อลงเวลาเข้างานอีกครั้ง (IN)';

          if (statusText) statusText.textContent = `กำลังทำงาน (เข้างานเมื่อ ${log.clock_in})`;
          if (statusIcon) statusIcon.textContent = '💼';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
            badge.textContent = 'กำลังปฏิบัติงาน';
          }
          if (heroTitle) heroTitle.textContent = 'แตะเพื่อลงเวลาออกงาน';
          if (heroSub) heroSub.textContent = 'เลิกงานประจำวัน / สิ้นสุดการทำงาน (Clock OUT)';
          if (data.branchConfig && data.branchConfig.earlyDismissalFullPay && !data.branchConfig.isUndertimeExempt) {
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse';
              badge.textContent = '✨ งานเสร็จ (จ่ายเต็มวัน)';
            }
            if (heroSub) {
              heroSub.textContent = '⚡ โหมดงานเสร็จประจำสาขา (ได้รับค่าแรงเต็มวัน ไม่หักเงิน)';
            }
          }
          if (heroIcon) heroIcon.textContent = '🚪';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-xl transition-all duration-200 transform active:scale-[0.98] flex flex-col items-center justify-center space-y-2.5 bg-rose-600 hover:bg-rose-700 shadow-rose-600/30 hero-pulse-rose';
            heroBtn.disabled = false;
            heroBtn.onclick = () => openQrScannerModal('OUT');
          }
          if (directGpsText) directGpsText.textContent = 'ถ่ายรูปออกงานด้วย GPS โดยตรง (OUT)';
          if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('OUT');

        } else if (log.clock_out) {
          currentAction = 'DONE';
          if (statusText) statusText.textContent = `เลิกงานเรียบร้อยแล้ว (ออกเวลา ${log.clock_out})`;
          if (statusIcon) statusIcon.textContent = '🎉';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-emerald-100 text-emerald-800 border border-emerald-200';
            badge.textContent = 'บันทึกครบถ้วนแล้ว';
          }
          if (heroTitle) heroTitle.textContent = 'ลงเวลาครบถ้วนแล้ว';
          if (heroSub) heroSub.textContent = `บันทึกเวลาของวันนี้เรียบร้อยแล้ว (ออกงานเวลา ${log.clock_out})`;
          const isBranchEarly = (log.remark && log.remark.includes('งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน'));
          if (isBranchEarly) {
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
              badge.textContent = '✨ งานเสร็จ (เต็มวัน)';
            }
            if (heroSub) {
              heroSub.textContent = `เลิกงานในโหมดงานเสร็จเรียบร้อยแล้ว (ออกเวลา ${log.clock_out}) ได้รับค่าแรงเต็มวัน`;
            }
          }
          if (heroIcon) heroIcon.textContent = '✅';
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-white shadow-lg flex flex-col items-center justify-center space-y-2.5 bg-slate-700 hover:bg-slate-800 cursor-default';
            heroBtn.disabled = false;
            heroBtn.onclick = () => {
              Swal.fire({
                icon: 'success',
                title: 'บันทึกเวลาทำงานของวันนี้ครบถ้วนแล้ว',
                html: `<div class="text-sm text-slate-600">เข้า: ${log.clock_in} | ออก: ${log.clock_out}</div>`,
                timer: 2000,
                showConfirmButton: false
              });
            };
          }
        }
      }

      // Check Time Window Lock Restriction for current active action
      if (currentAction !== 'DONE') {
        const winCheck = isActionWithinTimeWindow(currentAction);
        if (!winCheck.allowed) {
          if (heroBtn) {
            heroBtn.className = 'w-full py-7 md:py-9 px-6 rounded-3xl text-slate-300 shadow-lg flex flex-col items-center justify-center space-y-2.5 bg-slate-700/85 border-2 border-slate-600/80 cursor-pointer';
            heroBtn.disabled = false;
            heroBtn.onclick = () => {
              Swal.fire({
                icon: 'info',
                title: 'อยู่นอกช่วงเวลาที่กำหนด',
                html: `<div class="text-left text-sm space-y-2">
                  <p>ระบบกำหนดช่วงเวลาสำหรับ <strong>${winCheck.label}</strong>:</p>
                  <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl font-mono text-center text-amber-800 font-bold text-base">
                    ⏰ ${winCheck.start} - ${winCheck.end} น.
                  </div>
                  <p class="text-xs text-slate-500 text-center">ขณะนี้เวลาในระบบคือ <strong>${winCheck.curTime} น.</strong></p>
                </div>`,
                confirmButtonText: 'รับทราบ',
                confirmButtonColor: '#2563eb'
              });
            };
          }
          if (heroTitle) heroTitle.innerHTML = `<span class="flex items-center justify-center gap-2"><span class="text-amber-400">🔒</span> อยู่นอกช่วงเวลา (${winCheck.start}-${winCheck.end})</span>`;
          if (heroSub) heroSub.textContent = `ระบบเปิดให้ลงเวลา ${winCheck.label} ช่วง ${winCheck.start} - ${winCheck.end} น. (ขณะนี้ ${winCheck.curTime} น.)`;
          if (heroIcon) heroIcon.textContent = '⏳';
        }
      }

      // Secondary Action Button Toggle
      if (secBox && secBtn) {
        if (secAction && currentAction !== 'DONE') {
          secBox.classList.remove('hidden');
          secBtn.textContent = secText;
          secBtn.onclick = () => openQrScannerModal(secAction);
        } else {
          secBox.classList.add('hidden');
        }
      }

      // Direct GPS Container Toggle
      if (directGpsContainer) {
        if (appSettings.allow_direct_gps === 'false' || currentAction === 'DONE') {
          directGpsContainer.classList.add('hidden');
        } else {
          directGpsContainer.classList.remove('hidden');
        }
      }
      applyFeatureToggles();
    }
  } catch(e) {
    console.warn('Today status note:', e);
  }
}

// ==============================================================================
// 9. SALARY ADVANCE (ขอเบิกเงินล่วงหน้า)
// ==============================================================================
async function loadAdvanceEligibility() {
  if (!currentEmployee) return;

  try {
    const res = await fetch(`${API_URL}?action=getAdvanceEligibility&empId=${currentEmployee.empId}`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('advDaysWorked').textContent = data.daysWorked;
      document.getElementById('advDailyRate').textContent = data.dailyRate;
      document.getElementById('advMaxAllowed').textContent = data.maxAllowed;
      
      const badge = document.getElementById('advanceDayBadge');
      const submitBtn = document.getElementById('btnSubmitAdvance');
      const windowInfo = document.getElementById('advanceWindowInfo');
      const headerTitle = document.getElementById('advanceHeaderTitle');

      const startTime = data.advanceStartTime || '09:00';
      const endTime = data.advanceEndTime || '18:00';

      let dayText = 'ทุกวันเสาร์';
      if (data.advanceDayOfWeek === 'ANY') dayText = 'ทุกวัน';
      else if (data.advanceDayOfWeek === 'FRIDAY') dayText = 'ทุกวันศุกร์';
      else if (data.advanceDayOfWeek === 'FRIDAY_SATURDAY') dayText = 'ทุกวันศุกร์และเสาร์';

      if (headerTitle) {
        headerTitle.textContent = `💵 ขอเบิกเงินล่วงหน้า (${dayText})`;
      }

      if (windowInfo) {
        windowInfo.textContent = `เปิดรับคำขอ: ${dayText} เวลา ${startTime} - ${endTime} น.`;
      }

      if (data.enabled === false) {
        if (badge) {
          badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200';
          badge.textContent = '🔒 ปิดรับคำขอชั่วคราว';
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
          submitBtn.textContent = 'ระบบปิดรับคำขอชั่วคราว';
        }
      } else if (data.isOpen) {
        if (badge) {
          badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 animate-pulse';
          badge.textContent = `🟢 เปิดรับคำขอ (${startTime} - ${endTime} น.)`;
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          submitBtn.textContent = 'ยื่นขอเบิกเงินล่วงหน้า';
        }
      } else {
        if (badge) {
          badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-900 border border-amber-200';
          if (!data.isAllowedDay) {
            badge.textContent = `🔒 เปิดเฉพาะ${dayText}`;
          } else {
            badge.textContent = `⏰ ปิดรับ (เปิด ${startTime} - ${endTime} น.)`;
          }
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
          if (!data.isAllowedDay) {
            submitBtn.textContent = `เปิดรับเฉพาะ${dayText}`;
          } else {
            submitBtn.textContent = `อยู่นอกเวลาเปิดรับ (${startTime} - ${endTime} น.)`;
          }
        }
      }
    }
  } catch (e) {
    console.warn('Advance eligibility note:', e);
  }
}

async function submitAdvanceRequest() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  const amountInput = document.getElementById('advRequestAmount');
  const reasonInput = document.getElementById('advReason');
  const amount = Number(amountInput?.value);
  const reason = reasonInput?.value.trim();

  if (!amount || amount <= 0) {
    Swal.fire('กรุณาระบุจำนวนเงินที่ต้องการขอเบิก', '', 'warning');
    return;
  }

  Swal.fire({ title: 'กำลังยื่นคำขอเบิกเงิน...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submitAdvanceRequest',
        empId: currentEmployee.empId,
        amount,
        reason
      })
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire('ยื่นคำขอเบิกเงินสำเร็จ', data.message, 'success');
      amountInput.value = '';
      if (reasonInput) reasonInput.value = '';
      loadAdvanceEligibility();
      switchSubTab('status');
    } else {
      if (handleMaintenanceResponse(data)) return;
      Swal.fire('ไม่สามารถยื่นขอเบิกเงินได้', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

// ==============================================================================
// 10. HISTORY TAB (รอบตัดวิก 26 ถึง 25)
// ==============================================================================
async function loadEmployeeHistory() {
  if (!currentEmployee) return;
  const month = document.getElementById('historyMonthPicker')?.value || new Date().toISOString().substring(0, 7);
  const container = document.getElementById('historyListContainer');
  if (container) container.innerHTML = '<div class="text-center py-6 text-xs text-slate-400">กำลังโหลดข้อมูลประวัติ...</div>';

  try {
    const res = await fetch(`${API_URL}?action=getEmployeeHistory&empId=${currentEmployee.empId}&month=${month}`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('statWorkDays').textContent = data.stats.totalWorkDays;
      document.getElementById('statLateMin').textContent = data.stats.totalLateMinutes;
      document.getElementById('statOtHours').textContent = data.stats.totalOtHours;
      document.getElementById('statAdvance').textContent = data.stats.totalAdvances || 0;

      if (!data.logs || data.logs.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-xs text-slate-400">ไม่พบประวัติการลงเวลาในรอบนี้</div>';
        return;
      }

      window._currentHistoryLogs = data.logs || [];
      let html = '';
      data.logs.forEach((l, idx) => {
        const isLate = (l.late_minutes || 0) > 0;
        const isBranchEarly = (l.remark && l.remark.includes('งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน'));
        html += `
          <div onclick="openHistoryDetailModal(${idx})" class="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 hover:border-sky-300 active:scale-[0.98] transition cursor-pointer shadow-sm flex items-center justify-between group">
            <div class="flex items-center space-x-3">
              <div class="flex items-center -space-x-2 flex-shrink-0">
                ${l.in_photo_url ? `
                  <img src="${l.in_photo_url}" title="รูปถ่ายเข้างาน (${l.clock_in})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-emerald-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.in_photo_url}', 'รูปถ่ายเซลฟี่ตอนเข้างาน ${l.date} (${l.clock_in})')" />
                ` : ''}
                ${l.break_out_photo_url ? `
                  <img src="${l.break_out_photo_url}" title="รูปถ่ายออกพัก (${l.break_out})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-amber-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.break_out_photo_url}', 'รูปถ่ายเซลฟี่ตอนออกไปพัก ${l.date} (${l.break_out})')" />
                ` : ''}
                ${l.break_in_photo_url ? `
                  <img src="${l.break_in_photo_url}" title="รูปถ่ายเข้าจากพัก (${l.break_in})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-blue-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.break_in_photo_url}', 'รูปถ่ายเซลฟี่ตอนกลับเข้างาน ${l.date} (${l.break_in})')" />
                ` : ''}
                ${l.out_photo_url ? `
                  <img src="${l.out_photo_url}" title="รูปถ่ายออกงาน (${l.clock_out})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-rose-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.out_photo_url}', 'รูปถ่ายเซลฟี่ตอนออกงาน ${l.date} (${l.clock_out})')" />
                ` : ''}
                ${!l.in_photo_url && !l.out_photo_url && !l.break_out_photo_url && !l.break_in_photo_url ? `
                  <div class="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-sm">📅</div>
                ` : ''}
              </div>
              <div class="space-y-0.5">
                <div class="font-bold text-slate-900 text-sm sm:text-base">${l.date}</div>
                <div class="flex items-center space-x-2 text-xs sm:text-sm text-slate-600">
                  <span>เข้า: <b class="text-emerald-700 font-bold">${l.clock_in || '--'}</b></span>
                  <span>ออก: <b class="text-rose-700 font-bold">${l.clock_out || '--'}</b></span>
                  <span>(ปกติ ${l.work_hours || 0} ชม. ${l.ot_hours > 0 ? '+ OT ' + l.ot_hours + ' ชม.' : ''})</span>
                </div>
              </div>
            </div>
            <div class="text-right flex-shrink-0 pl-2">
              ${isBranchEarly
                ? `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-bold bg-purple-100 text-purple-800 border border-purple-200 shadow-sm">✨ งานเสร็จ (เต็มวัน)</span>`
                : isLate 
                  ? `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-bold bg-amber-100 text-amber-900 border border-amber-200 shadow-sm">สาย ${l.late_minutes} น.</span>`
                  : `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-sm">ปกติ</span>`
              }
              <div class="text-[11px] sm:text-xs text-slate-400 mt-1 flex items-center justify-end gap-1 font-medium group-hover:text-sky-600 transition">
                <span>แตะดู</span> <i class="fa-solid fa-chevron-right text-[9px]"></i>
              </div>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;
    }
  } catch(e) {
    if (container) container.innerHTML = '<div class="text-center py-6 text-sm text-rose-500 font-medium">โหลดข้อมูลไม่สำเร็จ</div>';
  }
}

// ------------------------------------------------------------------------------
// History Item Detail Modal
// ------------------------------------------------------------------------------
function openHistoryDetailModal(idx) {
  var logs = window._currentHistoryLogs || [];
  var l = logs[idx];
  if (!l) return;

  var isBranchEarly = (l.remark && l.remark.includes('งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน'));
  var isLate = (l.late_minutes || 0) > 0;

  var badgeEl = document.getElementById('hModalBadge');
  if (badgeEl) {
    if (isBranchEarly) {
      badgeEl.className = 'px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-purple-100 text-purple-800 border border-purple-300';
      badgeEl.textContent = '✨ งานเสร็จ (จ่ายเต็มวัน)';
    } else if (isLate) {
      badgeEl.className = 'px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-amber-100 text-amber-800 border border-amber-300';
      badgeEl.textContent = '🟠 สาย ' + l.late_minutes + ' นาที';
    } else {
      badgeEl.className = 'px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300';
      badgeEl.textContent = '🟢 ปฏิบัติงานปกติ';
    }
  }

  var branchEl = document.getElementById('hModalBranch');
  if (branchEl) {
    branchEl.innerHTML = l.branch_name ? ('🏬 ' + l.branch_name) : (l.branch_id ? ('🏬 ' + l.branch_id) : '🏬 ประจำสาขา');
  }

  var dateEl = document.getElementById('hModalDate');
  if (dateEl) dateEl.textContent = l.date || '-';

  // Photos (4-Photo 2x2 Grid)
  // 1. In Photo
  var pInCont = document.getElementById('hModalPhotoInContainer');
  var pInTime = document.getElementById('hModalPhotoInTime');
  var pInBadge = document.getElementById('hModalPhotoInBadge');
  if (pInTime) pInTime.textContent = l.clock_in ? l.clock_in.substring(0, 5) : '--:--';
  if (pInBadge) pInBadge.textContent = isLate ? ('① สาย ' + l.late_minutes + ' น.') : '① เข้างาน';
  if (pInCont) {
    if (l.in_photo_url) {
      pInCont.innerHTML = '<img src="' + l.in_photo_url + '" class="w-full h-full object-cover group-hover:scale-105 transition" alt="รูปเข้างาน">';
      pInCont.onclick = function() { previewCertPhoto(l.in_photo_url, 'รูปถ่ายเซลฟี่ตอนเข้างาน ' + l.date + ' (' + (l.clock_in || '') + ')'); };
    } else {
      pInCont.innerHTML = '<span class="text-[11px] text-slate-400 font-medium">ไม่มีรูปภาพ</span>';
      pInCont.onclick = null;
    }
  }

  // 2. Break Out Photo
  var pBOutCont = document.getElementById('hModalPhotoBreakOutContainer');
  var pBOutTime = document.getElementById('hModalPhotoBreakOutTime');
  if (pBOutTime) pBOutTime.textContent = l.break_out ? l.break_out.substring(0, 5) : '--:--';
  if (pBOutCont) {
    if (l.break_out_photo_url) {
      pBOutCont.innerHTML = '<img src="' + l.break_out_photo_url + '" class="w-full h-full object-cover group-hover:scale-105 transition" alt="รูปออกพัก">';
      pBOutCont.onclick = function() { previewCertPhoto(l.break_out_photo_url, 'รูปถ่ายเซลฟี่ตอนออกไปพัก ' + l.date + ' (' + (l.break_out || '') + ')'); };
    } else {
      pBOutCont.innerHTML = '<span class="text-[11px] text-slate-400 font-medium">' + (l.break_out ? 'ไม่มีรูป' : 'ไม่ได้สแกน') + '</span>';
      pBOutCont.onclick = null;
    }
  }

  // 3. Break In Photo
  var pBInCont = document.getElementById('hModalPhotoBreakInContainer');
  var pBInTime = document.getElementById('hModalPhotoBreakInTime');
  var pBInBadge = document.getElementById('hModalPhotoBreakInBadge');
  if (pBInTime) pBInTime.textContent = l.break_in ? l.break_in.substring(0, 5) : '--:--';
  if (pBInBadge) {
    var bMin = l.break_minutes || 0;
    pBInBadge.textContent = bMin > 0 ? ('③ พัก ' + bMin + ' น.') : '③ เข้าจากพัก';
  }
  if (pBInCont) {
    if (l.break_in_photo_url) {
      pBInCont.innerHTML = '<img src="' + l.break_in_photo_url + '" class="w-full h-full object-cover group-hover:scale-105 transition" alt="รูปกลับเข้างาน">';
      pBInCont.onclick = function() { previewCertPhoto(l.break_in_photo_url, 'รูปถ่ายเซลฟี่ตอนกลับเข้างาน ' + l.date + ' (' + (l.break_in || '') + ')'); };
    } else {
      pBInCont.innerHTML = '<span class="text-[11px] text-slate-400 font-medium">' + (l.break_in ? 'ไม่มีรูป' : 'ไม่ได้สแกน') + '</span>';
      pBInCont.onclick = null;
    }
  }

  // 4. Clock Out Photo
  var pOutCont = document.getElementById('hModalPhotoOutContainer');
  var pOutTime = document.getElementById('hModalPhotoOutTime');
  var pOutBadge = document.getElementById('hModalPhotoOutBadge');
  if (pOutTime) pOutTime.textContent = l.clock_out ? l.clock_out.substring(0, 5) : '--:--';
  if (pOutBadge) pOutBadge.textContent = isBranchEarly ? '④ งานเสร็จ' : '④ เลิกงาน';
  if (pOutCont) {
    if (l.out_photo_url) {
      pOutCont.innerHTML = '<img src="' + l.out_photo_url + '" class="w-full h-full object-cover group-hover:scale-105 transition" alt="รูปออกงาน">';
      pOutCont.onclick = function() { previewCertPhoto(l.out_photo_url, 'รูปถ่ายเซลฟี่ตอนออกงาน ' + l.date + ' (' + (l.clock_out || '') + ')'); };
    } else {
      pOutCont.innerHTML = '<span class="text-[11px] text-slate-400 font-medium">' + (l.clock_out ? 'ไม่มีรูป' : 'ยังไม่ลงเวลา') + '</span>';
      pOutCont.onclick = null;
    }
  }

  // Timeline
  var clockInEl = document.getElementById('hModalClockIn');
  if (clockInEl) {
    clockInEl.innerHTML = (l.clock_in || '--:--:--') + (isLate ? ' <span class="text-xs sm:text-sm font-bold text-amber-600">(สาย ' + l.late_minutes + ' น.)</span>' : ' <span class="text-xs sm:text-sm font-bold text-emerald-600">(ตรงเวลา)</span>');
  }

  var breakRow = document.getElementById('hModalBreakRow');
  var breakEl = document.getElementById('hModalBreak');
  if (breakRow && breakEl) {
    if (l.break_out || l.break_in) {
      breakRow.classList.remove('hidden');
      breakEl.textContent = (l.break_out || '--') + ' - ' + (l.break_in || '--') + (l.break_minutes ? ' (' + l.break_minutes + ' นาที)' : '');
    } else {
      breakRow.classList.add('hidden');
    }
  }

  var clockOutEl = document.getElementById('hModalClockOut');
  if (clockOutEl) {
    clockOutEl.innerHTML = l.clock_out ? (l.clock_out + (isBranchEarly ? ' <span class="text-xs sm:text-sm font-bold text-purple-700">(งานเสร็จก่อนเวลา)</span>' : '')) : '<span class="text-slate-400 font-normal">ยังไม่ได้ลงเวลาออก</span>';
  }

  var hoursEl = document.getElementById('hModalHours');
  if (hoursEl) {
    var otTxt = (l.ot_hours && l.ot_hours > 0) ? ' + OT ' + l.ot_hours + ' ชม.' : '';
    hoursEl.textContent = (l.work_hours || 0) + ' ชม.' + otTxt;
  }

  // Wage box
  var wageBox = document.getElementById('hModalWageBox');
  var wageTitle = document.getElementById('hModalWageTitle');
  var wageDesc = document.getElementById('hModalWageDesc');
  if (wageBox && wageTitle && wageDesc) {
    if (isBranchEarly) {
      wageBox.className = 'border rounded-2xl p-3.5 space-y-1.5 bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200 text-purple-900';
      wageTitle.innerHTML = '✨ การคิดค่าจ้างของวันนี้: ได้รับค่าแรงเต็มวัน 100%';
      wageDesc.innerHTML = 'ระบบยกเว้นการหักเงินชั่วโมงขาดให้อัตโนมัติ เนื่องจากสาขาเปิด <strong>โหมดงานเสร็จ-เลิกงานก่อน</strong>';
    } else if (isLate) {
      wageBox.className = 'border rounded-2xl p-3.5 space-y-1.5 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 text-amber-900';
      wageTitle.innerHTML = '🟠 การคิดค่าจ้างของวันนี้: มีบันทึกมาสาย ' + l.late_minutes + ' นาที';
      wageDesc.innerHTML = 'คำนวณการหักเงินสายตามระเบียบบริษัท ในรอบการคิดเงินเดือนประจำงวด';
    } else {
      wageBox.className = 'border rounded-2xl p-3.5 space-y-1.5 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200 text-emerald-900';
      wageTitle.innerHTML = '🟢 การคิดค่าจ้างของวันนี้: ปฏิบัติงานปกติ ครบถ้วน';
      wageDesc.innerHTML = 'ได้รับค่าจ้างเต็มจำนวนตามรอบการทำงานปกติ ' + ((l.ot_hours && l.ot_hours > 0) ? 'พร้อมคำนวณเงินค่าล่วงเวลา (OT)' : '');
    }
  }

  // Remark box (hide internal exemption remarks from employee)
  var remarkBox = document.getElementById('hModalRemarkBox');
  var remarkText = document.getElementById('hModalRemarkText');
  if (remarkBox && remarkText) {
    var displayRemark = (l.remark || '').replace(/\[สิทธิ์ประจำตำแหน่ง:[^\]]*\]/g, '').trim();
    if (displayRemark) {
      remarkBox.classList.remove('hidden');
      remarkText.textContent = displayRemark;
    } else {
      remarkBox.classList.add('hidden');
    }
  }

  var m = document.getElementById('modalHistoryDetail');
  if (m) {
    m.classList.remove('hidden');
  }
}

function closeHistoryDetailModal() {
  var m = document.getElementById('modalHistoryDetail');
  if (m) m.classList.add('hidden');
}

// ==============================================================================
// 11. SUB-TABS (LEAVE / OT / ADVANCE / STATUS)
// ==============================================================================
function switchSubTab(sub) {
  if (sub === 'advance' && appSettings.enable_advance_requests === 'false') {
    Swal.fire('ระบบขอเบิกเงินล่วงหน้าปิดให้บริการชั่วคราว', 'กรุณาติดต่อฝ่ายบุคคล/HR', 'info');
    return;
  }
  if (sub === 'leave' && appSettings.enable_leave_requests === 'false') {
    Swal.fire('ระบบขอลางานออนไลน์ปิดให้บริการชั่วคราว', 'กรุณาติดต่อฝ่ายบุคคล/HR', 'info');
    return;
  }
  if (sub === 'ot' && appSettings.enable_ot_requests === 'false') {
    Swal.fire('ระบบขอทำ OT ออนไลน์ปิดให้บริการชั่วคราว', 'กรุณาติดต่อฝ่ายบุคคล/HR', 'info');
    return;
  }

  const advBtn = document.getElementById('subTabBtnAdvance');
  const leaveBtn = document.getElementById('subTabBtnLeave');
  const otBtn = document.getElementById('subTabBtnOt');
  const statusBtn = document.getElementById('subTabBtnStatus');
  
  const advContent = document.getElementById('subTabAdvanceContent');
  const leaveContent = document.getElementById('subTabLeaveContent');
  const otContent = document.getElementById('subTabOtContent');
  const statusContent = document.getElementById('subTabStatusContent');

  [advContent, leaveContent, otContent, statusContent].forEach(el => el?.classList.add('hidden'));
  [advBtn, leaveBtn, otBtn, statusBtn].forEach(b => {
    if (b) b.className = 'flex-1 py-2 text-xs font-bold rounded-xl text-slate-600 hover:text-slate-900 transition';
  });

  if (sub === 'advance') {
    advContent?.classList.remove('hidden');
    if (advBtn) advBtn.className = 'flex-1 py-2 text-xs font-bold rounded-xl bg-white shadow-sm text-emerald-700 transition';
    loadAdvanceEligibility();
  } else if (sub === 'leave') {
    leaveContent?.classList.remove('hidden');
    if (leaveBtn) leaveBtn.className = 'flex-1 py-2 text-xs font-bold rounded-xl bg-white shadow-sm text-sky-700 transition';
  } else if (sub === 'ot') {
    otContent?.classList.remove('hidden');
    if (otBtn) otBtn.className = 'flex-1 py-2 text-xs font-bold rounded-xl bg-white shadow-sm text-indigo-700 transition';
  } else if (sub === 'status') {
    statusContent?.classList.remove('hidden');
    if (statusBtn) statusBtn.className = 'flex-1 py-2 text-xs font-bold rounded-xl bg-white shadow-sm text-slate-800 transition';
    loadMyRequests();
  }

  // Re-apply feature toggles so disabled tab buttons (e.g. OT when disabled) stay hidden!
  applyFeatureToggles();
}

async function submitLeaveRequest() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  const leaveType = document.getElementById('leaveType').value;
  const startDate = document.getElementById('leaveStartDate').value;
  const endDate = document.getElementById('leaveEndDate').value;
  const daysCount = document.getElementById('leaveDaysCount').value;
  const reason = document.getElementById('leaveReason').value.trim();
  const fileInput = document.getElementById('leaveCertFile');

  if (!startDate || !endDate || !daysCount) {
    Swal.fire('กรุณากรอกข้อมูลวันที่ให้ครบถ้วน', '', 'warning');
    return;
  }

  let certDataUrl = null;
  if (fileInput && fileInput.files && fileInput.files[0]) {
    certDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(fileInput.files[0]);
    });
  }

  Swal.fire({ title: 'กำลังส่งคำขอลางาน...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submitLeaveRequest',
        empId: currentEmployee.empId,
        leaveType,
        startDate,
        endDate,
        daysCount,
        reason,
        medicalCertUrl: certDataUrl
      })
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire('ส่งคำขอลางานสำเร็จ', 'คำขอถูกส่งไปยังหัวหน้างาน/HR แล้ว', 'success');
      document.getElementById('leaveReason').value = '';
      if (fileInput) fileInput.value = '';
      switchSubTab('status');
    } else {
      if (handleMaintenanceResponse(data)) return;
      Swal.fire('ไม่สามารถส่งคำขอได้', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

async function submitOtRequest() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  if (currentEmployee.isOtEligible === false || currentEmployee.is_ot_eligible === 'false') {
    Swal.fire({
      icon: 'info',
      title: 'ไม่มีสิทธิ์เบิกค่าล่วงเวลา',
      text: 'ตำแหน่งงานของคุณได้รับการกำหนดค่าจ้างแบบเหมาจ่าย ไม่สามารถส่งคำขอ OT ได้'
    });
    return;
  }

  const date = document.getElementById('otDate').value;
  const plannedHours = document.getElementById('otPlannedHours').value;
  const otType = document.getElementById('otType').value;
  const reason = document.getElementById('otReason').value.trim();

  if (!date || !plannedHours) {
    Swal.fire('กรุณาระบุวันที่และชั่วโมง OT', '', 'warning');
    return;
  }

  Swal.fire({ title: 'กำลังส่งคำขอ OT...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submitOtRequest',
        empId: currentEmployee.empId,
        date,
        plannedHours,
        otType,
        reason
      })
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire('ส่งคำขอทำ OT สำเร็จ', 'รอหัวหน้างานอนุมัติคำขอ', 'success');
      document.getElementById('otReason').value = '';
      switchSubTab('status');
    } else {
      if (handleMaintenanceResponse(data)) return;
      Swal.fire('ไม่สามารถส่งคำขอได้', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

async function loadMyRequests() {
  if (!currentEmployee) return;
  const container = document.getElementById('myRequestsList');
  if (container) container.innerHTML = '<div class="text-center py-4 text-slate-400">กำลังโหลดรายการคำขอ...</div>';

  const today = new Date().toISOString().substring(0, 10);
  const curMonth = today.substring(0, 7);

  try {
    const res = await fetch(`${API_URL}?action=getEmployeeHistory&empId=${currentEmployee.empId}&month=${curMonth}`);
    const data = await res.json();
    if (data.success) {
      let html = '';
      const leaves = data.leaves || [];
      const ots = data.ots || [];
      const advances = data.advances || [];

      // Check and fire realtime notification if any request status transitioned
      checkRequestStatusChanges(leaves, ots, advances);

      if (leaves.length === 0 && ots.length === 0 && advances.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-slate-400">ยังไม่มีรายการคำขอในเดือนนี้</div>';
        return;
      }

      advances.forEach(ad => {
        const badgeColor = ad.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (ad.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = ad.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (ad.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        const cancelBtn = ad.status === 'PENDING' ? `
          <button onclick="cancelMyRequest('advance', ${ad.id})" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-600 rounded-xl text-xs font-bold border border-rose-200 flex items-center gap-1 transition">
            <i class="fa-solid fa-trash-can text-[11px]"></i> ยกเลิกคำขอ
          </button>
        ` : '';
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-800 text-sm">💵 ขอเบิกเงิน: ${ad.amount} บาท</span>
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
                ${cancelBtn}
              </div>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่ขอ: ${ad.request_date} (วันทำงาน ${ad.days_worked} วัน)</div>
            ${ad.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${ad.reason}</div>` : ''}
          </div>
        `;
      });

      leaves.forEach(lv => {
        const badgeColor = lv.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (lv.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = lv.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (lv.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        const cancelBtn = lv.status === 'PENDING' ? `
          <button onclick="cancelMyRequest('leave', ${lv.id})" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-600 rounded-xl text-xs font-bold border border-rose-200 flex items-center gap-1 transition">
            <i class="fa-solid fa-trash-can text-[11px]"></i> ยกเลิกคำขอ
          </button>
        ` : '';
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-800 text-sm">🏖️ ขอลางาน: ${LEAVE_TYPE_LABELS[lv.leave_type] || lv.leave_type}</span>
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
                ${cancelBtn}
              </div>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่: ${lv.start_date} ถึง ${lv.end_date} (${lv.days_count} วัน)</div>
            ${lv.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${lv.reason}</div>` : ''}
          </div>
        `;
      });

      ots.forEach(ot => {
        const badgeColor = ot.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (ot.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = ot.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (ot.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        const cancelBtn = ot.status === 'PENDING' ? `
          <button onclick="cancelMyRequest('ot', ${ot.id})" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-600 rounded-xl text-xs font-bold border border-rose-200 flex items-center gap-1 transition">
            <i class="fa-solid fa-trash-can text-[11px]"></i> ยกเลิกคำขอ
          </button>
        ` : '';
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-800 text-sm">⏱️ ขอทำ OT (${ot.ot_type}x)</span>
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
                ${cancelBtn}
              </div>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่: ${ot.date} — ขอ: ${ot.planned_hours} ชม. (จริง: ${ot.actual_hours || 0} ชม.)</div>
            ${ot.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${ot.reason}</div>` : ''}
          </div>
        `;
      });

      container.innerHTML = html;
    }
  } catch(e) {
    if (container) container.innerHTML = '<div class="text-center py-4 text-rose-500">โหลดไม่สำเร็จ</div>';
  }
}

async function cancelMyRequest(type, id) {
  if (!currentEmployee) return;
  const typeText = type === 'advance' ? 'เบิกเงินล่วงหน้า' : (type === 'leave' ? 'ลางาน' : 'ทำ OT');
  const confirmResult = await Swal.fire({
    title: `ยกเลิกคำขอ${typeText}?`,
    text: 'คุณต้องการยกเลิกคำขอนี้ใช่หรือไม่ รายการจะถูกลบออกจากระบบทันที',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#e11d48',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ใช่, ยกเลิกคำขอ',
    cancelButtonText: 'ไม่'
  });

  if (!confirmResult.isConfirmed) return;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'cancelMyRequest',
        empId: currentEmployee.empId,
        type,
        id
      })
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire({
        icon: 'success',
        title: data.message || 'ยกเลิกคำขอเรียบร้อยแล้ว',
        timer: 1500,
        showConfirmButton: false
      });
      loadMyRequests();
      loadAdvanceEligibility();
      if (typeof loadEmployeeHistory === 'function') loadEmployeeHistory();
    } else {
      if (handleMaintenanceResponse(data)) return;
      Swal.fire('เกิดข้อผิดพลาด', data.message || 'ไม่สามารถยกเลิกคำขอได้', 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

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
          <span class="text-xs text-slate-500 font-medium">${ad.request_date}</span>
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
          <span class="text-xs text-slate-500 font-medium">${lv.created_at?.substring(0, 16) || ''}</span>
        </div>
        <div class="text-xs text-slate-700">
          ประเภท: <b class="text-sky-800 font-bold">${lv.leave_type}</b> (${lv.days_count} วัน)<br>
          ช่วงวัน: ${lv.start_date} ถึง ${lv.end_date}<br>
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
          <span class="text-xs text-slate-500 font-medium">${ot.created_at?.substring(0, 16) || ''}</span>
        </div>
        <div class="text-xs text-slate-700">
          วันที่: <b>${ot.date}</b> — จำนวน: <b class="text-indigo-800 font-bold">${ot.planned_hours} ชม.</b> (อัตรา ${ot.ot_type}x)<br>
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
// 13. TAB NAVIGATION
// ==============================================================================
function switchTab(tab) {
  if (tab === 'payslip' && appSettings.enable_payslip === 'false') {
    Swal.fire({
      icon: 'info',
      title: 'ฟังก์ชันสลิปเงินเดือนปิดใช้งาน',
      text: 'ผู้ดูแลระบบปิดการใช้งานฟังก์ชันสลิปเงินเดือนชั่วคราว'
    });
    tab = 'clock';
  }

  const tabs = ['clock', 'history', 'requests', 'payslip'];
  tabs.forEach(t => {
    const section = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const navBtn = document.getElementById('navBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    if (section) section.classList.add('hidden');
    if (navBtn) {
      navBtn.className = 'flex-1 flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-600 transition';
    }
  });

  const activeSection = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  const activeNavBtn = document.getElementById('navBtn' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (activeSection) activeSection.classList.remove('hidden');
  if (activeNavBtn) {
    activeNavBtn.className = 'flex-1 flex flex-col items-center justify-center py-1 text-sky-600 transition font-semibold';
  }

  if (tab === 'history') {
    loadEmployeeHistory();
  } else if (tab === 'requests') {
    if (appSettings.enable_advance_requests !== 'false') {
      switchSubTab('advance');
    } else if (appSettings.enable_leave_requests !== 'false') {
      switchSubTab('leave');
    } else if (appSettings.enable_ot_requests !== 'false') {
      switchSubTab('ot');
    } else {
      switchSubTab('status');
    }
  } else if (tab === 'payslip') {
    initPayslipView();
  }

  applyFeatureToggles();
}

// ==============================================================================
// 14. DEVICE LOCK & 3-WAY UNLOCK CONTROLLERS
// ==============================================================================
function openDeviceUnlockModal() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }
  applyFeatureToggles();
  const nameEl = document.getElementById('unlockCurrentEmpName');
  if (nameEl) {
    const nick = currentEmployee.nickname ? ` (${currentEmployee.nickname})` : '';
    nameEl.textContent = `[${currentEmployee.empId}] ${currentEmployee.fullName}${nick} - ${currentEmployee.department || 'พนักงาน'}`;
  }
  const passEl = document.getElementById('unlockSupervisorPass');
  if (passEl) passEl.value = '';
  document.getElementById('modalDeviceUnlock')?.classList.remove('hidden');
}

function closeDeviceUnlockModal() {
  document.getElementById('modalDeviceUnlock')?.classList.add('hidden');
}

async function submitSupervisorPasswordUnlock() {
  const u = document.getElementById('unlockSupervisorUser')?.value.trim();
  const p = document.getElementById('unlockSupervisorPass')?.value.trim();
  if (!u || !p) {
    Swal.fire('กรุณากรอกชื่อผู้ใช้และรหัสผ่านหัวหน้างาน/HR', '', 'warning');
    return;
  }

  Swal.fire({ title: 'กำลังตรวจสอบสิทธิ์หัวหน้างาน...', didOpen: () => Swal.showLoading() });
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'unlockDeviceWithPassword',
        empId: currentEmployee ? currentEmployee.empId : null,
        deviceId: getOrCreateDeviceId(),
        username: u,
        password: p
      })
    });
    const data = await res.json();
    if (data.success) {
      isDeviceLocked = false;
      currentEmployee = null;
      localStorage.removeItem('ptn_time_emp');
      updateHeaderEmployeeView();
      closeDeviceUnlockModal();
      await Swal.fire({
        icon: 'success',
        title: 'ปลดล็อกเครื่องสำเร็จ!',
        text: 'อุปกรณ์นี้สามารถเลือกหรือผูกกับพนักงานคนใหม่ได้แล้ว',
        timer: 1800,
        showConfirmButton: false
      });
      openEmployeePickerModal();
    } else {
      Swal.fire('ปลดล็อกไม่สำเร็จ', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

function startScanMasterQrToUnlock() {
  closeDeviceUnlockModal();
  openQrScannerModal('UNLOCK');
}

async function submitScanMasterQrUnlock(token) {
  Swal.fire({ title: 'กำลังยืนยัน Master QR...', didOpen: () => Swal.showLoading() });
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'unlockDeviceWithQr',
        empId: currentEmployee ? currentEmployee.empId : null,
        deviceId: getOrCreateDeviceId(),
        qrToken: token
      })
    });
    const data = await res.json();
    if (data.success) {
      isDeviceLocked = false;
      currentEmployee = null;
      localStorage.removeItem('ptn_time_emp');
      updateHeaderEmployeeView();
      await Swal.fire({
        icon: 'success',
        title: 'ปลดล็อกด้วย Master QR สำเร็จ!',
        text: 'อุปกรณ์นี้ได้รับการปลดล็อกโดยหัวหน้างานเรียบร้อยแล้ว',
        timer: 1800,
        showConfirmButton: false
      });
      openEmployeePickerModal();
    } else {
      Swal.fire('ปลดล็อกไม่สำเร็จ', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

// SUPERVISOR MASTER QR GENERATOR (Method 2 Display)
async function openMasterQrModal() {
  document.getElementById('modalMasterQrDisplay')?.classList.remove('hidden');
  await refreshMasterQr();
  if (masterQrInterval) clearInterval(masterQrInterval);
  masterQrInterval = setInterval(refreshMasterQr, 20000);
}

function closeMasterQrModal() {
  document.getElementById('modalMasterQrDisplay')?.classList.add('hidden');
  if (masterQrInterval) {
    clearInterval(masterQrInterval);
    masterQrInterval = null;
  }
}

async function refreshMasterQr() {
  try {
    const res = await fetch(API_URL + '?action=getMasterUnlockQr');
    const data = await res.json();
    if (data.success) {
      const box = document.getElementById('masterQrBox');
      const tokenText = document.getElementById('masterQrTokenText');
      const countdown = document.getElementById('masterQrCountdown');
      if (tokenText) tokenText.textContent = data.token;
      if (countdown) countdown.textContent = data.secondsLeft;

      if (box && window.QRCode) {
        box.innerHTML = '';
        new QRCode(box, {
          text: data.token,
          width: 190,
          height: 190,
          colorDark: "#047857",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }
  } catch(e) {
    console.warn('Master QR error:', e);
  }
}

// SUPERVISOR DEVICE LOCKS LIST
async function loadDeviceLocksList() {
  const container = document.getElementById('supervisorDeviceLocksList');
  if (!container) return;
  try {
    const res = await fetch(API_URL + '?action=getDeviceLockList');
    const data = await res.json();
    if (data.success && data.devices && data.devices.length > 0) {
      container.innerHTML = data.devices.map(d => `
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="font-bold text-slate-900 text-xs truncate">
              [${d.emp_id}] ${d.full_name || 'พนักงาน'} ${d.nickname ? '(' + d.nickname + ')' : ''}
            </div>
            <div class="text-[10px] text-slate-500 truncate">
              📱 ${d.device_name || 'Mobile Web'} &bull; ผูกเมื่อ: ${d.bound_at?.substring(0, 16) || '-'}
            </div>
          </div>
          <button onclick="supervisorResetDevice('${d.emp_id}', '${d.full_name || d.emp_id}')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] rounded-xl flex-shrink-0 transition active:scale-95">
            ปลดล็อก
          </button>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<div class="text-center py-4 text-slate-400 text-xs">ยังไม่มีพนักงานผูกเครื่องในระบบ ✨</div>';
    }
  } catch(e) {
    container.innerHTML = '<div class="text-center py-4 text-rose-500 text-xs">โหลดรายการไม่สำเร็จ</div>';
  }
}

async function supervisorResetDevice(empId, empName) {
  const confirm = await Swal.fire({
    title: `ปลดล็อกเครื่องพนักงาน?`,
    text: `ต้องการปลดล็อกอุปกรณ์ของ [${empId}] ${empName} ใช่หรือไม่? พนักงานจะสามารถเลือกหรือผูกเครื่องใหม่ได้`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ใช่, ปลดล็อกทันที',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626'
  });
  if (!confirm.isConfirmed) return;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resetEmployeeDevice', empId })
    });
    const data = await res.json();
    if (data.success) {
      Swal.fire('ปลดล็อกสำเร็จ', data.message, 'success');
      loadDeviceLocksList();
    } else {
      Swal.fire('เกิดข้อผิดพลาด', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

// ==============================================================================
// 14. REALTIME PUSH NOTIFICATIONS & SERVICE WORKER (PWA)
// ==============================================================================

let swRegistration = null;
let breakTimer50 = null;
let breakTimer60 = null;

// Register Service Worker
async function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js');
      console.log('PTN Time Service Worker registered');
    } catch (e) {
      console.warn('Service Worker registration note:', e);
    }
  }
}

// Request Notification Permission
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    Swal.fire('อุปกรณ์ไม่รองรับ', 'เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับการแจ้งเตือนแบบ Push', 'info');
    return false;
  }

  try {
    const perm = await Notification.requestPermission();
    checkNotificationBanner();

    if (perm === 'granted') {
      Swal.fire({
        icon: 'success',
        title: 'เปิดรับการแจ้งเตือนสำเร็จ! 🔔',
        text: 'คุณจะได้รับการแจ้งเตือนเวลาเข้า-ออกงาน, เตือนเวลาพักเบรก, และผลการอนุมัติคำขอต่างๆ',
        confirmButtonColor: '#0284c7'
      });
      sendPushOrLocalNotification(
        'PTN Time เชื่อมต่อการแจ้งเตือนสำเร็จ 🔔',
        'ยินดีต้อนรับ! ระบบพร้อมส่งการแจ้งเตือนสำคัญถึงคุณแล้ว',
        'welcome'
      );
      return true;
    } else if (perm === 'denied') {
      Swal.fire({
        icon: 'warning',
        title: 'การแจ้งเตือนถูกปิดกั้น',
        text: 'กรุณาเปิดการอนุญาตการแจ้งเตือนในการตั้งค่าของเบราว์เซอร์/โทรศัพท์',
        confirmButtonColor: '#0284c7'
      });
      return false;
    }
  } catch(e) {
    console.error('Permission request error:', e);
  }
}

function dismissNotifBanner() {
  document.getElementById('notifPermissionBanner')?.classList.add('hidden');
  localStorage.setItem('ptn_dismiss_notif_banner', 'true');
}

function checkNotificationBanner() {
  const banner = document.getElementById('notifPermissionBanner');
  if (!banner) return;
  if (!('Notification' in window) || Notification.permission === 'granted' || localStorage.getItem('ptn_dismiss_notif_banner') === 'true') {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
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
        <span class="text-[10px] text-slate-400">${item.date} ${item.time}</span>
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
  localStorage.setItem('ptn_break_start_timestamp', now.getTime().toString());

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
}

// Check Break duration when reopening app
function checkActiveBreakOnWake() {
  const stored = localStorage.getItem('ptn_break_start_timestamp');
  if (!stored) return;
  const elapsedMinutes = Math.floor((Date.now() - parseInt(stored, 10)) / 60000);
  if (elapsedMinutes >= 60) {
    sendPushOrLocalNotification(
      '⚠️ คุณพักเกินเกณฑ์ 60 นาทีแล้ว!',
      `ขณะนี้คุณพักไปแล้ว ${elapsedMinutes} นาที กรุณาสแกนกลับเข้าทำงานทันที`,
      'break_over'
    );
  } else if (elapsedMinutes >= 50) {
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

  // Check OT
  ots.forEach(ot => {
    const id = 'ot_' + ot.id;
    newStatuses[id] = ot.status;
    if (prevStatuses[id] && prevStatuses[id] === 'PENDING' && ot.status !== 'PENDING') {
      if (ot.status === 'APPROVED') {
        sendPushOrLocalNotification(
          '✅ คำขอ OT ได้รับการอนุมัติแล้ว',
          `คำขอ OT วันที่ ${ot.ot_date} (${ot.ot_hours} ชม.) ได้รับการอนุมัติเข้างวดแล้ว`,
          'ot_approved'
        );
      } else if (ot.status === 'REJECTED') {
        sendPushOrLocalNotification(
          '❌ คำขอ OT ไม่ได้รับการอนุมัติ',
          `คำขอ OT วันที่ ${ot.ot_date} ถูกปฏิเสธ`,
          'ot_rejected'
        );
      }
    }
  });

  // Check Leave
  leaves.forEach(lv => {
    const id = 'lv_' + lv.id;
    newStatuses[id] = lv.status;
    if (prevStatuses[id] && prevStatuses[id] === 'PENDING' && lv.status !== 'PENDING') {
      if (lv.status === 'APPROVED') {
        sendPushOrLocalNotification(
          '✅ คำขอลางานได้รับการอนุมัติแล้ว',
          `คำขอลาวันที่ ${lv.start_date} ได้รับการอนุมัติแล้ว`,
          'leave_approved'
        );
      } else if (lv.status === 'REJECTED') {
        sendPushOrLocalNotification(
          '❌ คำขอลางานถูกปฏิเสธ',
          `คำขอลาวันที่ ${lv.start_date} ไม่ได้รับการอนุมัติ (${lv.reject_reason || '-'})`,
          'leave_rejected'
        );
      }
    }
  });

  // Check Advance
  advances.forEach(ad => {
    const id = 'ad_' + ad.id;
    newStatuses[id] = ad.status;
    if (prevStatuses[id] && prevStatuses[id] === 'PENDING' && ad.status !== 'PENDING') {
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

// ==============================================================================
// 16. E-PAYSLIP CONTROLLER (สลิปเงินเดือนออนไลน์ & PIN LOCK)
// ==============================================================================

function initPayslipView() {
  const payslipEnabled = (appSettings.enable_payslip !== 'false');
  const disabledNotice = document.getElementById('payslipDisabledNotice');
  const pinGate = document.getElementById('payslipPinGate');
  const detailContainer = document.getElementById('payslipDetailContainer');
  const pinInput = document.getElementById('payslipPinInput');

  // Hide new badge once user navigates to payslip tab
  const badge = document.getElementById('badgePayslipNew');
  if (badge) badge.classList.add('hidden');

  if (!payslipEnabled) {
    disabledNotice?.classList.remove('hidden');
    pinGate?.classList.add('hidden');
    detailContainer?.classList.add('hidden');
    return;
  }

  disabledNotice?.classList.add('hidden');

  if (!currentEmployee) {
    pinGate?.classList.remove('hidden');
    detailContainer?.classList.add('hidden');
    openEmployeePickerModal();
    return;
  }

  if (!isPayslipUnlocked) {
    pinGate?.classList.remove('hidden');
    detailContainer?.classList.add('hidden');
    if (pinInput) {
      pinInput.value = '';
      setTimeout(() => pinInput.focus(), 200);
    }
  } else {
    pinGate?.classList.add('hidden');
    detailContainer?.classList.remove('hidden');
    if (!currentPayslipData) {
      loadEmployeePayslips();
    }
  }
}

async function verifyAndUnlockPayslip() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  const pinInput = document.getElementById('payslipPinInput');
  const pin = pinInput ? pinInput.value.trim() : '';

  if (!pin) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกรหัส PIN',
      text: 'ใช้เลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์'
    });
    return;
  }

  if (pin === '1234') {
    Swal.fire({
      icon: 'error',
      title: 'รหัสไม่ถูกต้อง',
      text: 'รหัส 1234 ถูกยกเลิกแล้ว กรุณาใช้เลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์'
    });
    return;
  }

  await loadEmployeePayslips(null, pin);
}

async function loadEmployeePayslips(period = null, pin = null) {
  if (!currentEmployee) return;

  const pinGate = document.getElementById('payslipPinGate');
  const detailContainer = document.getElementById('payslipDetailContainer');
  const periodSelect = document.getElementById('payslipPeriodSelect');

  Swal.fire({
    title: 'กำลังโหลดข้อมูลสลิปเงินเดือน...',
    didOpen: () => Swal.showLoading(),
    allowOutsideClick: false
  });

  try {
    let url = `${API_URL}?action=getMyPayslips&empId=${encodeURIComponent(currentEmployee.empId)}`;
    if (period) url += `&period=${encodeURIComponent(period)}`;
    if (pin) url += `&pin=${encodeURIComponent(pin)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.success) {
      Swal.close();
      isPayslipUnlocked = true;
      pinGate?.classList.add('hidden');
      detailContainer?.classList.remove('hidden');

      // Populate Period Dropdown
      if (periodSelect && data.periods && data.periods.length > 0) {
        periodSelect.innerHTML = '';
        data.periods.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = `งวด ${p}`;
          if (data.payslip && data.payslip.period === p) {
            opt.selected = true;
          }
          periodSelect.appendChild(opt);
        });
      }

      if (data.payslip) {
        currentPayslipData = data.payslip;
        renderPayslipVoucher(data.payslip, data.companyInfo);
      } else {
        Swal.fire({
          icon: 'info',
          title: 'ไม่พบข้อมูลสลิปเงินเดือน',
          text: 'ยังไม่มีข้อมูลสลิปเงินเดือนที่สรุปแล้วสำหรับงวดนี้'
        });
      }
    } else {
      if (handleMaintenanceResponse(data)) return;
      Swal.fire({
        icon: 'error',
        title: 'ไม่สามารถเปิดดูสลิปได้',
        text: data.message || 'รหัส PIN ไม่ถูกต้อง หรือระบบปิดให้บริการ'
      });
    }
  } catch (e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
  }
}

function renderPayslipVoucher(slip, companyInfo) {
  if (!slip) return;

  const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Company and Employee Header
  const compEl = document.getElementById('slipCompanyDisplay');
  if (compEl) compEl.textContent = companyInfo?.name || 'บจก. พีทีเอ็น ฟาร์มาเซ็นเตอร์';

  const periodBadge = document.getElementById('slipPeriodBadge');
  if (periodBadge) periodBadge.textContent = slip.period ? `งวด ${slip.period}` : '-';

  const empIdEl = document.getElementById('slipEmpIdDisplay');
  if (empIdEl) empIdEl.textContent = slip.empId || (currentEmployee ? currentEmployee.empId : '-');

  const empNameEl = document.getElementById('slipEmpNameDisplay');
  if (empNameEl) empNameEl.textContent = slip.fullName || (currentEmployee ? currentEmployee.fullName : '-');

  const deptEl = document.getElementById('slipDeptDisplay');
  if (deptEl) deptEl.textContent = slip.department || (currentEmployee ? currentEmployee.department : 'พนักงาน');

  const statusBadge = document.getElementById('slipPeriodStatusBadge');
  if (statusBadge) {
    if (slip.isClosed) {
      statusBadge.textContent = '✓ ปิดงวดแล้ว';
      statusBadge.className = 'inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/30 text-emerald-200 border border-emerald-400/40';
    } else {
      statusBadge.textContent = '⏳ ฉบับร่าง';
      statusBadge.className = 'inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/30 text-amber-200 border border-amber-400/40';
    }
  }

  // Net Pay Hero Card
  const netPayEl = document.getElementById('slipNetPayDisplay');
  if (netPayEl) netPayEl.textContent = `฿ ${fmt(slip.netPay)}`;

  const bankEl = document.getElementById('slipBankDisplay');
  if (bankEl) bankEl.textContent = slip.bankName || 'ธนาคารกสิกรไทย';

  const accEl = document.getElementById('slipAccountDisplay');
  if (accEl) accEl.textContent = slip.bankAccountMasked || '***-*-*----';

  // Earnings
  const totalEarnEl = document.getElementById('slipTotalEarningsDisplay');
  if (totalEarnEl) totalEarnEl.textContent = `฿ ${fmt(slip.grossPay)}`;

  const baseSalaryEl = document.getElementById('slipBaseSalaryDisplay');
  if (baseSalaryEl) baseSalaryEl.textContent = fmt(slip.baseSalary);

  const otLabelEl = document.getElementById('slipOtLabel');
  if (otLabelEl) otLabelEl.textContent = `ค่าล่วงเวลา (OT ${slip.otHours || 0} ชม.)`;

  const otPayEl = document.getElementById('slipOtPayDisplay');
  if (otPayEl) otPayEl.textContent = fmt(slip.otPay);

  const allowEl = document.getElementById('slipAllowanceDisplay');
  if (allowEl) allowEl.textContent = fmt(slip.allowance);

  const bonusEl = document.getElementById('slipBonusDisplay');
  if (bonusEl) bonusEl.textContent = fmt(slip.bonus);

  // Deductions
  const totalDeductEl = document.getElementById('slipTotalDeductionsDisplay');
  if (totalDeductEl) totalDeductEl.textContent = `- ฿ ${fmt(slip.totalDeductions)}`;

  const ssoEl = document.getElementById('slipSsoDisplay');
  if (ssoEl) ssoEl.textContent = fmt(slip.sso);

  const pfEl = document.getElementById('slipPfDisplay');
  if (pfEl) pfEl.textContent = fmt(slip.pf);

  const taxEl = document.getElementById('slipTaxDisplay');
  if (taxEl) taxEl.textContent = fmt(slip.tax);

  const advEl = document.getElementById('slipAdvanceDisplay');
  if (advEl) advEl.textContent = fmt(slip.advanceDeduct);

  const lateEl = document.getElementById('slipLateDisplay');
  if (lateEl) lateEl.textContent = fmt(slip.lateDeduct);

  const leaveDedEl = document.getElementById('slipLeaveDedDisplay');
  if (leaveDedEl) leaveDedEl.textContent = fmt(slip.leaveDeduct);

  const otherDedEl = document.getElementById('slipOtherDisplay');
  if (otherDedEl) otherDedEl.textContent = fmt(slip.otherDeduct);

  // Attendance Stats
  const absEl = document.getElementById('slipAbsentDays');
  if (absEl) absEl.textContent = `${slip.absentDays || 0} วัน`;

  const leaveEl = document.getElementById('slipLeaveDays');
  if (leaveEl) leaveEl.textContent = `${slip.leaveDays || 0} วัน`;

  const sickEl = document.getElementById('slipSickDays');
  if (sickEl) sickEl.textContent = `${slip.sickLeaveDays || 0} วัน`;

  const unpaidSickEl = document.getElementById('slipUnpaidSickDays');
  if (unpaidSickEl) unpaidSickEl.textContent = `${slip.unpaidSickLeaveDays || 0} วัน`;
}

function onPayslipPeriodChange(val) {
  if (val) {
    loadEmployeePayslips(val);
  }
}

function lockPayslip() {
  isPayslipUnlocked = false;
  currentPayslipData = null;
  const pinInput = document.getElementById('payslipPinInput');
  if (pinInput) pinInput.value = '';
  initPayslipView();

  Swal.fire({
    icon: 'info',
    title: 'ล็อกหน้าจอแล้ว',
    text: 'ล็อกการแสดงสลิปเงินเดือนเรียบร้อยแล้ว',
    timer: 1200,
    showConfirmButton: false
  });
}

function printPayslipDocument() {
  window.print();
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


