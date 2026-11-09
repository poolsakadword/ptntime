/**
 * ==============================================================================
 * PTN Time Attendant - Device Lock Module (3-Way Unlock Controllers)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

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
