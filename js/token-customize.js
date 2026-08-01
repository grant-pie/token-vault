// Lets a user apply a border shape, border color/width, and background tint
// to a vault token before downloading it. Wired up from vault.js/admin-vault.js
// (and recent.js/generate.js/monster.js), which call
// window.openTokenCustomizer(token, imageSrc) when a token card is clicked.

const TOKEN_CUSTOMIZE_STORAGE_KEY = "tokenVaultCustomizeSettings";
const CANVAS_SIZE = 1024;

const DEFAULT_SETTINGS = {
  shape: "square",
  borderEnabled: true,
  borderColor: "#c9a227",
  borderWidth: 5,
  tintEnabled: true,
  tintColor: "#241609",
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(TOKEN_CUSTOMIZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(TOKEN_CUSTOMIZE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private browsing, quota) — settings just won't persist.
  }
}

// Builds the clip/stroke path for the chosen shape, inset so a thick stroke
// never gets cropped by the canvas edge.
function shapePath(ctx, shape, size, inset) {
  const cx = size / 2;
  const cy = size / 2;
  const half = size / 2 - inset;
  const path = new Path2D();

  if (shape === "square") {
    const cornerRadius = half * 0.12;
    path.moveTo(cx - half + cornerRadius, cy - half);
    path.arcTo(cx + half, cy - half, cx + half, cy + half, cornerRadius);
    path.arcTo(cx + half, cy + half, cx - half, cy + half, cornerRadius);
    path.arcTo(cx - half, cy + half, cx - half, cy - half, cornerRadius);
    path.arcTo(cx - half, cy - half, cx + half, cy - half, cornerRadius);
    path.closePath();
  } else if (shape === "hexagon") {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 90);
      const x = cx + half * Math.cos(angle);
      const y = cy + half * Math.sin(angle);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  } else {
    path.arc(cx, cy, half, 0, Math.PI * 2);
  }

  return path;
}

function drawToken(ctx, image, settings, transform) {
  const size = CANVAS_SIZE;
  ctx.clearRect(0, 0, size, size);

  const borderWidthPx = settings.borderEnabled ? (settings.borderWidth / 100) * size : 0;
  const inset = borderWidthPx / 2 + 2;
  const path = shapePath(ctx, settings.shape, size, inset);

  ctx.save();
  ctx.clip(path);

  if (settings.tintEnabled) {
    ctx.fillStyle = settings.tintColor;
    ctx.fillRect(0, 0, size, size);
  }

  // Base "contain" fit (whole creature visible, no cropping), then apply the
  // user's zoom on top and offset by their drag position.
  const baseScale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const scale = baseScale * transform.scale;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (size - drawWidth) / 2 + transform.offsetX;
  const y = (size - drawHeight) / 2 + transform.offsetY;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);

  ctx.restore();

  if (settings.borderEnabled) {
    ctx.lineWidth = borderWidthPx;
    ctx.strokeStyle = settings.borderColor;
    ctx.stroke(path);
  }
}

