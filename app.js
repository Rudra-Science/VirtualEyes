// app.js — Virtual Eyes AI (fixed speech timing)
// Place this file next to index.html and style.css

(async () => {
  // DOM elements
  const video = document.getElementById('webcam');
  const overlay = document.getElementById('overlay');
  const octx = overlay.getContext('2d');

  const snapshot = document.getElementById('snapshot');
  const sctx = snapshot.getContext('2d');

  const statusLine = document.getElementById('statusLine');
  const scanBtn = document.getElementById('scanBtn');
  const cameraSelect = document.getElementById('cameraSelect');
  const startBtn = document.getElementById('startBtn');
  const takeSnapshotBtn = document.getElementById('takeSnapshot');
  const saveDataBtn = document.getElementById('saveData');

  const detectedStrip = document.getElementById('detectedStrip');
  const resultsList = document.getElementById('resultsList');

  // State
  let cocoModel = null;
  let currentStream = null;
  let running = false;
  let rafId = null;

  let cycles = []; // stored snapshot cycles until Save Data
  let nextCycleNumber = 1;

  // constants
  const objectHeights = {
    person: 1.7,
    bottle: 0.25,
    chair: 1.0,
    book: 0.3,
    tv: 0.6,
    laptop: 0.4,
    cellphone: 0.15,
    keyboard: 0.45,
    mouse: 0.12
  };
  const FOCAL_LENGTH_PX = 700;
  const PIXELS_PER_CM = 5;

  const pad = n => String(n).padStart(2, '0');
  function ordinal(n) {
    const s = ["th","st","nd","rd"], v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }
  function formatDistance(est) {
    if (!isFinite(est) || est <= 0) return "unknown";
    const meters = Math.floor(est);
    const centimeters = Math.round((est - meters) * 100);
    const parts = [];
    if (meters > 0) parts.push(`${meters} metres`);
    if (centimeters > 0) parts.push(`${centimeters} centimetres`);
    return parts.join(' ');
  }

  /* ---------- Camera ---------- */
  async function setupCamera(deviceId) {
    try {
      if (currentStream) currentStream.getTracks().forEach(t => t.stop());
      const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: { facingMode: "environment" } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream;
      video.srcObject = stream;
      await new Promise(res => video.onloadedmetadata = res);

      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
      snapshot.width = Math.min(920, video.videoWidth);
      snapshot.height = Math.min(620, video.videoHeight);
    } catch (err) {
      console.error("Camera setup error:", err);
      alert("Unable to access camera. Make sure you allowed camera permissions.");
      throw err;
    }
  }

  async function populateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      cameraSelect.innerHTML = '';
      cams.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = c.deviceId;
        opt.textContent = c.label || `Camera ${i+1}`;
        cameraSelect.appendChild(opt);
      });
    } catch (e) {
      console.warn("populateCameras failed:", e);
    }
  }

  /* ---------- Model init ---------- */
  async function init() {
    try {
      await setupCamera();
      await populateCameras();
      statusLine.classList.add('loading');
      statusLine.textContent = 'Loading model...';
      cocoModel = await cocoSsd.load();
      statusLine.classList.remove('loading');
      statusLine.classList.add('ready');
      statusLine.textContent = '✅ Ready to detect objects';
      startLive();
    } catch (e) {
      console.error("Init failed:", e);
      statusLine.textContent = 'Model load failed';
    }
  }

  /* ---------- Live detection ---------- */
  async function liveLoop() {
    if (!running) return;
    if (!cocoModel) { rafId = requestAnimationFrame(liveLoop); return; }
    try {
      const preds = await cocoModel.detect(video);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.lineWidth = 2;

      preds.forEach(p => {
        const [x,y,w,h] = p.bbox;
        octx.strokeStyle = 'rgba(0,255,200,0.95)';
        octx.strokeRect(x, y, w, h);

        octx.fillStyle = 'rgba(0,255,200,0.95)';
        octx.font = '15px Arial';
        const label = `${p.class} ${Math.round(p.score*100)}%`;
        const labelY = y - 18 >= 0 ? y - 18 : y;
        const tw = octx.measureText(label).width;
        octx.fillRect(x, labelY, tw + 8, 18);
        octx.fillStyle = '#002827';
        octx.fillText(label, x + 4, labelY + 2);
      });
    } catch (err) {
      console.warn("liveLoop error:", err);
    }
    rafId = requestAnimationFrame(liveLoop);
  }

  function startLive() {
    if (running) return;
    running = true;
    liveLoop();
  }

  function stopLive() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  /* ---------- Helpers ---------- */
  const colorPalette = ['#00c4cc','#4fb0ff','#f6b352','#9b8cff','#ff6b6b','#45c272','#ff9ee3'];
  function colorForLabel(label) {
    let h = 0;
    for (let i=0;i<label.length;i++) h = (h<<5) - h + label.charCodeAt(i);
    h = Math.abs(h);
    return colorPalette[h % colorPalette.length];
  }

  function speakText(text, rate=0.95) {
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      u.pitch = 1.0;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  // ✅ FIXED: smoother, faster voice (no long pause between coordinates)
  async function speakObjectWithPause(name, coordX, coordY, distanceStr) {
    const text = `${name} detected at ${coordX}, ${coordY} at ${distanceStr}`;
    await speakText(text, 0.95);
  }

  /* ---------- Snapshot handling ---------- */
  takeSnapshotBtn.addEventListener('click', async () => {
    if (!cocoModel) { alert("Model not ready"); return; }

    const sw = snapshot.width;
    const sh = snapshot.height;

    sctx.clearRect(0,0,sw,sh);
    sctx.drawImage(video, 0, 0, sw, sh);

    const preds = await cocoModel.detect(snapshot);

    sctx.lineWidth = 2;
    preds.forEach(p => {
      const [x,y,w,h] = p.bbox;
      sctx.strokeStyle = 'rgba(0,255,200,0.95)';
      sctx.strokeRect(x, y, w, h);
      sctx.fillStyle = 'rgba(0,255,200,0.95)';
      sctx.font = '14px Arial';
      const label = `${p.class} ${Math.round(p.score*100)}%`;
      const labelY = y - 18 >= 0 ? y - 18 : y;
      const tw = sctx.measureText(label).width;
      sctx.fillRect(x, labelY, tw + 8, 18);
      sctx.fillStyle = '#002827';
      sctx.fillText(label, x + 4, labelY + 2);
    });

    const now = new Date();
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const cycle = { timeStr, cycleOrdinal: nextCycleNumber, preds: [] };

    detectedStrip.innerHTML = '';
    if (!preds || preds.length === 0) {
      const note = document.createElement('div');
      note.style.color = 'var(--muted)';
      note.textContent = 'No objects detected in snapshot';
      detectedStrip.appendChild(note);
      resultsList.textContent = 'No detections';
      cycle.preds = [];
      cycles.push(cycle);
      nextCycleNumber++;
      return;
    }

    resultsList.textContent = `${preds.length} object(s) detected.`;

    const speakQueue = [];

    for (let i=0;i<preds.length;i++) {
      const p = preds[i];
      const name = p.class;
      const conf = Math.round(p.score * 100);
      const [x, y, w, h] = p.bbox;
      const centerX = x + w/2;
      const centerY = y + h/2;
      const coordX = Math.round((centerX - (sw/2)) / PIXELS_PER_CM);
      const coordY = Math.round(((sh/2) - centerY) / PIXELS_PER_CM);

      let distanceStr = "unknown";
      const known = objectHeights[name.toLowerCase()];
      if (known && h >= 5) {
        const est = (known * FOCAL_LENGTH_PX) / h;
        distanceStr = formatDistance(est);
      }

      cycle.preds.push({ class: name, score: conf, coordX, coordY, distanceStr });

      const card = document.createElement('div');
      card.className = 'obj-card';
      const accent = colorForLabel(name);
      card.style.borderLeftColor = accent;

      const thumb = document.createElement('div');
      thumb.className = 'obj-thumb';
      thumb.style.border = `2px solid ${accent}`;
      thumb.textContent = name[0].toUpperCase();

      const info = document.createElement('div');
      info.className = 'obj-info';
      const nm = document.createElement('div');
      nm.className = 'obj-name';
      nm.textContent = name;
      const meta = document.createElement('div');
      meta.className = 'obj-meta';
      meta.textContent = `(${coordX}, ${coordY}) • ${distanceStr}`;
      const confEl = document.createElement('div');
      confEl.className = 'obj-confidence';
      confEl.textContent = `${conf}%`;

      info.appendChild(nm);
      info.appendChild(meta);
      card.appendChild(thumb);
      card.appendChild(info);
      card.appendChild(confEl);

      detectedStrip.appendChild(card);

      speakQueue.push({ name, coordX, coordY, distanceStr });
    }

    cycles.push(cycle);
    nextCycleNumber++;

    // Speak objects sequentially, but without long pauses
    (async () => {
      for (let s of speakQueue) {
        try {
          await speakObjectWithPause(s.name, s.coordX, s.coordY, s.distanceStr);
          await new Promise(r => setTimeout(r, 100)); // tiny pause between objects
        } catch (e) {
          console.warn("TTS error", e);
        }
      }
    })();
  });

  /* ---------- Save Data ---------- */
  saveDataBtn.addEventListener('click', () => {
    if (!cycles.length) { alert('No detections to save.'); return; }

    const lines = [];
    cycles.forEach(c => {
      lines.push(`detection ${c.timeStr} ${ordinal(c.cycleOrdinal)}`);
      if (!c.preds || c.preds.length === 0) {
        lines.push('no_objects_detected');
      } else {
        c.preds.forEach((p, i) => {
          lines.push(`object ${i+1} {${p.distanceStr}}{${p.coordX},${p.coordY}}{${p.score}%}`);
        });
      }
      lines.push('');
    });

    const content = lines.join('\n');
    const now = new Date();
    const filename = `saves/detection_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.txt`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    cycles = [];
    nextCycleNumber = 1;
    detectedStrip.innerHTML = '<div style="color:var(--muted);padding:6px 10px;border-radius:8px">No snapshot yet</div>';
    resultsList.textContent = 'Take a snapshot to see the detected objects displayed below.';
    sctx.clearRect(0,0,snapshot.width,snapshot.height);

    alert('Saved and reset cycles.');
  });

  /* ---------- Camera selection ---------- */
  scanBtn.addEventListener('click', async () => {
    await populateCameras();
    alert('Select a camera from the dropdown if multiple are available.');
  });

  cameraSelect.addEventListener('change', async (e) => {
    await setupCamera(e.target.value);
  });

  startBtn.addEventListener('click', () => {
    if (running) {
      stopLive();
      startBtn.textContent = '▶ Start';
    } else {
      startLive();
      startBtn.textContent = '⏸ Pause';
    }
  });

  // kick off init
  try {
    await init();
  } catch (err) {
    console.error("Initialization failed:", err);
  }

})();

