import './style.css';

// ============================================================================
// 1. INITIALIZATION & DATABASE (INDEXED DB)
// ============================================================================
const DB_NAME = 'FastPhotoDB'; let db;
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('photos')) {
                const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
                photoStore.createIndex('folderId', 'folderId', { unique: false });
            }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
        request.onerror = (e) => reject(e);
    });
}
function dbPut(storeName, data) { return new Promise((res) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(data); tx.oncomplete = () => res(); }); }
function dbGetAll(storeName) { return new Promise((res) => { const tx = db.transaction(storeName, 'readonly'); const req = tx.objectStore(storeName).getAll(); req.onsuccess = () => res(req.result); }); }
function dbGetByIndex(storeName, indexName, value) { return new Promise((res) => { const tx = db.transaction(storeName, 'readonly'); const req = tx.objectStore(storeName).index(indexName).getAll(value); req.onsuccess = () => res(req.result); }); }
function dbDelete(storeName, id) { return new Promise((res) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(id); tx.oncomplete = () => res(); }); }

// ============================================================================
// 2. GLOBAL STATE & UI ELEMENTS
// ============================================================================
const workspace = document.getElementById('workspace');
const canvas = document.getElementById('photo-canvas'); const ctx = canvas.getContext('2d');
const offCanvas = document.createElement('canvas'); const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const histCanvas = document.getElementById('hist-canvas'); const histCtx = histCanvas.getContext('2d');
const zoomValDisp = document.getElementById('zoom-val'); const noPhotoMsg = document.getElementById('no-photo-msg');
const exifBar = document.getElementById('exif-bar');

let layers = []; let activeLayerIndex = -1; let history = []; let historyIndex = -1;
let scale = 1, panX = 0, panY = 0;
let isPanning = false, isSpacePressed = false, isDraggingLayer = false;
let startPan = {x:0, y:0}, startCoords = {x:0, y:0}, currentCoords = {x:0, y:0}, startLayerPos = {x:0, y:0};

let isCropMode = false, isCropDragging = false, isTextMode = false;
let isCloneMode = false, isCloning = false, cloneSource = null, cloneOffset = {dx:0, dy:0}, hoverCoords = null;
let isBrushMode = false, isBrushing = false;

let showShadowClipping = false; let showHighlightClipping = false; let isExporting = false;
let isSplitView = false; let splitPos = 0.5; let isDraggingSplit = false;

// NUOVO: Stato Batch Editing
let copiedSettings = null;

const s = {
    effOp: document.getElementById('effect-opacity-slider'), sharp: document.getElementById('sharpness-slider'),
    temp: document.getElementById('temp-slider'), tint: document.getElementById('tint-slider'),
    exp: document.getElementById('exposure-slider'), cont: document.getElementById('contrast-slider'),
    shadows: document.getElementById('shadows-slider'), high: document.getElementById('highlights-slider'),
    sat: document.getElementById('saturation-slider')
};
const v = {
    effOp: document.getElementById('effect-opacity-val'), sharp: document.getElementById('sharpness-val'),
    temp: document.getElementById('temp-val'), tint: document.getElementById('tint-val'),
    exp: document.getElementById('exposure-val'), cont: document.getElementById('contrast-val'),
    shadows: document.getElementById('shadows-val'), high: document.getElementById('highlights-val'),
    sat: document.getElementById('saturation-val')
};

// ============================================================================
// 3. COLOR MIX (HSL) STATE & UI
// ============================================================================
let hslState = {
    red: { h:0, s:0, l:0 }, orange: { h:0, s:0, l:0 }, yellow: { h:0, s:0, l:0 },
    green: { h:0, s:0, l:0 }, blue: { h:0, s:0, l:0 }, magenta: { h:0, s:0, l:0 }
};
document.getElementById('hsl-channel').onchange = (e) => {
    const ch = e.target.value;
    document.getElementById('hsl-h').value = hslState[ch].h; document.getElementById('hsl-s').value = hslState[ch].s; document.getElementById('hsl-l').value = hslState[ch].l;
    document.getElementById('hsl-h-val').textContent = hslState[ch].h; document.getElementById('hsl-s-val').textContent = hslState[ch].s; document.getElementById('hsl-l-val').textContent = hslState[ch].l;
};
['h', 's', 'l'].forEach(prop => {
    document.getElementById(`hsl-${prop}`).oninput = (e) => {
        const ch = document.getElementById('hsl-channel').value; hslState[ch][prop] = parseInt(e.target.value);
        document.getElementById(`hsl-${prop}-val`).textContent = e.target.value; updateBaseFilters();
    };
    document.getElementById(`hsl-${prop}`).onchange = () => saveHistory();
});

// ============================================================================
// 4. HISTORY MANAGEMENT (UNDO/REDO)
// ============================================================================
function saveHistory() {
    if (layers.length === 0) return;
    const state = layers.map(l => ({ ...l, imgData: l.workingCanvas ? l.workingCanvas.toDataURL() : l.img.src, workingCanvas: null }));
    history = history.slice(0, historyIndex + 1); history.push(JSON.stringify(state)); historyIndex++;
}
document.getElementById('undo-btn').onclick = () => { if (historyIndex > 0) { historyIndex--; loadHistoryState(); }};
document.getElementById('redo-btn').onclick = () => { if (historyIndex < history.length - 1) { historyIndex++; loadHistoryState(); }};
async function loadHistoryState() {
    const data = JSON.parse(history[historyIndex]);
    const promises = data.map(l => new Promise(res => { const img = new Image(); img.onload = () => { l.img = img; if(l.id === 'base') { l.workingCanvas = document.createElement('canvas'); l.workingCanvas.width = l.w; l.workingCanvas.height = l.h; l.workingCanvas.getContext('2d').drawImage(img, 0, 0); } res(l); }; img.src = l.imgData; }));
    layers = await Promise.all(promises); updateLayersUI(); updateBaseFilters();
}

