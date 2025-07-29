let video, canvas, ctx;
let cocoModel, customModel = null;
let ready = false;
let frameCount = 0;

const customModelURL = '';
const customLabels = ['Class 1', 'Class 2'];

let alertActive = false;
const beepAudio = new Audio("sound/beep.wav");
beepAudio.loop = true;
beepAudio.volume = 1.0; // Max volume

async function setupCamera() {
  video = document.getElementById('webcam');
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;

  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      video.play();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      resolve();
    };
  });
}

async function loadModels() {
  cocoModel = await cocoSsd.load();

  if (customModelURL) {
    try {
      customModel = await tf.loadGraphModel(customModelURL);
    } catch (e) {
      console.warn("Custom model failed to load. Using COCO-SSD only.");
    }
  }

  document.getElementById('status').innerText = "✅ Ready to detect objects";
  ready = true;
}

async function detectFrame() {
  if (!ready) return;

  frameCount++;
  if (frameCount % 2 !== 0) {
    requestAnimationFrame(detectFrame);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const cocoPreds = await cocoModel.detect(video);

  let dangerDetected = false;
  let detectedThreat = "";
  const alertClasses = ['car', 'motorcycle', 'truck', 'bus'];

  cocoPreds.forEach(pred => {
    drawBox(pred.bbox, pred.class, 'cyan');

    if (alertClasses.includes(pred.class.toLowerCase())) {
      dangerDetected = true;
      detectedThreat = pred.class;
    }
  });

  if (dangerDetected) {
    triggerLiveAlert(detectedThreat);
  }

  if (customModel) {
    tf.tidy(() => {
      const tfImg = tf.browser.fromPixels(video).toFloat();
      const resized = tf.image.resizeBilinear(tfImg, [224, 224]);
      const expanded = resized.expandDims(0);
      const result = customModel.predict(expanded);

      result.data().then(predictions => {
        predictions.forEach((score, i) => {
          if (score > 0.6) {
            drawBox([10, 10 + i * 30, 160, 20], customLabels[i], 'orange');
          }
        });
      });
    });
  }

  requestAnimationFrame(detectFrame);
}

function drawBox(bbox, label, color = 'cyan') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.font = '16px Arial';
  ctx.fillStyle = color;

  ctx.strokeRect(...bbox);
  ctx.fillText(label, bbox[0], bbox[1] > 10 ? bbox[1] - 5 : 10);
}

function triggerLiveAlert(objectName = "Object") {
  if (alertActive) return;

  alertActive = true;

  beepAudio.play();

  const utterance = new SpeechSynthesisUtterance(`⚠️ ${objectName} detected at the captured frame`);
  utterance.lang = 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1.1;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);

  setTimeout(() => {
    beepAudio.pause();
    beepAudio.currentTime = 0;
    alertActive = false;
  }, 5000);
}

// ---------------- Snapshot Detection ----------------

document.getElementById('detect-btn').addEventListener('click', async () => {
  const snapshotCanvas = document.getElementById('snapshot');
  const ctx = snapshotCanvas.getContext('2d');
  const resultList = document.getElementById('result-list');

  const canvasWidth = snapshotCanvas.width;
  const canvasHeight = snapshotCanvas.height;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  resultList.innerHTML = "";
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

  const linesToSpeak = [];

  const objectHeights = {
    person: 1.5,
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

  const cocoPreds = await cocoModel.detect(snapshotCanvas);
  cocoPreds.forEach(pred => {
    const [x, y, width, height] = pred.bbox;
    const centerXCanvas = x + width / 2;
    const centerYCanvas = y + height / 2;
    const coordX = Math.round((centerXCanvas - centerX) / PIXELS_PER_CM);
    const coordY = Math.round((centerY - centerYCanvas) / PIXELS_PER_CM);

    let distance;
    const knownSize = objectHeights[pred.class.toLowerCase()];
    if (knownSize && height >= 5) {
      const estimatedDistance = (knownSize * FOCAL_LENGTH_PX) / height;
      const meters = Math.floor(estimatedDistance);
      const centimeters = Math.round((estimatedDistance - meters) * 100);
      distance = `${meters} meter${meters !== 1 ? 's' : ''} ${centimeters} cm`;
    } else {
      distance = "unknown";
    }

    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = 'cyan';
    ctx.font = '14px Arial';
    ctx.fillText(`${pred.class} (${coordX}, ${coordY}) - ${distance}`, x, y > 10 ? y - 5 : 10);

    const li = document.createElement('li');
    li.textContent = `🟦 ${pred.class} at (${coordX}, ${coordY}) - ${distance}`;
    resultList.appendChild(li);

    linesToSpeak.push(`${pred.class} at X ${coordX} centimeters, Y ${coordY} centimeters, distance ${distance}`);
  });

  const speech = linesToSpeak.join('. ');
  if (speech) {
    const utterance = new SpeechSynthesisUtterance(speech);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }
});

// ---------------- Camera Switching ----------------

let currentStream;

async function getCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(device => device.kind === 'videoinput');
}

async function setCamera(deviceId) {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  const constraints = {
    video: { deviceId: { exact: deviceId } }
  };

  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;

  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      video.play();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      resolve();
    };
  });
}

document.getElementById('scan-btn').addEventListener('click', async () => {
  const select = document.getElementById('camera-select');
  select.innerHTML = '';

  const cameras = await getCameras();
  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.text = camera.label || `Camera ${index + 1}`;
    select.appendChild(option);
  });

  if (cameras.length > 0) {
    await setCamera(cameras[0].deviceId);
  }
});

document.getElementById('camera-select').addEventListener('change', async (e) => {
  await setCamera(e.target.value);
});

// ---------------- Init ----------------

(async () => {
  await setupCamera();
  await loadModels();
  detectFrame();
})();
