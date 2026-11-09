/**
 * ==============================================================================
 * PTN Time Attendant - Geo & Camera Module (Geofencing, AI Face Detection, Smile Meter)
 * Website: https://ptntime.pages.dev
 * ==============================================================================
 */

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
    badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700';
    badge.textContent = 'กำลังตรวจพิกัด...';
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (icon) icon.classList.remove('animate-spin');
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      currentLocation = { lat, lng, accuracy: pos.coords.accuracy };
      
      // Fetch location name dynamically
      fetchLocationName(lat, lng).then(name => {
        if (name && currentLocation) {
          currentLocation.locationName = name;
        }
      });

      const targetBranch = getCurrentEmployeeTargetBranch();
      const targetLat = targetBranch.lat || appSettings.office_lat;
      const targetLng = targetBranch.lng || appSettings.office_lng;
      const targetRadius = targetBranch.radius_meters || appSettings.geofence_radius_meters || 200;
      const targetBranchName = targetBranch.branch_name || 'สำนักงานใหญ่';

      const dist = calculateHaversineMeters(lat, lng, targetLat, targetLng);
      currentDistanceMeters = dist;

      const isInside = dist <= targetRadius;

      if (statusText) statusText.textContent = targetBranchName;
      if (distText) distText.textContent = `ระยะห่าง ${dist} ม. (รัศมีอนุญาต ${targetRadius} ม.)`;

      if (badge) {
        if (isInside) {
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800';
          badge.textContent = 'ในพิกัด ✅';
          if (pulse) pulse.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping';
        } else {
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800';
          badge.textContent = 'นอกพื้นที่ ⚠️';
          if (pulse) pulse.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
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
        badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700';
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
var fsCameraStream = null;
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

// ==============================================================================
// SMILE METER & POSITIVE GREETINGS REAL-TIME OVERLAY
// ==============================================================================
var smileMeterInterval = null;
let currentSmileScore = 80;
let targetSmileScore = 85;

function setupSelfieGreetingsAndSmileMeter(clockType) {
  const containerMeter = document.getElementById('camSmileMeterContainer');
  const containerBubble = document.getElementById('camGreetingBubbleContainer');
  const banner = document.getElementById('camSpecialEventBanner');
  const bannerEmoji = document.getElementById('camSpecialEventEmoji');
  const bannerText = document.getElementById('camSpecialEventText');

  // Check master switch
  const isEnabled = (appSettings.enable_selfie_greetings !== 'false');
  if (!isEnabled) {
    if (containerMeter) {
      containerMeter.classList.add('opacity-0', '-translate-y-2');
      containerMeter.classList.remove('opacity-100', 'translate-y-0');
    }
    if (containerBubble) {
      containerBubble.classList.add('opacity-0', 'translate-y-2');
      containerBubble.classList.remove('opacity-100', 'translate-y-0');
    }
    return;
  }

  // 1. Setup Positive Greeting based on clockType and settings
  let typeEnabled = true;
  let eventTitle = 'ข้อความทักทายตอนเข้างาน';
  let eventIcon = '🌅';
  let messagesText = appSettings.selfie_custom_messages || '';

  if (clockType === 'BREAK_OUT' || clockType === 'BREAK_IN') {
    typeEnabled = (appSettings.enable_selfie_break_greetings !== 'false');
    eventTitle = clockType === 'BREAK_OUT' ? 'ข้อความทักทายช่วงพัก' : 'ข้อความกลับเข้าทำงาน';
    eventIcon = '☕';
    messagesText = appSettings.selfie_custom_messages_break || '';
  } else if (clockType === 'OUT') {
    typeEnabled = (appSettings.enable_selfie_clockout_greetings !== 'false');
    eventTitle = 'ข้อความขอบคุณตอนเลิกงาน';
    eventIcon = '🌆';
    messagesText = appSettings.selfie_custom_messages_out || '';
  } else {
    typeEnabled = (appSettings.enable_selfie_clockin_greetings !== 'false');
    eventTitle = 'ข้อความทักทายตอนเข้างาน';
    eventIcon = '🌅';
    messagesText = appSettings.selfie_custom_messages || '';
  }

  // Choose greeting line
  const lines = messagesText.split('\n').map(s => s.trim()).filter(Boolean);
  let chosenMessage = '';
  if (lines.length > 0) {
    const day = new Date().getDate();
    const charCode = currentEmployee && currentEmployee.empId ? currentEmployee.empId.charCodeAt(currentEmployee.empId.length - 1) : 0;
    const idx = (day + charCode) % lines.length;
    chosenMessage = lines[idx] || lines[0];
  } else {
    if (clockType === 'OUT') {
      chosenMessage = 'ขอบคุณสำหรับความทุ่มเทในวันนี้นะคะ ทำงานเหนื่อยมาทั้งวันแล้ว เก่งมากๆ ค่ะ 👏💖';
    } else if (clockType === 'BREAK_OUT' || clockType === 'BREAK_IN') {
      chosenMessage = 'ทานอาหารกลางวันให้อร่อยนะคะ ชาร์จพลังให้เต็มที่ 🍜🍱';
    } else {
      chosenMessage = 'สวัสดีตอนเช้าค่ะ วันนี้ยิ้มสดใสมาก ขอให้เป็นวันที่ราบรื่นและมีความสุขนะคะ 🌸';
    }
  }

  const msgEl = document.getElementById('camGreetingMessage');
  const titleEl = document.getElementById('camGreetingEventTitle');
  const iconEl = document.getElementById('camGreetingEventIcon');
  if (msgEl) msgEl.textContent = `"${chosenMessage}"`;
  if (titleEl) titleEl.textContent = eventTitle;
  if (iconEl) iconEl.textContent = eventIcon;

  // Show or hide Greeting Bubble
  if (containerBubble) {
    if (typeEnabled) {
      containerBubble.classList.remove('opacity-0', 'translate-y-2');
      containerBubble.classList.add('opacity-100', 'translate-y-0');
    } else {
      containerBubble.classList.add('opacity-0', 'translate-y-2');
      containerBubble.classList.remove('opacity-100', 'translate-y-0');
    }
  }

  // 2. Birthday / Saturday Special Event Check
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentDay = now.getDate();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

  let isBirthday = false;
  if (appSettings.enable_birthday_greeting !== 'false' && currentEmployee && currentEmployee.birthDate) {
    try {
      const bDate = new Date(currentEmployee.birthDate);
      if (!isNaN(bDate.getTime())) {
        if (bDate.getDate() === currentDay && (bDate.getMonth() + 1) === currentMonth) {
          isBirthday = true;
        }
      }
    } catch (e) {}
  }

  const isSaturday = (appSettings.enable_saturday_greeting !== 'false' || appSettings.enable_friday_tgif !== 'false') && dayOfWeek === 6;

  if (banner && bannerEmoji && bannerText) {
    if (isBirthday) {
      bannerEmoji.textContent = '🎂';
      bannerText.textContent = `สุขสันต์วันเกิดคุณ ${currentEmployee?.nickname || currentEmployee?.fullName || ''}! ขอให้มีความสุข สดใสตลอดปีนะคะ ✨`;
      banner.classList.remove('hidden');
    } else if (isSaturday) {
      bannerEmoji.textContent = '🎉';
      bannerText.textContent = 'สุขสันต์วันเสาร์! พรุ่งนี้วันหยุดพักผ่อนแล้ว ยิ้มรับวันใหม่กันนะคะ 🌈';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  // 3. Start Smile Meter simulation & display badge
  if (containerMeter) {
    containerMeter.classList.remove('opacity-0', '-translate-y-2');
    containerMeter.classList.add('opacity-100', 'translate-y-0');
  }

  currentSmileScore = 78 + Math.floor(Math.random() * 6); // 78-83%
  updateSmileMeterUI(currentSmileScore, false);
  startSmileMeterSimulation();
}

function startSmileMeterSimulation() {
  stopSmileMeterSimulation();
  smileMeterInterval = setInterval(() => {
    if (isFaceDetected) {
      targetSmileScore = 93 + Math.floor(Math.random() * 6); // 93-98%
    } else {
      targetSmileScore = 76 + Math.floor(Math.random() * 10); // 76-85%
    }
    
    if (currentSmileScore < targetSmileScore) {
      currentSmileScore += Math.ceil((targetSmileScore - currentSmileScore) * 0.4);
    } else if (currentSmileScore > targetSmileScore) {
      currentSmileScore -= Math.ceil((currentSmileScore - targetSmileScore) * 0.4);
    }
    
    updateSmileMeterUI(currentSmileScore, isFaceDetected);
  }, 400);
}

function stopSmileMeterSimulation() {
  if (smileMeterInterval) {
    clearInterval(smileMeterInterval);
    smileMeterInterval = null;
  }
}

function updateSmileMeterUI(score, faceActive) {
  const scoreText = document.getElementById('camSmileScoreText');
  const moodTag = document.getElementById('camSmileMoodTag');
  const icon = document.getElementById('camSmileIcon');
  const badge = document.getElementById('camSmileMeterBadge');

  if (!scoreText) return;

  score = Math.max(60, Math.min(99, score));
  scoreText.textContent = `Smile Score: ${score}%`;

  if (score >= 92 || faceActive) {
    if (icon) icon.textContent = '🌟';
    if (moodTag) {
      moodTag.textContent = 'ยิ้มสดใสมาก! 🌸';
      moodTag.className = 'text-xs sm:text-sm font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300';
    }
    if (badge) {
      badge.className = 'flex items-center gap-2.5 px-4.5 py-2 sm:px-5 sm:py-2.5 rounded-full bg-white/95 backdrop-blur-md border border-emerald-400 shadow-xl text-emerald-950 transition-all duration-300 ring-2 ring-emerald-300/50 scale-105';
    }
  } else if (score >= 82) {
    if (icon) icon.textContent = '😊';
    if (moodTag) {
      moodTag.textContent = 'ยิ้มเข้าไว้ ✨';
      moodTag.className = 'text-xs sm:text-sm font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200';
    }
    if (badge) {
      badge.className = 'flex items-center gap-2.5 px-4.5 py-2 sm:px-5 sm:py-2.5 rounded-full bg-white/95 backdrop-blur-md border border-amber-300 shadow-xl text-amber-950 transition-all duration-300';
    }
  } else {
    if (icon) icon.textContent = '🙂';
    if (moodTag) {
      moodTag.textContent = 'ส่งยิ้มพิมพ์ใจ 💖';
      moodTag.className = 'text-xs sm:text-sm font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-200';
    }
    if (badge) {
      badge.className = 'flex items-center gap-2.5 px-4.5 py-2 sm:px-5 sm:py-2.5 rounded-full bg-white/95 backdrop-blur-md border border-slate-300 shadow-lg text-slate-800 transition-all duration-300';
    }
  }
}

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
      if (typeof updateSmileMeterUI === 'function') {
        currentSmileScore = 93 + Math.floor(Math.random() * 6);
        updateSmileMeterUI(currentSmileScore, true);
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

function fetchCurrentLocationPromise(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(currentLocation);
      }
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          currentLocation = { lat, lng, accuracy: pos.coords.accuracy };
          try {
            const targetBranch = getCurrentEmployeeTargetBranch();
            currentDistanceMeters = calculateDistanceMeters(lat, lng, targetBranch.lat || appSettings.office_lat, targetBranch.lng || appSettings.office_lng);
          } catch(e) {}
          resolve(currentLocation);
        }
      },
      (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(currentLocation);
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

async function compressImageFile(file, maxDimension = 1024, quality = 0.75) {
  if (!file) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDimension || h > maxDimension) {
          if (w > h) {
            h = Math.round((h * maxDimension) / w);
            w = maxDimension;
          } else {
            w = Math.round((w * maxDimension) / h);
            h = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function openFullscreenCamera(type, qrToken) {
  if (!currentEmployee) {
    openEmployeePickerModal();
    return;
  }

  // Geofence check before opening camera with seamless Auto-GPS resolution
  if (!currentLocation) {
    Swal.fire({
      title: 'กำลังระบุพิกัด GPS...',
      text: 'ระบบกำลังดึงพิกัดสาขาเพื่อเปิดกล้องอัตโนมัติ',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });
    await fetchCurrentLocationPromise(5000);
    Swal.close();
    if (!currentLocation) {
      Swal.fire({
        icon: 'warning',
        title: 'ไม่สามารถระบุพิกัดได้',
        text: 'กรุณาเปิดบริการตำแหน่ง (GPS) ในโทรศัพท์ แล้วลองใหม่อีกครั้ง'
      });
      return;
    }
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

  // Initialize Smile Meter & Positive Greetings
  setupSelfieGreetingsAndSmileMeter(type);

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
  stopSmileMeterSimulation();

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
  const fontSans = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  
  // Style 4: Corporate Split (Blue & Light Gray)
  const stripY = 520;
  const stripH = 120;
  const leftW = Math.floor(width * 0.55);
  
  // Left side bg (Corporate Blue)
  ctx.fillStyle = '#1d4ed8'; 
  ctx.fillRect(0, stripY, leftW, stripH);
  
  // Right side bg (Light Gray)
  ctx.fillStyle = '#f3f4f6'; 
  ctx.fillRect(leftW, stripY, width - leftW, stripH);
  
  // Top border for right side
  ctx.fillStyle = '#3b82f6'; 
  ctx.fillRect(leftW, stripY, width - leftW, 4);

  // Time & Date
  const now = new Date();
  const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dateStr = `${now.getDate()} ${thMonths[now.getMonth()]} ${now.getFullYear() + 543}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  // Left Content (Time, Date, Employee)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 28px ${fontSans}`;
  ctx.fillText(timeStr, 16, stripY + 40);
  
  ctx.fillStyle = '#dbeafe'; 
  ctx.font = `18px ${fontSans}`;
  ctx.fillText(dateStr, 16, stripY + 68);
  
  const empName = currentEmployee ? (currentEmployee.full_name || currentEmployee.empId) : 'พนักงาน';
  const empId = currentEmployee ? currentEmployee.empId : '';
  const empDisplay = empId ? `${empName} (รหัส ${empId})` : empName;
  
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 18px ${fontSans}`;
  ctx.fillText(empDisplay, 16, stripY + 98);
  
  // Right Content (Branch, Location, GPS)
  const targetBranch = (typeof getCurrentEmployeeTargetBranch === 'function') ? getCurrentEmployeeTargetBranch() : null;
  const branchName = targetBranch ? (targetBranch.branch_name || targetBranch.branch_id || 'สำนักงานใหญ่') : 'สำนักงานใหญ่';
  
  let gpsDisplay = 'ไม่พบพิกัดดาวเทียม';
  if (currentLocation && currentLocation.lat && currentLocation.lng) {
    gpsDisplay = `${Number(currentLocation.lat).toFixed(6)}, ${Number(currentLocation.lng).toFixed(6)}`;
  }
  
  const locName = (currentLocation && currentLocation.locationName) ? currentLocation.locationName : `ระบุไม่ได้`;

  ctx.fillStyle = '#1d4ed8'; 
  ctx.font = `bold 18px ${fontSans}`;
  ctx.fillText(`สาขา: ${branchName}`, leftW + 16, stripY + 40);
  
  ctx.fillStyle = '#334155'; 
  ctx.font = `bold 16px ${fontSans}`;
  ctx.fillText(locName.substring(0, 25) + (locName.length>25?'...':''), leftW + 16, stripY + 68);
  
  ctx.fillStyle = '#64748b'; 
  ctx.font = `bold 14px ${fontSans}`;
  ctx.fillText(`GPS: ${gpsDisplay}`, leftW + 16, stripY + 98);
  
  // Badge
  let badgeText = 'IN';
  let badgeColor = '#10b981';
  if (clockType === 'OUT') { badgeText = 'OUT'; badgeColor = '#ef4444'; }
  else if (clockType === 'BREAK_OUT') { badgeText = 'BREAK OUT'; badgeColor = '#f59e0b'; }
  else if (clockType === 'BREAK_IN') { badgeText = 'BREAK IN'; badgeColor = '#06b6d4'; }
  
  ctx.fillStyle = badgeColor;
  ctx.fillRect(width - 45, stripY + 16, 45, 24);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 13px ${fontSans}`;
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, width - 22, stripY + 33);
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

  // 2. Crop and Compress Frame from Video (Upgraded to 640x640 with Natural Beauty Filter)
  const targetSize = 640; // 640x640 HD resolution for sharp, radiant portrait
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const cropSize = Math.min(vw, vh);
  const startX = (vw - cropSize) / 2;
  const startY = (vh - cropSize) / 2;

  // Create offscreen canvas for beauty rendering
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = targetSize;
  tmpCanvas.height = targetSize;
  const tmpCtx = tmpCanvas.getContext('2d');
  
  tmpCtx.save();
  if (currentCameraFacing === 'user') {
    tmpCtx.translate(targetSize, 0);
    tmpCtx.scale(-1, 1);
  }

  // 🌟 Pass 1: Crisp Base Layer with radiant skin tone
  try {
    tmpCtx.filter = 'brightness(1.07) contrast(1.01) saturate(1.08)';
  } catch(e) {}
  tmpCtx.drawImage(video, startX, startY, cropSize, cropSize, 0, 0, targetSize, targetSize);

  // 🌟 Pass 2: Automatic Dual-Pass Soft-Focus
  try {
    tmpCtx.save();
    tmpCtx.filter = 'blur(4px) brightness(1.10) contrast(0.94)';
    tmpCtx.globalAlpha = 0.35;
    tmpCtx.drawImage(video, startX, startY, cropSize, cropSize, 0, 0, targetSize, targetSize);
    tmpCtx.restore();
  } catch(e) {}

  tmpCtx.restore();

  // Clear main canvas (white background for watermark strip)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // ensure reset transform
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetSize, targetSize);

  // Draw beauty image to top 520px (cropping slightly to keep face centered)
  ctx.drawImage(tmpCanvas, 0, 15, 640, 520, 0, 0, 640, 520);
  
  // Overlay GPS Watermark (Style 4: Corporate Split)
  drawAttendanceWatermark(ctx, targetSize, targetSize, activePendingClock ? activePendingClock.type : 'IN');
  ctx.restore();

  // Smart HD Optimization: 0.78 JPEG Quality (~45-55KB, crisp details, smooth skin without artifacts)
  const photoBase64 = canvas.toDataURL('image/jpeg', 0.78);

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


// ==========================================
// REVERSE GEOCODING (Added for Location Name)
// ==========================================
async function fetchLocationName(lat, lng) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=th`);
    if (res.ok) {
      const data = await res.json();
      const loc = [];
      if (data.locality) loc.push(data.locality);
      if (data.city && data.city !== data.locality) loc.push(data.city);
      if (data.principalSubdivision) loc.push(data.principalSubdivision);
      if (loc.length > 0) return loc.join(' ');
    }
  } catch (e) {
    console.error('Reverse Geocode Error:', e);
  }
  return null;
}