// ============================================================================
// 5. BATCH EDITING (COPIA / INCOLLA IMPOSTAZIONI)
// ============================================================================
function copySettings() {
    copiedSettings = {
        s: { effOp: s.effOp.value, sharp: s.sharp.value, temp: s.temp.value, tint: s.tint.value, exp: s.exp.value, cont: s.cont.value, shadows: s.shadows.value, high: s.high.value, sat: s.sat.value },
        curve: { ...curvePoint },
        hsl: JSON.parse(JSON.stringify(hslState)),
        lut: activeLUT
    };
    
    // Feedback visivo rapido
    const btn = document.getElementById('copy-settings-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Copiato!`;
    btn.style.color = "#007aff";
    setTimeout(() => { btn.innerHTML = originalText; btn.style.color = "white"; }, 1500);
}

function pasteSettings() {
    if(!copiedSettings) return;
    const p = copiedSettings;
    s.effOp.value=p.s.effOp; s.sharp.value=p.s.sharp; s.temp.value=p.s.temp; s.tint.value=p.s.tint; s.exp.value=p.s.exp; s.cont.value=p.s.cont; s.shadows.value=p.s.shadows; s.high.value=p.s.high; s.sat.value=p.s.sat;
    curvePoint = { ...p.curve };
    hslState = JSON.parse(JSON.stringify(p.hsl));
    activeLUT = p.lut;
    
    const ch = document.getElementById('hsl-channel').value;
    document.getElementById('hsl-h').value = hslState[ch].h; document.getElementById('hsl-s').value = hslState[ch].s; document.getElementById('hsl-l').value = hslState[ch].l;
    document.getElementById('hsl-h-val').textContent = hslState[ch].h; document.getElementById('hsl-s-val').textContent = hslState[ch].s; document.getElementById('hsl-l-val').textContent = hslState[ch].l;
    Object.keys(s).forEach(k => { if(s[k] && v[k]) v[k].textContent = s[k].value + (k==='sat'?'%':''); });
    
    if(activeLUT) { document.getElementById('remove-lut-btn').style.display = 'block'; } 
    else { document.getElementById('remove-lut-btn').style.display = 'none'; }

    drawCurveGraph(); updateBaseFilters(); saveHistory();

    const btn = document.getElementById('paste-settings-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Fatto!`;
    btn.style.color = "#007aff";
    setTimeout(() => { btn.innerHTML = originalText; btn.style.color = "white"; }, 1500);
}

document.getElementById('copy-settings-btn').onclick = copySettings;
document.getElementById('paste-settings-btn').onclick = pasteSettings;

// ============================================================================
// 6. TONE CURVES
// ============================================================================
const curveCanvas = document.getElementById('curve-canvas'); const curveCtx = curveCanvas.getContext('2d');
function drawCurveGraph() {
    curveCtx.clearRect(0, 0, 256, 256); curveCtx.strokeStyle = '#333'; curveCtx.lineWidth = 1;
    for(let i=1; i<4; i++) { curveCtx.beginPath(); curveCtx.moveTo(i*64, 0); curveCtx.lineTo(i*64, 256); curveCtx.stroke(); curveCtx.beginPath(); curveCtx.moveTo(0, i*64); curveCtx.lineTo(256, i*64); curveCtx.stroke(); }
    curveCtx.beginPath(); curveCtx.moveTo(0, 256);
    const cx = 2 * curvePoint.x - 128; const cy = 2 * curvePoint.y - 128;
    curveCtx.quadraticCurveTo(cx, cy, 256, 0); curveCtx.strokeStyle = '#007aff'; curveCtx.lineWidth = 2; curveCtx.stroke();
    curveCtx.beginPath(); curveCtx.arc(curvePoint.x, curvePoint.y, 6, 0, Math.PI*2); curveCtx.fillStyle = 'white'; curveCtx.fill(); curveCtx.strokeStyle = '#000'; curveCtx.stroke();
    for(let i=0; i<256; i++) { let t = i / 255; let val = Math.pow(1-t, 2)*256 + 2*(1-t)*t*cy; curveLUT[i] = Math.max(0, Math.min(255, 256 - val)); }
}
drawCurveGraph();
curveCanvas.onmousedown = () => isDraggingCurve = true;
window.addEventListener('mousemove', (e) => {
    if(isDraggingCurve) {
        const rect = curveCanvas.getBoundingClientRect();
        curvePoint.x = Math.max(0, Math.min(256, (e.clientX - rect.left) * (256/rect.width))); curvePoint.y = Math.max(0, Math.min(256, (e.clientY - rect.top) * (256/rect.height)));
        drawCurveGraph(); updateBaseFilters();
    }
});
window.addEventListener('mouseup', () => isDraggingCurve = false);

// ============================================================================
// 7. CUSTOM PRESETS & LUTs (.cube)
// ============================================================================
function renderCustomPresets() {
    const grid = document.getElementById('custom-presets-grid'); grid.innerHTML = '';
    customPresets.forEach((p, index) => {
        const btn = document.createElement('button'); btn.className = 'preset-card'; btn.style.borderColor = '#007aff'; btn.innerHTML = `<i class="fa-solid fa-star"></i> ${p.name}`;
        btn.onclick = () => { 
            s.effOp.value=p.s.effOp; s.sharp.value=p.s.sharp; s.temp.value=p.s.temp; s.tint.value=p.s.tint; s.exp.value=p.s.exp; s.cont.value=p.s.cont; s.shadows.value=p.s.shadows; s.high.value=p.s.high; s.sat.value=p.s.sat; 
            curvePoint = { ...p.curve }; 
            hslState = p.hsl ? JSON.parse(JSON.stringify(p.hsl)) : { red:{h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} };
            const ch = document.getElementById('hsl-channel').value; document.getElementById('hsl-h').value = hslState[ch].h; document.getElementById('hsl-s').value = hslState[ch].s; document.getElementById('hsl-l').value = hslState[ch].l; document.getElementById('hsl-h-val').textContent = hslState[ch].h; document.getElementById('hsl-s-val').textContent = hslState[ch].s; document.getElementById('hsl-l-val').textContent = hslState[ch].l;
            Object.keys(s).forEach(k => { if(s[k] && v[k]) v[k].textContent = s[k].value + (k==='sat'?'%':''); }); 
            drawCurveGraph(); updateBaseFilters(); saveHistory(); 
        };
        btn.oncontextmenu = (e) => { e.preventDefault(); if(confirm(`Eliminare il preset "${p.name}"?`)) { customPresets.splice(index, 1); localStorage.setItem('fastphoto_presets', JSON.stringify(customPresets)); renderCustomPresets(); } };
        grid.appendChild(btn);
    });
}
renderCustomPresets();
document.getElementById('save-preset-btn').onclick = () => { const name = prompt("Nome del filtro:"); if(!name) return; const preset = { name, s: { effOp: s.effOp.value, sharp: s.sharp.value, temp: s.temp.value, tint: s.tint.value, exp: s.exp.value, cont: s.cont.value, shadows: s.shadows.value, high: s.high.value, sat: s.sat.value }, curve: { ...curvePoint }, hsl: JSON.parse(JSON.stringify(hslState)) }; customPresets.push(preset); localStorage.setItem('fastphoto_presets', JSON.stringify(customPresets)); renderCustomPresets(); };
document.getElementById('lut-upload').onchange = (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = (ev) => {
        const text = ev.target.result; const lines = text.split('\n'); let size = 0; let data = [];
        for(let line of lines) { line = line.trim(); if(!line || line.startsWith('#')) continue; if(line.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(' ')[1]); else if(/^[0-9.-]/.test(line)) { const parts = line.split(/\s+/).map(Number); if(parts.length === 3) data.push(parts[0], parts[1], parts[2]); } }
        if(size > 0 && data.length > 0) { activeLUT = { size, data, name: file.name }; document.getElementById('remove-lut-btn').style.display = 'block'; updateBaseFilters(); saveHistory(); }
    }; reader.readAsText(file); e.target.value = "";
};
document.getElementById('remove-lut-btn').onclick = () => { activeLUT = null; document.getElementById('remove-lut-btn').style.display = 'none'; updateBaseFilters(); saveHistory(); };

// ============================================================================
// 8. CORE IMAGE PROCESSING (RAW DEV ENGINE + HSL + CLIPPING)
// ============================================================================
function applySharpen(data, w, h, amount) {
    if (amount <= 0) return data; const weights = [0, -amount, 0, -amount, 1 + amount * 4, -amount, 0, -amount, 0]; const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; let r=0, g=0, b=0; for (let cy=0; cy<3; cy++) { for (let cx=0; cx<3; cx++) { const iy = Math.min(h-1, Math.max(0, y + cy - 1)); const ix = Math.min(w-1, Math.max(0, x + cx - 1)); const srcI = (iy * w + ix) * 4; const wt = weights[cy * 3 + cx]; r += data[srcI] * wt; g += data[srcI+1] * wt; b += data[srcI+2] * wt; } } out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=data[i+3]; } } return out;
}

