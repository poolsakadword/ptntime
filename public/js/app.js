/**
 * PTN Time Attendant — Main Frontend Application Engine
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 * Website: https://ptntime.pages.dev
 */

const API_URL = '/api';

// Global State
let currentEmployee = null;
let employeeList = [];
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
  advance_daily_rate: 250,
  advance_max_amount: 3000,
  enable_leave_requests: 'true',
  enable_ot_requests: 'true',
  enable_advance_requests: 'true',
  allow_direct_gps: 'true',
  qr_mode: 'HYBRID',
  break_tracking_mode: 'AUTO_DEDUCT',
  break_duration_minutes: 60
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
  initLiveClock();
  await loadInitialData();
  restoreSavedEmployee();
  getCurrentLocation();
  
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
      if (data.settings) appSettings = { ...appSettings, ...data.settings };
      employeeList = data.employees || [];
      populateEmployeeDropdown();
      updateShiftDisplay();
      applyFeatureToggles();
    }
  } catch (e) {
    console.warn('Backend API connection note:', e);
  }
}

function updateShiftDisplay() {
  const shiftEl = document.getElementById('shiftTickerText');
  if (shiftEl) {
    shiftEl.textContent = `${appSettings.work_start_time} - ${appSettings.work_end_time}`;
  }
}

function applyFeatureToggles() {
  const leaveBtn = document.getElementById('subTabBtnLeave');
  const otBtn = document.getElementById('subTabBtnOt');
  const advBtn = document.getElementById('subTabBtnAdvance');

  if (leaveBtn) {
    if (appSettings.enable_leave_requests === 'false') leaveBtn.classList.add('hidden');
    else leaveBtn.classList.remove('hidden');
  }
  if (otBtn) {
    if (appSettings.enable_ot_requests === 'false') otBtn.classList.add('hidden');
    else otBtn.classList.remove('hidden');
  }
  if (advBtn) {
    if (appSettings.enable_advance_requests === 'false') advBtn.classList.add('hidden');
    else advBtn.classList.remove('hidden');
  }

  const directGpsContainer = document.getElementById('containerDirectGps');
  if (directGpsContainer) {
    if (appSettings.allow_direct_gps === 'false') {
      directGpsContainer.classList.add('hidden');
    } else {
      directGpsContainer.classList.remove('hidden');
    }
  }
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
        }
      } catch(err) {
        // Offline or fallback, retain lock
        isDeviceLocked = true;
      }

      updateHeaderEmployeeView();
      loadTodayStatus();
      loadAdvanceEligibility();
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
        const numPart = currentEmployee.empId.replace(/[^0-9]/g, '');
        avatarEl.textContent = numPart ? numPart.slice(-2) : 'PTN';
      }
      if (subEl) {
        subEl.textContent = currentEmployee.department || 'พนักงาน';
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
      if (stepEmpId) stepEmpId.textContent = `${currentEmployee.empId} • ${currentEmployee.department || 'พนักงาน'}`;
      if (stepEmpAvatar) {
        const numPart = currentEmployee.empId.replace(/[^0-9]/g, '');
        stepEmpAvatar.textContent = numPart ? numPart.slice(-2) : '👤';
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
}

// ==============================================================================
// 3. EMPLOYEE PICKER / LOGIN (AUTO-REMEMBER)
// ==============================================================================
function populateEmployeeDropdown() {
  const sel = document.getElementById('empSelectDropdown');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- กรุณาเลือกพนักงาน --</option>';
  employeeList.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.empId;
    const nick = e.nickname ? ` (${e.nickname})` : '';
    opt.textContent = `[${e.empId}] ${e.fullName}${nick} - ${e.department}`;
    sel.appendChild(opt);
  });
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
  const sel = document.getElementById('empSelectDropdown');
  if (sel && currentEmployee) {
    sel.value = currentEmployee.empId;
    document.getElementById('pinEntrySection')?.classList.remove('hidden');
  }
}

function closeEmployeePickerModal() {
  document.getElementById('modalEmployeePicker')?.classList.add('hidden');
}

function onSelectEmployeeDropdown(val) {
  const pinSec = document.getElementById('pinEntrySection');
  if (val) {
    pinSec?.classList.remove('hidden');
  } else {
    pinSec?.classList.add('hidden');
  }
}

