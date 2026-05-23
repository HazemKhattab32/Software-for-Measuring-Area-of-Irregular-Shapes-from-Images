const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const fileInput = document.getElementById('file-input');
const uploadZone = document.getElementById('upload-zone');
const canvasArea = document.getElementById('canvas-area');
const toolbar = document.getElementById('toolbar');

let img = null;
let mode = 'magic';
let calPoints = [];
let polyPoints = [];
let calPixelLength = 0;
let scale = null;
let isClosed = false;
let magicBoundary = null;
let magicAreaPx = 0;
let results = null;
let imgOffX = 0, imgOffY = 0, imgDrawW = 0, imgDrawH = 0;

// --- Multi-shape history ---
let shapeHistory = [];
let shapeCounter = 0;

// --- Dark Mode ---
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('shapeTool_darkMode', isDark ? '1' : '0');
}

// Restore preference on load
(function() {
  const saved = localStorage.getItem('shapeTool_darkMode');
  if (saved === '1') document.body.classList.add('dark');
})();

// --- File input ---
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadImage(e.target.files[0]); });
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag'); if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]); });
canvasArea.addEventListener('dragover', e => e.preventDefault());
canvasArea.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]); });

function loadImage(file) {
  if (!file.type.startsWith('image/')) { toast('Please upload an image file.'); return; }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    img = image;
    uploadZone.style.display = 'none';
    canvas.style.display = 'block';
    toolbar.classList.add('show');
    computeCanvasLayout();
    resetAll(false);
    setStatus('img', 'done', 'Loaded');
    drawAll();
    URL.revokeObjectURL(url);
  };
  image.onerror = () => toast('Failed to load image.');
  image.src = url;
}

function computeCanvasLayout() {
  const maxW = canvasArea.clientWidth - 0;
  const maxH = canvasArea.clientHeight - 0;
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  imgDrawW = Math.round(img.naturalWidth * ratio);
  imgDrawH = Math.round(img.naturalHeight * ratio);
  canvas.width = imgDrawW;
  canvas.height = imgDrawH;
  imgOffX = 0; imgOffY = 0;
}

// Convert canvas click coords to image pixel coords
function toImg(cx, cy) {
  const ratio = img.naturalWidth / imgDrawW;
  return [cx * ratio, cy * ratio];
}

function toCanvas(ix, iy) {
  const ratio = imgDrawW / img.naturalWidth;
  return [ix * ratio, iy * ratio];
}

