/**
 * ==============================================================================
 * PTN Time Attendant - Attendance Module (QR Scanner, Punch Engine, Hero Button)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

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
        clearBreakReminders();
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
        clearBreakReminders();
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
      // Auto-clear break reminders if there is no active break today
      if (!log || !log.clock_in || !log.break_out || log.break_in || log.clock_out) {
        clearBreakReminders();
      }

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
      const timelineContainer = document.getElementById('timelineBoxesContainer');
      if (boxBreakOut && boxBreakIn) {
        if (isBreakMode) {
          boxBreakOut.classList.remove('hidden');
          boxBreakIn.classList.remove('hidden');
          if (timelineContainer) timelineContainer.className = 'grid grid-cols-4 gap-1.5 sm:gap-2 text-center';
        } else {
          boxBreakOut.classList.add('hidden');
          boxBreakIn.classList.add('hidden');
          if (timelineContainer) timelineContainer.className = 'grid grid-cols-2 gap-2 sm:gap-3 text-center';
        }
      }

      window.currentTodayLog = log || null;
      window.currentBranchConfig = data.branchConfig || null;
      updateShiftDisplay();

      if (log && log.clock_in) {
        if (lateEl) {
          lateEl.textContent = log.late_minutes > 0 ? `สาย ${log.late_minutes} นาที` : 'ตรงเวลา ปกติ';
          lateEl.className = log.late_minutes > 0 ? 'text-xs sm:text-sm text-amber-700 font-normal' : 'text-xs sm:text-sm text-emerald-700 font-normal';
        }
      } else {
        if (lateEl) {
          const targetBranch = data.branchConfig || getCurrentEmployeeTargetBranch();
          const targetStartTime = targetBranch ? (targetBranch.workStartTime || targetBranch.work_start_time || appSettings.work_start_time || '09:30') : (appSettings.work_start_time || '09:30');
          lateEl.textContent = 'เกณฑ์ ' + targetStartTime + ' น.';
          lateEl.className = 'text-xs sm:text-sm text-emerald-700 font-normal';
        }
      }

      if (log && log.clock_out) {
        if (workSummaryEl) workSummaryEl.textContent = `ปกติ ${log.work_hours} ชม. + OT ${log.ot_hours || 0} ชม.`;
      } else {
        if (workSummaryEl) workSummaryEl.textContent = 'ปกติ 0 ชม.';
      }

      // Check if today is a company holiday
      const curIsoDate = new Date().toISOString().substring(0, 10);
      let todayHoliday = data.holiday || null;
      if (!todayHoliday && Array.isArray(window.companyHolidays)) {
        todayHoliday = window.companyHolidays.find(h => h.date === curIsoDate) || null;
      }

      // Holiday Banner & Notice Elements
      const holBanner = document.getElementById('todayHolidayBanner');
      const holTitle = document.getElementById('todayHolidayTitle');
      const holSub = document.getElementById('todayHolidaySub');
      const holTag = document.getElementById('todayHolidayTag');
      const holNotice = document.getElementById('todayHolidayNoticeCard');

      if (todayHoliday) {
        if (holBanner) {
          holBanner.classList.remove('hidden');
          if (holTitle) holTitle.textContent = todayHoliday.holiday_name || 'วันหยุดบริษัท';
          if (holTag) holTag.textContent = todayHoliday.holiday_type === 'SPECIAL' ? 'วันหยุดพิเศษ' : 'วันหยุดประเพณี';
          if (holSub) holSub.textContent = `วันนี้เป็น${todayHoliday.holiday_type === 'SPECIAL' ? 'วันหยุดพิเศษ' : 'วันหยุดประเพณี'} / วันหยุดบริษัท`;
        }
      } else {
        if (holBanner) holBanner.classList.add('hidden');
        if (holNotice) holNotice.classList.add('hidden');
      }

      // =========================================================================
      // CONCEPT 3: HERO ONE-TAP ACTION LOGIC
      // =========================================================================
      const heroBtn = document.getElementById('heroActionButton');
      const heroIcon = document.getElementById('heroActionIcon');
      const heroTitle = document.getElementById('heroActionTitle');
      const heroSub = document.getElementById('heroActionSubtitle');
      const heroBadge = document.getElementById('heroActionBadge');
      const statusText = document.getElementById('todayStatusText');
      const statusIcon = document.getElementById('todayStatusIcon');
      const secBox = document.getElementById('heroSecondaryActionBox');
      const secBtn = document.getElementById('btnHeroSecondaryAction');
      const directGpsContainer = document.getElementById('containerHeroDirectGps');
      const directGpsBtn = document.getElementById('btnHeroDirectGps');
      const directGpsText = document.getElementById('txtHeroDirectGps');

      const heroBtnClasses = {
        IN: 'radar-circle radar-emerald w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 text-white shadow-2xl shadow-emerald-500/40 flex flex-col items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer',
        OUT: 'radar-circle radar-rose w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-rose-600 via-pink-500 to-rose-400 text-white shadow-2xl shadow-rose-500/40 flex flex-col items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer',
        BREAK_OUT: 'radar-circle radar-amber w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-amber-600 via-orange-500 to-amber-400 text-white shadow-2xl shadow-amber-500/40 flex flex-col items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer',
        BREAK_IN: 'radar-circle radar-sky w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-sky-600 via-cyan-500 to-sky-400 text-white shadow-2xl shadow-sky-500/40 flex flex-col items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer',
        DONE: 'radar-done w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-slate-700 via-slate-600 to-slate-500 text-white shadow-xl shadow-slate-500/30 flex flex-col items-center justify-center transition-all duration-200 cursor-default',
        LOCKED: 'radar-done w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full text-slate-300 shadow-xl flex flex-col items-center justify-center bg-slate-700/90 border-2 border-slate-600/80 cursor-pointer'
      };

      let currentAction = 'IN';
      let secAction = null;
      let secText = '';

      if (isBreakMode) {
        // Mode 2: 4-Punch (BREAK_PUNCH)
        if (!log || !log.clock_in) {
          // State 1: Not clocked in
          currentAction = 'IN';
          secAction = null; // No clock-out allowed if never clocked in

          const nowObj = new Date();
          const curHM = String(nowObj.getHours()).padStart(2, '0') + ':' + String(nowObj.getMinutes()).padStart(2, '0');
          const lunchStart = (window.currentBranchConfig && window.currentBranchConfig.lunchStartTime) || appSettings.lunch_start_time || '13:00';
          const workEnd = (window.currentBranchConfig && window.currentBranchConfig.workEndTime) || appSettings.work_end_time || '19:00';
          const shiftCutoffMins = timeToMinutes(workEnd) + 30; // e.g. 19:30
          const curMins = timeToMinutes(curHM);
          const isPastCutoff = (curMins >= shiftCutoffMins);
          const isAfternoon = (!isPastCutoff && curMins >= timeToMinutes(lunchStart));

          if (todayHoliday) {
            if (holNotice) holNotice.classList.remove('hidden');
            if (statusText) statusText.textContent = `วันหยุดบริษัท: ${todayHoliday.holiday_name || ''}`;
            if (statusIcon) statusIcon.textContent = '🏖️';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-black bg-amber-200 text-amber-950 border border-amber-300 shadow-xs';
              badge.textContent = '⭐ วันหยุดบริษัท';
            }
            if (heroTitle) heroTitle.textContent = 'วันหยุดพักผ่อน';
            if (heroBadge) heroBadge.textContent = 'สแกนทำงาน';
            if (heroSub) heroSub.textContent = 'วันหยุดตามประกาศบริษัท (แตะเพื่อสแกนหากเข้าเวรปฏิบัติงาน)';
            if (heroIcon) heroIcon.textContent = '🏖️';
            if (heroBtn) {
              heroBtn.className = 'radar-circle radar-amber w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-amber-500 via-orange-400 to-amber-300 text-white shadow-2xl shadow-amber-500/40 flex flex-col items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer';
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('IN');
            }
          } else if (isPastCutoff) {
            // Cut off as absent - never clocked in all day
            if (holNotice) holNotice.classList.add('hidden');
            if (statusText) statusText.textContent = 'ไม่พบการลงเวลาของวันนี้ (สถานะ: ขาดงาน)';
            if (statusIcon) statusIcon.textContent = '🚫';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-rose-100 text-rose-800 border border-rose-200';
              badge.textContent = '🔴 ขาดงาน';
            }
            if (heroTitle) heroTitle.textContent = 'พ้นเวลางานแล้ว';
            if (heroBadge) heroBadge.textContent = 'หมดเวลา';
            if (heroSub) heroSub.textContent = 'ไม่พบบันทึกเวลาเข้างานของวันนี้ (หากมาปฏิบัติงานจริง กรุณาติดต่อ HR)';
            if (heroIcon) heroIcon.textContent = '🚫';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.LOCKED;
              heroBtn.disabled = true;
              heroBtn.onclick = () => {
                Swal.fire({
                  icon: 'warning',
                  title: 'พ้นเวลาการลงเวลาของวันนี้แล้ว',
                  text: 'ระบบไม่พบบันทึกเวลาเข้างานของวันนี้ จึงไม่มีการบันทึกเวลาทำงาน หากคุณมาปฏิบัติงานจริง กรุณาติดต่อ HR เพื่อทำการปรับปรุงเวลา',
                  confirmButtonText: 'รับทราบ'
                });
              };
            }
            if (directGpsText) directGpsText.textContent = 'สิ้นสุดเวลาลงเวลาประจำวัน';
            if (directGpsBtn) directGpsBtn.onclick = null;
          } else if (isAfternoon) {
            // Afternoon arrival - allow Clock IN
            if (holNotice) holNotice.classList.add('hidden');
            const hasLeave = (data.leave && data.leave.status === 'APPROVED');
            if (statusText) statusText.textContent = hasLeave ? 'มีใบลาช่วงเช้า (พร้อมเข้างานช่วงบ่าย)' : 'ยังไม่ได้ลงเวลาเข้างาน (ช่วงบ่าย)';
            if (statusIcon) statusIcon.textContent = '☀️';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
              badge.textContent = hasLeave ? 'ลาเช้า / เข้าบ่าย' : 'พร้อมลงเวลาบ่าย';
            }
            if (heroTitle) heroTitle.textContent = 'แตะเข้างานบ่าย';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'แตะเพื่อลงเวลาเข้าปฏิบัติงานช่วงบ่าย (Clock IN)';
            if (heroIcon) heroIcon.textContent = '☀️';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.IN;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('IN');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปเข้างานบ่ายด้วย GPS โดยตรง (IN)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('IN');
          } else {
            if (holNotice) holNotice.classList.add('hidden');
            if (statusText) statusText.textContent = 'ยังไม่ได้ลงเวลาวันนี้';
            if (statusIcon) statusIcon.textContent = '🌅';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
              badge.textContent = 'พร้อมลงเวลา';
            }
            if (heroTitle) heroTitle.textContent = 'แตะลงเวลาเข้า';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'สแกน QR Code ประจำสาขา หรือถ่ายรูปเซลฟี่';
            if (heroIcon) heroIcon.textContent = '☀️';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.IN;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('IN');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปเข้างานด้วย GPS โดยตรง (IN)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('IN');
          }

        } else if (log.clock_in && !log.break_out && !log.clock_out) {
          // State 2: Clocked in morning, no break out yet
          // Check current time: if past break window (>= 14:30), smartly promote Hero Button to OUT (Clock OUT)
          const nowObj = new Date();
          const curHM = String(nowObj.getHours()).padStart(2, '0') + ':' + String(nowObj.getMinutes()).padStart(2, '0');
          const breakOutLimit = appSettings.window_break_out_end || '14:30';
          const isAfternoon = (curHM >= breakOutLimit);

          if (isAfternoon) {
            currentAction = 'OUT';
            secAction = 'BREAK_OUT';
            secText = 'หรือแตะเพื่อลงเวลาเริ่มพัก (Break OUT)';

            if (statusText) statusText.textContent = `ปฏิบัติงานช่วงบ่าย (เข้างานเมื่อ ${log.clock_in})`;
            if (statusIcon) statusIcon.textContent = '💼';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
              badge.textContent = 'ปฏิบัติงานช่วงบ่าย/เย็น';
            }
            if (heroTitle) heroTitle.textContent = 'แตะลงเวลาออก';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'เลิกงานประจำวัน / สรุปเวลางาน (Clock OUT)';
            if (data.branchConfig && data.branchConfig.earlyDismissalFullPay) {
              if (badge) {
                badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse';
                badge.textContent = '✨ งานเสร็จ (จ่ายเต็มวัน)';
              }
              if (heroSub) heroSub.textContent = '⚡ โหมดงานเสร็จประจำสาขา (ได้รับค่าแรงเต็มวัน ไม่หักเงิน)';
            }
            if (heroIcon) heroIcon.textContent = '🚪';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.OUT;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('OUT');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปออกงานด้วย GPS โดยตรง (Clock OUT)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('OUT');
          } else {
            currentAction = 'BREAK_OUT';
            secAction = 'OUT';
            secText = 'หรือแตะเพื่อลงเวลาออกงานทันที (Clock OUT)';

            if (statusText) statusText.textContent = `กำลังทำงาน (เข้างานเมื่อ ${log.clock_in})`;
            if (statusIcon) statusIcon.textContent = '💼';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
              badge.textContent = 'กำลังปฏิบัติงาน';
            }
            if (heroTitle) heroTitle.textContent = 'แตะเริ่มพัก';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'บันทึกเวลาพักกลางวัน (Break OUT - 2/4)';
            if (heroIcon) heroIcon.textContent = '☕';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.BREAK_OUT;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('BREAK_OUT');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปออกไปพักด้วย GPS โดยตรง (Break OUT)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('BREAK_OUT');
          }

        } else if (log.break_out && !log.break_in && !log.clock_out) {
          // State 3: On Break -> ready to Break In (or transition to OUT if past break-in window)
          const nowObj = new Date();
          const curHM = String(nowObj.getHours()).padStart(2, '0') + ':' + String(nowObj.getMinutes()).padStart(2, '0');
          const breakInLimit = appSettings.window_break_in_end || '15:30';
          const isPastBreakInWindow = (curHM >= breakInLimit);

          if (isPastBreakInWindow) {
            currentAction = 'OUT';
            secAction = 'BREAK_IN';
            secText = 'หรือแตะเพื่อลงเวลากลับเข้าทำงาน (Break IN)';

            if (statusText) statusText.textContent = `กำลังทำงาน (เริ่มพักเมื่อ ${log.break_out})`;
            if (statusIcon) statusIcon.textContent = '🏢';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
              badge.textContent = 'พร้อมลงเวลาเลิกงาน';
            }
            if (heroTitle) heroTitle.textContent = 'แตะลงเวลาออก';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'เลิกงานประจำวัน / ปิดเวลาพักให้อัตโนมัติ (Clock OUT)';
            if (data.branchConfig && data.branchConfig.earlyDismissalFullPay) {
              if (badge) {
                badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse';
                badge.textContent = '✨ งานเสร็จ (จ่ายเต็มวัน)';
              }
              if (heroSub) heroSub.textContent = '⚡ โหมดงานเสร็จประจำสาขา (ได้รับค่าแรงเต็มวัน ไม่หักเงิน)';
            }
            if (heroIcon) heroIcon.textContent = '🚪';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.OUT;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('OUT');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปออกงานด้วย GPS โดยตรง (Clock OUT)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('OUT');
          } else {
            currentAction = 'BREAK_IN';
            secAction = 'OUT';
            secText = 'หรือแตะเพื่อลงเวลาออกงานทันที (Clock OUT)';

            if (statusText) statusText.textContent = `กำลังอยู่ในช่วงพักผ่อน (เริ่มพัก ${log.break_out})`;
            if (statusIcon) statusIcon.textContent = '☕';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
              badge.textContent = 'กำลังพักผ่อน';
            }
            if (heroTitle) heroTitle.textContent = 'แตะกลับงาน';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'สิ้นสุดเวลาพัก พร้อมปฏิบัติงานช่วงบ่าย (Break IN - 3/4)';
            if (heroIcon) heroIcon.textContent = '💼';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.BREAK_IN;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('BREAK_IN');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปกลับเข้าทำงานด้วย GPS โดยตรง (Break IN)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('BREAK_IN');
          }

        } else if (log.break_in && !log.clock_out) {
          // State 4: Afternoon shift -> ready to Clock Out
          currentAction = 'OUT';
          if (statusText) statusText.textContent = `ปฏิบัติงานช่วงบ่าย (พักไป ${log.break_minutes || 0} นาที)`;
          if (statusIcon) statusIcon.textContent = '🏢';
          if (badge) {
            badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-sky-100 text-sky-800 border border-sky-200';
            badge.textContent = 'ปฏิบัติงานช่วงบ่าย';
          }
          if (heroTitle) heroTitle.textContent = 'แตะลงเวลาออก';
          if (heroBadge) heroBadge.textContent = 'สแกน QR';
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
            heroBtn.className = heroBtnClasses.OUT;
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
          if (heroTitle) heroTitle.textContent = 'ลงเวลาครบ';
          if (heroBadge) heroBadge.textContent = 'เรียบร้อย';
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
            heroBtn.className = heroBtnClasses.DONE;
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
          secAction = null; // No clock-out allowed if never clocked in

          const nowObj = new Date();
          const curHM = String(nowObj.getHours()).padStart(2, '0') + ':' + String(nowObj.getMinutes()).padStart(2, '0');
          const lunchStart = (window.currentBranchConfig && window.currentBranchConfig.lunchStartTime) || appSettings.lunch_start_time || '13:00';
          const workEnd = (window.currentBranchConfig && window.currentBranchConfig.workEndTime) || appSettings.work_end_time || '19:00';
          const shiftCutoffMins = timeToMinutes(workEnd) + 30; // e.g. 19:30
          const curMins = timeToMinutes(curHM);
          const isPastCutoff = (curMins >= shiftCutoffMins);
          const isAfternoon = (!isPastCutoff && curMins >= timeToMinutes(lunchStart));

          if (todayHoliday) {
            if (holNotice) holNotice.classList.remove('hidden');
            if (statusText) statusText.textContent = `วันหยุดบริษัท: ${todayHoliday.holiday_name || ''}`;
            if (statusIcon) statusIcon.textContent = '🏖️';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-black bg-amber-200 text-amber-950 border border-amber-300 shadow-xs';
              badge.textContent = '⭐ วันหยุดบริษัท';
            }
            if (heroTitle) heroTitle.textContent = 'วันหยุดพักผ่อน';
            if (heroBadge) heroBadge.textContent = 'สแกนทำงาน';
            if (heroSub) heroSub.textContent = 'วันหยุดตามประกาศบริษัท (แตะเพื่อสแกนหากเข้าเวรปฏิบัติงาน)';
            if (heroIcon) heroIcon.textContent = '🏖️';
            if (heroBtn) {
              heroBtn.className = 'radar-circle radar-amber w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 rounded-full bg-gradient-to-tr from-amber-500 via-orange-400 to-amber-300 text-white shadow-2xl shadow-amber-500/40 flex flex-col items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer';
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('IN');
            }
          } else if (isPastCutoff) {
            // Cut off as absent - never clocked in all day
            if (holNotice) holNotice.classList.add('hidden');
            if (statusText) statusText.textContent = 'ไม่พบการลงเวลาของวันนี้ (สถานะ: ขาดงาน)';
            if (statusIcon) statusIcon.textContent = '🚫';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-bold bg-rose-100 text-rose-800 border border-rose-200';
              badge.textContent = '🔴 ขาดงาน';
            }
            if (heroTitle) heroTitle.textContent = 'พ้นเวลางานแล้ว';
            if (heroBadge) heroBadge.textContent = 'หมดเวลา';
            if (heroSub) heroSub.textContent = 'ไม่พบบันทึกเวลาเข้างานของวันนี้ (หากมาปฏิบัติงานจริง กรุณาติดต่อ HR)';
            if (heroIcon) heroIcon.textContent = '🚫';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.LOCKED;
              heroBtn.disabled = true;
              heroBtn.onclick = () => {
                Swal.fire({
                  icon: 'warning',
                  title: 'พ้นเวลาการลงเวลาของวันนี้แล้ว',
                  text: 'ระบบไม่พบบันทึกเวลาเข้างานของวันนี้ จึงไม่มีการบันทึกเวลาทำงาน หากคุณมาปฏิบัติงานจริง กรุณาติดต่อ HR เพื่อทำการปรับปรุงเวลา',
                  confirmButtonText: 'รับทราบ'
                });
              };
            }
            if (directGpsText) directGpsText.textContent = 'สิ้นสุดเวลาลงเวลาประจำวัน';
            if (directGpsBtn) directGpsBtn.onclick = null;
          } else if (isAfternoon) {
            // Afternoon arrival - allow Clock IN
            if (holNotice) holNotice.classList.add('hidden');
            const hasLeave = (data.leave && data.leave.status === 'APPROVED');
            if (statusText) statusText.textContent = hasLeave ? 'มีใบลาช่วงเช้า (พร้อมเข้างานช่วงบ่าย)' : 'ยังไม่ได้ลงเวลาเข้างาน (ช่วงบ่าย)';
            if (statusIcon) statusIcon.textContent = '☀️';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
              badge.textContent = hasLeave ? 'ลาเช้า / เข้าบ่าย' : 'พร้อมลงเวลาบ่าย';
            }
            if (heroTitle) heroTitle.textContent = 'แตะเข้างานบ่าย';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'แตะเพื่อลงเวลาเข้าปฏิบัติงานช่วงบ่าย (Clock IN)';
            if (heroIcon) heroIcon.textContent = '☀️';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.IN;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('IN');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปเข้างานบ่ายด้วย GPS โดยตรง (IN)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('IN');
          } else {
            if (holNotice) holNotice.classList.add('hidden');
            if (statusText) statusText.textContent = 'ยังไม่ได้ลงเวลาวันนี้';
            if (statusIcon) statusIcon.textContent = '🌅';
            if (badge) {
              badge.className = 'px-3 py-1 rounded-xl text-xs md:text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200';
              badge.textContent = 'พร้อมลงเวลา';
            }
            if (heroTitle) heroTitle.textContent = 'แตะลงเวลาเข้า';
            if (heroBadge) heroBadge.textContent = 'สแกน QR';
            if (heroSub) heroSub.textContent = 'สแกน QR Code ประจำสาขา หรือถ่ายรูปเซลฟี่';
            if (heroIcon) heroIcon.textContent = '☀️';
            if (heroBtn) {
              heroBtn.className = heroBtnClasses.IN;
              heroBtn.disabled = false;
              heroBtn.onclick = () => openQrScannerModal('IN');
            }
            if (directGpsText) directGpsText.textContent = 'ถ่ายรูปเข้างานด้วย GPS โดยตรง (IN)';
            if (directGpsBtn) directGpsBtn.onclick = () => startDirectGpsClock('IN');
          }

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
          if (heroTitle) heroTitle.textContent = 'แตะลงเวลาออก';
          if (heroBadge) heroBadge.textContent = 'สแกน QR';
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
            heroBtn.className = heroBtnClasses.OUT;
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
          if (heroTitle) heroTitle.textContent = 'ลงเวลาครบ';
          if (heroBadge) heroBadge.textContent = 'เรียบร้อย';
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
            heroBtn.className = heroBtnClasses.DONE;
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
            heroBtn.className = heroBtnClasses.LOCKED;
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
          if (heroTitle) heroTitle.innerHTML = `<span class="flex items-center justify-center gap-1 text-[11px]"><span class="text-amber-400">🔒</span> นอกเวลา</span>`;
          if (heroBadge) heroBadge.textContent = `${winCheck.start}-${winCheck.end}`;
          if (heroSub) heroSub.textContent = `ระบบเปิดให้ลงเวลา ${winCheck.label} ช่วง ${winCheck.start} - ${winCheck.end} น. (ขณะนี้ ${winCheck.curTime} น.)`;
          if (heroIcon) heroIcon.textContent = '⏳';
        }
      }

      // Secondary Action Button Toggle & Dynamic Styling
      if (secBox && secBtn) {
        if (secAction && currentAction !== 'DONE') {
          secBox.classList.remove('hidden');
          secBtn.onclick = () => openQrScannerModal(secAction);

          const secIconEl = document.getElementById('iconHeroSecondaryAction');
          const secTitleEl = document.getElementById('titleHeroSecondaryAction');
          const secSubEl = document.getElementById('subHeroSecondaryAction');
          const secBadgeWrapEl = document.getElementById('badgeWrapperHeroSecondaryAction');
          const secBadgeTextEl = document.getElementById('badgeTextHeroSecondaryAction');

          if (secAction === 'OUT') {
            secBtn.className = 'w-full py-2 px-3 bg-gradient-to-r from-rose-50 to-orange-50 hover:from-rose-100 hover:to-orange-100 active:scale-[0.98] border border-dashed border-rose-300 rounded-xl flex items-center justify-between text-rose-800 transition-all shadow-xs group';
            if (secIconEl) secIconEl.textContent = '🚪';
            if (secTitleEl) {
              secTitleEl.className = 'text-xs font-bold text-rose-900 truncate';
              secTitleEl.textContent = 'หรือแตะเพื่อลงเวลาออกงานทันที';
            }
            if (secSubEl) secSubEl.className = 'hidden';
            if (secBadgeWrapEl) {
              secBadgeWrapEl.className = 'flex items-center space-x-1 text-rose-600 font-bold text-xs bg-white px-2 py-0.5 rounded-lg border border-rose-200 shadow-2xs group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2';
            }
            if (secBadgeTextEl) secBadgeTextEl.textContent = 'สแกนออกงาน';
          } else if (secAction === 'BREAK_OUT') {
            secBtn.className = 'w-full py-2 px-3 bg-gradient-to-r from-amber-50 to-yellow-50 hover:from-amber-100 hover:to-yellow-100 active:scale-[0.98] border border-dashed border-amber-300 rounded-xl flex items-center justify-between text-amber-800 transition-all shadow-xs group';
            if (secIconEl) secIconEl.textContent = '☕';
            if (secTitleEl) {
              secTitleEl.className = 'text-xs font-bold text-amber-900 truncate';
              secTitleEl.textContent = 'หรือแตะเพื่อลงเวลาเริ่มพัก';
            }
            if (secSubEl) secSubEl.className = 'hidden';
            if (secBadgeWrapEl) {
              secBadgeWrapEl.className = 'flex items-center space-x-1 text-amber-600 font-bold text-xs bg-white px-2 py-0.5 rounded-lg border border-amber-200 shadow-2xs group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2';
            }
            if (secBadgeTextEl) secBadgeTextEl.textContent = 'สแกนเริ่มพัก';
          } else if (secAction === 'BREAK_IN') {
            secBtn.className = 'w-full py-2 px-3 bg-gradient-to-r from-sky-50 to-blue-50 hover:from-sky-100 hover:to-blue-100 active:scale-[0.98] border border-dashed border-sky-300 rounded-xl flex items-center justify-between text-sky-800 transition-all shadow-xs group';
            if (secIconEl) secIconEl.textContent = '💼';
            if (secTitleEl) {
              secTitleEl.className = 'text-xs font-bold text-sky-900 truncate';
              secTitleEl.textContent = 'หรือแตะเพื่อลงเวลากลับเข้าทำงาน';
            }
            if (secSubEl) secSubEl.className = 'hidden';
            if (secBadgeWrapEl) {
              secBadgeWrapEl.className = 'flex items-center space-x-1 text-sky-600 font-bold text-xs bg-white px-2 py-0.5 rounded-lg border border-sky-200 shadow-2xs group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2';
            }
            if (secBadgeTextEl) secBadgeTextEl.textContent = 'สแกนเข้าบ่าย';
          } else {
            // Default / Other (e.g. IN)
            secBtn.className = 'w-full py-2 px-3 bg-gradient-to-r from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 active:scale-[0.98] border border-dashed border-emerald-300 rounded-xl flex items-center justify-between text-emerald-800 transition-all shadow-xs group';
            if (secIconEl) secIconEl.textContent = '☀️';
            if (secTitleEl) {
              secTitleEl.className = 'text-xs font-bold text-emerald-900 truncate';
              secTitleEl.textContent = secText || 'หรือแตะเพื่อลงเวลาเข้างาน';
            }
            if (secSubEl) secSubEl.className = 'hidden';
            if (secBadgeWrapEl) {
              secBadgeWrapEl.className = 'flex items-center space-x-1 text-emerald-600 font-bold text-xs bg-white px-2 py-0.5 rounded-lg border border-emerald-200 shadow-2xs group-hover:translate-x-0.5 transition-transform flex-shrink-0 ml-2';
            }
            if (secBadgeTextEl) secBadgeTextEl.textContent = 'สแกนเข้างาน';
          }
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
