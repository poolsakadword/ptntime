/**
 * ==============================================================================
 * PTN Time Attendant - Auth & Employee Module (Picker, PIN Login, Announcements)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

// ==============================================================================
// 2.1 APP ANNOUNCEMENT CONTROLLERS (GRAPHIC BANNER CARD - DESIGN 2)
// ==============================================================================
var activeAppAnnouncement = null;

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
              syncWebPushSubscriptionWithEmployee(currentEmployee.empId);
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

          if (data.employee) {
            currentEmployee = { ...currentEmployee, ...data.employee };
          }
          if (data.branchId) {
            currentEmployee.branchId = data.branchId;
            currentEmployee.allowAllBranches = data.allowAllBranches;
          }
          try {
            localStorage.setItem('ptn_time_emp', JSON.stringify(currentEmployee));
          } catch(e) {}
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

function getCustomAvatarKey(empId) {
  return 'ptn_custom_avatar_' + (empId || '');
}

function getCustomAvatarUrl(empId) {
  if (!empId) return null;
  try {
    return localStorage.getItem(getCustomAvatarKey(empId)) || null;
  } catch(e) {
    return null;
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
      
      const effectivePhoto = getCustomAvatarUrl(currentEmployee.empId) || currentEmployee.photoUrl;
      if (avatarEl) {
        if (effectivePhoto) {
          avatarEl.innerHTML = `<img src="${effectivePhoto}" alt="Avatar" class="w-full h-full object-cover rounded-2xl">`;
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
        if (btnTagIcon) btnTagIcon.innerHTML = '<i class="fa-solid fa-id-card text-xs"></i>';
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
        const stepPhoto = getCustomAvatarUrl(currentEmployee.empId) || currentEmployee.photoUrl;
        if (stepPhoto) {
          stepEmpAvatar.innerHTML = `<img src="${stepPhoto}" alt="Avatar" class="w-full h-full object-cover rounded-xl">`;
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
var selectedPickerEmpId = null;

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

    const customEmpImg = getCustomAvatarUrl(e.empId);
    const cardImg = customEmpImg || e.photoUrl;

    html += `
      <div onclick="selectEmployeeCard('${escapeHtml(e.empId)}')" class="p-2.5 rounded-2xl cursor-pointer transition-all active:scale-[0.98] flex items-center justify-between ${cardClass}">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${isSelected ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'}">
            ${isSelected ? '✓' : (cardImg ? `<img src="${cardImg}" class="w-full h-full rounded-xl object-cover">` : e.empId.replace(/[^0-9]/g, ''))}
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
  clearBreakReminders();
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

function handleHeaderProfileClick() {
  if (currentEmployee) {
    openEmployeeProfileModal();
  } else {
    openEmployeePickerModal();
  }
}

function openEmployeeProfileModal() {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }
  const modal = document.getElementById('modalEmployeeProfile');
  if (!modal) return;

  const nick = currentEmployee.nickname ? ` (${currentEmployee.nickname})` : '';
  const nameEl = document.getElementById('modalProfileName');
  const idEl = document.getElementById('modalProfileIdBadge');
  const lockEl = document.getElementById('modalProfileLockBadge');
  const deptEl = document.getElementById('modalProfileDept');
  const branchEl = document.getElementById('modalProfileBranch');
  const shiftEl = document.getElementById('modalProfileShiftTime');

  if (nameEl) nameEl.textContent = `${currentEmployee.fullName}${nick}`;
  if (idEl) idEl.textContent = `#${currentEmployee.empId}`;
  if (lockEl) {
    if (isDeviceLocked) {
      lockEl.textContent = '🔒 เครื่องนี้ผูกถาวรแล้ว';
      lockEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
    } else {
      lockEl.textContent = '🔓 ยังไม่ได้ผูกเครื่อง';
      lockEl.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300';
    }
  }

  const targetBranch = getCurrentEmployeeTargetBranch();
  const bTag = (currentEmployee.allowAllBranches === true || currentEmployee.allow_all_branches === 'true') 
    ? 'ทุกสาขา (Roaming)' 
    : (targetBranch ? targetBranch.branch_name : 'สำนักงานใหญ่');

  if (deptEl) deptEl.textContent = currentEmployee.department || 'พนักงาน';
  if (branchEl) branchEl.textContent = bTag;
  if (shiftEl) {
    const bCfg = window.currentBranchConfig || targetBranch;
    const sIn = bCfg ? (bCfg.workStartTime || bCfg.work_start_time || '09:30') : '09:30';
    const sOut = bCfg ? (bCfg.workEndTime || bCfg.work_end_time || '19:00') : '19:00';
    shiftEl.textContent = `${sIn} - ${sOut} น.`;
  }

  // Load avatar
  const customPhoto = getCustomAvatarUrl(currentEmployee.empId);
  const effectivePhoto = customPhoto || currentEmployee.photoUrl;
  const avatarImg = document.getElementById('modalEmpAvatarImg');
  const avatarFallback = document.getElementById('modalEmpAvatarFallback');
  const btnRemove = document.getElementById('btnRemoveCustomPhoto');

  if (effectivePhoto && avatarImg) {
    avatarImg.src = effectivePhoto;
    avatarImg.classList.remove('hidden');
    if (avatarFallback) avatarFallback.classList.add('hidden');
  } else {
    if (avatarImg) {
      avatarImg.src = '';
      avatarImg.classList.add('hidden');
    }
    if (avatarFallback) {
      const numPart = currentEmployee.empId.replace(/[^0-9]/g, '');
      avatarFallback.textContent = numPart ? numPart.slice(-2) : '👤';
      avatarFallback.classList.remove('hidden');
    }
  }

  // Show "Remove" button only if there is a custom photo stored on this device
  if (btnRemove) {
    if (customPhoto) {
      btnRemove.classList.remove('hidden');
    } else {
      btnRemove.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
}

function closeEmployeeProfileModal() {
  const modal = document.getElementById('modalEmployeeProfile');
  if (modal) modal.classList.add('hidden');
}

function triggerCustomPhotoInput() {
  const input = document.getElementById('customPhotoFileInput');
  if (input) input.click();
}

function handleCustomPhotoSelected(event) {
  if (!currentEmployee) return;
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    Swal.fire({
      icon: 'warning',
      title: 'ไฟล์ไม่ถูกต้อง',
      text: 'กรุณาเลือกไฟล์รูปภาพ (JPG, PNG, WebP) เท่านั้นครับ'
    });
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const tempImg = new Image();
    tempImg.onload = function() {
      // Resize to crisp square avatar (max 320x320)
      const targetSize = 320;
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');

      // Center crop to square
      const minDim = Math.min(tempImg.width, tempImg.height);
      const sx = (tempImg.width - minDim) / 2;
      const sy = (tempImg.height - minDim) / 2;

      ctx.drawImage(tempImg, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      // Save locally per employee ID (Local Device Storage)
      try {
        localStorage.setItem(getCustomAvatarKey(currentEmployee.empId), compressedDataUrl);
      } catch (err) {
        console.warn('LocalStorage save avatar error:', err);
      }

      // Update UI across all views
      updateHeaderEmployeeView();

      // Update Modal View
      const avatarImg = document.getElementById('modalEmpAvatarImg');
      const avatarFallback = document.getElementById('modalEmpAvatarFallback');
      const btnRemove = document.getElementById('btnRemoveCustomPhoto');
      if (avatarImg) {
        avatarImg.src = compressedDataUrl;
        avatarImg.classList.remove('hidden');
      }
      if (avatarFallback) avatarFallback.classList.add('hidden');
      if (btnRemove) btnRemove.classList.remove('hidden');

      Swal.fire({
        icon: 'success',
        title: 'เพิ่มรูปโปรไฟล์สำเร็จ!',
        html: `<div class="text-xs text-slate-600 leading-relaxed">
                 บันทึกรูปภาพไว้เฉพาะบนอุปกรณ์เครื่องนี้แล้ว<br>
                 <span class="text-emerald-600 font-bold">✨ รูปในระบบ PTN Payroll ยังคงเดิม ไม่ถูกเปลี่ยนแปลง</span>
               </div>`,
        timer: 2600,
        showConfirmButton: false
      });
    };
    tempImg.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removeCustomPhoto() {
  if (!currentEmployee) return;
  Swal.fire({
    title: 'ยืนยันลบรูปภาพเฉพาะเครื่อง?',
    text: 'ระบบจะกลับไปใช้รูป/ไอคอนดั้งเดิมของพนักงาน',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ยืนยันลบ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#e11d48'
  }).then((result) => {
    if (result.isConfirmed) {
      try {
        localStorage.removeItem(getCustomAvatarKey(currentEmployee.empId));
      } catch(e) {}
      
      updateHeaderEmployeeView();
      openEmployeeProfileModal(); // Refresh modal view

      Swal.fire({
        icon: 'info',
        title: 'ใช้รูปดั้งเดิมแล้ว',
        timer: 1500,
        showConfirmButton: false
      });
    }
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
  const modal = document.getElementById('modalEmployeePicker');
  if (modal) modal.classList.remove('hidden');

  const empInput = document.getElementById('directLoginEmpId');
  const pinInput = document.getElementById('directLoginPin');
  if (empInput) {
    if (currentEmployee && currentEmployee.empId) {
      empInput.value = currentEmployee.empId;
      if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 200);
      }
    } else {
      empInput.value = '';
      if (pinInput) pinInput.value = '';
      setTimeout(() => empInput.focus(), 200);
    }
  }
}

function closeEmployeePickerModal() {
  document.getElementById('modalEmployeePicker')?.classList.add('hidden');
}

function onSelectEmployeeDropdown(val) {
  if (val) {
    const empInput = document.getElementById('directLoginEmpId');
    if (empInput) empInput.value = val;
  }
}

async function confirmEmployeeLogin() {
  const empInput = document.getElementById('directLoginEmpId') || document.getElementById('empSelectDropdown');
  const pinInput = document.getElementById('directLoginPin') || document.getElementById('empPinInput');
  const rawEmpId = (empInput ? empInput.value : '').trim();
  const empId = rawEmpId.toUpperCase();
  const pin = pinInput ? pinInput.value.trim() : '';
  const deviceId = getOrCreateDeviceId();

  if (!empId) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกรหัสพนักงาน',
      text: 'ระบุรหัสพนักงานของท่าน (เช่น EMP001 หรือ EMP042) หรือเบอร์โทรศัพท์ที่แจ้งไว้'
    });
    if (empInput) empInput.focus();
    return;
  }

  if (!pin) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกรหัสยืนยันตัวตน',
      text: 'ใช้เลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์'
    });
    if (pinInput) pinInput.focus();
    return;
  }

  if (pin === '1234') {
    Swal.fire({
      icon: 'error',
      title: 'รหัส 1234 ถูกยกเลิกแล้ว',
      text: 'กรุณากรอกเลข 4 ตัวท้ายบัตรประชาชน หรือเบอร์โทรศัพท์ของท่าน'
    });
    if (pinInput) pinInput.focus();
    return;
  }

  Swal.fire({ 
    title: 'กำลังยืนยันตัวตน...', 
    text: 'กำลังตรวจสอบข้อมูลและผูกอุปกรณ์',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading() 
  });

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
      Swal.fire({
        icon: 'error',
        title: 'เข้าใช้งานไม่สำเร็จ',
        text: data.message || 'รหัสพนักงานหรือรหัสยืนยันไม่ถูกต้อง'
      });
      return;
    }

    // 2. Bind Device (Device Lock)
    const bindRes = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bindDevice',
        empId: data.employee.empId,
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
    syncWebPushSubscriptionWithEmployee(currentEmployee.empId);

    // Recalculate GPS location for this employee's branch
    getCurrentLocation(true, false);

    const nickStr = currentEmployee.nickname ? ` (${currentEmployee.nickname})` : '';
    Swal.fire({
      icon: 'success',
      title: `ผูกอุปกรณ์สำเร็จ!`,
      text: `ยินดีต้อนรับคุณ ${currentEmployee.fullName}${nickStr} [${currentEmployee.empId}] ระบบได้ล็อกเครื่องนี้ไว้กับคุณเรียบร้อยแล้ว`,
      timer: 2400,
      showConfirmButton: false
    });
  } catch(e) {
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาดในการเชื่อมต่อ',
      text: e.message || 'กรุณาลองใหม่อีกครั้ง'
    });
  }
}
