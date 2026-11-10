/**
 * ==============================================================================
 * PTN Time Attendant - Payslips & Time Card Module (E-Payslip, Canvas Exporter, Print)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

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

      // Populate Period Dropdown (sorted newest period first)
      if (periodSelect && data.periods && data.periods.length > 0) {
        const thaiMonths = [
          'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
          'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
        ];
        const getPeriodSortKey = (periodStr) => {
          if (!periodStr) return 0;
          const s = String(periodStr).trim();
          const ymMatch = s.match(/^(\d{4})-(\d{1,2})/);
          if (ymMatch) {
            let y = parseInt(ymMatch[1], 10);
            const m = parseInt(ymMatch[2], 10);
            if (y < 2400) y += 543;
            return y * 100 + m;
          }
          let monthIdx = 0;
          for (let i = 0; i < thaiMonths.length; i++) {
            if (s.includes(thaiMonths[i])) {
              monthIdx = i + 1;
              break;
            }
          }
          const yearMatch = s.match(/(\d{4})/);
          let year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
          if (year > 0 && year < 2400) year += 543;
          if (year > 0 && monthIdx > 0) return year * 100 + monthIdx;
          return 0;
        };
        const sortedPeriods = [...data.periods].sort((a, b) => getPeriodSortKey(b) - getPeriodSortKey(a));

        periodSelect.innerHTML = '';
        sortedPeriods.forEach(p => {
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
        window.lastCompanyInfo = data.companyInfo;
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
  if (leaveDedEl) leaveDedEl.textContent = fmt(slip.leaveDeduct !== undefined ? slip.leaveDeduct : slip.leaveDeduction);

  const otherDedEl = document.getElementById('slipOtherDisplay');
  if (otherDedEl) otherDedEl.textContent = fmt(slip.otherDeduct);

  // Toggle Breakdown Button for Incident & Damage Deductions
  const btnIncBreakdown = document.getElementById('btnViewSlipIncidentBreakdown');
  window.currentSlipIncidentDeductions = slip.incidentDeductions || [];
  window.currentSlipPeriod = slip.period || '';
  if (btnIncBreakdown) {
    if (window.currentSlipIncidentDeductions.length > 0 || (Number(slip.otherDeduct) > 0)) {
      btnIncBreakdown.classList.remove('hidden');
    } else {
      btnIncBreakdown.classList.add('hidden');
    }
  }

  // Attendance Stats
  const absEl = document.getElementById('slipAbsentDays');
  if (absEl) absEl.textContent = `${slip.absentDays || 0} วัน`;

  const leaveEl = document.getElementById('slipLeaveDays');
  if (leaveEl) leaveEl.textContent = `${slip.leaveDays || 0} วัน`;

  const sickEl = document.getElementById('slipSickDays');
  if (sickEl) sickEl.textContent = `${slip.sickLeaveDays || 0} วัน`;

  const unpaidSickEl = document.getElementById('slipUnpaidSickDays');
  if (unpaidSickEl) unpaidSickEl.textContent = `${slip.unpaidSickLeaveDays || 0} วัน`;

  // --------------------------------------------------------------------------
  // Populate Official Printable Paper Voucher (#payslipOfficialPrintDoc)
  // --------------------------------------------------------------------------
  try {
    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setText('prnCompanyTitle', companyInfo?.name || 'บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด');
    setText('prnCompanyAddress', companyInfo?.address || '919/30 ม.10 ต.นครสวรรค์ตก อ.เมือง จ.นครสวรรค์ 60000');
    setText('prnCompanyTaxId', companyInfo?.taxId || '0605556001337');
    setText('prnPeriodText', slip.period || '-');
    setText('prnPayDateText', slip.payDate || new Date().toLocaleDateString('th-TH'));

    const resolvedEmpName = slip.fullName || slip.full_name || slip.name || currentEmployee?.full_name || currentEmployee?.fullName || currentEmployee?.name || '-';
    const resolvedRole = slip.position || currentEmployee?.position || currentEmployee?.role || 'พนักงาน';
    const resolvedDept = slip.department || currentEmployee?.department || currentEmployee?.branch_name || 'สาขา B01';

    setText('prnEmpId', slip.empId || (currentEmployee ? currentEmployee.empId : '-'));
    setText('prnEmpName', resolvedEmpName);
    setText('prnEmpRole', resolvedRole);
    setText('prnEmpDept', resolvedDept);
    setText('prnBankName', slip.bankName || 'ธนาคารกสิกรไทย');
    setText('prnBankAcc', slip.bankAccount || slip.bankAccountMasked || '***-*-*----');

    // Earnings
    setText('prnBaseSalary', fmt(slip.baseSalary));
    setText('prnOtHours', (slip.otHours && slip.otHours > 0) ? `(${slip.otHours} ชม.)` : '');
    setText('prnOtPay', fmt(slip.otPay));
    setText('prnAllowance', fmt(slip.allowance));
    setText('prnBonus', fmt(slip.bonus));
    setText('prnTotalGross', fmt(slip.grossPay));

    // Deductions
    setText('prnTax', fmt(slip.tax));
    setText('prnSso', fmt(slip.sso));
    setText('prnPf', fmt(slip.pf));
    setText('prnAdvance', fmt(slip.advanceDeduct));
    setText('prnLate', fmt(slip.lateDeduct));
    setText('prnLeaveDed', fmt(slip.leaveDeduct !== undefined ? slip.leaveDeduct : slip.leaveDeduction));
    setText('prnOtherDed', fmt(slip.otherDeduct));
    setText('prnTotalDeduct', fmt(slip.totalDeductions));

    // Net Pay & Thai Baht
    setText('prnNetPayNum', `฿ ${fmt(slip.netPay)}`);
    setText('prnThaiBahtNetText', bahtTextHelper(slip.netPay));

    // Mini Stats
    setText('prnStatAbsent', slip.absentDays || 0);
    setText('prnStatLeave', slip.leaveDays || 0);
    setText('prnStatSick', (slip.sickLeaveDays || 0) + (slip.unpaidSickLeaveDays || 0));
    setText('prnPrintTimestamp', `สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`);
  } catch(e) {
    console.error('Error populating official print payslip:', e);
  }
}

// Helper: Convert number to Thai Baht Text
function bahtTextHelper(num) {
  num = Number(num) || 0;
  if (num === 0) return '(ศูนย์บาทถ้วน)';
  var isNeg = num < 0;
  num = Math.abs(num);

  var parts = num.toFixed(2).split('.');
  var integerPart = parts[0];
  var decimalPart = parts[1];

  var digits = ['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  var units = ['','สิบ','ร้อย','พัน','หมื่น','แสน','ล้าน'];

  function convertGroup(nStr) {
    var res = '';
    var len = nStr.length;
    for (var i = 0; i < len; i++) {
      var d = parseInt(nStr.charAt(i), 10);
      var pos = len - i - 1;
      if (d !== 0) {
        if (pos === 1 && d === 1) {
          res += 'สิบ';
        } else if (pos === 1 && d === 2) {
          res += 'ยี่สิบ';
        } else if (pos === 0 && d === 1 && len > 1 && res !== '') {
          res += 'เอ็ด';
        } else {
          res += digits[d] + units[pos];
        }
      }
    }
    return res;
  }

  var intText = '';
  if (integerPart.length > 6) {
    var millionPart = integerPart.substring(0, integerPart.length - 6);
    var remainderPart = integerPart.substring(integerPart.length - 6);
    intText = convertGroup(millionPart) + 'ล้าน' + convertGroup(remainderPart);
  } else {
    intText = convertGroup(integerPart);
  }
  if (!intText) intText = 'ศูนย์';

  var decText = '';
  if (decimalPart === '00') {
    decText = 'ถ้วน';
  } else {
    decText = convertGroup(decimalPart) + 'สตางค์';
  }

  return '(' + (isNeg ? 'ลบ' : '') + intText + 'บาท' + decText + ')';
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


// ==============================================================================
// SAVE PAYSLIP AS IMAGE (PNG) USING HTML2CANVAS
// ==============================================================================
async function savePayslipAsImage() {
  if (!currentPayslipData) {
    Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลสลิปสำหรับบันทึกรูป', 'warning');
    return;
  }

  const slip = currentPayslipData;
  const comp = window.lastCompanyInfo || {};
  const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compName = comp.name || 'บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด';
  const compAddr = comp.address || '919/30 ม.10 ต.นครสวรรค์ตก อ.เมือง จ.นครสวรรค์ 60000';
  const compTax = comp.taxId || '0605556001337';
  const compPhone = comp.phone || '056-345625, 056-371370';
  const empId = slip.empId || (currentEmployee ? currentEmployee.empId : '-');
  const empName = slip.fullName || slip.full_name || slip.name || currentEmployee?.full_name || currentEmployee?.fullName || currentEmployee?.name || '-';
  const empRole = slip.position || currentEmployee?.position || currentEmployee?.role || 'พนักงาน';
  const empDept = slip.department || currentEmployee?.department || currentEmployee?.branch_name || 'สาขา B01';
  const bankName = slip.bankName || 'ธนาคารกสิกรไทย';
  const bankAcc = slip.bankAccount || slip.bankAccountMasked || '***-*-*----';
  const period = slip.period || '-';
  const payDate = slip.payDate || new Date().toLocaleDateString('th-TH');
  const otHoursText = (slip.otHours && slip.otHours > 0) ? `(${slip.otHours} ชม.)` : '';
  const thaiBaht = bahtTextHelper(slip.netPay);
  const nowStr = new Date().toLocaleString('th-TH');

  Swal.fire({
    title: 'กำลังสร้างรูปภาพสลิป...',
    text: 'กรุณารอสักครู่ ระบบกำลังเรนเดอร์เอกสารความละเอียดสูง',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  // Create an offscreen voucher container with explicit desktop dimensions for sharp image rendering
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-9999px';
  wrapper.style.top = '0';
  wrapper.style.width = '780px';
  wrapper.style.background = '#ffffff';
  wrapper.style.padding = '24px 28px';
  wrapper.style.color = '#0f172a';
  wrapper.style.fontFamily = "'Prompt', 'Sarabun', sans-serif";
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.border = '2px solid #0f172a';
  wrapper.style.borderRadius = '4px';

  wrapper.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0f172a; padding-bottom:10px; margin-bottom:12px;">
      <div>
        <h2 style="font-size:18px; font-weight:700; margin:0 0 2px 0; color:#0f172a;">${compName}</h2>
        <p style="font-size:11px; color:#475569; margin:1px 0;">${compAddr}</p>
        <p style="font-size:11px; color:#475569; margin:1px 0;">เลขประจำตัวผู้เสียภาษี: ${compTax}</p>
      </div>
      <div style="text-align:right;">
        <div style="font-size:14px; font-weight:800; border:1.5px solid #0f172a; padding:3px 10px; display:inline-block; background:#f8fafc;">ใบจ่ายเงินเดือน / PAYSLIP</div>
        <div style="font-size:12px; margin-top:5px;">งวดประจำเดือน: <strong>${period}</strong></div>
        <div style="font-size:11px; color:#64748b;">วันที่จ่าย: ${payDate}</div>
      </div>
    </div>

    <table style="width:100%; border-collapse:collapse; margin-bottom:12px; font-size:12px; border:1px solid #cbd5e1; background:#f8fafc;">
      <tr>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; width:18%; color:#475569; background:#f1f5f9;">รหัสพนักงาน:</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; width:32%; color:#0f172a;"><strong>${empId}</strong></td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; width:18%; color:#475569; background:#f1f5f9;">ชื่อ-นามสกุล:</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; width:32%; color:#0f172a;"><strong>${empName}</strong></td>
      </tr>
      <tr>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#475569; background:#f1f5f9;">ตำแหน่ง:</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#0f172a;">${empRole}</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#475569; background:#f1f5f9;">แผนก/สาขา:</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#0f172a;">${empDept}</td>
      </tr>
      <tr>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#475569; background:#f1f5f9;">การจ่ายเงิน:</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#0f172a;">${bankName}</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#475569; background:#f1f5f9;">เลขที่บัญชี:</td>
        <td style="padding:5px 8px; border:1px solid #e2e8f0; color:#0f172a; font-family:monospace;">${bankAcc}</td>
      </tr>
    </table>

    <table style="width:100%; border-collapse:collapse; border:1.5px solid #334155; margin-bottom:10px;">
      <thead>
        <tr>
          <th style="width:50%; background:#e2e8f0; color:#0f172a; font-size:12px; font-weight:700; padding:6px; border:1px solid #cbd5e1; text-align:center;">รายการได้ (EARNINGS)</th>
          <th style="width:50%; background:#e2e8f0; color:#0f172a; font-size:12px; font-weight:700; padding:6px; border:1px solid #cbd5e1; text-align:center;">รายการหัก (DEDUCTIONS)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="vertical-align:top; padding:0;">
            <table style="width:100%; border-collapse:collapse;">
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">เงินเดือนพื้นฐาน</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.baseSalary)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">ค่าล่วงเวลา (OT) ${otHoursText}</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.otPay)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">เบี้ยขยัน</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.allowance)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">โบนัส / เงินพิเศษ</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.bonus)}</td></tr>
              <tr style="height:18px;"><td style="padding:4px 8px;">&nbsp;</td><td style="padding:4px 8px;">&nbsp;</td></tr>
            </table>
          </td>
          <td style="vertical-align:top; padding:0;">
            <table style="width:100%; border-collapse:collapse;">
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">ภาษีหัก ณ ที่จ่าย</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.tax)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">เงินสมทบประกันสังคม (SSO)</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.sso)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">กองทุนสำรองเลี้ยงชีพ (PF)</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.pf)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">หักเงินเบิกล่วงหน้า (Advance)</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.advanceDeduct)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">หักมาสาย / ออกก่อนเวลา</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.lateDeduct)}</td></tr>
              <tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">หักลากิจ / ขาดงาน</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.leaveDeduct !== undefined ? slip.leaveDeduct : slip.leaveDeduction)}</td></tr>
              ${slip.otherDeduct > 0 ? `<tr><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; color:#334155;">หักอื่นๆ</td><td style="padding:4px 8px; font-size:11.5px; border-bottom:1px solid #f1f5f9; text-align:right; font-family:monospace; font-weight:600; color:#0f172a;">${fmt(slip.otherDeduct)}</td></tr>` : ''}
            </table>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td style="background:#f1f5f9; padding:6px 10px; border-top:1.5px solid #334155; font-size:12px; font-weight:700; color:#0f172a;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>รวมเงินได้ทั้งสิ้น</span>
              <span style="font-family:monospace;">${fmt(slip.grossPay)}</span>
            </div>
          </td>
          <td style="background:#f1f5f9; padding:6px 10px; border-top:1.5px solid #334155; font-size:12px; font-weight:700; color:#0f172a;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>รวมรายการหักทั้งสิ้น</span>
              <span style="font-family:monospace;">${fmt(slip.totalDeductions)}</span>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>

    <div style="border:2px solid #0f172a; background:#f8fafc; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-radius:2px;">
      <div>
        <span style="font-size:11px; color:#475569; display:block;">จำนวนเงินสุทธิ (ตัวอักษร):</span>
        <strong style="font-size:12.5px; color:#0f172a;">${thaiBaht}</strong>
      </div>
      <div style="text-align:right;">
        <span style="font-size:12px; font-weight:700; color:#334155; margin-right:6px;">เงินได้สุทธิ (Net Pay):</span>
        <span style="font-size:18px; font-weight:900; font-family:monospace; text-decoration:underline;">฿ ${fmt(slip.netPay)}</span>
      </div>
    </div>

    <div style="font-size:10.5px; color:#64748b; border:1px solid #e2e8f0; background:#f8fafc; padding:4px 8px; display:flex; justify-content:space-between; margin-bottom:14px;">
      <span>สถิติประจำงวด: ขาดงาน <strong>${slip.absentDays || 0}</strong> วัน | ลากิจ <strong>${slip.leaveDays || 0}</strong> วัน | ลาป่วย <strong>${(slip.sickLeaveDays || 0) + (slip.unpaidSickLeaveDays || 0)}</strong> วัน</span>
      <span>${nowStr}</span>
    </div>

    <div style="display:flex; justify-content:space-around; padding-top:10px; text-align:center;">
      <div style="width:42%;">
        <div style="font-size:11px; color:#334155; margin-bottom:22px;">ลงชื่อ ..............................................................</div>
        <div style="font-size:11px; color:#64748b;">( พนักงานผู้รับเงิน )</div>
      </div>
      <div style="width:42%;">
        <div style="font-size:11px; color:#334155; margin-bottom:22px;">ลงชื่อ ..............................................................</div>
        <div style="font-size:11px; color:#64748b;">( ผู้มีอำนาจจ่ายเงิน / ฝ่ายการเงิน )</div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper);

  try {
    if (typeof html2canvas !== 'function') {
      throw new Error('ไม่พบไลบรารี html2canvas');
    }

    const canvas = await html2canvas(wrapper, {
      scale: 2, // High resolution (retina crisp quality)
      useCORS: true,
      backgroundColor: '#ffffff'
    });

    // Generate download link
    const imageUri = canvas.toDataURL('image/png');
    const filename = `Payslip_${empId}_${period.replace(/\//g, '-')}.png`;

    const downloadLink = document.createElement('a');
    downloadLink.href = imageUri;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    Swal.fire({
      icon: 'success',
      title: 'บันทึกรูปภาพเรียบร้อย!',
      text: `ดาวน์โหลดไฟล์ ${filename} แล้ว`,
      timer: 2000,
      showConfirmButton: false
    });
  } catch(e) {
    console.error('Save payslip image error:', e);
    Swal.fire('ไม่สามารถบันทึกรูปได้', e.message || 'เกิดข้อผิดพลาดในการบันทึกรูปภาพ', 'error');
  } finally {
    if (wrapper.parentNode) {
      document.body.removeChild(wrapper);
    }
  }
}


// ==============================================================================
// SAVE TIME CARD AS IMAGE (PNG) USING HTML2CANVAS
// ==============================================================================
async function downloadEmployeeTimeCardImage() {
  if (!currentEmployee) {
    Swal.fire('กรุณาเข้าสู่ระบบ', 'กรุณาระบุตัวตนพนักงานก่อนดาวน์โหลดบัตรตอก', 'warning');
    return;
  }

  const month = document.getElementById('historyMonthPicker')?.value || getActiveCutoffPeriodString();

  Swal.fire({
    title: 'กำลังสร้างรูปภาพบัตรตอก...',
    html: '<div class="text-xs text-slate-500 mt-2">กำลังรวบรวมข้อมูลเวลาทำงานและประมวลผลเป็นรูปภาพความละเอียดสูง</div>',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  let wrapper = null;

  try {
    // 1. Fetch employee history data for selected month
    const res = await fetch(`${API_URL}?action=getEmployeeHistory&empId=${encodeURIComponent(currentEmployee.empId)}&month=${encodeURIComponent(month)}`);
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || 'ไม่สามารถดึงข้อมูลประวัติการลงเวลาได้');
    }

    const startDate = data.startDate || `${month}-01`;
    const endDate = data.endDate || `${month}-31`;
    const logs = data.logs || [];
    const rawLeaves = data.leaves || [];
    const holidays = data.holidays || window.companyHolidays || [];
    const stats = data.stats || {};

    const comp = window.lastCompanyInfo || {};
    const compName = comp.name || 'บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด';
    const compTax = comp.taxId || '0605556001337';

    const emp = (employeeList && Array.isArray(employeeList)) 
      ? (employeeList.find(e => e.empId === currentEmployee.empId) || currentEmployee)
      : currentEmployee;
    const empId = emp.empId || currentEmployee.empId || '-';
    const empFullName = (emp.fullName || emp.full_name || emp.name || currentEmployee.fullName || empId) +
      (emp.nickname || currentEmployee.nickname ? ` (${emp.nickname || currentEmployee.nickname})` : '');
    const empPos = (emp.position || emp.role || currentEmployee.position || 'พนักงาน') +
      (emp.department || currentEmployee.department ? ` / ${emp.department || currentEmployee.department}` : '');
    const empBranch = emp.branch_name || emp.branchId || currentEmployee.branch_name || currentEmployee.branchId || 'สำนักงานใหญ่';

    // Build holiday map
    const holidayMap = {};
    holidays.forEach(h => {
      if (h && h.date) holidayMap[h.date] = h;
    });

    // Build approved leave map
    const leaveMap = {};
    rawLeaves.filter(lv => lv && lv.status === 'APPROVED').forEach(lv => {
      let s = lv.start_date;
      let e = lv.end_date || lv.start_date;
      if (s > e) { const tmp = s; s = e; e = tmp; }
      let cur = new Date(s + 'T00:00:00Z');
      const stop = new Date(e + 'T00:00:00Z');
      while (cur <= stop) {
        const ds = cur.toISOString().substring(0, 10);
        if (!leaveMap[ds]) leaveMap[ds] = [];
        leaveMap[ds].push(lv);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    });

    // Build approved advance map
    const rawAdvances = data.advances || [];
    const advanceMap = {};
    let totalAdvancesAmount = 0;
    const approvedAdvances = rawAdvances.filter(ad => ad && String(ad.status || '').toUpperCase() === 'APPROVED');
    approvedAdvances.forEach(ad => {
      const d = String(ad.request_date || '').trim().substring(0, 10);
      if (!advanceMap[d]) advanceMap[d] = [];
      advanceMap[d].push(ad);
      totalAdvancesAmount += (Number(ad.amount) || 0);
    });

    // Build logs map
    const logsMap = {};
    logs.forEach(l => {
      if (l && l.date) logsMap[l.date] = l;
    });

    // Generate all dates in period
    const dateList = [];
    let curDate = new Date(startDate + 'T00:00:00Z');
    const endDateObj = new Date(endDate + 'T00:00:00Z');
    while (curDate <= endDateObj) {
      dateList.push(curDate.toISOString().substring(0, 10));
      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }

    const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    let daysWorked = 0;
    let totalWorkHours = 0;
    let totalOtHours = 0;
    let lateCount = 0;
    let totalLateMinutes = 0;
    let holidayCount = 0;
    let leaveDaysCount = 0;
    let absentDaysCount = 0;

    let rowsHtml = '';
    dateList.forEach((dStr, idx) => {
      const dObj = new Date(dStr + 'T00:00:00');
      const dayIdx = dObj.getDay();
      const dayName = isNaN(dayIdx) ? '' : thaiDays[dayIdx];
      const isSunday = dayIdx === 0;

      const parts = dStr.split('-');
      const beYear = parseInt(parts[0], 10) + 543;
      const dateDisplay = `${parts[2]}/${parts[1]}/${beYear}`;

      const hInfo = holidayMap[dStr];
      const isHoliday = !!hInfo;
      const holidayName = isHoliday ? (hInfo.holiday_name || hInfo.name || 'วันหยุดบริษัท') : '';
      const holidayTypeLabel = isHoliday ? (hInfo.holiday_type === 'SPECIAL' ? 'วันหยุดพิเศษ' : 'วันหยุดประเพณี') : '';
      if (isHoliday) holidayCount++;

      const l = logsMap[dStr];
      const leavesOnDate = leaveMap[dStr] || [];
      const hasApprovedLeave = leavesOnDate.length > 0;
      const advancesOnDate = advanceMap[dStr] || [];
      const hasAdvances = advancesOnDate.length > 0;
      if (hasApprovedLeave && !l) leaveDaysCount++;

      if (l) {
        if (l.clock_in) daysWorked++;
        const wH = Number(l.work_hours) || 0;
        totalWorkHours += wH;
        const otH = Number(l.ot_hours) || 0;
        totalOtHours += otH;
        const lateM = Number(l.late_minutes) || 0;
        if (lateM > 0) {
          lateCount++;
          totalLateMinutes += lateM;
        }

        const in1 = l.clock_in ? l.clock_in.substring(0, 5) : '-';
        const out1 = l.break_out ? l.break_out.substring(0, 5) : '-';
        const in2 = l.break_in ? l.break_in.substring(0, 5) : '-';
        const out2 = l.clock_out ? l.clock_out.substring(0, 5) : '-';

        const otStart = (otH > 0 && l.ot_start) ? l.ot_start.substring(0, 5) : (otH > 0 ? 'OT' : '-');
        const otEnd = (otH > 0 && l.ot_end) ? l.ot_end.substring(0, 5) : (otH > 0 ? `${otH} ชม.` : '-');

        const notes = [];
        if (isHoliday) notes.push(`⭐ ทำงานวันหยุด (${holidayName})`);
        if (hasApprovedLeave) {
          const lv = leavesOnDate[0];
          const lvLabel = (typeof LEAVE_TYPE_LABELS !== 'undefined' && LEAVE_TYPE_LABELS[lv.leave_type]) || lv.leave_type || 'ลา';
          notes.push(`🏖️ ${lvLabel}`);
        }
        if (hasAdvances) {
          advancesOnDate.forEach(ad => {
            const amt = Number(ad.amount) || 0;
            notes.push(`💵 เบิกเงิน ${amt.toLocaleString()} บ.`);
          });
        }
        if (otH > 0) notes.push(`OT ${otH} ชม.`);
        if (lateM > 0) notes.push(`สาย ${lateM} น.`);
        if (l.status === 'GEOFENCE_FAIL') notes.push('นอกพิกัด');
        if (l.remark) {
          const cleanRem = String(l.remark)
            .replace(/\[(?:สิทธิ์[^\]]*|นโยบาย[^\]]*|ยกเว้น[^\]]*|งานเสร็จ[^\]]*|ระบบ[^\]]*|เพิ่มโดย HR[^\]]*|แก้ไขโดย[^\]]*|จ่ายเต็มวัน[^\]]*)\]/g, '')
            .replace(/\|?\s*งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน/g, '')
            .replace(/\|?\s*สิทธิ์ประจำตำแหน่ง[^|,\n]*/g, '')
            .replace(/^[\s|,]+|[\s|,]+$/g, '')
            .replace(/\s*\|\s*\|\s*/g, ' | ')
            .trim();
          if (cleanRem && !notes.some(n => cleanRem.includes(n))) notes.push(cleanRem);
        }

        const lateCellStyle = lateM > 0 ? 'color:#b91c1c;font-weight:700;background:#fee2e2;' : 'color:#64748b;';
        const in1Color = lateM > 0 ? '#dc2626' : '#1d4ed8';
        const rowBg = isHoliday ? 'background:#fef3c7;' : (hasApprovedLeave ? 'background:#e0f2fe;' : (hasAdvances ? 'background:#fef9c3;border-left:3px solid #eab308;' : (isSunday ? 'background:#fff1f2;' : (idx % 2 === 1 ? 'background:#faf5ea;' : ''))));

        rowsHtml += `
          <tr style="height:21px; ${rowBg}">
            <td style="font-size:10px;">${idx + 1}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-size:10.5px;">${dateDisplay}</td>
            <td style="font-size:10px; ${isSunday ? 'color:#b91c1c;font-weight:700;' : (isHoliday ? 'color:#b45309;font-weight:700;' : (hasAdvances ? 'color:#854d0e;font-weight:700;' : ''))}">${dayName}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:10.5px; color:${in1Color}">${in1}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-size:10.5px; color:#475569">${out1}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-size:10.5px; color:#475569">${in2}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:10.5px; color:#991b1b">${out2}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#78350f">${otStart}</td>
            <td style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#78350f">${otEnd}</td>
            <td style="font-size:10.5px; font-weight:700;">${wH > 0 ? wH.toFixed(1) : '-'}</td>
            <td style="font-size:10px; ${lateCellStyle}">${lateM > 0 ? lateM : '-'}</td>
            <td style="text-align:left; padding-left:6px; font-size:9.5px; color:${isHoliday ? '#b45309;font-weight:700;' : (hasAdvances ? '#854d0e;font-weight:700;' : '#78350f;')}">${notes.join(', ') || 'ปกติ'}</td>
          </tr>
        `;
      } else {
        if (isHoliday) {
          rowsHtml += `
            <tr style="height:21px; background:#fef3c7; border-left:3px solid #f59e0b;">
              <td style="font-size:10px;">${idx + 1}</td>
              <td style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:10.5px; color:#92400e;">${dateDisplay}</td>
              <td style="font-size:10px; color:#b45309; font-weight:700;">${dayName}</td>
              <td colspan="6" style="color:#b45309; font-weight:700; letter-spacing:0.5px; font-size:9.5px; text-align:center;">
                ⭐ วันหยุด: ${holidayName} ${holidayTypeLabel ? `(${holidayTypeLabel})` : ''}
              </td>
              <td style="font-size:10px;">-</td>
              <td style="font-size:10px;">-</td>
              <td style="text-align:left; padding-left:6px; color:#b45309; font-weight:700; font-size:9.5px;">${holidayTypeLabel || 'วันหยุดบริษัท'}</td>
            </tr>
          `;
        } else if (hasApprovedLeave) {
          const lv = leavesOnDate[0];
          const lvLabel = (typeof LEAVE_TYPE_LABELS !== 'undefined' && LEAVE_TYPE_LABELS[lv.leave_type]) || lv.leave_type || 'ลา';
          const slot = lv.time_slot === 'MORNING' ? ' (ครึ่งวันเช้า)' : (lv.time_slot === 'AFTERNOON' ? ' (ครึ่งวันบ่าย)' : '');
          let leaveNote = `🏖️ ลาที่ได้รับอนุมัติ: ${lvLabel}${slot} ${lv.reason ? `(${lv.reason})` : ''}`;
          if (hasAdvances) {
            const advT = advancesOnDate.map(ad => `💵 เบิกเงิน ${(Number(ad.amount) || 0).toLocaleString()} บ.`).join(', ');
            leaveNote += ` • ${advT}`;
          }
          rowsHtml += `
            <tr style="height:21px; background:#e0f2fe; border-left:3px solid #0284c7;">
              <td style="font-size:10px;">${idx + 1}</td>
              <td style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:10.5px; color:#0369a1;">${dateDisplay}</td>
              <td style="font-size:10px; color:#0369a1; font-weight:700;">${dayName}</td>
              <td colspan="6" style="color:#0369a1; font-weight:700; font-size:9.5px; text-align:center;">
                ${leaveNote}
              </td>
              <td style="font-size:10px;">-</td>
              <td style="font-size:10px;">-</td>
              <td style="text-align:left; padding-left:6px; color:#0369a1; font-weight:700; font-size:9.5px;">อนุมัติการลา</td>
            </tr>
          `;
        } else if (hasAdvances) {
          const advText = advancesOnDate.map(ad => `💵 เบิกเงินล่วงหน้า ${(Number(ad.amount) || 0).toLocaleString()} บ. (อนุมัติแล้ว)`).join(', ');
          rowsHtml += `
            <tr style="height:21px; background:#fef9c3; border-left:3px solid #eab308;">
              <td style="font-size:10px;">${idx + 1}</td>
              <td style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:10.5px; color:#854d0e;">${dateDisplay}</td>
              <td style="font-size:10px; color:#854d0e; font-weight:700;">${dayName}</td>
              <td colspan="6" style="color:#854d0e; font-weight:700; font-size:9.5px; text-align:center;">
                ${advText}
              </td>
              <td style="font-size:10px;">-</td>
              <td style="font-size:10px;">-</td>
              <td style="text-align:left; padding-left:6px; color:#854d0e; font-weight:700; font-size:9.5px;">เบิกเงินล่วงหน้า</td>
            </tr>
          `;
        } else if (isSunday) {
          rowsHtml += `
            <tr style="height:21px; background:#fee2e2;">
              <td style="font-size:10px;">${idx + 1}</td>
              <td style="font-family:'JetBrains Mono',monospace; font-size:10.5px; color:#991b1b;">${dateDisplay}</td>
              <td style="font-size:10px; color:#b91c1c; font-weight:700;">${dayName}</td>
              <td colspan="6" style="color:#991b1b; font-weight:700; letter-spacing:1px; font-size:9.5px; text-align:center;">
                -- วันหยุดประจำสัปดาห์ (WEEKLY OFF) --
              </td>
              <td style="font-size:10px;">-</td>
              <td style="font-size:10px;">-</td>
              <td style="text-align:left; padding-left:6px; color:#991b1b; font-size:9.5px;">วันหยุด</td>
            </tr>
          `;
        } else {
          const nowBkk = new Date(Date.now() + 7 * 3600 * 1000);
          const todayIso = nowBkk.toISOString().substring(0, 10);
          const joinD = emp ? String(emp.joinDate || emp.join_date || emp.startDate || emp.start_date || '').substring(0, 10) : '';
          const resignD = emp ? String(emp.resignDate || emp.resign_date || '').substring(0, 10) : '';
          const isBeforeJoin = joinD && dStr < joinD;
          const isAfterResign = resignD && dStr > resignD;

          if (dStr < todayIso && !isBeforeJoin && !isAfterResign) {
            absentDaysCount++;
            rowsHtml += `
              <tr style="height:21px; background:#fef2f2; border-left:3px solid #ef4444;">
                <td style="font-size:10px;">${idx + 1}</td>
                <td style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:10.5px; color:#dc2626;">${dateDisplay}</td>
                <td style="font-size:10px; color:#b91c1c; font-weight:700;">${dayName}</td>
                <td colspan="6" style="color:#dc2626; font-weight:700; letter-spacing:0.5px; font-size:9.5px; text-align:center;">
                  🔴 ขาดงาน (ไม่มีบันทึกเวลาทำงาน)
                </td>
                <td style="font-size:10px; color:#dc2626; font-weight:700;">-</td>
                <td style="font-size:10px; color:#dc2626; font-weight:700;">-</td>
                <td style="text-align:left; padding-left:6px; color:#dc2626; font-weight:700; font-size:9.5px;">🔴 ขาดงาน</td>
              </tr>
            `;
          } else {
            rowsHtml += `
              <tr style="height:21px; ${idx % 2 === 1 ? 'background:#faf5ea;' : ''}">
                <td style="font-size:10px;">${idx + 1}</td>
                <td style="font-family:'JetBrains Mono',monospace; font-size:10.5px;">${dateDisplay}</td>
                <td style="font-size:10px;">${dayName}</td>
                <td colspan="6" style="color:#94a3b8; font-size:9.5px; text-align:center;">-</td>
                <td style="font-size:10px;">-</td>
                <td style="font-size:10px;">-</td>
                <td style="text-align:left; padding-left:6px; color:#94a3b8; font-size:9.5px;">-</td>
              </tr>
            `;
          }
        }
      }
    });

    const now = new Date();
    const thaiMonthList = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const printTimeStr = `${now.getDate()} ${thaiMonthList[now.getMonth()]} ${now.getFullYear() + 543} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`;
    const periodText = `${startDate} ถึง ${endDate}`;

    // 2. Offscreen container
    wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-9999px';
    wrapper.style.top = '0';
    wrapper.style.width = '790px';
    wrapper.style.zIndex = '-9999';
    wrapper.style.backgroundColor = '#faf8f0';
    wrapper.style.fontFamily = "'Prompt', 'Sarabun', sans-serif";
    wrapper.style.color = '#0f172a';
    wrapper.style.padding = '14px 18px';
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.border = '2.5px solid #78350f';

    wrapper.innerHTML = `
      <!-- Header -->
      <div style="border-bottom: 2px solid #78350f; padding-bottom: 6px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 44px; height: 44px; border-radius: 8px; background: #78350f; color: #fef08a; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; border: 1.5px solid #92400e; flex-shrink:0;">PTN</div>
            <div>
              <div style="font-size: 14.5px; font-weight: 800; color: #451a03; text-transform: uppercase;">${compName}</div>
              <div style="font-size: 10px; color: #78350f;">PTN PHARMA CENTER CO., LTD. &bull; เลขประจำตัวผู้เสียภาษี: ${compTax}</div>
              <div style="font-size: 12px; font-weight: 700; color: #78350f; margin-top: 1px;">บัตรบันทึกเวลาทำงาน (TIME CARD) &bull; ประจำงวดตัดวิก</div>
            </div>
          </div>
          <div style="text-align: right; border: 1px solid #92400e; background: #fefce8; border-radius: 6px; padding: 4px 10px; font-size: 11px; color: #451a03;">
            <div style="font-weight: 800; color: #78350f; font-size: 12px;">รอบงวด: ${periodText}</div>
            <div style="font-size: 9.5px; color: #92400e; margin-top: 2px;">พนักงาน: ${empId}</div>
          </div>
        </div>
      </div>

      <!-- Employee Info Banner -->
      <div style="display: grid; grid-template-columns: 1.2fr 2fr 2fr 1.8fr; gap: 6px; margin-bottom: 8px; background: #fef3c7; border: 1px solid #d97706; padding: 5px 8px; border-radius: 4px; font-size: 11px; color: #451a03;">
        <div><span style="font-size: 9.5px; color: #92400e; display: block; font-weight: 600;">รหัสพนักงาน:</span><span style="font-family:'JetBrains Mono',monospace; font-weight: 800; font-size: 12.5px;">${empId}</span></div>
        <div><span style="font-size: 9.5px; color: #92400e; display: block; font-weight: 600;">ชื่อ - นามสกุล:</span><span style="font-weight: 800; font-size: 12px;">${empFullName}</span></div>
        <div><span style="font-size: 9.5px; color: #92400e; display: block; font-weight: 600;">ตำแหน่ง / แผนก:</span><span style="font-weight: 700; font-size: 11px;">${empPos}</span></div>
        <div><span style="font-size: 9.5px; color: #92400e; display: block; font-weight: 600;">สาขาประจำ:</span><span style="font-weight: 700; font-size: 11px;">${empBranch}</span></div>
      </div>

      <!-- Table -->
      <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; border: 1.5px solid #92400e;">
        <thead>
          <tr style="background: #f5eedb; color: #78350f;">
            <th rowspan="2" style="width: 26px; border: 1px solid #d97706; padding: 3px 2px;">ลำดับ</th>
            <th rowspan="2" style="width: 70px; border: 1px solid #d97706; padding: 3px 2px;">วันที่</th>
            <th rowspan="2" style="width: 44px; border: 1px solid #d97706; padding: 3px 2px;">วัน</th>
            <th colspan="2" style="background: #fef3c7; border: 1px solid #d97706; padding: 2px;">กะเช้า (MORNING)</th>
            <th colspan="2" style="background: #fef3c7; border: 1px solid #d97706; padding: 2px;">กะบ่าย (AFTERNOON)</th>
            <th colspan="2" style="background: #fef3c7; border: 1px solid #d97706; padding: 2px;">ล่วงเวลา (OT)</th>
            <th rowspan="2" style="width: 46px; border: 1px solid #d97706; padding: 3px 2px;">รวม ชม.</th>
            <th rowspan="2" style="width: 42px; border: 1px solid #d97706; padding: 3px 2px;">สาย (น.)</th>
            <th rowspan="2" style="border: 1px solid #d97706; padding: 3px 4px;">หมายเหตุ / การลา / รายการเงินเบิก</th>
          </tr>
          <tr style="background: #f5eedb;">
            <th style="width: 42px; color: #1e3a8a; border: 1px solid #d97706; padding: 2px; font-size: 10px;">เข้า 1</th>
            <th style="width: 42px; color: #475569; border: 1px solid #d97706; padding: 2px; font-size: 10px;">ออก 1</th>
            <th style="width: 42px; color: #475569; border: 1px solid #d97706; padding: 2px; font-size: 10px;">เข้า 2</th>
            <th style="width: 42px; color: #991b1b; border: 1px solid #d97706; padding: 2px; font-size: 10px;">ออก 2</th>
            <th style="width: 42px; color: #78350f; border: 1px solid #d97706; padding: 2px; font-size: 10px;">เริ่ม</th>
            <th style="width: 42px; color: #78350f; border: 1px solid #d97706; padding: 2px; font-size: 10px;">สิ้นสุด</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <!-- Summary 6 Box -->
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-top: 6px; border: 1.5px solid #92400e; background: #fefce8; padding: 6px; text-align: center; font-size: 11px;">
        <div><div style="font-size: 9.5px; color: #92400e; font-weight: 700;">วันทำงานจริง</div><div style="font-size: 13px; font-weight: 800; color: #166534;">${daysWorked} วัน</div></div>
        <div><div style="font-size: 9.5px; color: #92400e; font-weight: 700;">วันลาที่อนุมัติ</div><div style="font-size: 13px; font-weight: 800; color: #6d28d9;">${leaveDaysCount} วัน</div></div>
        <div><div style="font-size: 9.5px; color: #92400e; font-weight: 700;">ขาดงาน</div><div style="font-size: 13px; font-weight: 800; color: ${absentDaysCount > 0 ? '#dc2626' : '#64748b'};">${absentDaysCount} วัน</div></div>
        <div><div style="font-size: 9.5px; color: #92400e; font-weight: 700;">ชม. งานปกติ</div><div style="font-size: 13px; font-weight: 800; color: #1e40af;">${totalWorkHours.toFixed(1)} ชม.</div></div>
        <div><div style="font-size: 9.5px; color: #92400e; font-weight: 700;">รวมล่วงเวลา (OT)</div><div style="font-size: 13px; font-weight: 800; color: #78350f;">${totalOtHours.toFixed(1)} ชม.</div></div>
        <div><div style="font-size: 9.5px; color: #92400e; font-weight: 700;">มาสายรวม</div><div style="font-size: 13px; font-weight: 800; color: #b91c1c;">${lateCount} ครั้ง (${totalLateMinutes} น.)</div></div>
      </div>

      <!-- Advance Payment Summary Banner -->
      ${totalAdvancesAmount > 0 ? `
      <div style="margin-top: 6px; border: 1.5px solid #eab308; background: #fffbeb; border-radius: 4px; padding: 5px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="background: #eab308; color: #713f12; width: 22px; height: 22px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px;">฿</span>
          <div>
            <strong style="color: #854d0e; font-size: 11.5px;">รายการเบิกเงินล่วงหน้างวดนี้ (Advance Payment):</strong>
            <span style="color: #713f12; margin-left: 6px;">
              ${approvedAdvances.map(ad => {
                const d = String(ad.request_date || '').substring(0, 10);
                const p = d.split('-');
                const thD = p.length === 3 ? `${p[2]}/${p[1]}/${parseInt(p[0], 10) + 543}` : d;
                return `${thD ? `วันที่ ${thD} ` : ''}${(Number(ad.amount) || 0).toLocaleString()}฿`;
              }).join(', ')}
            </span>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 10px; color: #854d0e;">ยอดเบิกรวม:</span>
          <strong style="font-family:'JetBrains Mono',monospace; font-size: 13.5px; color: #b45309; margin-left: 4px;">฿ ${totalAdvancesAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
          <span style="font-size: 9px; color: #a16207; display: block;">(หักในสลิปเงินเดือนงวดนี้)</span>
        </div>
      </div>
      ` : ''}

      <!-- Signatures -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 14px; text-align: center; font-size: 11px; color: #451a03;">
        <div>
          <div style="border-bottom: 1px dotted #92400e; width: 80%; margin: 24px auto 4px;"></div>
          <div style="font-weight: 700;">ลายมือชื่อพนักงาน</div>
          <div style="font-size: 10px; color: #78350f;">( ${empFullName || '..............................'} )</div>
          <div style="font-size: 9.5px; color: #92400e;">วันที่ ...../...../..........</div>
          ${totalAdvancesAmount > 0 ? `<div style="font-size: 8.5px; color: #b45309; margin-top: 2px;">*รับทราบเวลาทำงานและยอดหักเบิกเงิน ${totalAdvancesAmount.toLocaleString()}฿*</div>` : ''}
        </div>
        <div>
          <div style="border-bottom: 1px dotted #92400e; width: 80%; margin: 24px auto 4px;"></div>
          <div style="font-weight: 700;">ผู้ตรวจสอบ (หัวหน้างาน)</div>
          <div style="font-size: 10px; color: #78350f;">( .................................................... )</div>
          <div style="font-size: 9.5px; color: #92400e;">วันที่ ...../...../..........</div>
        </div>
        <div>
          <div style="border-bottom: 1px dotted #92400e; width: 80%; margin: 24px auto 4px;"></div>
          <div style="font-weight: 700;">ผู้อนุมัติ (ผู้จัดการ / HR)</div>
          <div style="font-size: 10px; color: #78350f;">( .................................................... )</div>
          <div style="font-size: 9.5px; color: #92400e;">วันที่ ...../...../..........</div>
        </div>
      </div>

      <!-- Footer Micro Text -->
      <div style="margin-top: 12px; display: flex; justify-content: space-between; font-size: 9px; color: #92400e; border-top: 1px solid #d97706; padding-top: 3px;">
        <span>PTN Time System &bull; Electronic Time Card Sheet</span>
        <span>สร้างเมื่อ: ${printTimeStr}</span>
      </div>
    `;

    document.body.appendChild(wrapper);

    if (typeof html2canvas !== 'function') {
      throw new Error('ไม่พบไลบรารี html2canvas ในระบบ');
    }

    const canvas = await html2canvas(wrapper, {
      scale: 2, // High resolution (retina crisp)
      useCORS: true,
      backgroundColor: '#faf8f0'
    });

    const imageUri = canvas.toDataURL('image/png');
    const filename = `TimeCard_${empId}_${startDate}_to_${endDate}.png`;

    // Direct auto-download
    const downloadLink = document.createElement('a');
    downloadLink.href = imageUri;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    // Prepare share if supported
    let canShare = false;
    let fileObj = null;
    try {
      if (canvas.toBlob && window.File && navigator.canShare) {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (blob) {
          fileObj = new File([blob], filename, { type: 'image/png' });
          canShare = navigator.canShare({ files: [fileObj] });
        }
      }
    } catch (e) {
      canShare = false;
    }

    // Show completion modal with preview and options
    Swal.fire({
      icon: 'success',
      title: 'สร้างรูปภาพบัตรตอกสำเร็จ!',
      html: `
        <div class="space-y-3 text-left">
          <p class="text-xs text-slate-600 text-center">ดาวน์โหลดไฟล์ <strong>${filename}</strong> แล้ว</p>
          <div class="border border-amber-300 rounded-xl overflow-hidden shadow-inner max-h-[38vh] overflow-y-auto bg-[#faf8f0] p-1">
            <img src="${imageUri}" class="w-full rounded shadow-sm" alt="Time Card Preview" />
          </div>
          <div class="space-y-1.5 pt-1">
            <a href="${imageUri}" download="${filename}" class="w-full py-2.5 px-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition block text-center">
              <i class="fa-solid fa-download"></i> ดาวน์โหลดรูปภาพอีกครั้ง
            </a>
            ${canShare ? `
              <button type="button" id="btnShareTimeCard" class="w-full py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition">
                <i class="fa-solid fa-share-nodes"></i> แชร์รูปภาพ (ส่งต่อเข้า LINE / บันทึกลงอัลบั้ม)
              </button>
            ` : ''}
          </div>
          <p class="text-[11px] text-slate-400 text-center">💡 หากรูปไม่บันทึกอัตโนมัติ ให้แตะที่รูปค้างไว้ แล้วเลือก 'บันทึกรูปภาพ' ลงเครื่อง</p>
        </div>
      `,
      showConfirmButton: true,
      confirmButtonText: 'ปิดหน้าต่าง',
      confirmButtonColor: '#78350f',
      didOpen: () => {
        if (canShare && fileObj) {
          const shareBtn = document.getElementById('btnShareTimeCard');
          if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
              try {
                await navigator.share({
                  files: [fileObj],
                  title: `บัตรตอกลงเวลา ${empId}`,
                  text: `บัตรตอกลงเวลาประจำงวด ${periodText} (${empFullName})`
                });
              } catch (err) {
                if (err.name !== 'AbortError') {
                  console.warn('Share error:', err);
                }
              }
            });
          }
        }
      }
    });

  } catch (err) {
    console.error('Time Card Image generation error:', err);
    Swal.fire('เกิดข้อผิดพลาด', err.message || 'ไม่สามารถสร้างรูปภาพบัตรตอกได้', 'error');
  } finally {
    if (wrapper && wrapper.parentNode) {
      document.body.removeChild(wrapper);
    }
  }
}