/* --------- Threat detection snippet (paste below your app.js) --------- */
(async () => {
  // Config
  const THREAT_CLASSES = new Set(['car','truck','bus','motorcycle','bicycle']);
  const SCORE_THRESHOLD = 0.5;      // minimum confidence to consider
  const POLL_INTERVAL = 700;        // ms between detection passes
  const ALERT_COOLDOWN = 5000;      // ms cooldown per class
  const BEEP_COUNT = 3;             // number of short beeps per alert
  const BEEP_DURATION = 80;         // ms each beep

  // Elements (must exist in your page)
  const video = document.getElementById('webcam');
  if (!video) {
    console.warn('Threat detector: #webcam element not found — detector not started.');
    return;
  }

  // Create a top-level visual flash overlay (append to body)
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    background: 'rgba(255,0,0,0)',
    transition: 'background 220ms ease',
    zIndex: 99999,
  });
  document.body.appendChild(flash);

  // Create small canvas to draw threat boxes (so we don't touch app overlay)
  const threatCanvas = document.createElement('canvas');
  threatCanvas.id = 'threatOverlay';
  threatCanvas.style.position = 'absolute';
  threatCanvas.style.left = '0';
  threatCanvas.style.top = '0';
  threatCanvas.style.pointerEvents = 'none';
  threatCanvas.style.zIndex = 99998;
  document.body.appendChild(threatCanvas);
  const tctx = threatCanvas.getContext('2d');

  // Resize helper: match canvas to video rect
  function resizeThreatCanvas() {
    const rect = video.getBoundingClientRect();
    threatCanvas.width = rect.width;
    threatCanvas.height = rect.height;
    threatCanvas.style.left = `${rect.left + window.scrollX}px`;
    threatCanvas.style.top = `${rect.top + window.scrollY}px`;
  }
  window.addEventListener('resize', resizeThreatCanvas);
  window.addEventListener('scroll', resizeThreatCanvas);
  // initial resize (if video already loaded)
  setTimeout(resizeThreatCanvas, 200);

  // WebAudio beep function (returns Promise that resolves when sequence done)
  function playBeepSequence(count = BEEP_COUNT, duration = BEEP_DURATION, gap = 120) {
    return new Promise(resolve => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        let i = 0;
        function oneBeep() {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = 880; // beep pitch
          g.gain.value = 0.0001;
          o.connect(g);
          g.connect(ctx.destination);

          const now = ctx.currentTime;
          g.gain.setValueAtTime(0.0001, now);
          g.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
          o.start(now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);
          o.stop(now + duration / 1000 + 0.02);

          o.onended = () => {
            i++;
            if (i < count) {
              setTimeout(oneBeep, gap);
            } else {
              // give a tiny offset then close context
              setTimeout(() => {
                try { ctx.close(); } catch (e) {}
                resolve();
              }, 60);
            }
          };
        }
        oneBeep();
      } catch (e) {
        console.warn('Beep failed:', e);
        resolve();
      }
    });
  }

  // TTS helper
  function speakAlert(text) {
    return new Promise(resolve => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 0.95;
        u.pitch = 1.0;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
      } catch (e) {
        console.warn('TTS failed', e);
        resolve();
      }
    });
  }

  // Flash screen briefly
  function doFlash() {
    flash.style.background = 'rgba(255,0,0,0.12)';
    setTimeout(() => flash.style.background = 'rgba(255,0,0,0)', 220);
  }

  // Draw bounding boxes for threats on threatCanvas (video-relative)
  function drawThreatBoxes(boxes, scores, classes) {
    // Clear
    tctx.clearRect(0, 0, threatCanvas.width, threatCanvas.height);
    if (!boxes || !boxes.length) return;
    tctx.lineWidth = Math.max(2, Math.round(threatCanvas.width * 0.004));
    for (let i = 0; i < boxes.length; i++) {
      const [x, y, w, h] = boxes[i];
      tctx.strokeStyle = 'rgba(255,60,60,0.95)';
      tctx.fillStyle = 'rgba(255,60,60,0.12)';
      tctx.strokeRect(x, y, w, h);
      tctx.fillRect(x, y, w, Math.min(28, h));
      tctx.font = `${12}px Arial`;
      tctx.fillStyle = '#fff';
      const label = `${classes[i]} ${Math.round(scores[i]*100)}%`;
      tctx.fillText(label, x + 6, y + 16);
    }
  }

  // Map detected class to friendly group (vehicle)
  function mapToThreatLabel(cls) {
    if (THREAT_CLASSES.has(cls)) return 'vehicle';
    return cls;
  }

  // Load model separately
  let detectorModel = null;
  try {
    detectorModel = await cocoSsd.load();
    console.log('Threat detector model loaded.');
  } catch (e) {
    console.error('Threat detector: model load failed', e);
    return;
  }

  // Throttle map: keeps last alerted timestamp per label
  const lastAlertTime = new Map();

  // Running control
  let running = true;
  let pollHandle = null;

  // Main detection pass
  async function detectionPass() {
    if (!running) return;
    if (video.readyState < 2) { // HAVE_CURRENT_DATA
      // try again later
      pollHandle = setTimeout(detectionPass, POLL_INTERVAL);
      return;
    }

    // ensure overlay canvas sized same as video rect for drawing boxes
    const rect = video.getBoundingClientRect();
    resizeThreatCanvas();

    try {
      // run detection on the video element directly (fast)
      const preds = await detectorModel.detect(video);
      // collect threats found this pass
      const foundBoxes = [];
      const foundScores = [];
      const foundClasses = [];

      for (let p of preds) {
        const cls = p.class.toLowerCase();
        if (THREAT_CLASSES.has(cls) && p.score >= SCORE_THRESHOLD) {
          // convert bbox (x,y,w,h) from video pixel space to threatCanvas coordinate
          // detectorModel.detect returns bbox in pixels relative to video element size
          // but because threatCanvas is set to video DOM rect size, we can use directly
          foundBoxes.push(p.bbox);
          foundScores.push(p.score);
          foundClasses.push(cls);
        }
      }

      // Draw threat boxes briefly
      if (foundBoxes.length) {
        drawThreatBoxes(foundBoxes, foundScores, foundClasses);

        // For each unique class detected, decide whether to alert
        const now = Date.now();
        const alertedThisPass = new Set();
        for (let i = 0; i < foundClasses.length; i++) {
          const cls = foundClasses[i];
          const label = mapToThreatLabel(cls);
          if (alertedThisPass.has(label)) continue; // avoid duplicate same-pass
          const last = lastAlertTime.get(label) || 0;
          if (now - last < ALERT_COOLDOWN) continue;
          // mark alerted now
          lastAlertTime.set(label, now);
          alertedThisPass.add(label);

        // Trigger sound + TTS + visual flash (play simultaneously)
        (() => {
          try {
            doFlash();

        // Play local beep.mp3
        const beepAudio = new Audio('beep.wav');
        beepAudio.volume = 1;
        beepAudio.play().catch(e => console.warn('Beep audio play failed:', e));

        // Speak the alert at the same time
        const utter = new SpeechSynthesisUtterance(`Alert! ${label} detected in the live frame`);
        utter.lang = 'en-US';
        utter.rate = 0.95;
        utter.pitch = 1.0;
        speechSynthesis.speak(utter);
      } catch (e) {
        console.warn('Alert sequence failed', e);
      }
    })();

        }
        // clear boxes after short timeout to avoid sticky boxes
        setTimeout(() => tctx.clearRect(0,0,threatCanvas.width, threatCanvas.height), 900);
      } else {
        // no threats — ensure canvas cleared
        tctx.clearRect(0, 0, threatCanvas.width, threatCanvas.height);
      }
    } catch (err) {
      console.warn('Threat detector error:', err);
    }

    pollHandle = setTimeout(detectionPass, POLL_INTERVAL);
  }

  // Public control
  window.threatDetector = {
    start() {
      if (running) return;
      running = true;
      detectionPass();
      console.log('Threat detector started.');
    },
    stop() {
      running = false;
      if (pollHandle) { clearTimeout(pollHandle); pollHandle = null; }
      tctx.clearRect(0,0,threatCanvas.width, threatCanvas.height);
      flash.style.background = 'rgba(0,0,0,0)';
      console.log('Threat detector stopped.');
    },
    isRunning() { return running; },
    model: detectorModel
  };

  // Auto-start detection
  detectionPass();
  console.log('Threat detector initialized and running. Use window.threatDetector.stop()/start() to control.');
})();


 