function updateBaseFilters() {
    if (layers.length === 0) return;
    const base = layers[0]; const tCanvas = document.createElement('canvas'); tCanvas.width = base.w; tCanvas.height = base.h; const tCtx = tCanvas.getContext('2d'); tCtx.drawImage(base.workingCanvas || base.img, 0, 0);
    let imgData = tCtx.getImageData(0, 0, base.w, base.h); let data = imgData.data;
    
    const effOp = parseInt(s.effOp?.value || 100) / 100, sharp = parseInt(s.sharp?.value || 0) / 100, temp = parseInt(s.temp?.value || 0), tint = parseInt(s.tint?.value || 0), exp = parseInt(s.exp?.value || 0), cont = parseInt(s.cont?.value || 0), shadows = parseInt(s.shadows?.value || 0), high = parseInt(s.high?.value || 0), sat = parseInt(s.sat?.value || 100) / 100, factor = (259 * (cont + 255)) / (255 * (259 - cont)), lutSize = activeLUT ? activeLUT.size - 1 : 0;
    
    let applyHsl = false; const activeHsl = []; const targets = [0, 30, 60, 120, 240, 300]; const keys = ['red', 'orange', 'yellow', 'green', 'blue', 'magenta'];
    for(let j=0; j<6; j++) { let ch = hslState[keys[j]]; if(ch.h!==0 || ch.s!==0 || ch.l!==0) { applyHsl = true; activeHsl.push({ th: targets[j], dh: ch.h * 0.5, ds: ch.s/100, dl: ch.l/100 }); } }

    for (let i = 0; i < data.length; i += 4) {
        
        // 3D LUT
        if(activeLUT) { let cr = Math.max(0, Math.min(255, data[i])); let cg = Math.max(0, Math.min(255, data[i+1])); let cb = Math.max(0, Math.min(255, data[i+2])); let bx = Math.round((cr / 255) * lutSize); let by = Math.round((cg / 255) * lutSize); let bz = Math.round((cb / 255) * lutSize); let idx = (bz * activeLUT.size * activeLUT.size + by * activeLUT.size + bx) * 3; data[i] = activeLUT.data[idx] * 255; data[i+1] = activeLUT.data[idx+1] * 255; data[i+2] = activeLUT.data[idx+2] * 255; }
        
        // Curve
        data[i] = curveLUT[data[i]]; data[i+1] = curveLUT[data[i+1]]; data[i+2] = curveLUT[data[i+2]];
        
        // HSL
        if (applyHsl) {
            let r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
            let max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h = 0, s_hsl = 0, l = (max + min) / 2;
            if (max !== min) {
                let d = max - min; s_hsl = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
                h /= 6;
            }
            h *= 360;
            if (s_hsl > 0.05 && l > 0.02 && l < 0.98) {
                let sh = 0, ss = 0, sl = 0;
                for(let j=0; j<activeHsl.length; j++) {
                    let a = activeHsl[j]; let dist = Math.abs(h - a.th); if (dist > 180) dist = 360 - dist;
                    if (dist < 45) { let w = 1 - (dist / 45); sh += a.dh * w; ss += a.ds * w; sl += a.dl * w; }
                }
                if (sh !== 0 || ss !== 0 || sl !== 0) {
                    h = (h + sh + 360) % 360; s_hsl = Math.max(0, Math.min(1, s_hsl + ss)); l = Math.max(0, Math.min(1, l + sl));
                    h /= 360; let q = l < 0.5 ? l * (1 + s_hsl) : l + s_hsl - l * s_hsl; let p = 2 * l - q;
                    let tr = h + 1/3, tg = h, tb = h - 1/3;
                    if(tr < 0) tr+=1; else if(tr > 1) tr-=1; if(tg < 0) tg+=1; else if(tg > 1) tg-=1; if(tb < 0) tb+=1; else if(tb > 1) tb-=1;
                    data[i] = (tr < 1/6 ? p + (q-p)*6*tr : tr < 1/2 ? q : tr < 2/3 ? p + (q-p)*(2/3-tr)*6 : p)*255;
                    data[i+1] = (tg < 1/6 ? p + (q-p)*6*tg : tg < 1/2 ? q : tg < 2/3 ? p + (q-p)*(2/3-tg)*6 : p)*255;
                    data[i+2] = (tb < 1/6 ? p + (q-p)*6*tb : tb < 1/2 ? q : tb < 2/3 ? p + (q-p)*(2/3-tb)*6 : p)*255;
                }
            }
        }

        // Sviluppo
        data[i] += temp + exp; data[i+1] += tint + exp; data[i+2] += exp - temp; data[i] = factor * (data[i] - 128) + 128; data[i+1] = factor * (data[i+1] - 128) + 128; data[i+2] = factor * (data[i+2] - 128) + 128;
        data[i]=Math.min(255,Math.max(0,data[i])); data[i+1]=Math.min(255,Math.max(0,data[i+1])); data[i+2]=Math.min(255,Math.max(0,data[i+2]));
        
        let lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
        if (shadows !== 0 && lum < 128) { let m = (128-lum)/128; data[i]+=shadows*m; data[i+1]+=shadows*m; data[i+2]+=shadows*m; }
        if (high !== 0 && lum > 128) { let m = (lum-128)/127; data[i]-=high*m; data[i+1]-=high*m; data[i+2]-=high*m; }
        lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]; data[i]=lum+(data[i]-lum)*sat; data[i+1]=lum+(data[i+1]-lum)*sat; data[i+2]=lum+(data[i+2]-lum)*sat;

        // Avvisi di Clipping
        if (!isExporting) {
            if (showShadowClipping && data[i] <= 2 && data[i+1] <= 2 && data[i+2] <= 2) {
                data[i] = 0; data[i+1] = 0; data[i+2] = 255; 
            } else if (showHighlightClipping && data[i] >= 253 && data[i+1] >= 253 && data[i+2] >= 253) {
                data[i] = 255; data[i+1] = 0; data[i+2] = 0; 
            }
        }
    }

    if (sharp > 0) { const sharpened = applySharpen(data, base.w, base.h, sharp); imgData.data.set(sharpened); }
    tCtx.putImageData(imgData, 0, 0); offCanvas.width = base.w; offCanvas.height = base.h; offCtx.clearRect(0,0,base.w,base.h); offCtx.drawImage(base.workingCanvas || base.img, 0, 0); offCtx.globalAlpha = effOp; offCtx.drawImage(tCanvas, 0, 0); offCtx.globalAlpha = 1.0;
    
    drawHistogram(offCtx.getImageData(0,0,base.w,base.h).data); renderCanvas();
}