// --- Drawing ---
function drawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (img) ctx.drawImage(img, 0, 0, imgDrawW, imgDrawH);

  // Calibration line
  if (calPoints.length >= 1) {
    const [x1, y1] = toCanvas(...calPoints[0]);
    ctx.save();
    ctx.fillStyle = '#ef9f27';
    ctx.strokeStyle = '#ef9f27';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    if (calPoints.length === 2) {
      const [x2, y2] = toCanvas(...calPoints[1]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // Endpoint markers
      drawEndMarker(x1, y1, '#ef9f27');
      drawEndMarker(x2, y2, '#ef9f27');
      // Length label
      const mx = (x1+x2)/2, my = (y1+y2)/2;
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef9f27';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(calPixelLength.toFixed(1) + ' px', mx, my - 8);
    }
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x1, y1, 5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // Magic wand region
  if (magicBoundary && magicBoundary.length > 2) {
    ctx.save();
    ctx.strokeStyle = '#d4537e';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(212,83,126,0.18)';
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    const [bx0, by0] = toCanvas(...magicBoundary[0]);
    ctx.moveTo(bx0, by0);
    for (let i=1; i<magicBoundary.length; i++) {
      const [bx, by] = toCanvas(...magicBoundary[i]);
      ctx.lineTo(bx, by);
    }
    ctx.closePath();
    ctx.fill();
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  // Polygon
  if (polyPoints.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#1d9e75';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(29,158,117,0.15)';
    ctx.beginPath();
    const [px0, py0] = toCanvas(...polyPoints[0]);
    ctx.moveTo(px0, py0);
    for (let i=1; i<polyPoints.length; i++) {
      const [px, py] = toCanvas(...polyPoints[i]);
      ctx.lineTo(px, py);
    }
    if (isClosed) { ctx.closePath(); ctx.fill(); }
    ctx.stroke();

    // Close-snap indicator
    if (polyPoints.length > 2 && !isClosed) {
      ctx.strokeStyle = 'rgba(29,158,117,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      const [lx, ly] = toCanvas(...polyPoints[polyPoints.length-1]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(px0, py0); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Vertex dots
    polyPoints.forEach(([ix, iy], i) => {
      const [cx2, cy2] = toCanvas(ix, iy);
      ctx.fillStyle = i === 0 ? '#0f6e56' : '#1d9e75';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx2, cy2, i === 0 ? 6 : 4, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }
}

function drawEndMarker(x, y, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y-8); ctx.lineTo(x, y+8); ctx.stroke();
  ctx.restore();
}

// --- Canvas interaction ---
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('click', onCanvasClick);
canvas.addEventListener('dblclick', onDblClick);

let lastMoveXY = [0, 0];
function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  lastMoveXY = [cx, cy];
  const [ix, iy] = toImg(cx, cy);
  document.getElementById('tb-xy').textContent = `x: ${Math.round(ix)}  y: ${Math.round(iy)}`;
}

function onCanvasClick(e) {
  if (!img) return;
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
  const [ix, iy] = toImg(cx, cy);

  if (mode === 'calibrate') {
    if (calPoints.length >= 2) calPoints = [];
    calPoints.push([ix, iy]);
    if (calPoints.length === 2) {
      const dx = calPoints[1][0]-calPoints[0][0], dy = calPoints[1][1]-calPoints[0][1];
      calPixelLength = Math.sqrt(dx*dx+dy*dy);
      document.getElementById('cal-px-val').textContent = calPixelLength.toFixed(2) + ' px';
      document.getElementById('cal-info').style.display = 'block';
      computeScale();
    }
    drawAll();
  } else if (mode === 'polygon') {
    if (isClosed) return;
    if (polyPoints.length > 2) {
      // Check snap to close
      const [fcx, fcy] = toCanvas(...polyPoints[0]);
      if (Math.hypot(cx-fcx, cy-fcy) < 14) { closePolygon(); return; }
    }
    polyPoints.push([ix, iy]);
    document.getElementById('tb-pts').textContent = `Points: ${polyPoints.length}`;
    drawAll();
  } else if (mode === 'magic') {
    doMagicWand(Math.round(ix), Math.round(iy));
  } else if (mode === 'color') {
    // In color mode: click picks pixel color into the custom picker
    pickColorFromCanvas(Math.round(ix), Math.round(iy));
  }
}

function onDblClick(e) {
  if (mode === 'polygon' && polyPoints.length > 2 && !isClosed) {
    closePolygon();
  }
}

function closePolygon() {
  isClosed = true;
  const areaPx = shoelaceArea(polyPoints);
  showResults(areaPx, polyPoints, 'polygon');
  drawAll();
  toast('Shape closed. Area calculated.');
}

// --- Math ---
function shoelaceArea(pts) {
  let n = pts.length, area = 0;
  for (let i=0; i<n; i++) {
    const j = (i+1)%n;
    area += pts[i][0]*pts[j][1];
    area -= pts[j][0]*pts[i][1];
  }
  return Math.abs(area)/2;
}

function polygonPerimeter(pts) {
  let p = 0;
  for (let i=0; i<pts.length; i++) {
    const j = (i+1)%pts.length;
    const dx=pts[j][0]-pts[i][0], dy=pts[j][1]-pts[i][1];
    p += Math.sqrt(dx*dx+dy*dy);
  }
  return p;
}

// --- Magic Wand ---
function doMagicWand(seedX, seedY) {
  if (!img) return;
  const W = img.naturalWidth, H = img.naturalHeight;
  if (seedX < 0 || seedX >= W || seedY < 0 || seedY >= H) return;

  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const oc = offscreen.getContext('2d');
  oc.drawImage(img, 0, 0);
  const imageData = oc.getImageData(0, 0, W, H);
  const data = imageData.data;
  const tol = parseInt(document.getElementById('tolerance').value);

  const idx = (x, y) => (y*W+x)*4;
  const sr = data[idx(seedX,seedY)], sg = data[idx(seedX,seedY)+1], sb = data[idx(seedX,seedY)+2];

  const visited = new Uint8Array(W*H);
  const region = [];
  const stack = [seedX + seedY*W];
  visited[seedX + seedY*W] = 1;

  while (stack.length > 0) {
    const pos = stack.pop();
    const px = pos%W, py = Math.floor(pos/W);
    region.push([px, py]);
    const neighbors = [[px-1,py],[px+1,py],[px,py-1],[px,py+1]];
    for (const [nx,ny] of neighbors) {
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni = nx+ny*W;
      if (visited[ni]) continue;
      const ii = ni*4;
      if (Math.abs(data[ii]-sr)+Math.abs(data[ii+1]-sg)+Math.abs(data[ii+2]-sb) <= tol*3) {
        visited[ni]=1; stack.push(ni);
      }
    }
  }

  if (region.length < 4) { toast('Region too small. Try clicking inside the shape or adjusting tolerance.'); return; }

  magicAreaPx = region.length;
  magicBoundary = extractBoundary(region, W, H, visited);
  isClosed = true;
  polyPoints = [];
  showResults(magicAreaPx, magicBoundary, 'magic');
  drawAll();
  toast(`Magic wand selected ${region.length.toLocaleString()} pixels.`);
}

function extractBoundary(region, W, H, visited) {
  const set = new Set(region.map(([x,y]) => x+y*W));
  let boundary = region.filter(([x,y]) => {
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx=x+dx, ny=y+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) return true;
      if (!set.has(nx+ny*W)) return true;
    }
    return false;
  });
  if (boundary.length > 2000) boundary = boundary.filter((_,i)=>i%Math.ceil(boundary.length/2000)===0);
  return orderBoundaryByAngle(boundary);
}

function orderBoundaryByAngle(pts) {
  if (!pts.length) return pts;
  const cx = pts.reduce((s,[x])=>s+x,0)/pts.length;
  const cy = pts.reduce((s,[,y])=>s+y,0)/pts.length;
  return [...pts].sort(([ax,ay],[bx,by]) => Math.atan2(ay-cy,ax-cx)-Math.atan2(by-cy,bx-cx));
}

// --- Results ---
function computeScale() {
  const rl = parseFloat(document.getElementById('real-length').value);
  const unit = document.getElementById('unit').value;
  if (unit === 'px') { scale = null; return; }
  if (isNaN(rl) || rl <= 0 || calPixelLength <= 0) { scale = null; return; }
  scale = rl / calPixelLength;
  setStatus('cal', 'done', 'Set');
}

document.getElementById('real-length').addEventListener('input', () => { computeScale(); if (results) redisplayResults(); });
document.getElementById('unit').addEventListener('change', () => { computeScale(); if (results) redisplayResults(); });

function redisplayResults() {
  if (!results) return;
  showResults(results.areaPx, results.pts, results.type);
}

function showResults(areaPx, pts, type) {
  computeScale();
  results = { areaPx, pts, type };
  const unit = document.getElementById('unit').value;

  document.getElementById('results-section').style.display = 'block';
  document.getElementById('res-px').textContent = Math.round(areaPx).toLocaleString();

  let perimPx = polygonPerimeter(pts);
  let realArea = null, perimReal = null;

  if (scale && unit !== 'px') {
    realArea = areaPx * scale * scale;
    perimReal = perimPx * scale;
    document.getElementById('real-card').style.display = 'block';
    document.getElementById('res-unit-label').textContent = 'Real area';
    document.getElementById('res-real').textContent = realArea < 0.01 ? realArea.toExponential(3) : realArea.toFixed(4);
    document.getElementById('res-unit-sub').textContent = unit + '²';

    document.getElementById('perimeter-row').style.display = 'flex';
    document.getElementById('res-perimeter').textContent = perimReal.toFixed(3) + ' ' + unit;
    document.getElementById('export-row').style.display = 'block';
  } else {
    document.getElementById('real-card').style.display = 'none';
    document.getElementById('perimeter-row').style.display = 'none';
    document.getElementById('export-row').style.display = 'none';
    document.getElementById('perimeter-row').style.display = 'flex';
    document.getElementById('res-perimeter').textContent = perimPx.toFixed(1) + ' px';
  }

  if (type === 'polygon') {
    document.getElementById('vertices-row').style.display = 'flex';
    document.getElementById('res-vertices').textContent = pts.length;
  } else {
    document.getElementById('vertices-row').style.display = 'none';
  }

  // --- Save to history ---
  shapeCounter++;
  const rl = parseFloat(document.getElementById('real-length').value);
  const entry = {
    id: shapeCounter,
    timestamp: new Date().toISOString().replace('T',' ').substring(0,19),
    type,
    areaPx: Math.round(areaPx),
    realArea: realArea !== null ? realArea.toFixed(6) : 'N/A',
    unit: unit !== 'px' ? unit : 'px',
    perimPx: perimPx.toFixed(2),
    perimReal: perimReal !== null ? perimReal.toFixed(6) : 'N/A',
    vertexCount: type === 'polygon' ? pts.length : 'N/A',
    scaleFactor: scale ? scale.toFixed(8) : 'N/A',
    refPx: calPixelLength > 0 ? calPixelLength.toFixed(4) : 'N/A',
    refReal: (!isNaN(rl) && unit !== 'px') ? rl : 'N/A',
    pts: type === 'polygon' ? pts.map(([x,y]) => [x.toFixed(2), y.toFixed(2)]) : []
  };
  // Replace last entry if same shape was re-detected (user adjusted tolerance etc.)
  const last = shapeHistory[shapeHistory.length - 1];
  if (last && last.id === shapeCounter) {
    shapeHistory[shapeHistory.length - 1] = entry;
  } else {
    shapeHistory.push(entry);
  }
  updateShapeCountBadge();
  document.getElementById('export-row').style.display = 'block';
}

// --- Mode switching ---
function setMode(m) {
  mode = m;
  ['calibrate','polygon','magic','color'].forEach(id => {
    const el = document.getElementById('mode-'+id);
    if (el) el.classList.toggle('active', id===m);
  });
  const hints = {
    calibrate: 'Click two points on a known-length reference (e.g. a ruler) to set the measurement scale.',
    polygon: 'Click to place polygon vertices around your shape. Click near the first vertex or double-click to close and calculate area.',
    magic: 'Click anywhere inside the shape. The tool selects connected pixels of similar color. Adjust tolerance to include more or fewer pixels.',
    color: 'Select colors from the palette, then click "Analyze selected colors". Click anywhere on the image to pick that pixel\'s color into the custom picker.'
  };
  document.getElementById('mode-hint-box').innerHTML = hints[m];
  document.getElementById('magic-controls').style.display = m === 'magic' ? 'block' : 'none';
  document.getElementById('color-section').style.display = m === 'color' ? 'block' : 'none';
  document.getElementById('tb-mode').textContent = {
    calibrate: 'Calibrate mode',
    polygon: 'Polygon mode',
    magic: 'Magic wand mode',
    color: 'Color analysis mode'
  }[m];
}

document.getElementById('tolerance').addEventListener('input', function() {
  document.getElementById('tol-val').textContent = this.value;
});

// --- Clear / Reset ---
function clearSelection() {
  polyPoints = []; isClosed = false; magicBoundary = null; magicAreaPx = 0;
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('tb-pts').textContent = 'Points: 0';
  results = null;
  drawAll();
}

function clearAll() {
  clearSelection();
  calPoints = []; calPixelLength = 0; scale = null;
  shapeHistory = []; shapeCounter = 0;
  document.getElementById('cal-info').style.display = 'none';
  setStatus('cal', '', 'Pending');
  updateShapeCountBadge();
}

function resetAll(resetImg=true) {
  clearSelection();
  calPoints = []; calPixelLength = 0; scale = null;
  shapeHistory = []; shapeCounter = 0;
  document.getElementById('cal-info').style.display = 'none';
  setStatus('cal', '', 'Pending');
  updateShapeCountBadge();
  if (resetImg) {
    img = null; canvas.style.display='none'; uploadZone.style.display='flex';
    toolbar.classList.remove('show');
    setStatus('img', '', 'Pending');
  }
}

// --- Shape count badge ---
function updateShapeCountBadge() {
  let badge = document.getElementById('shape-count-badge');
  if (!badge) return;
  badge.textContent = shapeHistory.length + ' shape' + (shapeHistory.length !== 1 ? 's' : '') + ' recorded';
  badge.style.display = shapeHistory.length > 0 ? 'inline-flex' : 'none';
}

// --- Export all shapes as single CSV ---
function exportCSV() {
  if (shapeHistory.length === 0) { toast('No shapes recorded yet.'); return; }
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);

  // Determine if any entry has real-world units
  const hasReal = shapeHistory.some(e => e.unit !== 'px' && e.realArea !== 'N/A');

  // --- Summary table (one row per shape) ---
  let csv = `Shape Area Measurement Report\nGenerated: ${ts}\nImage: ${img?.naturalWidth || '—'} x ${img?.naturalHeight || '—'} px\n\n`;
  csv += `=== SUMMARY (${shapeHistory.length} shape${shapeHistory.length !== 1 ? 's' : ''}) ===\n`;

  const summaryHeaders = ['Shape #','Date','Time','Type','Area (px2)','Perimeter (px)','Vertices'];
  if (hasReal) summaryHeaders.push('Real Area','Real Perimeter','Unit','Scale (unit/px)','Ref Px','Ref Real');
  csv += summaryHeaders.join(',') + '\n';

  shapeHistory.forEach(e => {
    const [date, time] = e.timestamp.split(' ');
    const row = [e.id, date, time, e.type, e.areaPx, e.perimPx, e.vertexCount];
    if (hasReal) row.push(e.realArea, e.perimReal, e.unit !== 'px' ? e.unit + '2/' + e.unit : 'px', e.scaleFactor, e.refPx, e.refReal);
    csv += row.join(',') + '\n';
  });

  // --- Per-shape polygon vertex tables ---
  const polygons = shapeHistory.filter(e => e.type === 'polygon' && e.pts.length > 0);
  if (polygons.length > 0) {
    csv += `\n=== POLYGON VERTICES (image coordinates) ===\n`;
    polygons.forEach(e => {
      csv += `\nShape #${e.id} - ${e.type} - Area: ${e.areaPx} px2\n`;
      csv += `Vertex,X (px),Y (px)\n`;
      e.pts.forEach(([x,y], i) => { csv += `${i+1},${x},${y}\n`; });
    });
  }

  const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `area_measurements_${shapeHistory.length}shapes.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`CSV exported: ${shapeHistory.length} shape${shapeHistory.length !== 1 ? 's' : ''}.`);
}

// --- Helpers ---
function setStatus(which, cls, text) {
  const el = document.getElementById(which+'-status');
  if (!el) return;
  el.className = 'status-tag' + (cls ? ' '+cls : '');
  el.textContent = text;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

window.addEventListener('resize', () => {
  if (img) { computeCanvasLayout(); drawAll(); }
});

// --- (Undo Last Point) ---
function undoLastPoint() {
  if (mode === 'polygon' && polyPoints.length > 0) {
    if (isClosed) {
      isClosed = false;
      document.getElementById('results-section').style.display = 'none';
    } else {
      polyPoints.pop();
    }
    document.getElementById('tb-pts').textContent = `Points: ${polyPoints.length}`;
    drawAll();
    toast('Last point removed.');
  }
}

// --- (Canny Edge Detection) ---
let showingEdges = false;
let originalImgData = null;

function toggleEdges() {
  if (!cv || !img) { toast('OpenCV is loading or no image...'); return; }
  
  showingEdges = !showingEdges;
  const btn = document.getElementById('canny-btn');
  
  if (showingEdges) {
    applyCanny();
    btn.querySelector('span').textContent = '⏪ Show Original';
    btn.classList.add('danger');
  } else {
    drawAll();
    btn.querySelector('span').textContent = '🔍 Show Edges';
    btn.classList.remove('danger');
  }
}

function applyCanny() {
  // OpenCV Processing 
  let src = cv.imread(canvas);
  let dst = new cv.Mat();
  cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0); // (Grayscale)
  cv.Canny(src, dst, 50, 150, 3, false); // Canny Algorithm
  cv.imshow(canvas, dst); // Display edges on canvas
  src.delete(); dst.delete();
  toast('Edges detected using OpenCV.js');
}


// ═══════════════════════════════════════════════════
//  COLOR PALETTE FEATURE  (new — added below original)
// ═══════════════════════════════════════════════════

const PRESET_COLORS = [
  { name: 'Red',    hex: '#e84040' },
  { name: 'Orange', hex: '#f5830a' },
  { name: 'Yellow', hex: '#f5d80a' },
  { name: 'Green',  hex: '#27c25b' },
  { name: 'Cyan',   hex: '#0ad4f5' },
  { name: 'Blue',   hex: '#1a6cf5' },
  { name: 'Purple', hex: '#9b27c2' },
  { name: 'Pink',   hex: '#e84096' },
  { name: 'White',  hex: '#f0f0f0' },
  { name: 'Black',  hex: '#181818' },
  { name: 'Gray',   hex: '#888888' },
  { name: 'Brown',  hex: '#8b4513' },
];

let paletteColors = PRESET_COLORS.map(c => ({ ...c }));
let selectedColorIndices = new Set();

function renderPaletteSwatches() {
  const container = document.getElementById('palette-swatches');
  if (!container) return;
  container.innerHTML = '';
  paletteColors.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'palette-swatch' + (selectedColorIndices.has(i) ? ' selected' : '');
    sw.style.background = c.hex;
    sw.title = c.name + ' (' + c.hex + ')';
    sw.onclick = () => toggleSwatch(i);
    container.appendChild(sw);
  });
}

function toggleSwatch(i) {
  if (selectedColorIndices.has(i)) selectedColorIndices.delete(i);
  else selectedColorIndices.add(i);
  renderPaletteSwatches();
}

function addCustomColor() {
  const hex = document.getElementById('custom-color-picker').value;
  const name = 'Custom ' + hex.toUpperCase();
  // avoid exact duplicate
  let found = paletteColors.findIndex(c => c.hex.toLowerCase() === hex.toLowerCase());
  if (found < 0) {
    paletteColors.push({ name, hex });
    found = paletteColors.length - 1;
  }
  selectedColorIndices.add(found);
  renderPaletteSwatches();
  toast('Color added: ' + hex.toUpperCase());
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1,3), 16),
    parseInt(hex.slice(3,5), 16),
    parseInt(hex.slice(5,7), 16)
  ];
}

function colorDistance(r1,g1,b1, r2,g2,b2) {
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

function pickColorFromCanvas(ix, iy) {
  if (!img) return;
  const W = img.naturalWidth, H = img.naturalHeight;
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const oc = off.getContext('2d');
  oc.drawImage(img, 0, 0);
  const px = oc.getImageData(ix, iy, 1, 1).data;
  const hex = '#' + [px[0],px[1],px[2]].map(v => v.toString(16).padStart(2,'0')).join('');
  document.getElementById('custom-color-picker').value = hex;
  toast('Picked: ' + hex.toUpperCase() + ' — click "+ Add custom color" to use it');
}

function analyzeColors() {
  if (!img) { toast('Load an image first.'); return; }
  if (selectedColorIndices.size === 0) { toast('Select at least one color swatch first.'); return; }

  const tol = parseInt(document.getElementById('color-tolerance').value);
  document.getElementById('color-progress').style.display = 'block';
  document.getElementById('color-results-list').innerHTML = '';

  setTimeout(() => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const oc = off.getContext('2d');
    oc.drawImage(img, 0, 0);
    const data = oc.getImageData(0, 0, W, H).data;
    const totalPx = W * H;

    const selected = [...selectedColorIndices].map(i => paletteColors[i]);
    const counts = selected.map(() => 0);
    // precompute target RGB
    const targets = selected.map(c => hexToRgb(c.hex));
    const threshold = tol * 2.5;

    for (let p = 0; p < totalPx; p++) {
      const idx = p * 4;
      if (data[idx+3] < 128) continue;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      let bestDist = Infinity, bestI = -1;
      for (let ci = 0; ci < targets.length; ci++) {
        const [tr,tg,tb] = targets[ci];
        const d = colorDistance(r,g,b, tr,tg,tb);
        if (d < bestDist && d <= threshold) { bestDist = d; bestI = ci; }
      }
      if (bestI >= 0) counts[bestI]++;
    }

    document.getElementById('color-progress').style.display = 'none';
    renderColorResults(selected, counts, totalPx);
  }, 30);
}

function renderColorResults(colors, counts, totalPx) {
  computeScale();
  const unit = document.getElementById('unit').value;
  const list = document.getElementById('color-results-list');
  list.innerHTML = '';

  const total = counts.reduce((a,b) => a+b, 0);
  if (total === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px;">No matching pixels found.<br>Try increasing tolerance.</div>';
    return;
  }

  // header
  const hdr = document.createElement('div');
  hdr.className = 'color-results-header';
  hdr.innerHTML = '<span></span><span>Color</span><span>%</span><span>Pixels</span><span>Area</span>';
  list.appendChild(hdr);

  // sort by count descending
  const sorted = colors.map((c,i) => ({ c, count: counts[i] })).sort((a,b) => b.count - a.count);

  sorted.forEach(({ c, count }) => {
    if (count === 0) return;
    const pct = (count / totalPx * 100).toFixed(2);
    let areaStr;
    if (scale && unit !== 'px') {
      const realArea = count * scale * scale;
      areaStr = (realArea < 0.01 ? realArea.toExponential(2) : realArea.toFixed(3)) + ' ' + unit + '²';
    } else {
      areaStr = count.toLocaleString() + ' px²';
    }
    const row = document.createElement('div');
    row.className = 'color-result-row';
    row.innerHTML = `
      <div class="color-result-swatch" style="background:${c.hex};"></div>
      <div class="color-result-name">${c.name}</div>
      <div class="color-result-pct">${pct}%</div>
      <div class="color-result-px">${count.toLocaleString()}</div>
      <div class="color-result-area">${areaStr}</div>
    `;
    list.appendChild(row);
  });

  // summary footer
  const footer = document.createElement('div');
  footer.style = 'font-size:11px;color:var(--text-muted);text-align:center;padding:6px 0 2px;border-top:1px solid var(--border);margin-top:4px;';
  footer.textContent = `Matched ${total.toLocaleString()} px · ${(total/totalPx*100).toFixed(1)}% of image`;
  list.appendChild(footer);

  toast('Color analysis complete!');
}

function autoDetectColors() {
  if (!img) { toast('Load an image first.'); return; }
  toast('Detecting dominant colors…');
  setTimeout(() => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const oc = off.getContext('2d');
    oc.drawImage(img, 0, 0);
    const data = oc.getImageData(0, 0, W, H).data;
    const totalPx = W * H;

    // Sample every 8th pixel, quantize to 32-steps
    const buckets = {};
    for (let p = 0; p < totalPx; p += 8) {
      const idx = p * 4;
      if (data[idx+3] < 128) continue;
      const r = Math.round(data[idx]   / 32) * 32;
      const g = Math.round(data[idx+1] / 32) * 32;
      const b = Math.round(data[idx+2] / 32) * 32;
      const key = `${r},${g},${b}`;
      buckets[key] = (buckets[key] || 0) + 1;
    }

    const top = Object.entries(buckets).sort((a,b) => b[1]-a[1]).slice(0,8);

    selectedColorIndices.clear();
    top.forEach(([key]) => {
      const [r,g,b] = key.split(',').map(Number);
      const hex = '#' + [r,g,b].map(v => Math.min(255,v).toString(16).padStart(2,'0')).join('');
      const name = 'Auto ' + hex.toUpperCase();
      let found = paletteColors.findIndex(c => c.hex.toLowerCase() === hex.toLowerCase());
      if (found < 0) { paletteColors.push({ name, hex }); found = paletteColors.length - 1; }
      selectedColorIndices.add(found);
    });

    renderPaletteSwatches();
    toast(`Detected ${top.length} dominant colors. Press "Analyze" to measure.`);
  }, 30);
}

// initialise palette swatches on page load
renderPaletteSwatches();

// tolerance slider for color
document.getElementById('color-tolerance').addEventListener('input', function() {
  document.getElementById('color-tol-val').textContent = this.value;
});