function printPayslipDocument() {
  if (!currentPayslipData) {
    Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลสลิปสำหรับพิมพ์', 'warning');
    return;
  }

  const slip = currentPayslipData;
  const comp = window.lastCompanyInfo || {};
  const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compName = comp.name || 'บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด';
  const compAddr = comp.address || '919/30 ม.10 ต.นครสวรรค์ตก อ.เมือง จ.นครสวรรค์ 60000';
  const compTax = comp.taxId || '0605556001337';
  const compPhone = comp.phone || '056-345625, 056-371370';
  const empId = slip.empId || (currentEmployee ? currentEmployee.empId : '-');
  const empName = slip.fullName || slip.full_name || slip.name || currentEmployee?.full_name || currentEmployee?.fullName || currentEmployee?.name || '-';
  const empRole = slip.position || currentEmployee?.position || currentEmployee?.role || 'พนักงาน';
  const empDept = slip.department || currentEmployee?.department || currentEmployee?.branch_name || 'สาขา B01';
  const bankName = slip.bankName || 'ธนาคารกสิกรไทย';
  const bankAcc = slip.bankAccount || slip.bankAccountMasked || '***-*-*----';
  const period = slip.period || '-';
  const payDate = slip.payDate || new Date().toLocaleDateString('th-TH');
  const otHoursText = (slip.otHours && slip.otHours > 0) ? `(${slip.otHours} ชม.)` : '';
  const thaiBaht = bahtTextHelper(slip.netPay);
  const nowStr = new Date().toLocaleString('th-TH');

  const printHtml = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบจ่ายเงินเดือน (Payslip) - ${empName} (${period})</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&family=Prompt:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Sarabun', 'Prompt', sans-serif;
      margin: 0;
      padding: 12px;
      background: #f8fafc;
      color: #0f172a;
    }
    .no-print-bar {
      max-width: 800px;
      margin: 0 auto 15px auto;
      background: #1e293b;
      color: #ffffff;
      padding: 10px 16px;
      border-radius: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .btn-print {
      background: #0284c7;
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: bold;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-close {
      background: #475569;
      color: #fff;
      border: none;
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      margin-left: 8px;
    }
    .voucher-card {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      border: 1.5px solid #1e293b;
      border-radius: 4px;
      padding: 18px 22px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .comp-title {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 2px 0;
      color: #0f172a;
    }
    .comp-sub {
      font-size: 11px;
      color: #475569;
      margin: 1px 0;
    }
    .doc-badge {
      font-size: 14px;
      font-weight: 800;
      border: 1.5px solid #0f172a;
      padding: 3px 10px;
      display: inline-block;
      background: #f8fafc;
      text-align: right;
    }
    .period-text {
      font-size: 12px;
      margin-top: 5px;
      text-align: right;
    }
    .date-text {
      font-size: 11px;
      color: #64748b;
      text-align: right;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    .info-table {
      margin-bottom: 12px;
      font-size: 12px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
    }
    .info-table td {
      padding: 5px 8px;
      border: 1px solid #e2e8f0;
    }
    .info-table td.lbl {
      color: #475569;
      background: #f1f5f9;
      width: 18%;
    }
    .info-table td.val {
      color: #0f172a;
      width: 32%;
    }
    .calc-table {
      border: 1.5px solid #334155;
      margin-bottom: 10px;
    }
    .calc-table th {
      background: #e2e8f0;
      color: #0f172a;
      font-size: 12px;
      font-weight: 700;
      padding: 6px;
      border: 1px solid #cbd5e1;
      text-align: center;
    }
    .inner-table td {
      padding: 4px 8px;
      font-size: 11.5px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    .inner-table td.num {
      text-align: right;
      font-family: monospace;
      font-weight: 600;
      color: #0f172a;
    }
    .summary-cell {
      background: #f1f5f9;
      padding: 6px 10px;
      border-top: 1.5px solid #334155;
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
    }
    .flex-between {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .netpay-box {
      border: 2px solid #0f172a;
      background: #f8fafc;
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      border-radius: 2px;
    }
    .stats-bar {
      font-size: 10.5px;
      color: #64748b;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      padding: 4px 8px;
      display: flex;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .sign-grid {
      display: flex;
      justify-content: space-around;
      padding-top: 10px;
      text-align: center;
    }
    .sign-col {
      width: 42%;
    }
    .sign-dots {
      font-size: 11px;
      color: #334155;
      margin-bottom: 22px;
    }
    .sign-label {
      font-size: 11px;
      color: #64748b;
    }
    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .no-print-bar {
        display: none !important;
      }
      .voucher-card {
        border: 1.5px solid #1e293b !important;
        box-shadow: none !important;
        max-width: 100% !important;
        padding: 12px 16px !important;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <div><strong>🖨️ ใบจ่ายเงินเดือน (e-Payslip)</strong> &bull; ${empName} (${period})</div>
    <div>
      <button type="button" class="btn-print" onclick="window.print()">สั่งพิมพ์ / บันทึก PDF</button>
      <button type="button" class="btn-close" onclick="window.close()">ปิดหน้าต่าง</button>
    </div>
  </div>

  <div class="voucher-card">
    <div class="header-row">
      <div>
        <h2 class="comp-title">${compName}</h2>
        <p class="comp-sub">${compAddr}</p>
        <p class="comp-sub">เลขประจำตัวผู้เสียภาษี: ${compTax}</p>
      </div>
      <div>
        <div class="doc-badge">ใบจ่ายเงินเดือน / PAYSLIP</div>
        <div class="period-text">งวดประจำเดือน: <strong>${period}</strong></div>
        <div class="date-text">วันที่จ่าย: ${payDate}</div>
      </div>
    </div>

    <table class="info-table">
      <tr>
        <td class="lbl">รหัสพนักงาน:</td>
        <td class="val"><strong>${empId}</strong></td>
        <td class="lbl">ชื่อ-นามสกุล:</td>
        <td class="val"><strong>${empName}</strong></td>
      </tr>
      <tr>
        <td class="lbl">ตำแหน่ง:</td>
        <td class="val">${empRole}</td>
        <td class="lbl">แผนก/สาขา:</td>
        <td class="val">${empDept}</td>
      </tr>
      <tr>
        <td class="lbl">การจ่ายเงิน:</td>
        <td class="val">${bankName}</td>
        <td class="lbl">เลขที่บัญชี:</td>
        <td class="val" style="font-family:monospace;">${bankAcc}</td>
      </tr>
    </table>

    <table class="calc-table">
      <thead>
        <tr>
          <th style="width:50%;">รายการได้ (EARNINGS)</th>
          <th style="width:50%;">รายการหัก (DEDUCTIONS)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="vertical-align: top; padding: 0;">
            <table class="inner-table">
              <tr><td>เงินเดือนพื้นฐาน</td><td class="num">${fmt(slip.baseSalary)}</td></tr>
              <tr><td>ค่าล่วงเวลา (OT) ${otHoursText}</td><td class="num">${fmt(slip.otPay)}</td></tr>
              <tr><td>เบี้ยขยัน</td><td class="num">${fmt(slip.allowance)}</td></tr>
              <tr><td>โบนัส / เงินพิเศษ</td><td class="num">${fmt(slip.bonus)}</td></tr>
              <tr style="height:18px;"><td>&nbsp;</td><td>&nbsp;</td></tr>
            </table>
          </td>
          <td style="vertical-align: top; padding: 0;">
            <table class="inner-table">
              <tr><td>ภาษีหัก ณ ที่จ่าย</td><td class="num">${fmt(slip.tax)}</td></tr>
              <tr><td>เงินสมทบประกันสังคม (SSO)</td><td class="num">${fmt(slip.sso)}</td></tr>
              <tr><td>กองทุนสำรองเลี้ยงชีพ (PF)</td><td class="num">${fmt(slip.pf)}</td></tr>
              <tr><td>หักเงินเบิกล่วงหน้า (Advance)</td><td class="num">${fmt(slip.advanceDeduct)}</td></tr>
              <tr><td>หักมาสาย / ออกก่อนเวลา</td><td class="num">${fmt(slip.lateDeduct)}</td></tr>
              <tr><td>หักลากิจ / ขาดงาน</td><td class="num">${fmt(slip.leaveDeduct !== undefined ? slip.leaveDeduct : slip.leaveDeduction)}</td></tr>
              ${slip.otherDeduct > 0 ? `<tr><td>หักอื่นๆ</td><td class="num">${fmt(slip.otherDeduct)}</td></tr>` : ''}
            </table>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="summary-cell">
            <div class="flex-between">
              <span>รวมเงินได้ทั้งสิ้น</span>
              <span style="font-family:monospace;">${fmt(slip.grossPay)}</span>
            </div>
          </td>
          <td class="summary-cell">
            <div class="flex-between">
              <span>รวมรายการหักทั้งสิ้น</span>
              <span style="font-family:monospace;">${fmt(slip.totalDeductions)}</span>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>

    <div class="netpay-box">
      <div>
        <span style="font-size:11px;color:#475569;display:block;">จำนวนเงินสุทธิ (ตัวอักษร):</span>
        <strong style="font-size:12.5px;color:#0f172a;">${thaiBaht}</strong>
      </div>
      <div style="text-align:right;">
        <span style="font-size:12px;font-weight:700;color:#334155;margin-right:6px;">เงินได้สุทธิ (Net Pay):</span>
        <span style="font-size:18px;font-weight:900;font-family:monospace;text-decoration:underline;">฿ ${fmt(slip.netPay)}</span>
      </div>
    </div>

    <div class="stats-bar">
      <span>สถิติประจำงวด: ขาดงาน <strong>${slip.absentDays || 0}</strong> วัน | ลากิจ <strong>${slip.leaveDays || 0}</strong> วัน | ลาป่วย <strong>${(slip.sickLeaveDays || 0) + (slip.unpaidSickLeaveDays || 0)}</strong> วัน</span>
      <span>${nowStr}</span>
    </div>

    <div class="sign-grid">
      <div class="sign-col">
        <div class="sign-dots">ลงชื่อ ..............................................................</div>
        <div class="sign-label">( พนักงานผู้รับเงิน )</div>
      </div>
      <div class="sign-col">
        <div class="sign-dots">ลงชื่อ ..............................................................</div>
        <div class="sign-label">( ผู้มีอำนาจจ่ายเงิน / ฝ่ายการเงิน )</div>
      </div>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  <\/script>
</body>
</html>`;

  const printWin = window.open('', '_blank');
  if (printWin) {
    printWin.document.open();
    printWin.document.write(printHtml);
    printWin.document.close();
  } else {
    // Fallback if popup blocked
    window.print();
  }
}

// ==============================================================================
// INCIDENT & DAMAGE DEDUCTIONS BREAKDOWN MODAL IN PAYSLIP
// ==============================================================================
async function openPayslipIncidentBreakdownModal() {
  const subtitleEl = document.getElementById('incBreakdownSubtitle');
  const contentEl = document.getElementById('incBreakdownContent');
  const totalSumEl = document.getElementById('incBreakdownTotalSum');

  const period = window.currentSlipPeriod || (typeof currentPayslipData !== 'undefined' ? currentPayslipData?.period : '') || '';
  const empId = currentEmployee?.empId;

  if (subtitleEl) subtitleEl.textContent = `งวดประจำ: ${period || 'ปัจจุบัน'} • พนักงาน: [${empId}] ${currentEmployee?.name || ''}`;

  if (contentEl) {
    contentEl.innerHTML = '<div class="text-center py-6 text-slate-400">กำลังโหลดรายละเอียดการหักเงิน...</div>';
  }

  if (typeof openModal === 'function') {
    openModal('modalIncidentBreakdown');
  } else {
    document.getElementById('modalIncidentBreakdown')?.classList.remove('hidden');
  }

  try {
    let items = window.currentSlipIncidentDeductions || [];
    let totalAmt = 0;

    // If not preloaded, fetch dynamically
    if (items.length === 0 && empId) {
      const res = await fetch(`${API_URL}?action=getEmployeeIncidentBreakdown&empId=${empId}&period=${encodeURIComponent(period)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        items = data.items;
        totalAmt = data.totalAmount || 0;
      }
    } else {
      totalAmt = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    }

    if (totalSumEl) {
      totalSumEl.textContent = `${totalAmt.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
    }

    if (items.length > 0 && contentEl) {
      const categoryMap = {
        CASH_SHORT: '💵 เงินสดขาด',
        GOODS_DAMAGE: '📦 สินค้าเสียหาย',
        STOCK_LOSS: '🔍 สต็อกหาย',
        PROPERTY_DAMAGE: '🏢 ทรัพย์สินร้าน',
        OTHER: '📝 อื่นๆ'
      };

      window.slipIncidentPhotosCache = items.map(it => it.evidence_photo_url || '');

      contentEl.innerHTML = items.map((it, idx) => {
        const catText = categoryMap[it.category] || it.category || 'อื่นๆ';
        const instText = it.total_installments > 1 ? `งวดที่ ${it.installment_no}/${it.total_installments}` : 'หักงวดเดียว';

        return `
          <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-mono font-bold text-xs text-slate-800">${it.incident_code || '#' + (it.incident_id || (idx + 1))}</span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">${instText}</span>
            </div>
            <div class="font-bold text-slate-900 text-xs">${it.title || 'ค่าชดใช้ความเสียหาย'}</div>
            <div class="flex items-center justify-between text-[11px] text-slate-500">
              <span>📅 ${it.incident_date || '-'} • ${catText}</span>
              <span class="font-mono font-bold text-rose-600 text-sm">฿${(Number(it.amount) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            ${it.description ? `
              <div class="text-[11px] text-slate-600 bg-white p-2 rounded-xl border border-slate-200">
                ${it.description}
              </div>
            ` : ''}
            ${it.evidence_photo_url ? `
              <div class="pt-2 border-t border-slate-200 flex items-center gap-2.5">
                <img src="${it.evidence_photo_url}" onclick="openSlipIncidentPhotoLightbox(${idx})" class="w-12 h-12 object-cover rounded-xl border border-slate-300 cursor-pointer shrink-0" alt="Evidence" />
                <button type="button" onclick="openSlipIncidentPhotoLightbox(${idx})" class="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition active:scale-95">
                  <span>📷</span> ดูรูปถ่ายหลักฐานขนาดใหญ่
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    } else if (contentEl) {
      contentEl.innerHTML = `
        <div class="text-center py-6 text-slate-400 space-y-1">
          <div>ℹ️</div>
          <div class="text-xs">ไม่พบรายการหักความเสียหายเฉพาะในงวดนี้</div>
          <div class="text-[11px] text-slate-400">(ยอดหักอื่นๆ อาจมาจากการปรับปรุงยอดประจำงวดของฝ่ายบุคคล)</div>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error fetching incident breakdown:', err);
    if (contentEl) {
      contentEl.innerHTML = '<div class="text-center py-4 text-rose-500 text-xs">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>';
    }
  }
}

function openSlipIncidentPhotoLightbox(idx) {
  const url = window.slipIncidentPhotosCache?.[idx];
  if (!url) return;

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: '📷 รูปถ่ายหลักฐานความเสียหาย',
      html: `
        <div class="mt-2 max-h-[65vh] overflow-auto bg-slate-50 rounded-2xl p-2 border border-slate-200">
          <img src="${url}" class="max-w-full max-h-[60vh] mx-auto rounded-xl object-contain" alt="Evidence" />
        </div>
      `,
      width: 'auto',
      showCloseButton: true,
      confirmButtonText: 'ปิดหน้าต่าง',
      confirmButtonColor: '#0284c7'
    });
  } else {
    window.open(url, '_blank');
  }
}
