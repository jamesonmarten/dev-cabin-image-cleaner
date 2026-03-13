// Shared app logic for both Local and Online builds.
// This file is intentionally dependency-free.
// Online build may optionally load JSZip/exifr via CDN; we feature-detect them.

export function mountApp({
  document,
  settings: initialSettings,
  libs = {},
} = {}) {
  const JSZip = libs.JSZip ?? globalThis.JSZip;
  const exifr = libs.exifr ?? globalThis.exifr;

  const state = {
    settings: {
      maxWidth: 1024,
      maxHeight: 1024,
      quality: 85,
      outFormat: "keep",
      stripMeta: true,
      ...(initialSettings ?? {}),
    },
    processedOutputs: [],
  };

  const el = {
    input: document.getElementById("imageInput"),
    btn: document.getElementById("processBtn"),
    downloadAllBtn: document.getElementById("downloadAllBtn"),
    table: document.getElementById("resultsTable"),
    tbody: document.getElementById("resultsTable")?.querySelector("tbody"),
    summary: document.getElementById("summary"),
    statusbar: document.getElementById("statusbar"),
    statusText: document.getElementById("statusText"),
    progressFill: document.getElementById("progressFill"),

    preset: document.getElementById("preset"),
    outFormat: document.getElementById("outFormat"),
    maxWidth: document.getElementById("maxWidth"),
    maxHeight: document.getElementById("maxHeight"),
    quality: document.getElementById("quality"),
    qualityLabel: document.getElementById("qualityLabel"),
    stripMeta: document.getElementById("stripMeta"),
  };

  if (!el.input || !el.btn || !el.downloadAllBtn || !el.table || !el.tbody) {
    throw new Error("Missing required DOM elements. Is the HTML up to date?");
  }

  function safeRevokeObjectUrl(url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  function cleanupOldOutputs() {
    for (const o of state.processedOutputs) safeRevokeObjectUrl(o.previewUrl);
    state.processedOutputs = [];
  }

  function setProcessingUI(isProcessing, current = 0, total = 0) {
    if (!el.statusbar || !el.statusText || !el.progressFill) return;
    if (isProcessing) {
      el.statusbar.style.display = "flex";
      el.btn.disabled = true;
      el.downloadAllBtn.disabled = true;
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      el.statusText.textContent = total > 0 ? `Processing ${current}/${total}…` : "Processing…";
      el.progressFill.style.width = `${pct}%`;
    } else {
      el.statusbar.style.display = "none";
      el.btn.disabled = false;
      el.progressFill.style.width = "0%";
    }
  }

  function humanSize(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return value.toFixed(2) + " " + units[i];
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function baseNameWithoutExtension(name) {
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(0, idx) : name;
  }

  function extFromMime(mime, fallbackName) {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/svg+xml") return "svg";
    const idx = fallbackName.lastIndexOf(".");
    return idx >= 0 ? fallbackName.slice(idx + 1) : "bin";
  }

  function rotationFromExifOrientation(orientation) {
    if (orientation === 3) return 180;
    if (orientation === 6) return 90;
    if (orientation === 8) return 270;
    return 0;
  }

  async function getImageBitmapFromDataUrl(dataUrl) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  }

  function drawToCanvasWithRotation(bitmap, width, height, rotationDeg) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const rotation = ((rotationDeg % 360) + 360) % 360;
    const swapWH = rotation === 90 || rotation === 270;

    canvas.width = swapWH ? height : width;
    canvas.height = swapWH ? width : height;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
    ctx.restore();
    return canvas;
  }

  function getSettingsFromUI() {
    const maxWidth = Number.parseInt(el.maxWidth?.value || "1024", 10);
    const maxHeight = Number.parseInt(el.maxHeight?.value || "1024", 10);
    const quality = Number.parseInt(el.quality?.value || "85", 10);
    const outFormat = el.outFormat?.value || "keep";
    const stripMeta = !!el.stripMeta?.checked;

    state.settings = {
      ...state.settings,
      maxWidth: Number.isFinite(maxWidth) ? maxWidth : 1024,
      maxHeight: Number.isFinite(maxHeight) ? maxHeight : 1024,
      quality: Number.isFinite(quality) ? quality : 85,
      outFormat,
      stripMeta,
    };

    if (el.qualityLabel) el.qualityLabel.textContent = String(state.settings.quality);
    return state.settings;
  }

  function applyPreset(preset) {
    if (!el.maxWidth || !el.maxHeight || !el.quality || !el.outFormat) return;

    if (preset === "web_hero") {
      el.maxWidth.value = "1600";
      el.maxHeight.value = "1600";
      el.quality.value = "85";
      el.outFormat.value = "jpeg";
    } else if (preset === "web_thumb") {
      el.maxWidth.value = "480";
      el.maxHeight.value = "480";
      el.quality.value = "80";
      el.outFormat.value = "jpeg";
    } else if (preset === "store_listing") {
      el.maxWidth.value = "1200";
      el.maxHeight.value = "1200";
      el.quality.value = "88";
      el.outFormat.value = "jpeg";
    }

    getSettingsFromUI();
  }

  function mimeFromOutFormat(outFormat, originalType) {
    if (outFormat === "keep") return originalType;
    if (outFormat === "jpeg") return "image/jpeg";
    if (outFormat === "png") return "image/png";
    if (outFormat === "webp") return "image/webp";
    return originalType;
  }

  async function processRasterAutoOriented(file, settings) {
    const dataUrl = await fileToDataURL(file);
    const bitmap = await getImageBitmapFromDataUrl(dataUrl);

    let rotateDeg = 0;
    try {
      if (exifr && exifr.orientation) {
        const o = await exifr.orientation(file);
        rotateDeg = rotationFromExifOrientation(o);
      }
    } catch {
      // ignore
    }

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const rotatedW = rotateDeg === 90 || rotateDeg === 270 ? srcH : srcW;
    const rotatedH = rotateDeg === 90 || rotateDeg === 270 ? srcW : srcH;

    let outW = rotatedW;
    let outH = rotatedH;
    const aspect = rotatedW / rotatedH;
    if (outW > settings.maxWidth || outH > settings.maxHeight) {
      if (outW > outH) {
        outW = settings.maxWidth;
        outH = Math.round(settings.maxWidth / aspect);
      } else {
        outH = settings.maxHeight;
        outW = Math.round(settings.maxHeight * aspect);
      }
    }

    const scaleCanvas = document.createElement("canvas");
    scaleCanvas.width = outW;
    scaleCanvas.height = outH;
    scaleCanvas.getContext("2d").drawImage(bitmap, 0, 0, outW, outH);

    const finalCanvas = drawToCanvasWithRotation(scaleCanvas, outW, outH, rotateDeg);
    const mimeType = mimeFromOutFormat(settings.outFormat, file.type);
    const q = settings.quality / 100;

    const processedBlob = await new Promise((resolve) => {
      if (mimeType === "image/png") finalCanvas.toBlob(resolve, "image/png");
      else finalCanvas.toBlob(resolve, mimeType, q);
    });

    // Metadata stripping: canvas exports do not include original EXIF.
    // If outFormat=keep and type is jpeg/png, we still re-encode (so EXIF is removed).

    return processedBlob;
  }

  async function rotateRasterBlob(blob, rotationDeg) {
    const url = URL.createObjectURL(blob);
    try {
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = drawToCanvasWithRotation(bmp, bmp.width, bmp.height, rotationDeg);
      const mimeType = blob.type || "image/jpeg";
      return await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.9));
    } finally {
      safeRevokeObjectUrl(url);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => safeRevokeObjectUrl(url), 1000);
  }

  async function downloadAllZip() {
    if (!state.processedOutputs.length) return;
    if (!JSZip) {
      alert("ZIP library not available in this build.");
      return;
    }
    const zip = new JSZip();
    for (const f of state.processedOutputs) zip.file(f.name, f.blob);
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "processed_images.zip");
  }

  async function processAll() {
    const files = el.input.files;
    if (!files || files.length === 0) {
      alert("Please select one or more images.");
      return;
    }

    const settings = getSettingsFromUI();

    cleanupOldOutputs();
    el.table.style.display = "table";
    el.tbody.innerHTML = "";
    if (el.summary) el.summary.textContent = "";
    el.downloadAllBtn.disabled = true;

    let totalOriginal = 0;
    let totalProcessed = 0;

    setProcessingUI(true, 0, files.length);

    let index = 0;
    for (const file of files) {
      index++;
      setProcessingUI(true, index, files.length);

      const originalSize = file.size;
      let processedBlob = null;
      let previewUrl = null;
      let outType = file.type;

      try {
        if (file.type === "image/jpeg" || file.type === "image/png") {
          processedBlob = await processRasterAutoOriented(file, settings);
          outType = processedBlob.type || file.type;
          previewUrl = URL.createObjectURL(processedBlob);
        } else if (file.type === "image/svg+xml") {
          const text = await file.text();
          const optimized = text.replace(/<!--.*?-->/g, "").replace(/\s+/g, " ").trim();
          outType = "image/svg+xml";
          const svgBytes = new TextEncoder().encode(optimized);
          previewUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(optimized);
          processedBlob = new Blob([svgBytes]);
        }
      } catch (err) {
        // fallthrough to original
        console.error("Error processing", file.name, err);
      }

      if (!processedBlob) {
        processedBlob = file;
        outType = file.type;
        previewUrl = URL.createObjectURL(file);
      }

      const processedSize = processedBlob.size;
      const savings = originalSize - processedSize;
      totalOriginal += originalSize;
      totalProcessed += processedSize;

      const outExt = extFromMime(outType, file.name);
      const outputName = `${baseNameWithoutExtension(file.name)}_processed.${outExt}`;

      state.processedOutputs.push({ name: outputName, type: outType, blob: processedBlob, previewUrl });

      const row = document.createElement("tr");
      row.style.animationDelay = `${Math.min(260, index * 35)}ms`;

      const previewCell = document.createElement("td");
      const imgEl = document.createElement("img");
      imgEl.className = "thumb";
      imgEl.alt = `Preview of ${file.name}`;
      imgEl.src = previewUrl;
      previewCell.appendChild(imgEl);

      const fileCell = document.createElement("td");
      fileCell.textContent = file.name;

      const origCell = document.createElement("td");
      origCell.textContent = humanSize(originalSize);

      const procCell = document.createElement("td");
      procCell.textContent = humanSize(processedSize);

      const savCell = document.createElement("td");
      savCell.textContent = humanSize(savings);

      const actionsCell = document.createElement("td");
      actionsCell.style.whiteSpace = "nowrap";

      const dlLink = document.createElement("a");
      dlLink.href = URL.createObjectURL(processedBlob);
      dlLink.download = outputName;
      dlLink.textContent = "Download";
      dlLink.className = "btn-link";
      dlLink.addEventListener(
        "click",
        () => {
          setTimeout(() => safeRevokeObjectUrl(dlLink.href), 2000);
        },
        { once: true }
      );

      actionsCell.appendChild(dlLink);

      if (outType === "image/jpeg" || outType === "image/png" || outType === "image/webp") {
        const rotateWrap = document.createElement("span");
        rotateWrap.className = "rotate-group";

        const rotateLeft = document.createElement("button");
        rotateLeft.type = "button";
        rotateLeft.className = "icon-btn";
        rotateLeft.title = "Rotate left";
        rotateLeft.textContent = "⟲";

        const rotateRight = document.createElement("button");
        rotateRight.type = "button";
        rotateRight.className = "icon-btn";
        rotateRight.title = "Rotate right";
        rotateRight.textContent = "⟳";

        async function applyRotation(deg) {
          const idx = state.processedOutputs.findIndex((x) => x.name === outputName);
          if (idx < 0) return;

          const current = state.processedOutputs[idx];
          const rotated = await rotateRasterBlob(current.blob, deg);
          current.blob = rotated;
          safeRevokeObjectUrl(current.previewUrl);
          current.previewUrl = URL.createObjectURL(rotated);
          imgEl.src = current.previewUrl;

          dlLink.href = URL.createObjectURL(rotated);

          procCell.textContent = humanSize(rotated.size);
          savCell.textContent = humanSize(originalSize - rotated.size);
        }

        rotateLeft.addEventListener("click", () => applyRotation(270));
        rotateRight.addEventListener("click", () => applyRotation(90));

        rotateWrap.appendChild(rotateLeft);
        rotateWrap.appendChild(rotateRight);
        actionsCell.appendChild(document.createTextNode(" "));
        actionsCell.appendChild(rotateWrap);
      }

      row.appendChild(previewCell);
      row.appendChild(fileCell);
      row.appendChild(origCell);
      row.appendChild(procCell);
      row.appendChild(savCell);
      row.appendChild(actionsCell);

      el.tbody.appendChild(row);
    }

    const totalSavings = totalOriginal - totalProcessed;
    if (el.summary) el.summary.textContent = `Total savings: ${humanSize(totalSavings)}.`;

    el.downloadAllBtn.disabled = state.processedOutputs.length === 0 || !JSZip;
    setProcessingUI(false);
  }

  // wire events
  el.btn.addEventListener("click", processAll);
  el.downloadAllBtn.addEventListener("click", downloadAllZip);

  el.input.addEventListener("change", () => {
    cleanupOldOutputs();
    el.downloadAllBtn.disabled = true;
    el.tbody.innerHTML = "";
    el.table.style.display = "none";
    if (el.summary) el.summary.textContent = "";
    setProcessingUI(false);
  });

  if (el.preset) el.preset.addEventListener("change", () => applyPreset(el.preset.value));
  if (el.quality) el.quality.addEventListener("input", () => getSettingsFromUI());

  // initialize
  getSettingsFromUI();

  // Return some hooks for tests/debugging
  return {
    state,
    processAll,
  };
}