function drawHistogram(data) { histCtx.clearRect(0,0,310,80); let lums = new Array(256).fill(0); for(let i=0; i<data.length; i+=4) lums[Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])]++; let max = Math.max(...lums); histCtx.fillStyle = '#666'; for(let i=0; i<256; i++) histCtx.fillRect(i*(310/256), 80-(lums[i]/max)*80, 1, (lums[i]/max)*80); }

document.getElementById('clip-shadows-btn').onclick = function() { showShadowClipping = !showShadowClipping; this.style.background = showShadowClipping ? '#007aff' : 'transparent'; this.style.color = showShadowClipping ? '#fff' : '#007aff'; updateBaseFilters(); };
document.getElementById('clip-highlights-btn').onclick = function() { showHighlightClipping = !showHighlightClipping; this.style.background = showHighlightClipping ? '#ff3b30' : 'transparent'; this.style.color = showHighlightClipping ? '#fff' : '#ff3b30'; updateBaseFilters(); };


// ============================================================================
// 9. RENDERING & CANVAS INTERACTION (CON SPLIT VIEW)
// ============================================================================
function drawLayersToCtx(context) {
    context.save(); context.translate(panX, panY); context.scale(scale, scale);
    layers.forEach((l, i) => { 
        if (!l.visible) return; context.save(); 
        if (i === 0) context.drawImage(offCanvas, l.x, l.y, l.w, l.h); 
        else { context.globalAlpha = l.opacity || 1; context.globalCompositeOperation = l.blendMode || 'source-over'; context.drawImage(l.img, l.x, l.y, l.w, l.h); } 
        context.restore(); 
        if (i === activeLayerIndex && i !== 0 && !isSplitView) { context.strokeStyle = '#007aff'; context.lineWidth = 2/scale; context.strokeRect(l.x, l.y, l.w, l.h); } 
    });
    if (isCropMode && (isCropDragging || Math.abs(currentCoords.x - startCoords.x) > 5)) { context.strokeStyle = '#007aff'; context.lineWidth = 2/scale; context.setLineDash([5/scale, 5/scale]); context.strokeRect(startCoords.x, startCoords.y, currentCoords.x - startCoords.x, currentCoords.y - startCoords.y); }
    if ((isCloneMode || isBrushMode) && hoverCoords && layers.length > 0 && !isSplitView) { const brush = isCloneMode ? parseInt(document.getElementById('clone-size').value) : parseInt(document.getElementById('brush-size').value); context.beginPath(); context.arc(hoverCoords.x, hoverCoords.y, brush, 0, Math.PI*2); context.strokeStyle = 'rgba(255,255,255,0.8)'; context.lineWidth = 1.5/scale; context.stroke(); if (isCloneMode && cloneSource) { let sx = cloneSource.x, sy = cloneSource.y; if (isCloning) { sx = hoverCoords.x + cloneOffset.dx; sy = hoverCoords.y + cloneOffset.dy; } context.beginPath(); context.arc(sx, sy, brush, 0, Math.PI*2); context.strokeStyle = 'rgba(0,122,255,0.8)'; context.lineWidth = 1.5/scale; context.stroke(); context.beginPath(); context.moveTo(sx - 5/scale, sy); context.lineTo(sx + 5/scale, sy); context.moveTo(sx, sy - 5/scale); context.lineTo(sx, sy + 5/scale); context.stroke(); } }
    context.restore();
}