(function () {
  const modal = document.getElementById("token-modal");
  if (!modal) return;

  const canvas = document.getElementById("token-preview-canvas");
  const ctx = canvas.getContext("2d");
  const title = document.getElementById("token-modal-title");
  const shapeOptions = document.getElementById("shape-options");
  const borderToggle = document.getElementById("border-toggle");
  const borderColor = document.getElementById("border-color");
  const borderWidth = document.getElementById("border-width");
  const tintToggle = document.getElementById("tint-toggle");
  const tintColor = document.getElementById("tint-color");
  const zoomRange = document.getElementById("zoom-range");
  const resetPositionBtn = document.getElementById("reset-position-btn");
  const downloadBtn = document.getElementById("token-download-btn");
  const status = document.getElementById("token-modal-status");

  let settings = loadSettings();
  let transform = { scale: 1, offsetX: 0, offsetY: 0 };
  let currentImage = null;
  let currentToken = null;
  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragOffsetStart = { x: 0, y: 0 };

  function applySettingsToControls() {
    shapeOptions.querySelectorAll(".shape-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.shape === settings.shape);
    });
    borderToggle.checked = settings.borderEnabled;
    borderColor.value = settings.borderColor;
    borderWidth.value = settings.borderWidth;
    borderColor.disabled = !settings.borderEnabled;
    borderWidth.disabled = !settings.borderEnabled;
    tintToggle.checked = settings.tintEnabled;
    tintColor.value = settings.tintColor;
    tintColor.disabled = !settings.tintEnabled;
  }

  function redraw() {
    if (!currentImage) return;
    drawToken(ctx, currentImage, settings, transform);
  }

  function updateSetting(key, value) {
    settings = { ...settings, [key]: value };
    saveSettings(settings);
    redraw();
  }

  function resetPosition() {
    transform = { scale: 1, offsetX: 0, offsetY: 0 };
    zoomRange.value = 100;
    redraw();
  }

  // Screen-pixel drag distances need scaling up to canvas-pixel distances,
  // since the canvas is drawn at CANVAS_SIZE but displayed shrunk via CSS.
  function canvasPixelsPerScreenPixel() {
    const rect = canvas.getBoundingClientRect();
    return CANVAS_SIZE / rect.width;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!currentImage) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
    dragStart = { x: e.clientX, y: e.clientY };
    dragOffsetStart = { x: transform.offsetX, y: transform.offsetY };
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const factor = canvasPixelsPerScreenPixel();
    transform.offsetX = dragOffsetStart.x + (e.clientX - dragStart.x) * factor;
    transform.offsetY = dragOffsetStart.y + (e.clientY - dragStart.y) * factor;
    redraw();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("dragging");
    if (e && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("wheel", (e) => {
    if (!currentImage) return;
    e.preventDefault();
    const next = Math.min(300, Math.max(50, Number(zoomRange.value) - Math.sign(e.deltaY) * 5));
    zoomRange.value = next;
    transform.scale = next / 100;
    redraw();
  }, { passive: false });

  zoomRange.addEventListener("input", () => {
    transform.scale = Number(zoomRange.value) / 100;
    redraw();
  });

  resetPositionBtn.addEventListener("click", resetPosition);

  shapeOptions.addEventListener("click", (e) => {
    const btn = e.target.closest(".shape-btn");
    if (!btn) return;
    updateSetting("shape", btn.dataset.shape);
    applySettingsToControls();
  });

  borderToggle.addEventListener("change", () => {
    updateSetting("borderEnabled", borderToggle.checked);
    applySettingsToControls();
  });
  borderColor.addEventListener("input", () => updateSetting("borderColor", borderColor.value));
  borderWidth.addEventListener("input", () => updateSetting("borderWidth", Number(borderWidth.value)));
  tintToggle.addEventListener("change", () => {
    updateSetting("tintEnabled", tintToggle.checked);
    applySettingsToControls();
  });
  tintColor.addEventListener("input", () => updateSetting("tintColor", tintColor.value));

  downloadBtn.addEventListener("click", () => {
    if (!currentImage || !currentToken) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        status.textContent = "Couldn't export that token — try again.";
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = currentToken.name + ".png";
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  });

  window.openTokenCustomizer = function (token, src) {
    currentToken = token;
    currentImage = null;
    transform = { scale: 1, offsetX: 0, offsetY: 0 };
    zoomRange.value = 100;
    title.textContent = token.name;
    status.textContent = "Loading token…";
    downloadBtn.disabled = true;
    applySettingsToControls();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    modal.showModal();

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      currentImage = img;
      downloadBtn.disabled = false;
      status.textContent = "";
      redraw();
    };
    img.onerror = () => {
      status.textContent = "Couldn't load that token's image.";
    };
    img.src = src;
  };
})();
