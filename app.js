(() => {
  "use strict";

  const PALETTE = [
    "#222222", "#B4B4B4", "#EAE7DE", "#FFFFFF", "#D32F36",
    "#9D0A00", "#D60B4A", "#E6968D", "#FF9875", "#F7D0BF",
    "#FCEFE9", "#FCF6E8", "#DCD2C8", "#E2CEAB", "#D56422",
    "#D48C42", "#F29900", "#F8C933", "#FCE599", "#B3B47A",
    "#C1DA72", "#6C6E00", "#AA8B52", "#A98F74", "#AA9228",
    "#3F2B12", "#74491F", "#534658", "#2A2446", "#394599",
    "#59459C", "#BAA3D7", "#B6BCE0", "#A9ACBF", "#63ABB9",
    "#B4D2DC", "#90D8E6", "#48AEA0", "#B5D3C7", "#273864"
  ];
  const RGB = PALETTE.map(hexToRgb);
  const PALETTE_LAB = RGB.map(([r, g, b]) => rgbToOklab(r, g, b));
  const DARK_IDS = [1, 26, 28, 29, 40];
  const GRID = 24;
  const SOURCE_SIZE = 560;
  const STORAGE_KEY = "arknights_draw-local-grid-v2";
  const EXPORT_HISTORY_KEY = "arknights_draw-export-history-v2";
  const EXPORT_HISTORY_LIMIT = 50;

  const $ = id => document.getElementById(id);
  const el = {
    imageInput: $("imageInput"), projectInput: $("projectInput"), dropZone: $("dropZone"),
    cropWrap: $("cropWrap"), sourceCanvas: $("sourceCanvas"), sourceMeta: $("sourceMeta"),
    removeImageBtn: $("removeImageBtn"),
    zoomRange: $("zoomRange"), zoomOut: $("zoomOut"), resetCropBtn: $("resetCropBtn"),
    fitSubjectBtn: $("fitSubjectBtn"), modeSelect: $("modeSelect"),
    contrastRange: $("contrastRange"), contrastOut: $("contrastOut"),
    saturationRange: $("saturationRange"), saturationOut: $("saturationOut"),
    generateBtn: $("generateBtn"), gridCanvas: $("gridCanvas"), overviewCanvas: $("overviewCanvas"),
    cellInfo: $("cellInfo"),
    undoBtn: $("undoBtn"), redoBtn: $("redoBtn"), showNumbers: $("showNumbers"),
    showGrid: $("showGrid"), showOverview: $("showOverview"), overviewCard: $("overviewCard"),
    editorBoardLayout: $("editorBoardLayout"), replaceFrom: $("replaceFrom"), replaceBtn: $("replaceBtn"),
    selectedBadge: $("selectedBadge"), palette: $("palette"), fileName: $("fileName"),
    saveProjectBtn: $("saveProjectBtn"), helpBtn: $("helpBtn"), helpPanel: $("helpPanel"),
    status: $("status"), exportPreviewBtn: $("exportPreviewBtn"),
    exportTotalBtn: $("exportTotalBtn"), exportHistory: $("exportHistory"),
    historyCount: $("historyCount"), clearHistoryBtn: $("clearHistoryBtn"),
    authorLinks: Array.from(document.querySelectorAll("[data-author-dialog]")), authorDialog: $("authorDialog"),
    authorCloseBtn: $("authorCloseBtn")
  };

  const state = {
    image: null,
    imageUrl: "",
    zoom: 1,
    panX: 0,
    panY: 0,
    fitFull: false,
    cropDrag: null,
    grid: new Uint8Array(GRID * GRID).fill(4),
    selected: 1,
    tool: "paint",
    painting: false,
    mutationBefore: null,
    historyPreview: null,
    undo: [],
    redo: []
  };

  const sourceCtx = el.sourceCanvas.getContext("2d", { willReadFrequently: true });
  const gridCtx = el.gridCanvas.getContext("2d");
  const overviewCtx = el.overviewCanvas.getContext("2d");
  let gridResizeObserver = null;
  let exportHistory = [];

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function srgbLinear(value) {
    const x = value / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }

  function rgbToOklab(r, g, b) {
    r = srgbLinear(r); g = srgbLinear(g); b = srgbLinear(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  }

  function nearestPaletteId(r, g, b) {
    const [l, a, b2] = rgbToOklab(r, g, b);
    const chroma = Math.hypot(a, b2);
    const hue = Math.atan2(b2, a);
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < PALETTE_LAB.length; i++) {
      const [pl, pa, pb] = PALETTE_LAB[i];
      const pc = Math.hypot(pa, pb);
      const ph = Math.atan2(pb, pa);
      let dh = hue - ph;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const hueTerm = 2 * Math.sqrt(chroma * pc) * Math.sin(dh / 2);
      const distance = 0.65 * (l - pl) ** 2 + (chroma - pc) ** 2 + 1.7 * hueTerm ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best + 1;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function adjustedRgb(r, g, b) {
    const contrast = 1 + Number(el.contrastRange.value) / 100;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    const saturation = 1 + Number(el.saturationRange.value) / 100;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [
      clampByte(gray + (r - gray) * saturation),
      clampByte(gray + (g - gray) * saturation),
      clampByte(gray + (b - gray) * saturation)
    ];
  }

  function colorText(rgb) {
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return luminance < 142 ? "#ffffff" : "#17201d";
  }

  function setStatus(message, isError = false) {
    el.status.textContent = message;
    el.status.style.color = isError ? "#a52020" : "";
  }

  function safeName() {
    const cleaned = (el.fileName.value || "arknights_draw").trim().replace(/[\\/:*?"<>|]+/g, "_");
    return cleaned || "arknights_draw";
  }

  function drawingName(value) {
    return String(value || "arknights_draw").replace(/\u65bd\u5de5\u56fe/g, "图纸");
  }

  function renderPalette() {
    el.palette.replaceChildren();
    el.replaceFrom.replaceChildren();
    PALETTE.forEach((hex, index) => {
      const id = index + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.id = String(id);
      button.setAttribute("role", "option");
      const colorBlock = document.createElement("span");
      colorBlock.className = "swatch-color";
      colorBlock.style.background = hex;
      const info = document.createElement("span");
      info.className = "swatch-info";
      const number = document.createElement("strong");
      number.textContent = String(id).padStart(2, "0");
      const code = document.createElement("small");
      code.textContent = hex;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = "0格";
      info.append(number, count, code);
      button.append(colorBlock, info);
      button.addEventListener("click", () => selectColor(id));
      el.palette.append(button);

      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = `${String(id).padStart(2, "0")} ${hex}`;
      el.replaceFrom.append(option);
    });
    selectColor(state.selected);
  }

  function renderCoordinateAxes() {
    document.querySelectorAll(".coord-axis").forEach(axis => {
      axis.replaceChildren();
      for (let value = 1; value <= GRID; value++) {
        const label = document.createElement("span");
        label.textContent = String(value);
        axis.append(label);
      }
    });
  }

  function selectColor(id) {
    state.selected = Math.max(1, Math.min(40, Number(id) || 1));
    el.palette.querySelectorAll(".swatch").forEach(button => {
      const active = Number(button.dataset.id) === state.selected;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-selected", String(active));
    });
    const rgb = RGB[state.selected - 1];
    el.selectedBadge.textContent = `当前色 ${String(state.selected).padStart(2, "0")}`;
    el.selectedBadge.style.background = PALETTE[state.selected - 1];
    el.selectedBadge.style.color = colorText(rgb);
  }

  function updatePaletteCounts() {
    const counts = new Uint16Array(41);
    state.grid.forEach(id => counts[id]++);
    el.palette.querySelectorAll(".swatch").forEach(button => {
      button.querySelector(".count").textContent = `${counts[Number(button.dataset.id)]}格`;
    });
  }

  function getImageTransform(width, height) {
    if (!state.image) return null;
    const cover = Math.max(width / state.image.width, height / state.image.height);
    const contain = Math.min(width / state.image.width, height / state.image.height);
    const scale = (state.fitFull ? contain : cover) * state.zoom;
    return {
      width: state.image.width * scale,
      height: state.image.height * scale,
      x: (width - state.image.width * scale) / 2 + state.panX * width / SOURCE_SIZE,
      y: (height - state.image.height * scale) / 2 + state.panY * height / SOURCE_SIZE
    };
  }

  function drawImageTo(ctx, width, height) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = PALETTE[3];
    ctx.fillRect(0, 0, width, height);
    const t = getImageTransform(width, height);
    if (t) ctx.drawImage(state.image, t.x, t.y, t.width, t.height);
    ctx.restore();
  }

  function drawSource() {
    sourceCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    drawImageTo(sourceCtx, SOURCE_SIZE, SOURCE_SIZE);
  }

  function resetCrop(full = false) {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.fitFull = full;
    el.zoomRange.value = "100";
    el.zoomOut.textContent = "100%";
    el.fitSubjectBtn.textContent = full ? "裁满画布" : "完整显示";
    drawSource();
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("请选择 PNG、JPG、WEBP 等图片文件。", true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = url;
      state.image = image;
      el.fileName.value = file.name.replace(/\.[^.]+$/, "") || "arknights_draw";
      el.sourceMeta.textContent = `${image.width} × ${image.height}`;
      el.dropZone.hidden = true;
      el.cropWrap.hidden = false;
      el.generateBtn.disabled = false;
      resetCrop(false);
      setStatus("图片已载入。拖动和缩放确定构图，然后生成初稿。 ");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("图片读取失败，请换一种图片格式。", true);
    };
    image.src = url;
  }

  function removeSourceImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = "";
    state.image = null;
    state.cropDrag = null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.fitFull = false;
    el.imageInput.value = "";
    el.sourceMeta.textContent = "尚未选择图片";
    el.cropWrap.hidden = true;
    el.dropZone.hidden = false;
    el.generateBtn.disabled = true;
    el.zoomRange.value = "100";
    syncOutputs();
    sourceCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    setStatus("已移除原图，可以上传新图片；当前24×24编辑结果已保留。 ");
  }

  function buildGridFromImage() {
    if (!state.image) return;
    setStatus("正在分析576个方格并匹配固定40色……");
    el.generateBtn.disabled = true;
    window.setTimeout(() => {
      try {
        const block = 8;
        const sampleSize = GRID * block;
        const sample = document.createElement("canvas");
        sample.width = sampleSize;
        sample.height = sampleSize;
        const ctx = sample.getContext("2d", { willReadFrequently: true });
        drawImageTo(ctx, sampleSize, sampleSize);
        const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
        const result = new Uint8Array(GRID * GRID);
        const mode = el.modeSelect.value;

        for (let row = 0; row < GRID; row++) {
          for (let col = 0; col < GRID; col++) {
            const counts = new Uint16Array(41);
            let sumR = 0, sumG = 0, sumB = 0;
            for (let y = 0; y < block; y++) {
              for (let x = 0; x < block; x++) {
                const pixel = ((row * block + y) * sampleSize + col * block + x) * 4;
                const adjusted = adjustedRgb(data[pixel], data[pixel + 1], data[pixel + 2]);
                sumR += adjusted[0]; sumG += adjusted[1]; sumB += adjusted[2];
                counts[nearestPaletteId(adjusted[0], adjusted[1], adjusted[2])]++;
              }
            }
            const total = block * block;
            const averageId = nearestPaletteId(sumR / total, sumG / total, sumB / total);
            let dominantId = 1;
            for (let id = 2; id <= 40; id++) if (counts[id] > counts[dominantId]) dominantId = id;
            let chosen = averageId;
            if (mode === "dominant") {
              chosen = dominantId;
            } else if (mode === "hybrid") {
              let darkTotal = 0;
              let darkId = DARK_IDS[0];
              DARK_IDS.forEach(id => {
                darkTotal += counts[id];
                if (counts[id] > counts[darkId]) darkId = id;
              });
              if (darkTotal / total >= 0.18) chosen = darkId;
              else if (counts[dominantId] / total >= 0.36) chosen = dominantId;
            }
            result[row * GRID + col] = chosen;
          }
        }
        commitGrid(result);
        setStatus(`初稿已生成，共使用 ${new Set(result).size} 种固定色。现在可以逐格修正。`);
      } catch (error) {
        console.error(error);
        setStatus(`转换失败：${error.message}`, true);
      } finally {
        el.generateBtn.disabled = false;
      }
    }, 30);
  }

  function drawGrid(grid = state.historyPreview?.grid || state.grid) {
    const size = el.gridCanvas.width;
    const cell = size / GRID;
    const cssWidth = el.gridCanvas.getBoundingClientRect().width || size;
    const backingScale = size / cssWidth;
    gridCtx.clearRect(0, 0, size, size);
    gridCtx.imageSmoothingEnabled = false;
    gridCtx.textAlign = "center";
    gridCtx.textBaseline = "middle";
    gridCtx.font = `900 ${cell * 0.48}px Consolas, "Cascadia Mono", monospace`;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const id = grid[row * GRID + col];
        gridCtx.fillStyle = PALETTE[id - 1];
        gridCtx.fillRect(col * cell, row * cell, cell + 0.2, cell + 0.2);
        if (el.showNumbers.checked) {
          const rgb = RGB[id - 1];
          const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          gridCtx.fillStyle = luminance < 142 ? "#ffffff" : "#050505";
          const text = String(id).padStart(2, "0");
          gridCtx.fillText(text, (col + 0.5) * cell, (row + 0.52) * cell);
        }
      }
    }
    if (el.showGrid.checked) {
      gridCtx.beginPath();
      for (let i = 0; i <= GRID; i++) {
        const p = Math.round(i * cell) + 0.5;
        gridCtx.moveTo(p, 0); gridCtx.lineTo(p, size);
        gridCtx.moveTo(0, p); gridCtx.lineTo(size, p);
      }
      gridCtx.strokeStyle = "rgba(20,25,23,.48)";
      gridCtx.lineWidth = Math.max(1, backingScale);
      gridCtx.stroke();
    }
    drawOverview(grid);
  }

  function drawOverview(grid = state.historyPreview?.grid || state.grid) {
    const size = el.overviewCanvas.width;
    const cell = size / GRID;
    overviewCtx.clearRect(0, 0, size, size);
    overviewCtx.imageSmoothingEnabled = false;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const id = grid[row * GRID + col];
        overviewCtx.fillStyle = PALETTE[id - 1];
        overviewCtx.fillRect(col * cell, row * cell, cell, cell);
      }
    }
  }

  function syncGridCanvasResolution() {
    const rect = el.gridCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const pixelRatio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const target = Math.max(576, Math.round(rect.width * pixelRatio));
    if (el.gridCanvas.width === target && el.gridCanvas.height === target) return;
    el.gridCanvas.width = target;
    el.gridCanvas.height = target;
    drawGrid();
  }

  function cellFromEvent(event) {
    const rect = el.gridCanvas.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) / rect.width * GRID);
    const row = Math.floor((event.clientY - rect.top) / rect.height * GRID);
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) return null;
    return { row, col, index: row * GRID + col };
  }

  function beginMutation() {
    if (!state.mutationBefore) state.mutationBefore = state.grid.slice();
  }

  function endMutation() {
    if (!state.mutationBefore) return;
    let changed = false;
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] !== state.mutationBefore[i]) { changed = true; break; }
    }
    if (changed) {
      state.undo.push(state.mutationBefore);
      if (state.undo.length > 80) state.undo.shift();
      state.redo = [];
      afterGridChange();
    }
    state.mutationBefore = null;
  }

  function commitGrid(next) {
    state.undo.push(state.grid.slice());
    if (state.undo.length > 80) state.undo.shift();
    state.grid = new Uint8Array(next);
    state.redo = [];
    afterGridChange();
  }

  function afterGridChange() {
    clearHistoryPreview(false);
    drawGrid();
    updatePaletteCounts();
    updateHistoryButtons();
    saveLocal();
  }

  function updateHistoryButtons() {
    el.undoBtn.disabled = state.undo.length === 0;
    el.redoBtn.disabled = state.redo.length === 0;
  }

  function showHistoryPreview(kind) {
    const stack = kind === "undo" ? state.undo : state.redo;
    const button = kind === "undo" ? el.undoBtn : el.redoBtn;
    if (!stack.length || button.disabled) return;
    state.historyPreview = { kind, grid: stack[stack.length - 1] };
    el.undoBtn.classList.toggle("history-previewing", kind === "undo");
    el.redoBtn.classList.toggle("history-previewing", kind === "redo");
    drawGrid();
  }

  function clearHistoryPreview(redraw = true) {
    if (!state.historyPreview) return;
    state.historyPreview = null;
    el.undoBtn.classList.remove("history-previewing");
    el.redoBtn.classList.remove("history-previewing");
    if (redraw) drawGrid();
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(state.grid.slice());
    state.grid = state.undo.pop();
    afterGridChange();
    setStatus("已撤销上一步。 ");
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(state.grid.slice());
    state.grid = state.redo.pop();
    afterGridChange();
    setStatus("已恢复上一步。 ");
  }

  function paintCell(cell) {
    if (!cell || state.grid[cell.index] === state.selected) return;
    state.grid[cell.index] = state.selected;
    drawGrid();
    updatePaletteCounts();
  }

  function floodFill(startIndex, newId) {
    const oldId = state.grid[startIndex];
    if (oldId === newId) return;
    const stack = [startIndex];
    const seen = new Uint8Array(GRID * GRID);
    while (stack.length) {
      const index = stack.pop();
      if (seen[index] || state.grid[index] !== oldId) continue;
      seen[index] = 1;
      state.grid[index] = newId;
      const row = Math.floor(index / GRID), col = index % GRID;
      if (row > 0) stack.push(index - GRID);
      if (row < GRID - 1) stack.push(index + GRID);
      if (col > 0) stack.push(index - 1);
      if (col < GRID - 1) stack.push(index + 1);
    }
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool[data-tool]").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
  }

  function replaceColor() {
    const from = Number(el.replaceFrom.value);
    if (from === state.selected) {
      setStatus("来源色和当前色相同，不需要替换。", true);
      return;
    }
    beginMutation();
    let count = 0;
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] === from) { state.grid[i] = state.selected; count++; }
    }
    endMutation();
    setStatus(count ? `已将 ${String(from).padStart(2, "0")} 的 ${count} 格替换为 ${String(state.selected).padStart(2, "0")}。` : "网格中没有这种来源色。 ");
  }

  function createPixelCanvas(scale = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = GRID * scale;
    canvas.height = GRID * scale;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        ctx.fillStyle = PALETTE[state.grid[row * GRID + col] - 1];
        ctx.fillRect(col * scale, row * scale, scale, scale);
      }
    }
    return canvas;
  }

  function createNumberCanvas(includeLegend) {
    const cell = 44, margin = 58;
    const board = margin * 2 + cell * GRID;
    const legendWidth = includeLegend ? 600 : 0;
    const canvas = document.createElement("canvas");
    canvas.width = board + legendWidth;
    canvas.height = board;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f6f6f3";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#202422";
    ctx.font = '700 18px "Microsoft YaHei UI", sans-serif';
    for (let i = 0; i < GRID; i++) {
      ctx.fillText(String(i + 1), margin + (i + 0.5) * cell, margin / 2);
      ctx.fillText(String(i + 1), margin / 2, margin + (i + 0.5) * cell);
    }
    ctx.font = '700 16px "Microsoft YaHei UI", sans-serif';
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const id = state.grid[row * GRID + col];
        const x = margin + col * cell, y = margin + row * cell;
        ctx.fillStyle = PALETTE[id - 1];
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = "rgba(20,25,23,.72)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        ctx.fillStyle = colorText(RGB[id - 1]);
        ctx.strokeStyle = ctx.fillStyle === "#ffffff" ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.86)";
        ctx.lineWidth = 2.5;
        const text = String(id).padStart(2, "0");
        ctx.strokeText(text, x + cell / 2, y + cell / 2 + 1);
        ctx.fillText(text, x + cell / 2, y + cell / 2 + 1);
      }
    }
    if (includeLegend) drawLegend(ctx, board, 0, legendWidth, board);
    return canvas;
  }

  function drawLegend(ctx, left, top, width, height) {
    const counts = new Uint16Array(41);
    state.grid.forEach(id => counts[id]++);
    ctx.fillStyle = "#f9f9f7";
    ctx.fillRect(left, top, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#202422";
    ctx.font = '700 25px "Microsoft YaHei UI", sans-serif';
    ctx.fillText("奇象巡展·赛博拼豆制图工具", left + 22, top + 40);
    ctx.fillStyle = "#5e6864";
    ctx.font = '13px "Microsoft YaHei UI", sans-serif';
    ctx.fillText("固定40色（原编号）·每行2色，按游戏颜料顺序排列", left + 22, top + 67);
    const columns = 2;
    const rows = 20;
    const side = 22;
    const columnGap = 18;
    const startY = top + 92;
    const rowHeight = Math.floor((height - 146) / rows);
    const itemWidth = Math.floor((width - side * 2 - columnGap) / columns);
    const swatchWidth = 42;
    const swatchHeight = 34;
    for (let i = 0; i < 40; i++) {
      const column = i % columns, row = Math.floor(i / columns);
      const x = left + side + column * (itemWidth + columnGap);
      const y = startY + row * rowHeight;
      ctx.fillStyle = PALETTE[i];
      ctx.fillRect(x, y, swatchWidth, swatchHeight);
      ctx.strokeStyle = "#737876";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, swatchWidth - 1, swatchHeight - 1);

      const centerY = y + swatchHeight / 2 + 0.5;
      const infoX = x + swatchWidth + 9;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#202422";
      ctx.font = '700 18px Consolas, monospace';
      ctx.fillText(String(i + 1).padStart(2, "0"), infoX, centerY);

      ctx.fillStyle = "#59615e";
      ctx.font = '12px Consolas, monospace';
      ctx.fillText(PALETTE[i], infoX + 33, centerY);

      ctx.font = '13px "Microsoft YaHei UI", sans-serif';
      ctx.fillText(`${counts[i + 1]}格`, infoX + 111, centerY);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#4b5551";
    ctx.font = '14px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(`24 × 24，共576格；实际使用固定色板中的 ${new Set(state.grid).size} 色`, left + 22, top + height - 28);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadCanvas(canvas, filename, onSuccess) {
    canvas.toBlob(blob => {
      if (!blob) return setStatus("浏览器无法生成PNG，请换用Edge或Chrome。", true);
      downloadBlob(blob, filename);
      if (typeof onSuccess === "function") onSuccess(filename);
      else setStatus(`已导出 ${filename}`);
    }, "image/png");
  }

  function createProjectData(savedAt = new Date().toISOString()) {
    return {
      format: "arknights_draw-project",
      version: 1,
      gridSize: GRID,
      palette: PALETTE,
      grid: Array.from(state.grid),
      selected: state.selected,
      fileName: safeName(),
      settings: {
        mode: el.modeSelect.value,
        contrast: Number(el.contrastRange.value),
        saturation: Number(el.saturationRange.value),
        showNumbers: el.showNumbers.checked,
        showGrid: el.showGrid.checked,
        showOverview: el.showOverview.checked
      },
      savedAt
    };
  }

  function validateProject(project) {
    if (!project || project.format !== "arknights_draw-project" || project.gridSize !== GRID || !Array.isArray(project.grid) || project.grid.length !== GRID * GRID) {
      throw new Error("不是有效的24×24工程文件");
    }
    if (project.grid.some(id => !Number.isInteger(id) || id < 1 || id > 40)) {
      throw new Error("工程中含有固定色板以外的编号");
    }
  }

  function applyProject(project) {
    validateProject(project);
    if (project.fileName) el.fileName.value = String(project.fileName).slice(0, 40);
    if (project.settings) {
      if (["hybrid", "dominant", "average"].includes(project.settings.mode)) el.modeSelect.value = project.settings.mode;
      if (Number.isFinite(project.settings.contrast)) el.contrastRange.value = String(project.settings.contrast);
      if (Number.isFinite(project.settings.saturation)) el.saturationRange.value = String(project.settings.saturation);
      el.showNumbers.checked = project.settings.showNumbers !== false;
      el.showGrid.checked = project.settings.showGrid !== false;
      el.showOverview.checked = project.settings.showOverview !== false;
      syncOverviewVisibility();
    }
    if (project.selected) selectColor(project.selected);
    syncOutputs();
    commitGrid(project.grid);
  }

  function saveProject() {
    const project = createProjectData();
    const name = `${safeName()}_工程.json`;
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" }), name);
    setStatus(`工程已保存：${name}（不包含原图）`);
  }

  function loadProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = JSON.parse(String(reader.result));
        applyProject(project);
        setStatus("工程已载入，可以继续修改或导出。 ");
      } catch (error) {
        setStatus(`载入失败：${error.message}`, true);
      } finally {
        el.projectInput.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function historySignature(project) {
    return `${project.fileName}|${project.grid.join(",")}`;
  }

  function loadExportHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPORT_HISTORY_KEY) || "[]");
      if (!Array.isArray(saved)) return;
      exportHistory = saved.filter(record => {
        try {
          validateProject(record?.project);
          record.project.fileName = drawingName(record.project.fileName);
          return typeof record.id === "string" && typeof record.exportedAt === "string";
        } catch (_) {
          return false;
        }
      }).slice(0, EXPORT_HISTORY_LIMIT);
    } catch (_) {
      exportHistory = [];
    }
  }

  function persistExportHistory() {
    try {
      localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify(exportHistory));
      return true;
    } catch (_) {
      return false;
    }
  }

  function drawHistoryThumbnail(canvas, grid) {
    canvas.width = GRID;
    canvas.height = GRID;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        ctx.fillStyle = PALETTE[grid[row * GRID + col] - 1];
        ctx.fillRect(col, row, 1, 1);
      }
    }
  }

  function formatHistoryTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function loadHistoryRecord(record) {
    try {
      applyProject(record.project);
      setStatus(`已从导出历史载入“${drawingName(record.project.fileName)}”，可以继续修改。`);
      el.gridCanvas.closest(".editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(`历史记录载入失败：${error.message}`, true);
    }
  }

  function removeHistoryRecord(id) {
    const record = exportHistory.find(item => item.id === id);
    if (!record || !window.confirm(`删除历史记录“${drawingName(record.project.fileName)}”？`)) return;
    exportHistory = exportHistory.filter(item => item.id !== id);
    persistExportHistory();
    renderExportHistory();
    setStatus("已删除一条导出历史。 ");
  }

  function renderExportHistory() {
    el.exportHistory.replaceChildren();
    el.historyCount.textContent = `${exportHistory.length} 份`;
    el.clearHistoryBtn.disabled = exportHistory.length === 0;
    if (!exportHistory.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "尚无记录。第一次导出图纸后会自动出现在这里。";
      el.exportHistory.append(empty);
      return;
    }

    exportHistory.forEach(record => {
      const card = document.createElement("article");
      card.className = "history-card";

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "history-load";
      loadButton.setAttribute("aria-label", `载入历史图纸 ${drawingName(record.project.fileName)}`);

      const canvas = document.createElement("canvas");
      canvas.className = "history-thumb";
      canvas.setAttribute("aria-hidden", "true");
      drawHistoryThumbnail(canvas, record.project.grid);

      const copy = document.createElement("span");
      copy.className = "history-copy";
      const name = document.createElement("strong");
      name.textContent = drawingName(record.project.fileName);
      const meta = document.createElement("span");
      meta.textContent = `${new Set(record.project.grid).size} 色 · 24×24`;
      const time = document.createElement("small");
      time.textContent = formatHistoryTime(record.exportedAt);
      copy.append(name, meta, time);
      loadButton.append(canvas, copy);
      loadButton.addEventListener("click", () => loadHistoryRecord(record));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "history-delete";
      deleteButton.textContent = "×";
      deleteButton.title = "删除这条记录";
      deleteButton.setAttribute("aria-label", `删除历史记录 ${drawingName(record.project.fileName)}`);
      deleteButton.addEventListener("click", () => removeHistoryRecord(record.id));

      card.append(loadButton, deleteButton);
      el.exportHistory.append(card);
    });
  }

  function recordExportHistory() {
    const exportedAt = new Date().toISOString();
    const project = createProjectData(exportedAt);
    const signature = historySignature(project);
    const record = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      exportedAt,
      signature,
      project
    };
    exportHistory = [record, ...exportHistory.filter(item => (item.signature || historySignature(item.project)) !== signature)].slice(0, EXPORT_HISTORY_LIMIT);
    const persisted = persistExportHistory();
    renderExportHistory();
    return persisted;
  }

  function clearExportHistory() {
    if (!exportHistory.length || !window.confirm("清空全部导出历史？已下载的PNG和手动保存的JSON不会被删除。")) return;
    exportHistory = [];
    persistExportHistory();
    renderExportHistory();
    setStatus("导出历史已清空；已下载文件不受影响。 ");
  }

  function exportTotal() {
    const name = `${safeName()}_24x24_图纸.png`;
    downloadCanvas(createNumberCanvas(true), name, filename => {
      const persisted = recordExportHistory();
      setStatus(persisted
        ? `已导出 ${filename}，并加入导出历史。`
        : `已导出 ${filename}；当前浏览器禁止本地存储，历史只能保留到本页关闭前。`);
    });
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ grid: Array.from(state.grid), fileName: el.fileName.value }));
    } catch (_) { /* file:// privacy settings may disable storage */ }
  }

  function restoreLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.grid) && saved.grid.length === GRID * GRID && saved.grid.every(id => Number.isInteger(id) && id >= 1 && id <= 40)) {
        state.grid = new Uint8Array(saved.grid);
        if (saved.fileName) el.fileName.value = drawingName(saved.fileName).slice(0, 40);
      }
    } catch (_) { /* ignore damaged local cache */ }
  }

  function syncOutputs() {
    el.zoomOut.textContent = `${el.zoomRange.value}%`;
    el.contrastOut.textContent = Number(el.contrastRange.value) > 0 ? `+${el.contrastRange.value}` : el.contrastRange.value;
    el.saturationOut.textContent = Number(el.saturationRange.value) > 0 ? `+${el.saturationRange.value}` : el.saturationRange.value;
  }

  function syncOverviewVisibility() {
    const visible = el.showOverview.checked;
    el.overviewCard.hidden = !visible;
    el.editorBoardLayout.classList.toggle("overview-hidden", !visible);
  }

  function bindEvents() {
    el.imageInput.addEventListener("change", () => { loadImageFile(el.imageInput.files[0]); el.imageInput.value = ""; });
    el.projectInput.addEventListener("change", () => loadProjectFile(el.projectInput.files[0]));
    ["dragenter", "dragover"].forEach(type => el.dropZone.addEventListener(type, event => { event.preventDefault(); el.dropZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach(type => el.dropZone.addEventListener(type, event => { event.preventDefault(); el.dropZone.classList.remove("dragging"); }));
    el.dropZone.addEventListener("drop", event => loadImageFile([...event.dataTransfer.files].find(file => file.type.startsWith("image/"))));
    document.addEventListener("paste", event => {
      const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith("image/"));
      if (file) loadImageFile(file);
    });

    el.sourceCanvas.addEventListener("pointerdown", event => {
      state.cropDrag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      el.sourceCanvas.setPointerCapture(event.pointerId);
      el.sourceCanvas.classList.add("dragging");
    });
    el.sourceCanvas.addEventListener("pointermove", event => {
      if (!state.cropDrag) return;
      const rect = el.sourceCanvas.getBoundingClientRect();
      state.panX = state.cropDrag.panX + (event.clientX - state.cropDrag.x) * SOURCE_SIZE / rect.width;
      state.panY = state.cropDrag.panY + (event.clientY - state.cropDrag.y) * SOURCE_SIZE / rect.height;
      drawSource();
    });
    const stopCropDrag = () => { state.cropDrag = null; el.sourceCanvas.classList.remove("dragging"); };
    el.sourceCanvas.addEventListener("pointerup", stopCropDrag);
    el.sourceCanvas.addEventListener("pointercancel", stopCropDrag);
    el.sourceCanvas.addEventListener("wheel", event => {
      event.preventDefault();
      const next = Math.max(100, Math.min(400, Number(el.zoomRange.value) + (event.deltaY < 0 ? 10 : -10)));
      el.zoomRange.value = String(next);
      state.zoom = next / 100;
      syncOutputs();
      drawSource();
    }, { passive: false });

    el.zoomRange.addEventListener("input", () => { state.zoom = Number(el.zoomRange.value) / 100; syncOutputs(); drawSource(); });
    el.contrastRange.addEventListener("input", syncOutputs);
    el.saturationRange.addEventListener("input", syncOutputs);
    el.resetCropBtn.addEventListener("click", () => resetCrop(false));
    el.fitSubjectBtn.addEventListener("click", () => resetCrop(!state.fitFull));
    el.removeImageBtn.addEventListener("click", event => { event.stopPropagation(); removeSourceImage(); });
    el.generateBtn.addEventListener("click", buildGridFromImage);

    document.querySelectorAll(".tool[data-tool]").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
    el.undoBtn.addEventListener("click", undo);
    el.redoBtn.addEventListener("click", redo);
    el.undoBtn.addEventListener("pointerenter", () => showHistoryPreview("undo"));
    el.undoBtn.addEventListener("pointerleave", () => clearHistoryPreview());
    el.redoBtn.addEventListener("pointerenter", () => showHistoryPreview("redo"));
    el.redoBtn.addEventListener("pointerleave", () => clearHistoryPreview());
    el.showNumbers.addEventListener("change", () => drawGrid());
    el.showGrid.addEventListener("change", () => drawGrid());
    el.showOverview.addEventListener("change", syncOverviewVisibility);
    el.replaceBtn.addEventListener("click", replaceColor);

    el.gridCanvas.addEventListener("pointerdown", event => {
      const cell = cellFromEvent(event);
      if (!cell) return;
      el.gridCanvas.setPointerCapture(event.pointerId);
      if (event.button === 2 || state.tool === "picker") {
        selectColor(state.grid[cell.index]);
        setStatus(`已从 R${cell.row + 1} C${cell.col + 1} 取得颜色 ${String(state.selected).padStart(2, "0")}。`);
        return;
      }
      beginMutation();
      if (state.tool === "fill") {
        floodFill(cell.index, state.selected);
        endMutation();
      } else {
        state.painting = true;
        paintCell(cell);
      }
    });
    el.gridCanvas.addEventListener("pointermove", event => {
      const cell = cellFromEvent(event);
      if (cell) el.cellInfo.textContent = `R${cell.row + 1} C${cell.col + 1} · ${String(state.grid[cell.index]).padStart(2, "0")}`;
      if (state.painting && state.tool === "paint") paintCell(cell);
    });
    el.gridCanvas.addEventListener("pointerleave", () => { if (!state.painting) el.cellInfo.textContent = "R— C—"; });
    const stopPainting = () => { if (state.painting) { state.painting = false; endMutation(); } };
    el.gridCanvas.addEventListener("pointerup", stopPainting);
    el.gridCanvas.addEventListener("pointercancel", stopPainting);
    window.addEventListener("pointerup", stopPainting);
    el.gridCanvas.addEventListener("contextmenu", event => event.preventDefault());

    document.addEventListener("keydown", event => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (event.key.toLowerCase() === "b") setTool("paint");
      if (event.key.toLowerCase() === "f") setTool("fill");
      if (event.key.toLowerCase() === "i") setTool("picker");
    });

    el.fileName.addEventListener("change", saveLocal);
    el.helpBtn.addEventListener("click", () => {
      el.helpPanel.hidden = !el.helpPanel.hidden;
      el.helpBtn.setAttribute("aria-expanded", String(!el.helpPanel.hidden));
    });
    el.authorLinks.forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      if (!el.authorDialog.open) el.authorDialog.showModal();
    }));
    el.authorCloseBtn.addEventListener("click", () => el.authorDialog.close());
    el.authorDialog.addEventListener("click", event => {
      if (event.target === el.authorDialog) el.authorDialog.close();
    });
    el.saveProjectBtn.addEventListener("click", saveProject);
    el.exportPreviewBtn.addEventListener("click", () => downloadCanvas(createPixelCanvas(24), `${safeName()}_24x24_PNG预览.png`));
    el.exportTotalBtn.addEventListener("click", exportTotal);
    el.clearHistoryBtn.addEventListener("click", clearExportHistory);
  }

  function init() {
    restoreLocal();
    loadExportHistory();
    renderPalette();
    renderCoordinateAxes();
    renderExportHistory();
    bindEvents();
    syncOutputs();
    syncOverviewVisibility();
    drawGrid();
    updatePaletteCounts();
    updateHistoryButtons();
    if ("ResizeObserver" in window) {
      gridResizeObserver = new ResizeObserver(syncGridCanvasResolution);
      gridResizeObserver.observe(el.gridCanvas);
    }
    window.addEventListener("resize", syncGridCanvasResolution);
    window.addEventListener("blur", () => clearHistoryPreview());
    window.requestAnimationFrame(syncGridCanvasResolution);
  }

  init();
})();