function renderCanvas() {
    if (layers.length === 0) return; 
    ctx.clearRect(0, 0, canvas.width, canvas.height); 

    if (isSplitView) {
        const lineX = canvas.width * splitPos;
        
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, lineX, canvas.height); ctx.clip();
        ctx.translate(panX, panY); ctx.scale(scale, scale);
        ctx.drawImage(layers[0].workingCanvas || layers[0].img, layers[0].x, layers[0].y, layers[0].w, layers[0].h);
        ctx.restore();

        ctx.save(); ctx.beginPath(); ctx.rect(lineX, 0, canvas.width, canvas.height); ctx.clip();
        drawLayersToCtx(ctx); ctx.restore();

        ctx.fillStyle = '#fff'; ctx.fillRect(lineX - 1, 0, 2, canvas.height);
        ctx.beginPath(); ctx.arc(lineX, canvas.height / 2, 14, 0, Math.PI*2);
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 5; ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#333'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('< >', lineX, canvas.height / 2);
    } else { drawLayersToCtx(ctx); }
}

document.getElementById('split-view-btn').onclick = function() {
    isSplitView = !isSplitView; this.style.color = isSplitView ? '#007aff' : 'white';
    splitPos = 0.5; if(isSplitView) { isCropMode=false; isCloneMode=false; isBrushMode=false; isTextMode=false; } renderCanvas();
};

function getRealCoords(e) { const rect = canvas.getBoundingClientRect(); const x = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left; const y = (e.clientY || (e.touches ? e.touches[0].clientY : 0)) - rect.top; return { x: (x - panX) / scale, y: (y - panY) / scale }; }
function fitToScreen() { if (layers.length === 0) return; const base = layers[0]; const sX = (workspace.clientWidth - 40) / base.w, sY = (workspace.clientHeight - 40) / base.h; scale = Math.min(sX, sY, 1); panX = (workspace.clientWidth - base.w * scale) / 2; panY = (workspace.clientHeight - base.h * scale) / 2; zoomValDisp.textContent = Math.round(scale * 100) + '%'; renderCanvas(); }
canvas.onwheel = (e) => { e.preventDefault(); const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const oldScale = scale; scale *= (e.deltaY < 0 ? 1.1 : 0.9); scale = Math.max(0.05, Math.min(scale, 10)); panX = mx - (mx - panX) * (scale / oldScale); panY = my - (my - panY) * (scale / oldScale); zoomValDisp.textContent = Math.round(scale * 100) + '%'; renderCanvas(); };

function applyCloneStroke(coords) { if(!layers[0].workingCanvas) return; const ctxW = layers[0].workingCanvas.getContext('2d'); const brush = parseInt(document.getElementById('clone-size').value); const sx = coords.x + cloneOffset.dx; const sy = coords.y + cloneOffset.dy; ctxW.save(); ctxW.beginPath(); ctxW.arc(coords.x, coords.y, brush, 0, Math.PI*2); ctxW.clip(); ctxW.drawImage(layers[0].workingCanvas, sx - brush, sy - brush, brush*2, brush*2, coords.x - brush, coords.y - brush, brush*2, brush*2); ctxW.restore(); updateBaseFilters(); }
function applyBrushStroke(coords) { if(!layers[0].workingCanvas) return; const ctxW = layers[0].workingCanvas.getContext('2d'); const mode = document.getElementById('brush-mode').value; const brush = parseInt(document.getElementById('brush-size').value); const flow = parseInt(document.getElementById('brush-flow').value) / 100; ctxW.save(); const grad = ctxW.createRadialGradient(coords.x, coords.y, 0, coords.x, coords.y, brush); if(mode === 'dodge') { grad.addColorStop(0, `rgba(255,255,255,${flow})`); grad.addColorStop(1, 'rgba(255,255,255,0)'); ctxW.globalCompositeOperation = 'soft-light'; } if(mode === 'burn') { grad.addColorStop(0, `rgba(0,0,0,${flow})`); grad.addColorStop(1, 'rgba(0,0,0,0)'); ctxW.globalCompositeOperation = 'soft-light'; } ctxW.fillStyle = grad; ctxW.beginPath(); ctxW.arc(coords.x, coords.y, brush, 0, Math.PI*2); ctxW.fill(); ctxW.restore(); updateBaseFilters(); }

canvas.onmousedown = (e) => {
    if (layers.length === 0) return; 
    const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left; const coords = getRealCoords(e);
    if (isSplitView && Math.abs(mouseX - canvas.width * splitPos) < 20) { isDraggingSplit = true; return; }
    if (isSpacePressed || e.button === 1) { isPanning = true; startPan = { x: e.clientX - panX, y: e.clientY - panY }; return; }
    if (isCloneMode && !isSplitView) { if (e.altKey) { cloneSource = {...coords}; renderCanvas(); return; } if (cloneSource) { isCloning = true; cloneOffset = { dx: cloneSource.x - coords.x, dy: cloneSource.y - coords.y }; applyCloneStroke(coords); } return; }
    if (isBrushMode && !isSplitView) { isBrushing = true; applyBrushStroke(coords); return; }
    if (isTextMode && !isSplitView) { const txt = document.getElementById('watermark-text').value; if (!txt) return; const t = document.createElement('canvas'); t.width = layers[0].w; t.height = layers[0].h; const tc = t.getContext('2d'); tc.drawImage(layers[0].workingCanvas || layers[0].img, 0, 0); tc.font = "bold 60px sans-serif"; tc.fillStyle = document.getElementById('watermark-color').value; tc.fillText(txt, coords.x, coords.y); layers[0].workingCanvas = t; saveHistory(); updateBaseFilters(); isTextMode = false; document.getElementById('text-btn').classList.remove('active-action'); return; }
    if (isCropMode && !isSplitView) { isCropDragging = true; startCoords = coords; return; }
    if (activeLayerIndex > 0 && !isSplitView) { const l = layers[activeLayerIndex]; if (coords.x >= l.x && coords.x <= l.x + l.w && coords.y >= l.y && coords.y <= l.y + l.h) { isDraggingLayer = true; startLayerPos = { mx: coords.x, my: coords.y, lx: l.x, ly: l.y }; } }
};