async function confirmEmployeeLogin() {
  const sel = document.getElementById('empSelectDropdown');
  const pinInput = document.getElementById('empPinInput');
  const empId = sel?.value;
  const pin = pinInput?.value.trim() || '1234';
  const deviceId = getOrCreateDeviceId();

  if (!empId) {
    Swal.fire('กรุณาเลือกพนักงาน', '', 'warning');
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

function getCurrentLocation(silent = false) {
  const statusText = document.getElementById('gpsStatusText');
  const distText = document.getElementById('gpsDistanceText');
  const badge = document.getElementById('gpsBadge');
  const pulse = document.getElementById('gpsPulseDot');

  if (!navigator.geolocation) {
    if (statusText) statusText.textContent = 'เบราว์เซอร์ไม่รองรับ GPS';
    return;
  }

  if (!silent && statusText) statusText.textContent = 'กำลังจับพิกัด GPS...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      currentLocation = { lat, lng, accuracy: pos.coords.accuracy };

      const dist = calculateHaversineMeters(lat, lng, appSettings.office_lat, appSettings.office_lng);
      currentDistanceMeters = dist;

      const isInside = dist <= appSettings.geofence_radius_meters;

      if (statusText) statusText.textContent = `พิกัด GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (distText) distText.textContent = `ห่างจากสำนักงาน: ${dist} ม. (รัศมีอนุญาต ${appSettings.geofence_radius_meters} ม.)`;

      if (badge && pulse) {
        if (isInside) {
          badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700';
          badge.textContent = '🟢 อยู่ในพื้นที่บริษัท';
          pulse.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping';
        } else {
          badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-100 text-rose-700';
          badge.textContent = '🔴 อยู่นอกพื้นที่';
          pulse.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
        }
      }
    },
    (err) => {
      console.warn('Geolocation notice:', err.message);
      if (statusText) statusText.textContent = 'ไม่พบพิกัด (กรุณาเปิด GPS/อนุญาตเข้าถึงตำแหน่ง)';
      if (badge) {
        badge.className = 'px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-700';
        badge.textContent = '⚠️ GPS ปิดอยู่';
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ==============================================================================
// 5. FULLSCREEN SELFIE CAMERA SYSTEM (MODERN FULL-VIEWPORT MODAL)
// ==============================================================================
let fsCameraStream = null;
let currentCameraFacing = 'user'; // 'user' (front) or 'environment' (back)
let activePendingClock = null; // { type: 'IN' | 'OUT', qrToken: string | null }

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

  if (currentDistanceMeters > appSettings.geofence_radius_meters && appSettings.allow_outside_clockin !== 'true') {
    Swal.fire({
      icon: 'error',
      title: 'อยู่นอกพื้นที่สำนักงาน',
      text: `คุณอยู่ห่างจากสำนักงาน ${currentDistanceMeters} เมตร (อนุญาตไม่เกิน ${appSettings.geofence_radius_meters} ม.)`
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

  modal?.classList.remove('hidden');
  await initFullscreenCameraStream();
}

async function initFullscreenCameraStream() {
  const video = document.getElementById('fsVideoPreview');
  if (!video) return;

  try {
    if (fsCameraStream) {
      fsCameraStream.getTracks().forEach(t => t.stop());
      fsCameraStream = null;
    }

    const constraints = {
      video: {
        facingMode: currentCameraFacing,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    fsCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = fsCameraStream;

    if (currentCameraFacing === 'user') {
      video.classList.add('cam-video-mirrored');
      video.classList.remove('cam-video-normal');
    } else {
      video.classList.add('cam-video-normal');
      video.classList.remove('cam-video-mirrored');
    }
  } catch (err) {
    console.error('Camera access error:', err);
    closeFullscreenCamera();
    Swal.fire({
      icon: 'warning',
      title: 'ไม่สามารถเปิดกล้องได้',
      text: 'กรุณาอนุญาตให้เบราว์เซอร์เข้าถึงกล้องหน้าเพื่อถ่ายรูปเซลฟี่ยืนยันตัวตน'
    });
  }
}

function toggleCameraFacing() {
  currentCameraFacing = (currentCameraFacing === 'user') ? 'environment' : 'user';
  initFullscreenCameraStream();
}

function closeFullscreenCamera() {
  const modal = document.getElementById('modalCameraFullscreen');
  modal?.classList.add('hidden');

  if (fsCameraStream) {
    fsCameraStream.getTracks().forEach(t => t.stop());
    fsCameraStream = null;
  }
  activePendingClock = null;
}

function triggerShutterCapture() {
  const video = document.getElementById('fsVideoPreview');
  const canvas = document.getElementById('fsPhotoCanvas');
  const flash = document.getElementById('camFlashOverlay');

  if (!video || !canvas || !activePendingClock) return;

  // 1. Shutter Flash Effect & Haptic Vibration
  if (flash) {
    flash.style.opacity = '0.85';
    setTimeout(() => { flash.style.opacity = '0'; }, 180);
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(50); } catch(e) {}
  }

  // 2. Crop and Compress Frame from Video
  const targetSize = 400; // 400x400 square crop
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

  const photoBase64 = canvas.toDataURL('image/jpeg', 0.75);

  const pendingData = Object.assign({}, activePendingClock);
  closeFullscreenCamera();

  // 3. Immediately Submit Clock Action with Photo
  submitClockWithPhoto(pendingData.type, pendingData.qrToken, photoBase64);
}

function startDirectGpsClock(type) {
  if (!currentEmployee) {
    openEmployeePickerModal();
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
        // Success callback
        html5QrScannerInstance.stop().then(() => {
          closeQrScannerModal();
          if (pendingScanType === 'UNLOCK') {
            submitScanMasterQrUnlock(decodedText);
          } else {
            // Seamlessly open Fullscreen Camera to take selfie!
            openFullscreenCamera(pendingScanType, decodedText);
          }
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
      html5QrScannerInstance.stop().catch(() => {});
    } catch(e) {}
  }
}

// ==============================================================================
// 7. SUBMIT CLOCK IN / OUT ACTION
// ==============================================================================
async function submitClockWithPhoto(type, qrToken, photoUrl) {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  // Check allow direct GPS
  if (!qrToken && appSettings && appSettings.allow_direct_gps === 'false') {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่อนุญาตให้ลงเวลาด้วย GPS โดยตรง',
      text: 'ระบบตั้งค่าให้พนักงานต้องสแกน QR Code ประจำสาขาหรือหน้าจอเคาน์เตอร์เท่านั้น'
    });
    return;
  }

  // Geofence check
  if (!currentLocation) {
    getCurrentLocation();
    Swal.fire('กำลังตรวจพิกัด GPS', 'กรุณารอระบบยืนยันพิกัด GPS สักครู่ แล้วกดอีกครั้ง', 'info');
    return;
  }

  if (currentDistanceMeters > appSettings.geofence_radius_meters && appSettings.allow_outside_clockin !== 'true') {
    Swal.fire({
      icon: 'error',
      title: 'อยู่นอกพื้นที่สำนักงาน',
      text: `คุณอยู่ห่างจากสำนักงาน ${currentDistanceMeters} เมตร (อนุญาตไม่เกิน ${appSettings.geofence_radius_meters} ม.)`
    });
    return;
  }

  let actionName = 'clockIn';
  if (type === 'IN') actionName = 'clockIn';
  else if (type === 'OUT') actionName = 'clockOut';
  else if (type === 'BREAK_OUT') actionName = 'breakOut';
  else if (type === 'BREAK_IN') actionName = 'breakIn';

  Swal.fire({ title: `กำลังบันทึกเวลา...`, didOpen: () => Swal.showLoading() });

  try {
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
    const data = await res.json();
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
        Swal.fire({
          icon: 'success',
          title: 'บันทึกเวลาออกไปพักสำเร็จ!',
          html: `
            <div class="text-sm space-y-1">
              <p>เวลาเริ่มพัก: <b class="text-amber-700">${data.breakOutTime}</b></p>
              <p class="text-xs text-slate-500 pt-1">☕ พักผ่อนตามอัธยาศัย อย่าลืมสแกนกลับเข้าทำงานเมื่อหมดเวลาพัก</p>
            </div>
          `
        });
      } else if (type === 'BREAK_IN') {
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
        Swal.fire({
          icon: 'success',
          title: 'บันทึกเวลาออกงานสำเร็จ!',
          html: `
            <div class="text-sm space-y-1">
              <p>เวลาออกงาน: <b class="text-rose-700">${data.clockOutTime}</b></p>
              <p>งานปกติ: <b>${data.workHours} ชม.</b> | OT วันนี้: <b class="text-indigo-700">${data.otHours} ชม.</b></p>
              <p class="text-xs text-slate-500 pt-1">📸 บันทึกรูปถ่ายและพิกัด GPS สำเร็จ</p>
            </div>
          `
        });
      }
      loadTodayStatus();
      loadAdvanceEligibility();
    } else {
      Swal.fire('ไม่สามารถลงเวลาได้', data.message, 'error');
    }
  } catch(e) {
    Swal.fire('เกิดข้อผิดพลาด', e.message, 'error');
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

      // Handle Break Summary Display
      if (isBreakMode) {
        if (breakSummaryRow) breakSummaryRow.classList.remove('hidden');
        if (breakOutEl) breakOutEl.textContent = (log && log.break_out) ? log.break_out : '--:--:--';
        if (breakInEl) breakInEl.textContent = (log && log.break_in) ? log.break_in : '--:--:--';
        if (breakDurationEl) {
          if (log && log.break_minutes > 0) {
            breakDurationEl.textContent = `พัก ${log.break_minutes} นาที` + (log.overbreak_minutes > 0 ? ` (เกิน ${log.overbreak_minutes} น.)` : '');
            breakDurationEl.className = log.overbreak_minutes > 0 ? 'text-[10px] md:text-[11px] text-rose-700 font-bold' : 'text-[10px] md:text-[11px] text-teal-700 font-semibold';
          } else if (log && log.break_out) {
            breakDurationEl.textContent = 'กำลังพักอยู่';
            breakDurationEl.className = 'text-[10px] md:text-[11px] text-amber-700 font-bold animate-pulse';
          } else {
            breakDurationEl.textContent = 'รอพัก';
            breakDurationEl.className = 'text-[10px] md:text-[11px] text-slate-500 font-medium';
          }
        }
      } else {
        if (breakSummaryRow) breakSummaryRow.classList.add('hidden');
      }

      // Render Workflow Step 3 Based on Mode
      if (isBreakMode) {
        if (stdPunchBox) stdPunchBox.classList.add('hidden');
        if (breakPunchBox) breakPunchBox.classList.remove('hidden');

        const stateText = document.getElementById('breakPunchStateText');
        const stateBadge = document.getElementById('breakPunchStateBadge');
        const actionsGrid = document.getElementById('breakActionButtonsGrid');
        const gpsGrid = document.getElementById('breakDirectGpsButtonsGrid');

        if (!log || !log.clock_in) {
          // State 1: Not clocked in
          if (stateText) stateText.textContent = '☀️ ขั้นตอนที่ 1/4 : ยังไม่ได้บันทึกเวลาเข้างานเช้า';
          if (stateBadge) {
            stateBadge.className = 'px-2.5 py-1 rounded-lg text-xs font-black bg-slate-200 text-slate-700';
            stateBadge.textContent = '1/4 เข้าเช้า';
          }
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200';
            badge.textContent = 'ยังไม่ลงเวลา';
          }

          if (actionsGrid) {
            actionsGrid.innerHTML = `
              <button onclick="openQrScannerModal('IN')" class="w-full md:col-span-2 py-5 md:py-6 px-5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold rounded-2xl md:rounded-3xl shadow-lg shadow-emerald-600/30 flex items-center justify-center space-x-4 transition group">
                <div class="w-12 h-12 md:w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition text-2xl">
                  ☀️
                </div>
                <div class="text-left">
                  <div class="text-lg md:text-2xl font-black tracking-wide leading-tight">สแกน QR เข้างานเช้า (IN)</div>
                  <div class="text-xs md:text-sm font-semibold text-emerald-100 mt-0.5">บันทึกเวลาเริ่มงานเช้า (ครั้งที่ 1/4)</div>
                </div>
              </button>
            `;
          }

          if (gpsGrid) {
            gpsGrid.innerHTML = `
              <button type="button" onclick="startDirectGpsClock('IN')" class="md:col-span-2 py-3 px-4 bg-emerald-50 hover:bg-emerald-100 active:scale-[0.98] text-emerald-900 font-bold rounded-2xl border border-emerald-300 flex items-center justify-center space-x-2 transition shadow-sm">
                <span class="text-lg">📸</span>
                <span class="text-sm md:text-base font-black">ถ่ายรูปเข้างานเช้าด้วย GPS (IN)</span>
              </button>
            `;
          }

        } else if (log.clock_in && !log.break_out && !log.clock_out) {
          // State 2: Clocked in, ready to Break Out (or Clock Out)
          if (stateText) stateText.textContent = `☀️ เข้างานเช้าแล้ว (${log.clock_in}) กำลังปฏิบัติงาน`;
          if (stateBadge) {
            stateBadge.className = 'px-2.5 py-1 rounded-lg text-xs font-black bg-sky-100 text-sky-800 border border-sky-300 animate-pulse';
            stateBadge.textContent = '2/4 รอพัก';
          }
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200 animate-pulse';
            badge.textContent = 'เข้างานเช้าแล้ว';
          }

          if (actionsGrid) {
            actionsGrid.innerHTML = `
              <button onclick="openQrScannerModal('BREAK_OUT')" class="w-full py-5 md:py-6 px-5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-bold rounded-2xl md:rounded-3xl shadow-lg shadow-amber-500/30 flex items-center justify-center space-x-4 transition group">
                <div class="w-12 h-12 md:w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition text-2xl">
                  ☕
                </div>
                <div class="text-left">
                  <div class="text-lg md:text-2xl font-black tracking-wide leading-tight">สแกน QR ออกไปพัก</div>
                  <div class="text-xs md:text-sm font-semibold text-amber-100 mt-0.5">พักกลางวัน (Break OUT - 2/4)</div>
                </div>
              </button>

              <button onclick="openQrScannerModal('OUT')" class="w-full py-5 md:py-6 px-5 bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-bold rounded-2xl md:rounded-3xl shadow-lg shadow-rose-600/30 flex items-center justify-center space-x-4 transition group">
                <div class="w-12 h-12 md:w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition text-2xl">
                  🚪
                </div>
                <div class="text-left">
                  <div class="text-lg md:text-2xl font-black tracking-wide leading-tight">สแกน QR ออกงาน</div>
                  <div class="text-xs md:text-sm font-semibold text-rose-100 mt-0.5">เลิกงานกลับบ้าน (Clock OUT)</div>
                </div>
              </button>
            `;
          }

          if (gpsGrid) {
            gpsGrid.innerHTML = `
              <button type="button" onclick="startDirectGpsClock('BREAK_OUT')" class="py-3 px-4 bg-amber-50 hover:bg-amber-100 active:scale-[0.98] text-amber-900 font-bold rounded-2xl border border-amber-300 flex items-center justify-center space-x-2 transition shadow-sm">
                <span class="text-lg">📸</span>
                <span class="text-sm md:text-base font-black">ถ่ายรูปออกไปพัก (GPS)</span>
              </button>
              <button type="button" onclick="startDirectGpsClock('OUT')" class="py-3 px-4 bg-rose-50 hover:bg-rose-100 active:scale-[0.98] text-rose-900 font-bold rounded-2xl border border-rose-300 flex items-center justify-center space-x-2 transition shadow-sm">
                <span class="text-lg">📸</span>
                <span class="text-sm md:text-base font-black">ถ่ายรูปออกงาน (GPS)</span>
              </button>
            `;
          }

        } else if (log.break_out && !log.break_in && !log.clock_out) {
          // State 3: Currently on Break, waiting Break IN
          if (stateText) stateText.textContent = `☕ กำลังอยู่ในช่วงพัก (เริ่มพัก ${log.break_out})`;
          if (stateBadge) {
            stateBadge.className = 'px-2.5 py-1 rounded-lg text-xs font-black bg-amber-200 text-amber-900 border border-amber-400 animate-pulse';
            stateBadge.textContent = '3/4 กำลังพักผ่อน';
          }
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200 animate-pulse';
            badge.textContent = 'กำลังอยู่ในช่วงพักผ่อน';
          }

          if (actionsGrid) {
            actionsGrid.innerHTML = `
              <button onclick="openQrScannerModal('BREAK_IN')" class="w-full md:col-span-2 py-5 md:py-6 px-5 bg-teal-600 hover:bg-teal-700 active:scale-[0.98] text-white font-bold rounded-2xl md:rounded-3xl shadow-lg shadow-teal-600/30 flex items-center justify-center space-x-4 transition group">
                <div class="w-12 h-12 md:w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition text-2xl">
                  💼
                </div>
                <div class="text-left">
                  <div class="text-lg md:text-2xl font-black tracking-wide leading-tight">สแกน QR กลับเข้าทำงาน</div>
                  <div class="text-xs md:text-sm font-semibold text-teal-100 mt-0.5">หมดเวลาพัก / เข้างานบ่าย (Break IN - 3/4)</div>
                </div>
              </button>
            `;
          }

          if (gpsGrid) {
            gpsGrid.innerHTML = `
              <button type="button" onclick="startDirectGpsClock('BREAK_IN')" class="md:col-span-2 py-3 px-4 bg-teal-50 hover:bg-teal-100 active:scale-[0.98] text-teal-900 font-bold rounded-2xl border border-teal-300 flex items-center justify-center space-x-2 transition shadow-sm">
                <span class="text-lg">📸</span>
                <span class="text-sm md:text-base font-black">ถ่ายรูปกลับเข้าทำงานด้วย GPS (Break IN)</span>
              </button>
            `;
          }

        } else if (log.break_in && !log.clock_out) {
          // State 4: Back from break, working afternoon shift
          if (stateText) stateText.textContent = `💼 ปฏิบัติงานช่วงบ่าย (พักไป ${log.break_minutes || 0} นาที) รอลงเวลาเลิกงาน`;
          if (stateBadge) {
            stateBadge.className = 'px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse';
            stateBadge.textContent = '4/4 รอเลิกงาน';
          }
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-teal-100 text-teal-800 border border-teal-200 animate-pulse';
            badge.textContent = 'ปฏิบัติงานช่วงบ่าย';
          }

          if (actionsGrid) {
            actionsGrid.innerHTML = `
              <button onclick="openQrScannerModal('OUT')" class="w-full md:col-span-2 py-5 md:py-6 px-5 bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-bold rounded-2xl md:rounded-3xl shadow-lg shadow-rose-600/30 flex items-center justify-center space-x-4 transition group">
                <div class="w-12 h-12 md:w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-105 transition text-2xl">
                  🚪
                </div>
                <div class="text-left">
                  <div class="text-lg md:text-2xl font-black tracking-wide leading-tight">สแกน QR ออกงาน (Clock OUT)</div>
                  <div class="text-xs md:text-sm font-semibold text-rose-100 mt-0.5">เลิกงานประจำวัน / จบ OT (ครั้งที่ 4/4)</div>
                </div>
              </button>
            `;
          }

          if (gpsGrid) {
            gpsGrid.innerHTML = `
              <button type="button" onclick="startDirectGpsClock('OUT')" class="md:col-span-2 py-3 px-4 bg-rose-50 hover:bg-rose-100 active:scale-[0.98] text-rose-900 font-bold rounded-2xl border border-rose-300 flex items-center justify-center space-x-2 transition shadow-sm">
                <span class="text-lg">📸</span>
                <span class="text-sm md:text-base font-black">ถ่ายรูปออกงานด้วย GPS (OUT)</span>
              </button>
            `;
          }

        } else if (log.clock_out) {
          // State 5: Completed
          if (stateText) stateText.textContent = `✅ บันทึกเวลาครบ 4 ครั้งเรียบร้อยแล้ว (ออกงานเวลา ${log.clock_out})`;
          if (stateBadge) {
            stateBadge.className = 'px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-200 text-emerald-900';
            stateBadge.textContent = 'ครบ 4 ครั้ง';
          }
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
            badge.textContent = 'บันทึกครบถ้วนแล้ว';
          }

          if (actionsGrid) {
            actionsGrid.innerHTML = `
              <div class="md:col-span-2 p-5 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-center">
                <div class="text-3xl mb-1">🎉</div>
                <div class="text-lg font-black text-emerald-950">บันทึกเวลาทำงานของวันนี้ครบถ้วนแล้ว</div>
                <div class="text-xs md:text-sm text-emerald-800 font-semibold mt-1">
                  เข้า: ${log.clock_in} | พัก: ${log.break_out || '-'} ถึง ${log.break_in || '-'} | ออก: ${log.clock_out}
                </div>
              </div>
            `;
          }

          if (gpsGrid) {
            gpsGrid.innerHTML = '';
          }
        }

      } else {
        // Mode 1: Standard 2-Punch Mode (AUTO_DEDUCT)
        if (stdPunchBox) stdPunchBox.classList.remove('hidden');
        if (breakPunchBox) breakPunchBox.classList.add('hidden');

        if (log && log.clock_in) {
          if (log.clock_out) {
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
              badge.textContent = 'บันทึกครบถ้วนแล้ว';
            }
          } else {
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200 animate-pulse';
              badge.textContent = 'กำลังปฏิบัติงาน (เข้างานแล้ว)';
            }
          }
        } else {
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200';
            badge.textContent = 'ยังไม่ลงเวลา';
          }
        }
      }
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

      if (data.isAllowedDay) {
        if (badge) {
          badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
          badge.textContent = '🟢 เปิดรับคำขอวันนี้';
        }
        if (submitBtn) submitBtn.disabled = false;
      } else {
        if (badge) {
          badge.className = 'px-3 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-900 border border-amber-200';
          badge.textContent = '🔒 เปิดเฉพาะวันเสาร์';
        }
        if (submitBtn) submitBtn.disabled = true;
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

      let html = '';
      data.logs.forEach(l => {
        const isLate = l.late_minutes > 0;
        html += `
          <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between text-xs">
            <div class="flex items-center space-x-3">
              <div class="flex items-center -space-x-2 flex-shrink-0">
                ${l.in_photo_url ? `
                  <img src="${l.in_photo_url}" title="รูปถ่ายเข้างาน (${l.clock_in})" class="w-10 h-10 rounded-full object-cover border-2 border-emerald-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="previewCertPhoto('${l.in_photo_url}', 'รูปถ่ายเซลฟี่ตอนเข้างาน ${l.date} (${l.clock_in})')" />
                ` : ''}
                ${l.out_photo_url ? `
                  <img src="${l.out_photo_url}" title="รูปถ่ายออกงาน (${l.clock_out})" class="w-10 h-10 rounded-full object-cover border-2 border-rose-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="previewCertPhoto('${l.out_photo_url}', 'รูปถ่ายเซลฟี่ตอนออกงาน ${l.date} (${l.clock_out})')" />
                ` : ''}
                ${!l.in_photo_url && !l.out_photo_url ? `
                  <div class="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-xs">📅</div>
                ` : ''}
              </div>
              <div class="space-y-0.5">
                <div class="font-bold text-slate-900 text-sm">${l.date}</div>
                <div class="flex items-center space-x-2 text-xs text-slate-600">
                  <span>เข้า: <b class="text-emerald-700">${l.clock_in || '--'}</b></span>
                  <span>ออก: <b class="text-rose-700">${l.clock_out || '--'}</b></span>
                  <span>(ปกติ ${l.work_hours || 0} ชม. ${l.ot_hours > 0 ? '+ OT ' + l.ot_hours + ' ชม.' : ''})</span>
                </div>
              </div>
            </div>
            <div class="text-right flex-shrink-0">
              ${isLate 
                ? `<span class="px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-100 text-amber-900 border border-amber-200">สาย ${l.late_minutes} น.</span>`
                : `<span class="px-2.5 py-1 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">ปกติ</span>`
              }
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

      if (leaves.length === 0 && ots.length === 0 && advances.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-slate-400">ยังไม่มีรายการคำขอในเดือนนี้</div>';
        return;
      }

      advances.forEach(ad => {
        const badgeColor = ad.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (ad.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = ad.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (ad.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-800 text-sm">💵 ขอเบิกเงิน: ${ad.amount} บาท</span>
              <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่ขอ: ${ad.request_date} (วันทำงาน ${ad.days_worked} วัน)</div>
            ${ad.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${ad.reason}</div>` : ''}
          </div>
        `;
      });

      leaves.forEach(lv => {
        const badgeColor = lv.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (lv.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = lv.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (lv.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-800 text-sm">🏖️ ขอลางาน: ${lv.leave_type}</span>
              <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่: ${lv.start_date} ถึง ${lv.end_date} (${lv.days_count} วัน)</div>
            ${lv.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${lv.reason}</div>` : ''}
          </div>
        `;
      });

      ots.forEach(ot => {
        const badgeColor = ot.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (ot.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = ot.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (ot.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-800 text-sm">⏱️ ขอทำ OT (${ot.ot_type}x)</span>
              <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
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
  const tabs = ['clock', 'history', 'requests'];
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
    applyFeatureToggles();
    if (appSettings.enable_advance_requests !== 'false') {
      switchSubTab('advance');
    } else if (appSettings.enable_leave_requests !== 'false') {
      switchSubTab('leave');
    } else if (appSettings.enable_ot_requests !== 'false') {
      switchSubTab('ot');
    } else {
      switchSubTab('status');
    }
  }
}

// ==============================================================================
// 14. DEVICE LOCK & 3-WAY UNLOCK CONTROLLERS
// ==============================================================================
function openDeviceUnlockModal() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }
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

