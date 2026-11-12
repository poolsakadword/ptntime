/**
 * ==============================================================================
 * PTN Time Attendant - Requests Module (Salary Advance, Leave, OT, History Tab)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

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
  const month = document.getElementById('historyMonthPicker')?.value || getActiveCutoffPeriodString();
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

      // Cycle range from API (e.g. 2026-10-26 to 2026-11-25)
      const startDate = data.startDate || `${month}-01`;
      const endDate = data.endDate || `${month}-31`;

      const histCutoff = document.getElementById('historyCutoffLabel');
      if (histCutoff) {
        histCutoff.textContent = `รอบตัดวิก: ${formatDateThaiBE(startDate)} ถึง ${formatDateThaiBE(endDate)}`;
      }

      // Process company holidays for this period
      const holidays = data.holidays || window.companyHolidays || [];
      const periodHolidays = holidays.filter(h => h && h.date && h.date >= startDate && h.date <= endDate);
      
      const holidaySummaryEl = document.getElementById('historyHolidaySummary');
      const holidayCountTxt = document.getElementById('txtHistoryHolidayCount');
      if (holidaySummaryEl) {
        if (periodHolidays.length > 0) {
          holidaySummaryEl.classList.remove('hidden');
          if (holidayCountTxt) holidayCountTxt.textContent = `ในรอบนี้มีวันหยุดบริษัท / นักขัตฤกษ์ ${periodHolidays.length} วัน`;
        } else {
          holidaySummaryEl.classList.add('hidden');
        }
      }

      const holidayMap = {};
      periodHolidays.forEach(h => {
        holidayMap[h.date] = h;
      });

      // Process leaves for this period
      const rawLeaves = data.leaves || [];
      window._currentHistoryLeaves = rawLeaves;

      const approvedLeaves = rawLeaves.filter(lv => lv && lv.status === 'APPROVED');
      const leaveSummaryEl = document.getElementById('historyLeaveSummary');
      const leaveCountTxt = document.getElementById('txtHistoryLeaveCount');
      if (leaveSummaryEl) {
        if (approvedLeaves.length > 0) {
          const totalLeaveDays = approvedLeaves.reduce((sum, lv) => sum + (Number(lv.days_count) || 1), 0);
          leaveSummaryEl.classList.remove('hidden');
          if (leaveCountTxt) leaveCountTxt.textContent = `ในรอบนี้มีวันลาที่ได้รับอนุมัติ ${totalLeaveDays} วัน (${approvedLeaves.length} รายการ)`;
        } else {
          leaveSummaryEl.classList.add('hidden');
        }
      }

      const logs = data.logs || [];
      const logDates = new Set(logs.map(l => l.date));

      let todayStr = '';
      try {
        todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
      } catch (e) {
        todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
      }

      // Build leave map by date and collect standalone leaves (days without punch)
      const leaveMap = {}; // dateStr -> array of { leave, rawLeaveIndex }
      const standaloneLeaveDates = new Map(); // dateStr -> { leave, rawLeaveIndex }

      rawLeaves.forEach((lv, lIdx) => {
        if (!lv || !lv.start_date) return;
        let sDate = lv.start_date;
        let eDate = lv.end_date || lv.start_date;
        if (sDate > eDate) { const tmp = sDate; sDate = eDate; eDate = tmp; }

        let cur = new Date(sDate + 'T00:00:00Z');
        const end = new Date(eDate + 'T00:00:00Z');
        while (cur <= end) {
          const dStr = cur.toISOString().substring(0, 10);
          if (dStr >= startDate && dStr <= endDate) {
            if (!leaveMap[dStr]) leaveMap[dStr] = [];
            leaveMap[dStr].push({ leave: lv, rawLeaveIndex: lIdx });

            // If employee did NOT clock in on this date, register as standalone leave item
            if (!logDates.has(dStr)) {
              if (!standaloneLeaveDates.has(dStr)) {
                standaloneLeaveDates.set(dStr, { leave: lv, rawLeaveIndex: lIdx });
              }
            }
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      });
      window._currentHistoryLeaveMap = leaveMap;

      // Combine logs, standalone leaves, and company holidays
      const combinedItems = [];
      logs.forEach((l, idx) => {
        combinedItems.push({ type: 'LOG', date: l.date, log: l, rawIndex: idx });
      });

      // Add standalone leaves where employee didn't clock in
      standaloneLeaveDates.forEach((val, dStr) => {
        combinedItems.push({
          type: 'LEAVE',
          date: dStr,
          leave: val.leave,
          rawLeaveIndex: val.rawLeaveIndex
        });
      });

      // Add company holidays where neither log nor leave exists
      periodHolidays.forEach(h => {
        if (!logDates.has(h.date) && !standaloneLeaveDates.has(h.date)) {
          combinedItems.push({ type: 'HOLIDAY', date: h.date, holiday: h });
        }
      });

      // Sort by date DESC
      combinedItems.sort((a, b) => String(b.date).localeCompare(String(a.date)));

      if (combinedItems.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-xs text-slate-400">ไม่พบประวัติการลงเวลาในรอบนี้</div>';
        return;
      }

      window._currentHistoryLogs = logs;
      let html = '';
      combinedItems.forEach(item => {
        if (item.type === 'HOLIDAY') {
          const h = item.holiday;
          html += `
            <div class="bg-amber-50/90 p-3.5 sm:p-4 rounded-2xl border-2 border-amber-300 shadow-sm flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-amber-200 border-2 border-amber-300 flex items-center justify-center text-lg flex-shrink-0">
                  ⭐
                </div>
                <div class="space-y-0.5">
                  <div class="font-extrabold text-amber-950 text-sm sm:text-base">${formatDateThaiBE(h.date)}</div>
                  <div class="text-xs sm:text-sm font-bold text-amber-800">
                    วันหยุด: ${h.holiday_name} (${h.holiday_type === 'SPECIAL' ? 'วันหยุดพิเศษ' : 'วันหยุดประเพณี'})
                  </div>
                </div>
              </div>
              <div class="text-right flex-shrink-0 pl-2">
                <span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-amber-200 text-amber-950 border border-amber-300 shadow-xs">
                  วันหยุดบริษัท
                </span>
                <div class="text-[11px] sm:text-xs text-amber-700 mt-1 font-medium">หยุดพักผ่อน</div>
              </div>
            </div>
          `;
        } else if (item.type === 'LEAVE') {
          const lv = item.leave;
          const lIdx = item.rawLeaveIndex;
          const isApproved = lv.status === 'APPROVED';
          const isRejected = lv.status === 'REJECTED';

          const leaveName = LEAVE_TYPE_LABELS[lv.leave_type] || lv.leave_type || 'ลางาน';
          const isSick = lv.leave_type && lv.leave_type.startsWith('SICK');
          const isAnnual = lv.leave_type === 'ANNUAL';
          const icon = isSick ? '🩺' : (isAnnual ? '🌴' : '🏖️');
          const timeSlotText = lv.time_slot === 'MORNING' ? ' (ครึ่งวันเช้า)' : (lv.time_slot === 'AFTERNOON' ? ' (ครึ่งวันบ่าย)' : ' (เต็มวัน)');

          const badgeClass = isApproved
            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
            : (isRejected ? 'bg-rose-100 text-rose-900 border-rose-300' : 'bg-amber-100 text-amber-900 border-amber-300');
          const badgeText = isApproved ? '✓ อนุมัติแล้ว' : (isRejected ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');

          const cardBorder = isApproved
            ? 'border-sky-300 bg-sky-50/60 hover:border-sky-400'
            : (isRejected ? 'border-rose-200 bg-rose-50/40 hover:border-rose-300' : 'border-amber-200 bg-amber-50/40 hover:border-amber-300');

          html += `
            <div onclick="openHistoryLeaveModal(${lIdx})" class="p-3.5 sm:p-4 rounded-2xl border-2 ${cardBorder} shadow-sm flex items-center justify-between cursor-pointer active:scale-[0.98] transition group">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-full ${isApproved ? 'bg-sky-100 border-2 border-sky-300 text-sky-800' : 'bg-amber-100 border-2 border-amber-300 text-amber-800'} flex items-center justify-center text-lg flex-shrink-0 shadow-xs">
                  ${icon}
                </div>
                <div class="space-y-0.5">
                  <div class="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-1.5 flex-wrap">
                    <span>${formatDateThaiBE(item.date)}</span>
                    ${lv.medical_cert_url ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">📎 มีเอกสาร</span>` : ''}
                  </div>
                  <div class="text-xs sm:text-sm font-bold text-sky-900">
                    ${leaveName}${timeSlotText} ${lv.days_count ? `(${lv.days_count} วัน)` : ''}
                  </div>
                  ${lv.reason ? `<div class="text-[11px] sm:text-xs text-slate-500 truncate max-w-[200px] sm:max-w-xs">เหตุผล: ${lv.reason}</div>` : ''}
                </div>
              </div>
              <div class="text-right flex-shrink-0 pl-2">
                <span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-extrabold border shadow-xs ${badgeClass}">
                  ${badgeText}
                </span>
                <div class="text-[11px] sm:text-xs text-slate-400 mt-1 flex items-center justify-end gap-1 font-medium group-hover:text-sky-600 transition">
                  <span>แตะดู</span> <i class="fa-solid fa-chevron-right text-[9px]"></i>
                </div>
              </div>
            </div>
          `;
        } else {
          const l = item.log;
          const idx = item.rawIndex;
          const isLate = (l.late_minutes || 0) > 0;
          const isBranchEarly = (l.remark && l.remark.includes('งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน'));
          const isMissingClockOut = Boolean(
            l.clock_in && 
            (!l.clock_out || String(l.clock_out).trim() === '' || l.clock_out === '--' || l.status === 'INCOMPLETE') && 
            (l.date < todayStr)
          );
          const hOnLog = holidayMap[l.date];
          const leavesOnDate = leaveMap[l.date] || [];
          const primaryLeaveItem = leavesOnDate.length > 0 ? leavesOnDate[0].leave : null;

          html += `
            <div onclick="openHistoryDetailModal(${idx})" class="bg-white p-3.5 sm:p-4 rounded-2xl border ${isMissingClockOut ? 'border-rose-300 bg-rose-50/20' : (hOnLog ? 'border-purple-300 bg-purple-50/20' : (primaryLeaveItem ? 'border-sky-300 bg-sky-50/20' : 'border-slate-200'))} hover:border-sky-300 active:scale-[0.98] transition cursor-pointer shadow-sm flex items-center justify-between group">
              <div class="flex items-center space-x-3">
                <div class="flex items-center -space-x-2 flex-shrink-0">
                  ${l.in_photo_url ? `
                    <img src="${l.in_photo_url}" title="รูปถ่ายเข้างาน (${l.clock_in})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-emerald-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.in_photo_url}', 'รูปถ่ายเซลฟี่ตอนเข้างาน ${formatDateThaiBE(l.date)} (${l.clock_in})')" />
                  ` : ''}
                  ${l.break_out_photo_url ? `
                    <img src="${l.break_out_photo_url}" title="รูปถ่ายออกพัก (${l.break_out})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-amber-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.break_out_photo_url}', 'รูปถ่ายเซลฟี่ตอนออกไปพัก ${formatDateThaiBE(l.date)} (${l.break_out})')" />
                  ` : ''}
                  ${l.break_in_photo_url ? `
                    <img src="${l.break_in_photo_url}" title="รูปถ่ายเข้าจากพัก (${l.break_in})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-blue-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.break_in_photo_url}', 'รูปถ่ายเซลฟี่ตอนกลับเข้างาน ${formatDateThaiBE(l.date)} (${l.break_in})')" />
                  ` : ''}
                  ${l.out_photo_url ? `
                    <img src="${l.out_photo_url}" title="รูปถ่ายออกงาน (${l.clock_out})" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full object-cover border-2 border-rose-500 shadow cursor-pointer hover:scale-110 hover:z-10 transition" onclick="event.stopPropagation(); previewCertPhoto('${l.out_photo_url}', 'รูปถ่ายเซลฟี่ตอนออกงาน ${formatDateThaiBE(l.date)} (${l.clock_out})')" />
                  ` : ''}
                  ${!l.in_photo_url && !l.out_photo_url && !l.break_out_photo_url && !l.break_in_photo_url ? `
                    <div class="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-sm">📅</div>
                  ` : ''}
                </div>
                <div class="space-y-0.5">
                  <div class="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-1.5 flex-wrap">
                    <span>${formatDateThaiBE(l.date)}</span>
                    ${hOnLog ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">วันหยุด: ${hOnLog.holiday_name}</span>` : ''}
                    ${primaryLeaveItem ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-sky-100 text-sky-900 border border-sky-300">🏖️ ${LEAVE_TYPE_LABELS[primaryLeaveItem.leave_type] || 'ลางาน'} (${primaryLeaveItem.status === 'APPROVED' ? 'อนุมัติ' : 'รออนุมัติ'})</span>` : ''}
                  </div>
                  <div class="flex items-center space-x-2 text-xs sm:text-sm text-slate-600">
                    <span>เข้า: <b class="text-emerald-700 font-bold">${l.clock_in || '--'}</b></span>
                    <span>ออก: <b class="${isMissingClockOut ? 'text-rose-600 font-extrabold' : 'text-rose-700 font-bold'}">${l.clock_out || (isMissingClockOut ? 'ไม่ลงเวลา' : '--')}</b></span>
                    <span>(ปกติ ${l.work_hours || 0} ชม. ${l.ot_hours > 0 ? '+ OT ' + l.ot_hours + ' ชม.' : ''})</span>
                  </div>
                </div>
              </div>
              <div class="text-right flex-shrink-0 pl-2">
                ${isMissingClockOut
                  ? `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-rose-100 text-rose-800 border border-rose-300 shadow-sm">🔴 ขาดลงเวลาออก</span>`
                  : (hOnLog
                    ? `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-purple-100 text-purple-900 border border-purple-300 shadow-sm">⭐ ทำงานวันหยุด</span>`
                    : isBranchEarly
                      ? `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-bold bg-purple-100 text-purple-800 border border-purple-200 shadow-sm">✨ งานเสร็จ (เต็มวัน)</span>`
                      : isLate 
                        ? `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-bold bg-amber-100 text-amber-900 border border-amber-200 shadow-sm">สาย ${l.late_minutes} น.</span>`
                        : `<span class="px-2.5 py-1 rounded-xl text-xs sm:text-sm font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-sm">ปกติ</span>`
                  )
                }
                <div class="text-[11px] sm:text-xs text-slate-400 mt-1 flex items-center justify-end gap-1 font-medium group-hover:text-sky-600 transition">
                  <span>แตะดู</span> <i class="fa-solid fa-chevron-right text-[9px]"></i>
                </div>
              </div>
            </div>
          `;
        }
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

  var todayStr = '';
  try {
    todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  } catch (e) {
    todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
  }

  var isBranchEarly = (l.remark && l.remark.includes('งานเสร็จเลิกงานก่อน-จ่ายเต็มวัน'));
  var isLate = (l.late_minutes || 0) > 0;
  var isMissingClockOut = Boolean(
    l.clock_in && 
    (!l.clock_out || String(l.clock_out).trim() === '' || l.clock_out === '--' || l.status === 'INCOMPLETE') && 
    (l.date < todayStr)
  );

  var badgeEl = document.getElementById('hModalBadge');
  if (badgeEl) {
    if (isMissingClockOut) {
      badgeEl.className = 'px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold bg-rose-100 text-rose-800 border border-rose-300';
      badgeEl.textContent = '🔴 ขาดลงเวลาออกงาน (ไม่สแกนออก)';
    } else if (isBranchEarly) {
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
  if (dateEl) dateEl.textContent = formatDateThaiBE(l.date);

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
      pInCont.onclick = function() { previewCertPhoto(l.in_photo_url, 'รูปถ่ายเซลฟี่ตอนเข้างาน ' + formatDateThaiBE(l.date) + ' (' + (l.clock_in || '') + ')'); };
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
      pBOutCont.onclick = function() { previewCertPhoto(l.break_out_photo_url, 'รูปถ่ายเซลฟี่ตอนออกไปพัก ' + formatDateThaiBE(l.date) + ' (' + (l.break_out || '') + ')'); };
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
      pBInCont.onclick = function() { previewCertPhoto(l.break_in_photo_url, 'รูปถ่ายเซลฟี่ตอนกลับเข้างาน ' + formatDateThaiBE(l.date) + ' (' + (l.break_in || '') + ')'); };
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
  if (pOutBadge) pOutBadge.textContent = isBranchEarly ? '④ งานเสร็จ' : (isMissingClockOut ? '④ ขาดสแกนออก' : '④ เลิกงาน');
  if (pOutCont) {
    if (l.out_photo_url) {
      pOutCont.innerHTML = '<img src="' + l.out_photo_url + '" class="w-full h-full object-cover group-hover:scale-105 transition" alt="รูปออกงาน">';
      pOutCont.onclick = function() { previewCertPhoto(l.out_photo_url, 'รูปถ่ายเซลฟี่ตอนออกงาน ' + formatDateThaiBE(l.date) + ' (' + (l.clock_out || '') + ')'); };
    } else {
      var photoText = l.clock_out ? 'ไม่มีรูป' : (isMissingClockOut ? 'ขาดลงเวลาออก' : 'ยังไม่ลงเวลา');
      pOutCont.innerHTML = '<span class="text-[11px] ' + (isMissingClockOut ? 'text-rose-600 font-bold' : 'text-slate-400 font-medium') + '">' + photoText + '</span>';
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
    if (l.clock_out) {
      clockOutEl.innerHTML = l.clock_out + (isBranchEarly ? ' <span class="text-xs sm:text-sm font-bold text-purple-700">(งานเสร็จก่อนเวลา)</span>' : '');
    } else if (isMissingClockOut) {
      clockOutEl.innerHTML = '<span class="text-rose-600 font-bold">ไม่ได้ลงเวลาออกงาน (ขาดสแกนออก)</span>';
    } else {
      clockOutEl.innerHTML = '<span class="text-slate-400 font-normal">ยังไม่ได้ลงเวลาออก</span>';
    }
  }

  var hoursEl = document.getElementById('hModalHours');
  if (hoursEl) {
    var otTxt = (l.ot_hours && l.ot_hours > 0) ? ' + OT ' + l.ot_hours + ' ชม.' : '';
    hoursEl.textContent = (l.work_hours || 0) + ' ชม.' + otTxt;
  }

  // Leave Info Box in detail modal
  var leaveBox = document.getElementById('hModalLeaveBox');
  var leaveTitle = document.getElementById('hModalLeaveTitle');
  var leaveDesc = document.getElementById('hModalLeaveDesc');
  var leavesForDay = (window._currentHistoryLeaveMap && window._currentHistoryLeaveMap[l.date]) || [];
  if (leaveBox && leaveTitle && leaveDesc) {
    if (leavesForDay.length > 0) {
      var primaryLv = leavesForDay[0].leave;
      var lvName = LEAVE_TYPE_LABELS[primaryLv.leave_type] || primaryLv.leave_type;
      var lvStatusText = primaryLv.status === 'APPROVED' ? 'อนุมัติแล้ว' : (primaryLv.status === 'REJECTED' ? 'ไม่อนุมัติ' : 'รออนุมัติ');
      var lvSlotText = primaryLv.time_slot === 'MORNING' ? 'ครึ่งวันเช้า' : (primaryLv.time_slot === 'AFTERNOON' ? 'ครึ่งวันบ่าย' : 'เต็มวัน');
      leaveBox.classList.remove('hidden');
      leaveTitle.innerHTML = '🏖️ ข้อมูลการลา: ' + lvName + ' (' + lvStatusText + ')';
      leaveDesc.innerHTML = 'ช่วงเวลา: <strong>' + lvSlotText + '</strong>' + (primaryLv.reason ? ' | เหตุผล: ' + primaryLv.reason : '') + (primaryLv.approver_id ? ' (ผู้อนุมัติ: ' + primaryLv.approver_id + ')' : '');
    } else {
      leaveBox.classList.add('hidden');
    }
  }

  // Wage box
  var wageBox = document.getElementById('hModalWageBox');
  var wageTitle = document.getElementById('hModalWageTitle');
  var wageDesc = document.getElementById('hModalWageDesc');
  if (wageBox && wageTitle && wageDesc) {
    if (isMissingClockOut) {
      wageBox.className = 'border rounded-2xl p-3.5 space-y-1.5 bg-gradient-to-r from-rose-50 to-red-50 border-rose-200 text-rose-900';
      wageTitle.innerHTML = '🔴 การคิดค่าจ้างของวันนี้: ขาดลงเวลาออกงาน';
      var lateNote = isLate ? (' (มาสาย ' + l.late_minutes + ' นาที)') : '';
      wageDesc.innerHTML = 'พบการลงเวลาเข้างาน' + lateNote + ' แต่ไม่มีบันทึกเวลาเลิกงาน ระบบจึงไม่สามารถคำนวณชั่วโมงทำงานได้ กรุณาติดต่อหัวหน้างานหรือฝ่ายบุคคลเพื่อตรวจสอบ/แก้ไขเวลาให้ถูกต้อง';
    } else if (isBranchEarly) {
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

function openHistoryLeaveModal(idx) {
  const leaves = window._currentHistoryLeaves || [];
  const lv = leaves[idx];
  if (!lv) return;

  const leaveName = LEAVE_TYPE_LABELS[lv.leave_type] || lv.leave_type || 'ลางาน';
  const isApproved = lv.status === 'APPROVED';
  const isRejected = lv.status === 'REJECTED';
  const statusBadge = isApproved
    ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">✓ อนุมัติแล้ว</span>'
    : (isRejected
      ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">✕ ไม่อนุมัติ</span>'
      : '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">⏳ รออนุมัติ</span>');

  let dateRangeText = formatDateThaiBE(lv.start_date);
  if (lv.end_date && lv.end_date !== lv.start_date) {
    dateRangeText += ' ถึง ' + formatDateThaiBE(lv.end_date);
  }

  let slotText = 'เต็มวัน';
  if (lv.time_slot === 'MORNING') slotText = 'ครึ่งวันเช้า';
  if (lv.time_slot === 'AFTERNOON') slotText = 'ครึ่งวันบ่าย';

  let certHtml = '';
  if (lv.medical_cert_url) {
    certHtml = `
      <div class="mt-3 pt-3 border-t border-slate-200">
        <div class="text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
          <span>📎</span> เอกสารแนบ / ภาพถ่ายใบรับรอง:
        </div>
        <img src="${lv.medical_cert_url}" alt="เอกสารแนบ" 
          onclick="previewCertPhoto('${lv.medical_cert_url}', 'เอกสารแนบการลา: ${leaveName} (${dateRangeText})')"
          class="max-h-48 rounded-xl border border-slate-300 shadow-sm cursor-pointer hover:opacity-90 object-cover mx-auto" />
      </div>
    `;
  }

  Swal.fire({
    title: '<div class="text-base font-extrabold text-slate-800 flex items-center justify-center gap-2"><span>🏖️</span><span>รายละเอียดการลา</span></div>',
    html: `
      <div class="text-left text-xs sm:text-sm space-y-2.5 text-slate-700 mt-2">
        <div class="flex items-center justify-between pb-2 border-b border-slate-200">
          <span class="text-slate-500 font-medium">ประเภทการลา:</span>
          <span class="font-bold text-sky-800">${leaveName}</span>
        </div>
        <div class="flex items-center justify-between pb-2 border-b border-slate-200">
          <span class="text-slate-500 font-medium">วันที่ลา:</span>
          <span class="font-bold text-slate-900">${dateRangeText}</span>
        </div>
        <div class="flex items-center justify-between pb-2 border-b border-slate-200">
          <span class="text-slate-500 font-medium">ช่วงเวลา / จำนวน:</span>
          <span class="font-bold text-slate-800">${slotText} (${lv.days_count || 1} วัน)</span>
        </div>
        <div class="flex items-center justify-between pb-2 border-b border-slate-200">
          <span class="text-slate-500 font-medium">สถานะ:</span>
          <div>${statusBadge}</div>
        </div>
        ${lv.reason ? `
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-700">
            <span class="font-bold text-slate-800">เหตุผลการลา:</span> ${lv.reason}
          </div>
        ` : ''}
        ${isApproved && lv.approver_id ? `
          <div class="text-[11px] text-slate-500 bg-emerald-50/70 p-2 rounded-xl border border-emerald-200">
            <div>อนุมัติโดย: <b class="text-emerald-900">${lv.approver_id}</b></div>
            ${lv.approved_at ? `<div>เวลาอนุมัติ: ${lv.approved_at}</div>` : ''}
          </div>
        ` : ''}
        ${isRejected && lv.rejection_reason ? `
          <div class="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-xl border border-rose-200">
            <div>เหตุผลที่ไม่อนุมัติ: <b>${lv.rejection_reason}</b></div>
          </div>
        ` : ''}
        ${certHtml}
      </div>
    `,
    confirmButtonText: 'ปิด',
    confirmButtonColor: '#0284c7',
    customClass: {
      popup: 'rounded-3xl shadow-2xl p-4 sm:p-6'
    }
  });
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

function toggleLeaveTimeSlot() {
  const countEl = document.getElementById('leaveDaysCount');
  const slotCont = document.getElementById('leaveTimeSlotContainer');
  if (!countEl || !slotCont) return;
  const val = parseFloat(countEl.value);
  if (val === 0.5) {
    slotCont.classList.remove('hidden');
  } else {
    slotCont.classList.add('hidden');
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
  const timeSlot = (parseFloat(daysCount) === 0.5 && document.getElementById('leaveTimeSlot'))
    ? document.getElementById('leaveTimeSlot').value
    : 'FULL';
  const reason = document.getElementById('leaveReason').value.trim();
  const fileInput = document.getElementById('leaveCertFile');

  if (!startDate || !endDate || !daysCount) {
    Swal.fire('กรุณากรอกข้อมูลวันที่ให้ครบถ้วน', '', 'warning');
    return;
  }

  let certDataUrl = null;
  if (fileInput && fileInput.files && fileInput.files[0]) {
    certDataUrl = await compressImageFile(fileInput.files[0], 1024, 0.75);
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
        startDate: normalizeDateToIso(startDate),
        endDate: normalizeDateToIso(endDate),
        daysCount,
        timeSlot,
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
        date: normalizeDateToIso(date),
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

  const picker = document.getElementById('statusMonthPicker');
  const today = new Date().toISOString().substring(0, 10);
  const curMonth = today.substring(0, 7);
  if (picker && !picker.value) {
    picker.value = curMonth;
  }
  const month = (picker && picker.value) ? picker.value : curMonth;

  try {
    const res = await fetch(`${API_URL}?action=getEmployeeHistory&empId=${currentEmployee.empId}&month=${month}`);
    const data = await res.json();
    if (data.success) {
      let html = '';
      const leaves = data.leaves || [];
      const ots = (data.ots || []).filter(ot => {
        const r = String(ot.reason || '');
        return !r.includes('(Admin ปรับปรุงเวลา)') && !r.includes('OT งานเสร็จประจำวัน') && !r.includes('(HR ลงเวลาแทน)');
      });
      const advances = data.advances || [];

      // Check and fire realtime notification if any request status transitioned
      checkRequestStatusChanges(leaves, ots, advances);

      if (leaves.length === 0 && ots.length === 0 && advances.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-slate-400">ยังไม่มีรายการคำขอในงวดนี้ (${data.startDate || month} ถึง ${data.endDate || month})</div>`;
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
            <div class="text-slate-600 text-xs font-medium">วันที่ขอ: ${formatDateThaiBE(ad.request_date)} (วันทำงาน ${ad.days_worked} วัน)</div>
            ${ad.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${ad.reason}</div>` : ''}
          </div>
        `;
      });

      leaves.forEach(lv => {
        const badgeColor = lv.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (lv.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = lv.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (lv.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        const isFuture = data.endDate && (lv.start_date > data.endDate);
        const futureBadge = isFuture ? '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">ลางานล่วงหน้า</span>' : '';
        const cancelBtn = lv.status === 'PENDING' ? `
          <button onclick="cancelMyRequest('leave', ${lv.id})" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-600 rounded-xl text-xs font-bold border border-rose-200 flex items-center gap-1 transition">
            <i class="fa-solid fa-trash-can text-[11px]"></i> ยกเลิกคำขอ
          </button>
        ` : '';
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-extrabold text-slate-800 text-sm">🏖️ ขอลางาน: ${LEAVE_TYPE_LABELS[lv.leave_type] || lv.leave_type}</span>
                ${futureBadge}
              </div>
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
                ${cancelBtn}
              </div>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่: ${formatDateThaiBE(lv.start_date)} ถึง ${formatDateThaiBE(lv.end_date)} (${lv.days_count} วัน)</div>
            ${lv.reason ? `<div class="text-slate-500 text-xs bg-slate-50 p-2 rounded-xl mt-1">เหตุผล: ${lv.reason}</div>` : ''}
            ${lv.medical_cert_url ? `
              <div class="mt-2 p-2 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 cursor-pointer" onclick="previewCertPhoto('${lv.medical_cert_url}', 'เอกสารแนบการลา (${formatDateThaiBE(lv.start_date)})')" title="แตะเพื่อดูรูปขยาย">
                  <img src="${lv.medical_cert_url}" alt="Cert" class="w-10 h-10 rounded-lg object-cover border border-sky-400 shadow-xs flex-shrink-0" />
                  <div>
                    <div class="text-[11px] font-bold text-sky-900 flex items-center gap-1">📎 เอกสารแนบ / ใบรับรองแพทย์</div>
                    <div class="text-[10px] text-sky-700">แตะเพื่อดูรูปขยาย &amp; ซูม</div>
                  </div>
                </div>
                <button type="button" onclick="previewCertPhoto('${lv.medical_cert_url}', 'เอกสารแนบการลา (${formatDateThaiBE(lv.start_date)})')" class="py-1 px-2.5 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white rounded-lg font-bold text-[11px] shadow-xs flex items-center gap-1 whitespace-nowrap">
                  <i class="fa-solid fa-magnifying-glass-plus"></i> ดูรูปขยาย
                </button>
              </div>
            ` : ''}
          </div>
        `;
      });

      ots.forEach(ot => {
        const badgeColor = ot.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : (ot.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-900 border-amber-200');
        const badgeText = ot.status === 'APPROVED' ? '✓ อนุมัติแล้ว' : (ot.status === 'REJECTED' ? '✕ ไม่อนุมัติ' : '⏳ รออนุมัติ');
        const isFutureOt = data.endDate && ((ot.date || ot.ot_date) > data.endDate);
        const futureOtBadge = isFutureOt ? '<span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">ล่วงหน้า</span>' : '';
        const cancelBtn = ot.status === 'PENDING' ? `
          <button onclick="cancelMyRequest('ot', ${ot.id})" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-600 rounded-xl text-xs font-bold border border-rose-200 flex items-center gap-1 transition">
            <i class="fa-solid fa-trash-can text-[11px]"></i> ยกเลิกคำขอ
          </button>
        ` : '';
        html += `
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-extrabold text-slate-800 text-sm">⏱️ ขอทำ OT (${ot.ot_type}x)</span>
                ${futureOtBadge}
              </div>
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-1 rounded-xl text-xs font-bold border ${badgeColor}">${badgeText}</span>
                ${cancelBtn}
              </div>
            </div>
            <div class="text-slate-600 text-xs font-medium">วันที่: ${formatDateThaiBE(ot.date || ot.ot_date)} — ขอ: ${ot.planned_hours} ชม. (จริง: ${ot.actual_hours || 0} ชม.)</div>
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