window.onmousemove = (e) => { 
    const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left; hoverCoords = getRealCoords(e); 
    if (isSplitView) { if (Math.abs(mouseX - canvas.width * splitPos) < 20) canvas.style.cursor = 'ew-resize'; else if (!isSpacePressed) canvas.style.cursor = 'default'; }
    if (isDraggingSplit) { splitPos = Math.max(0, Math.min(1, mouseX / canvas.width)); renderCanvas(); return; }
    if (isPanning) { panX = e.clientX - startPan.x; panY = e.clientY - startPan.y; renderCanvas(); } 
    else if (isCloning) { applyCloneStroke(hoverCoords); } 
    else if (isBrushing) { applyBrushStroke(hoverCoords); } 
    else if (isDraggingLayer) { const l = layers[activeLayerIndex]; l.x = startLayerPos.lx + (hoverCoords.x - startLayerPos.mx); l.y = startLayerPos.ly + (hoverCoords.y - startLayerPos.my); renderCanvas(); } 
    else if (isCropDragging) { currentCoords = hoverCoords; renderCanvas(); } 
    else if (isCloneMode || isBrushMode) { renderCanvas(); } 
};
window.onmouseup = () => { if(isCloning || isBrushing) { saveHistory(); } isPanning = isDraggingLayer = isCropDragging = isCloning = isBrushing = isDraggingSplit = false; };

// ============================================================================
// 10. PROJECT LIBRARY & LOAD LOGIC
// ============================================================================
let currentFolderId = null; const libPanel = document.getElementById('library-panel');
document.getElementById('toggle-library-btn').onclick = () => { libPanel.style.display = libPanel.style.display === 'none' ? 'flex' : 'none'; };
async function loadFolders() { const folders = await dbGetAll('folders'); const list = document.getElementById('folders-list'); list.innerHTML = ''; folders.forEach(f => { const div = document.createElement('div'); div.className = 'folder-item'; div.innerHTML = `<i class="fa-solid fa-folder"></i> <span>${f.name}</span> <i class="fa-solid fa-trash" style="margin-left:auto; color:#ff3b30; font-size:0.8rem;" title="Elimina"></i>`; div.querySelector('.fa-trash').onclick = async (e) => { e.stopPropagation(); if(confirm(`Eliminare la cartella "${f.name}"?`)) { const photos = await dbGetByIndex('photos', 'folderId', f.id); for(let p of photos) await dbDelete('photos', p.id); await dbDelete('folders', f.id); loadFolders(); } }; div.onclick = () => openFolder(f.id, f.name); list.appendChild(div); }); }
document.getElementById('new-folder-btn').onclick = async () => { const name = prompt("Nome della cartella:"); if(name) { await dbPut('folders', { id: Date.now().toString(), name }); loadFolders(); } };
async function openFolder(id, name) { currentFolderId = id; document.getElementById('folders-list').style.display = 'none'; document.querySelector('.library-header').style.display = 'none'; document.getElementById('active-folder-view').style.display = 'block'; document.getElementById('current-folder-name').textContent = name; loadPhotosInFolder(); }
document.getElementById('back-folders-btn').onclick = () => { currentFolderId = null; document.getElementById('active-folder-view').style.display = 'none'; document.getElementById('folders-list').style.display = 'flex'; document.querySelector('.library-header').style.display = 'flex'; };
async function loadPhotosInFolder() { if(!currentFolderId) return; const photos = await dbGetByIndex('photos', 'folderId', currentFolderId); const grid = document.getElementById('folder-photos-grid'); grid.innerHTML = ''; photos.forEach(p => { const img = document.createElement('img'); img.className = 'photo-thumb'; img.src = p.thumb || p.data; img.onclick = () => loadToApp(p.data); grid.appendChild(img); }); }

document.getElementById('upload-to-folder').onchange = async (e) => {
    if(!currentFolderId) return; const files = e.target.files;
    for(let file of files) {
        let src = ''; let thumb = ''; const isRaw = file.name.toLowerCase().match(/\.(rw2|cr2|nef|arw)$/);
        if(isRaw) { try { src = await exifr.thumbnailUrl(file); thumb = src; } catch(e) { continue; } } else { src = await new Promise(res => { const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file); }); const tC = document.createElement('canvas'); tC.width=150; tC.height=150; const tCtx = tC.getContext('2d'); const tmpI = new Image(); tmpI.src = src; await new Promise(r => tmpI.onload=r); tCtx.drawImage(tmpI, 0, 0, 150, 150); thumb = tC.toDataURL('image/jpeg', 0.5); }
        await dbPut('photos', { id: Date.now().toString()+Math.random(), folderId: currentFolderId, name: file.name, data: src, thumb: thumb });
    }
    loadPhotosInFolder(); e.target.value = "";
};

document.getElementById('upload-btn').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const exifData = await exifr.parse(file, {tiff: true, ifd0: true, exif: true}); if(exifData) { exifBar.style.display = 'flex'; document.getElementById('exif-camera').innerHTML = `<i class="fa-solid fa-camera"></i> ${exifData.Make || ''} ${exifData.Model || 'Camera'} `; const fNum = exifData.FNumber ? `f/${exifData.FNumber}` : ''; const expTime = exifData.ExposureTime ? `1/${Math.round(1/exifData.ExposureTime)}s` : ''; const iso = exifData.ISO ? `ISO ${exifData.ISO}` : ''; document.getElementById('exif-settings').innerHTML = `<i class="fa-solid fa-sliders"></i> ${fNum} | ${expTime} | ${iso}`; } } catch(err) { exifBar.style.display = 'none'; }
    let targetSrc = ''; const isRaw = file.name.toLowerCase().match(/\.(rw2|cr2|nef|arw)$/);
    if (isRaw) { try { targetSrc = await exifr.thumbnailUrl(file); if(!targetSrc) throw new Error(); } catch(err) { alert("Impossibile estrarre RAW."); return; } } else { targetSrc = URL.createObjectURL(file); }
    loadToApp(targetSrc); e.target.value = "";
};

