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

// Draw Cartesian grid with 1 unit = 1 cm = 5 pixels
function drawCartesianGrid(ctx, width, height, unitSize = 5) {
  const midX = width / 2;
  const midY = height / 2;

  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;

  // Vertical grid lines
  for (let x = midX; x <= width; x += unitSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let x = midX - unitSize; x >= 0; x -= unitSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Horizontal grid lines
  for (let y = midY; y <= height; y += unitSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let y = midY - unitSize; y >= 0; y -= unitSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // X and Y axes
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1.5;

  // X-axis
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();

  // Y-axis
  ctx.beginPath();
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, height);
  ctx.stroke();
}

// Detect on snapshot
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

  // Draw webcam image
  ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);

  // Draw grid and axes
  //drawCartesianGrid(ctx, canvasWidth, canvasHeight, 5);


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

  const FOCAL_LENGTH_PX = 700; // Calibrated or adjusted focal length
  const PIXELS_PER_CM = 5;

  const cocoPreds = await cocoModel.detect(snapshotCanvas);
  cocoPreds.forEach(pred => {
    const [x, y, width, height] = pred.bbox;

    const centerXCanvas = x + width / 2;
    const centerYCanvas = y + height / 2;

    const coordX = Math.round((centerXCanvas - centerX) / PIXELS_PER_CM);
    const coordY = Math.round((centerY - centerYCanvas) / PIXELS_PER_CM);

    // Distance estimation
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

    // Draw box and label
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

  // Speak result
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

// Shortcut key
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'd' || key === ' ') {
    e.preventDefault();
    document.getElementById('detect-btn').click();
  }
});

// Camera controls
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

// Init
(async () => {
  await setupCamera();
  await loadModels();
  detectFrame();
})();
