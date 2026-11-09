/**
 * ==============================================================================
 * PTN Time Attendant - Main Application Bootstrap (v12.00)
 * บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

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

  const tabStyles = {
    clock: {
      pillActive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/35 scale-105 ring-2 ring-sky-300 transition-all',
      pillInactive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-sky-50 text-sky-600 hover:bg-sky-100 transition-all',
      textActive: 'text-[11px] md:text-xs mt-1 text-sky-600 font-extrabold transition',
      textInactive: 'text-[11px] md:text-xs mt-1 text-slate-600 font-medium transition'
    },
    history: {
      pillActive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/35 scale-105 ring-2 ring-indigo-300 transition-all',
      pillInactive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all',
      textActive: 'text-[11px] md:text-xs mt-1 text-indigo-600 font-extrabold transition',
      textInactive: 'text-[11px] md:text-xs mt-1 text-slate-600 font-medium transition'
    },
    requests: {
      pillActive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/35 scale-105 ring-2 ring-emerald-300 transition-all',
      pillInactive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all',
      textActive: 'text-[11px] md:text-xs mt-1 text-emerald-600 font-extrabold transition',
      textInactive: 'text-[11px] md:text-xs mt-1 text-slate-600 font-medium transition'
    },
    payslip: {
      pillActive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/35 scale-105 ring-2 ring-amber-300 transition-all relative',
      pillInactive: 'w-12 h-8 rounded-xl flex items-center justify-center bg-amber-50 text-amber-600 hover:bg-amber-100 transition-all relative',
      textActive: 'text-[11px] md:text-xs mt-1 text-amber-600 font-extrabold transition',
      textInactive: 'text-[11px] md:text-xs mt-1 text-slate-600 font-medium transition'
    }
  };

  const tabs = ['clock', 'history', 'requests', 'payslip'];
  tabs.forEach(t => {
    const section = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const navBtn = document.getElementById('navBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    const pill = document.getElementById('navPill' + t.charAt(0).toUpperCase() + t.slice(1));
    const text = document.getElementById('navText' + t.charAt(0).toUpperCase() + t.slice(1));
    if (section) section.classList.add('hidden');
    if (navBtn) {
      navBtn.className = 'flex-1 flex flex-col items-center justify-center py-1 transition group';
    }
    const isCurrent = (t === tab);
    const style = tabStyles[t];
    if (pill && style) {
      pill.className = isCurrent ? style.pillActive : style.pillInactive;
    }
    if (text && style) {
      text.className = isCurrent ? style.textActive : style.textInactive;
    }
  });

  const activeSection = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (activeSection) activeSection.classList.remove('hidden');

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
  
  // Auto-refresh GPS and attendance status whenever employee wakes or switches back to app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      getCurrentLocation(true, false);
      loadTodayStatus();
    }
  });
  window.addEventListener('focus', () => {
    getCurrentLocation(true, false);
  });

  // Initialize PWA Service Worker & Push Notification Handlers
  initServiceWorker().catch(() => {});
  checkNotificationBanner();
  checkPwaInstallState();
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

  // Setup Direct Login Enter key bindings
  const loginEmpInput = document.getElementById('directLoginEmpId');
  const loginPinInput = document.getElementById('directLoginPin');
  if (loginEmpInput) {
    loginEmpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (loginPinInput) loginPinInput.focus();
      }
    });
  }
  if (loginPinInput) {
    loginPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmEmployeeLogin();
      }
    });
  }
  const curMonth = getActiveCutoffPeriodString();
  const histPicker = document.getElementById('historyMonthPicker');
  if (histPicker) histPicker.value = curMonth;

  // Set default dates for forms
  const leaveStart = document.getElementById('leaveStartDate');
  const leaveEnd = document.getElementById('leaveEndDate');
  const otDate = document.getElementById('otDate');
  if (leaveStart) { leaveStart.value = today; updateLeaveStartDateThaiHint(); }
  if (leaveEnd) { leaveEnd.value = today; updateLeaveEndDateThaiHint(); }
  if (otDate) { otDate.value = today; updateOtDateThaiHint(); }
});