function loadToApp(src) {
    const img = new Image(); img.onload = () => { const wCanvas = document.createElement('canvas'); wCanvas.width = img.width; wCanvas.height = img.height; wCanvas.getContext('2d').drawImage(img, 0, 0); layers = [{ id: 'base', img, workingCanvas: wCanvas, w: img.width, h: img.height, x: 0, y: 0, visible: true, name: "Sfondo", opacity: 1, blendMode: 'source-over' }]; activeLayerIndex = 0; canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight; noPhotoMsg.style.display = 'none'; canvas.style.display = 'block'; document.querySelector('.zoom-bar').style.display = 'flex'; saveHistory(); updateBaseFilters(); fitToScreen(); updateLayersUI(); }; img.src = src;
}

// ============================================================================
// 11. UI BINDINGS, SHORTCUTS E ESPORTAZIONE
// ============================================================================
function toggleTool(btn, set, flag) { isCropMode=isTextMode=isCloneMode=isBrushMode=false; document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active-action')); document.getElementById('clone-settings').style.display='none'; document.getElementById('brush-settings').style.display='none'; canvas.style.cursor='default'; if(flag) { btn.classList.add('active-action'); if(set) document.getElementById(set).style.display='block'; canvas.style.cursor='crosshair'; } }
document.getElementById('zoom-in').onclick = () => { scale *= 1.2; zoomValDisp.textContent = Math.round(scale*100)+'%'; renderCanvas(); }; document.getElementById('zoom-out').onclick = () => { scale /= 1.2; zoomValDisp.textContent = Math.round(scale*100)+'%'; renderCanvas(); };
document.getElementById('clone-btn').onclick = () => { isSplitView=false; isCloneMode = !isCloneMode; toggleTool(document.getElementById('clone-btn'), 'clone-settings', isCloneMode); if(!isCloneMode) cloneSource = null; renderCanvas(); }; document.getElementById('clone-size').oninput = (e) => { document.getElementById('clone-size-val').textContent = e.target.value + 'px'; renderCanvas(); };
document.getElementById('brush-btn').onclick = () => { isSplitView=false; isBrushMode = !isBrushMode; toggleTool(document.getElementById('brush-btn'), 'brush-settings', isBrushMode); renderCanvas(); }; document.getElementById('brush-size').oninput = (e) => { document.getElementById('brush-size-val').textContent = e.target.value + 'px'; renderCanvas(); }; document.getElementById('brush-flow').oninput = (e) => { document.getElementById('brush-flow-val').textContent = e.target.value + '%'; };
document.getElementById('rotate-btn').onclick = () => { if(layers.length===0) return; const t = document.createElement('canvas'); t.width = layers[0].h; t.height = layers[0].w; const tc = t.getContext('2d'); tc.translate(t.width/2, t.height/2); tc.rotate(Math.PI/2); tc.drawImage(layers[0].workingCanvas || layers[0].img, -layers[0].w/2, -layers[0].h/2); layers[0].workingCanvas = t; layers[0].w = t.width; layers[0].h = t.height; saveHistory(); updateBaseFilters(); fitToScreen(); };
document.getElementById('crop-btn').onclick = () => { isSplitView=false; isCropMode = !isCropMode; toggleTool(document.getElementById('crop-btn'), null, isCropMode); if (!isCropMode && Math.abs(currentCoords.x - startCoords.x) > 20) { const x = Math.min(startCoords.x, currentCoords.x), y = Math.min(startCoords.y, currentCoords.y), w = Math.abs(currentCoords.x - startCoords.x), h = Math.abs(currentCoords.y - startCoords.y); const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').drawImage(layers[0].workingCanvas || layers[0].img, x, y, w, h, 0, 0, w, h); layers[0].workingCanvas = t; layers[0].w = w; layers[0].h = h; saveHistory(); updateBaseFilters(); fitToScreen(); } };
document.getElementById('text-btn').onclick = () => { isSplitView=false; isTextMode = !isTextMode; toggleTool(document.getElementById('text-btn'), null, isTextMode); canvas.style.cursor = isTextMode ? 'text' : 'default'; };

const exportModal = document.getElementById('export-modal');
document.getElementById('open-export-btn').onclick = () => { if (layers.length === 0) return; exportModal.style.display = 'flex'; updateExportStats(); };
document.getElementById('close-export').onclick = () => exportModal.style.display = 'none';
function updateExportStats() { const scaleFac = document.getElementById('export-scale').value / 100; const w = Math.round(layers[0].w * scaleFac); const h = Math.round(layers[0].h * scaleFac); document.getElementById('export-res-info').textContent = `Risoluzione: ${w} x ${h} px`; let usage = "Stampa / Archivio"; if (scaleFac < 0.6) usage = "Social / Web"; else if (scaleFac < 0.9) usage = "Portfolio"; document.getElementById('export-usage-info').textContent = `Destinazione: ${usage}`; document.getElementById('export-quality-val').textContent = document.getElementById('export-quality').value + '%'; document.getElementById('export-scale-val').textContent = document.getElementById('export-scale').value + '%'; document.getElementById('quality-group').style.opacity = document.getElementById('export-format').value === 'image/png' ? '0.3' : '1'; }
document.getElementById('export-quality').oninput = updateExportStats; document.getElementById('export-scale').oninput = updateExportStats; document.getElementById('export-format').onchange = updateExportStats;

document.getElementById('confirm-export-btn').onclick = () => {
    const format = document.getElementById('export-format').value; const quality = document.getElementById('export-quality').value / 100; const scaleFac = document.getElementById('export-scale').value / 100;
    isExporting = true; updateBaseFilters();
    const eCanvas = document.createElement('canvas'); eCanvas.width = layers[0].w * scaleFac; eCanvas.height = layers[0].h * scaleFac; const eCtx = eCanvas.getContext('2d'); eCtx.scale(scaleFac, scaleFac);
    layers.forEach((l, i) => { if(!l.visible) return; eCtx.save(); if(i === 0) eCtx.drawImage(offCanvas, 0, 0); else { eCtx.globalAlpha = l.opacity; eCtx.globalCompositeOperation = l.blendMode; eCtx.drawImage(l.img, l.x, l.y, l.w, l.h); } eCtx.restore(); });
    isExporting = false; updateBaseFilters();
    eCanvas.toBlob((blob) => {
        if (!blob) { alert("Errore di memoria. Prova a ridurre la scala."); return; }
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); let ext = format.split('/')[1]; if (ext === 'jpeg') ext = 'jpg';
        link.download = `FastPhoto_Pro_G97.${ext}`; link.href = url; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); exportModal.style.display = 'none';
    }, format, quality);
};

document.querySelectorAll('.preset-card').forEach(b => { b.onclick = (e) => { const p = e.target.dataset.preset; if (p==='normal') { s.effOp.value=100; s.temp.value=0; s.tint.value=0; s.exp.value=0; s.cont.value=0; s.shadows.value=0; s.high.value=0; s.sat.value=100; s.sharp.value=0; curvePoint={x:128, y:128}; hslState = { red:{h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} }; } if (p==='vintage') { s.effOp.value=100; s.temp.value=15; s.tint.value=10; s.exp.value=5; s.cont.value=-10; s.shadows.value=15; s.high.value=-10; s.sat.value=80; s.sharp.value=15; curvePoint={x:128, y:100}; hslState = { red:{h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} }; } if (p==='cinematic') { s.effOp.value=100; s.temp.value=-10; s.tint.value=5; s.exp.value=-5; s.cont.value=20; s.shadows.value=20; s.high.value=5; s.sat.value=90; s.sharp.value=25; curvePoint={x:128, y:150}; hslState = { red:{h:0,s:0,l:0}, orange:{h:10,s:20,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:-20,l:0}, blue:{h:-10,s:30,l:0}, magenta:{h:0,s:0,l:0} }; } if (p==='bw') { s.effOp.value=100; s.sat.value=0; s.exp.value=5; s.sharp.value=30; s.cont.value=15; s.shadows.value=0; s.high.value=0; s.temp.value=0; s.tint.value=0; curvePoint={x:128, y:120}; hslState = { red:{h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} }; } const ch = document.getElementById('hsl-channel').value; document.getElementById('hsl-h').value = hslState[ch].h; document.getElementById('hsl-s').value = hslState[ch].s; document.getElementById('hsl-l').value = hslState[ch].l; document.getElementById('hsl-h-val').textContent = hslState[ch].h; document.getElementById('hsl-s-val').textContent = hslState[ch].s; document.getElementById('hsl-l-val').textContent = hslState[ch].l; Object.keys(s).forEach(k => { if(s[k] && v[k]) v[k].textContent = s[k].value + (k==='sat'?'%':''); }); drawCurveGraph(); updateBaseFilters(); saveHistory(); }; });
Object.keys(s).forEach(k => { if(s[k]) s[k].oninput = () => { v[k].textContent = s[k].value + (k==='sat'?'%':''); updateBaseFilters(); }; }); Object.keys(s).forEach(k => { if(s[k]) s[k].onchange = () => saveHistory(); });
function updateLayersUI() { const list = document.getElementById('layers-list'); list.innerHTML = ''; layers.forEach((l, i) => { const div = document.createElement('div'); div.className = `layer-item ${i === activeLayerIndex ? 'active' : ''}`; div.innerHTML = `<span><i class="fa-solid fa-layer-group"></i> ${l.name}</span> <i class="fa-solid ${l.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>`; div.onclick = (e) => { if(e.target.classList.contains('fa-eye')||e.target.classList.contains('fa-eye-slash')) l.visible = !l.visible; else activeLayerIndex = i; updateLayersUI(); renderCanvas(); }; list.appendChild(div); }); document.getElementById('layer-settings').style.display = activeLayerIndex > 0 ? 'block' : 'none'; }
document.getElementById('layer-opacity').oninput = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].opacity = e.target.value/100; document.getElementById('layer-opacity-val').textContent = e.target.value + '%'; renderCanvas(); }}; document.getElementById('layer-blend').onchange = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].blendMode = e.target.value; renderCanvas(); }}; document.getElementById('del-layer-btn').onclick = () => { if(activeLayerIndex>0) { layers.splice(activeLayerIndex, 1); activeLayerIndex=0; updateLayersUI(); renderCanvas(); saveHistory(); } };
window.onresize = () => { if(layers.length > 0){ canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight; renderCanvas();} }; document.getElementById('reset-btn').onclick = () => location.reload();

