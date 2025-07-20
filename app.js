let video, canvas, ctx;
let cocoModel, customModel = null;
let ready = false;
let frameCount = 0;

const customModelURL = ''; // Optional: your custom model URL
const customLabels = ['Class 1', 'Class 2']; // Update to match your model

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
  cocoPreds.forEach(pred => drawBox(pred.bbox, pred.class, 'cyan'));

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

(async () => {
  await setupCamera();
  await loadModels();
  detectFrame();
})();

document.getElementById('detect-btn').addEventListener('click', async () => {
  const snapshotCanvas = document.getElementById('snapshot');
  const ctx = snapshotCanvas.getContext('2d');
  const resultList = document.getElementById('result-list');

  const canvasWidth = snapshotCanvas.width;
  const canvasHeight = snapshotCanvas.height;
  const centerX = canvasWidth / 2;
  const fov = 90; // 90° field of view (±45°)

  resultList.innerHTML = "";
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Draw snapshot from video
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

  // Draw crosshair
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, canvasHeight);
  ctx.moveTo(0, canvasHeight / 2);
  ctx.lineTo(canvasWidth, canvasHeight / 2);
  ctx.stroke();

  const linesToSpeak = [];

  // Object height reference in meters
  const objectHeights = {
    person: 1.7,
    bottle: 0.25,
    chair: 1.0,
    book: 0.3,
    tv: 0.6,
    laptop: 0.4
  };
  const FOCAL_LENGTH = 600; // Focal length in pixels (approx)

  // Run COCO detection
  const cocoPreds = await cocoModel.detect(snapshotCanvas);
  cocoPreds.forEach(pred => {
    const [x, y, width, height] = pred.bbox;
    const objectCenterX = x + width / 2;

    // Angle from center
    const offsetRatio = (objectCenterX - centerX) / canvasWidth;
    const clampedRatio = Math.max(Math.min(offsetRatio, 0.5), -0.5);
    const angle = (clampedRatio * fov).toFixed(1);
    const direction = angle > 0
      ? `${angle} degrees to the right`
      : angle < 0
      ? `${Math.abs(angle)} degrees to the left`
      : 'centered';

    // Distance estimate
    let distance;
    const knownHeight = objectHeights[pred.class.toLowerCase()];
    if (knownHeight) {
      const estimatedDistance = (knownHeight * FOCAL_LENGTH) / height;
      const meters = Math.floor(estimatedDistance);
      const centimeters = Math.round((estimatedDistance - meters) * 100);
      distance = `${meters} meter${meters !== 1 ? 's' : ''} ${centimeters} cm`;
    } else {
      distance = "unknown distance";
    }

    // Draw box and label
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = 'cyan';
    ctx.font = '14px Arial';
    ctx.fillText(`${pred.class} - ${direction} - ${distance}`, x, y > 10 ? y - 5 : 10);

    // Add to result list
    const li = document.createElement('li');
    li.textContent = `🟦 ${pred.class} - ${direction} - ${distance}`;
    resultList.appendChild(li);

    // Add to speech lines
    linesToSpeak.push(`${pred.class}, ${direction}, at ${distance}`);
  });

  // Optional: Custom model
  if (customModel) {
    tf.tidy(() => {
      const tfImg = tf.browser.fromPixels(snapshotCanvas).toFloat();
      const resized = tf.image.resizeBilinear(tfImg, [224, 224]);
      const expanded = resized.expandDims(0);

      customModel.predict(expanded).data().then(predictions => {
        predictions.forEach((conf, i) => {
          if (conf > 0.6) {
            const label = customLabels[i];
            const li = document.createElement('li');
            li.textContent = `🟧 ${label} - centered - unknown distance`;
            resultList.appendChild(li);
            linesToSpeak.push(`${label}, centered, distance unknown`);
          }
        });

        // Speak all
        const speech = linesToSpeak.join('. ');
        if (speech) {
          const utterance = new SpeechSynthesisUtterance(speech);
          utterance.lang = 'en-US';
          utterance.rate = 1;
          utterance.pitch = 1;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      });
    });
  } else {
    // Speak COCO only
    const speech = linesToSpeak.join('. ');
    if (speech) {
      const utterance = new SpeechSynthesisUtterance(speech);
      utterance.lang = 'en-US';
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  }
});

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'd' || key === ' ') {
    e.preventDefault(); // Prevent default scroll from spacebar
    document.getElementById('detect-btn').click();
  }
});


let currentStream;

// Get available video input devices
async function getCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(device => device.kind === 'videoinput');
}

// Set video stream from selected camera
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

// Scan button behavior
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

// Camera selection behavior
document.getElementById('camera-select').addEventListener('change', async (e) => {
  await setCamera(e.target.value);
});