// NUOVO: SHORTCUTS DA TASTIERA
window.addEventListener('keydown', (e) => {
    // Ignora se stai scrivendo il testo del watermark
    if (e.target.tagName.toLowerCase() === 'input' && e.target.type === 'text') return;

    if (e.code === 'Space') { isSpacePressed = true; canvas.style.cursor = 'grab'; return; }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

    // Copia e Incolla Impostazioni (Batch Editing)
    if (cmdOrCtrl && e.key.toLowerCase() === 'c') { e.preventDefault(); document.getElementById('copy-settings-btn').click(); }
    if (cmdOrCtrl && e.key.toLowerCase() === 'v') { e.preventDefault(); document.getElementById('paste-settings-btn').click(); }

    if (!cmdOrCtrl) {
        if (e.key.toLowerCase() === 'b') document.getElementById('brush-btn').click();
        if (e.key.toLowerCase() === 's') document.getElementById('clone-btn').click();
        if (e.key.toLowerCase() === 'c') document.getElementById('crop-btn').click();
        if (e.key === '\\') document.getElementById('split-view-btn').click();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { isSpacePressed = false; canvas.style.cursor = (isCloneMode||isBrushMode) ? 'crosshair' : 'default'; }
});

// INIT DB
initDB().then(loadFolders).catch(e => console.error("DB Init Error", e));

