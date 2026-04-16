import './style.css';

const workspace = document.getElementById('workspace');
const canvas = document.getElementById('photo-canvas');
const ctx = canvas.getContext('2d');
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const histCanvas = document.getElementById('hist-canvas');
const histCtx = histCanvas.getContext('2d');

const zoomValDisp = document.getElementById('zoom-val');
const noPhotoMsg = document.getElementById('no-photo-msg');
const exifBar = document.getElementById('exif-bar');

// --- CURVE DI TONO ---
const curveCanvas = document.getElementById('curve-canvas');
const curveCtx = curveCanvas.getContext('2d');
let curvePoint = { x: 128, y: 128 };
let isDraggingCurve = false;
let curveLUT = new Uint8Array(256);

function drawCurveGraph() {
    curveCtx.clearRect(0, 0, 256, 256);
    curveCtx.strokeStyle = '#333'; curveCtx.lineWidth = 1;
    for(let i=1; i<4; i++) {
        curveCtx.beginPath(); curveCtx.moveTo(i*64, 0); curveCtx.lineTo(i*64, 256); curveCtx.stroke();
        curveCtx.beginPath(); curveCtx.moveTo(0, i*64); curveCtx.lineTo(256, i*64); curveCtx.stroke();
    }
    curveCtx.beginPath(); curveCtx.moveTo(0, 256);
    const cx = 2 * curvePoint.x - 128; const cy = 2 * curvePoint.y - 128;
    curveCtx.quadraticCurveTo(cx, cy, 256, 0);
    curveCtx.strokeStyle = '#007aff'; curveCtx.lineWidth = 2; curveCtx.stroke();
    
    curveCtx.beginPath(); curveCtx.arc(curvePoint.x, curvePoint.y, 6, 0, Math.PI*2);
    curveCtx.fillStyle = 'white'; curveCtx.fill(); curveCtx.strokeStyle = '#000'; curveCtx.stroke();

    for(let i=0; i<256; i++) {
        let t = i / 255;
        let val = Math.pow(1-t, 2)*256 + 2*(1-t)*t*cy;
        curveLUT[i] = Math.max(0, Math.min(255, 256 - val)); 
    }
}
drawCurveGraph();

curveCanvas.onmousedown = () => isDraggingCurve = true;
window.addEventListener('mousemove', (e) => {
    if(isDraggingCurve) {
        const rect = curveCanvas.getBoundingClientRect();
        curvePoint.x = Math.max(0, Math.min(256, (e.clientX - rect.left) * (256/rect.width)));
        curvePoint.y = Math.max(0, Math.min(256, (e.clientY - rect.top) * (256/rect.height)));
        drawCurveGraph(); updateBaseFilters();
    }
});
window.addEventListener('mouseup', () => isDraggingCurve = false);

// --- GESTIONE PRESET E LUT UTENTE ---
let activeLUT = null;
let customPresets = JSON.parse(localStorage.getItem('fastphoto_presets')) || [];

function renderCustomPresets() {
    const grid = document.getElementById('custom-presets-grid');
    grid.innerHTML = '';
    customPresets.forEach((p, index) => {
        const btn = document.createElement('button');
        btn.className = 'preset-card';
        btn.style.borderColor = '#007aff';
        btn.innerHTML = `<i class="fa-solid fa-star"></i> ${p.name}`;
        btn.onclick = () => {
            s.effOp.value = p.s.effOp; s.sharp.value = p.s.sharp; s.temp.value = p.s.temp; s.tint.value = p.s.tint;
            s.exp.value = p.s.exp; s.cont.value = p.s.cont; s.shadows.value = p.s.shadows; s.high.value = p.s.high; s.sat.value = p.s.sat;
            curvePoint = { ...p.curve };
            Object.keys(s).forEach(k => { if(s[k] && v[k]) v[k].textContent = s[k].value + (k==='sat'?'%':''); });
            drawCurveGraph(); updateBaseFilters(); saveHistory();
        };
        // Tasto destro per eliminare il preset
        btn.oncontextmenu = (e) => {
            e.preventDefault();
            if(confirm(`Vuoi eliminare il preset "${p.name}"?`)) {
                customPresets.splice(index, 1);
                localStorage.setItem('fastphoto_presets', JSON.stringify(customPresets));
                renderCustomPresets();
            }
        };
        grid.appendChild(btn);
    });
}
renderCustomPresets();

document.getElementById('save-preset-btn').onclick = () => {
    const name = prompt("Dai un nome al tuo filtro (es. 'Ritratto Caldo'):");
    if(!name) return;
    const preset = {
        name,
        s: {
            effOp: s.effOp.value, sharp: s.sharp.value, temp: s.temp.value, tint: s.tint.value,
            exp: s.exp.value, cont: s.cont.value, shadows: s.shadows.value, high: s.high.value, sat: s.sat.value
        },
        curve: { ...curvePoint }
    };
    customPresets.push(preset);
    localStorage.setItem('fastphoto_presets', JSON.stringify(customPresets));
    renderCustomPresets();
};

document.getElementById('lut-upload').onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const text = ev.target.result;
        const lines = text.split('\n');
        let size = 0; let data = [];
        for(let line of lines) {
            line = line.trim();
            if(!line || line.startsWith('#')) continue;
            if(line.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(' ')[1]);
            else if(/^[0-9.-]/.test(line)) {
                const parts = line.split(/\s+/).map(Number);
                if(parts.length === 3) data.push(parts[0], parts[1], parts[2]);
            }
        }
        if(size > 0 && data.length > 0) {
            activeLUT = { size, data, name: file.name };
            document.getElementById('remove-lut-btn').style.display = 'block';
            document.getElementById('remove-lut-btn').innerHTML = `<i class="fa-solid fa-ban"></i> Rimuovi LUT (${file.name})`;
            updateBaseFilters(); saveHistory();
        } else {
            alert("File .cube non valido o corrotto.");
        }
    };
    reader.readAsText(file);
    e.target.value = "";
};

document.getElementById('remove-lut-btn').onclick = () => {
    activeLUT = null;
    document.getElementById('remove-lut-btn').style.display = 'none';
    updateBaseFilters(); saveHistory();
};

// --- STATO GLOBALE E NAVIGAZIONE ---
let layers = []; let activeLayerIndex = -1;
let scale = 1, panX = 0, panY = 0;
let isPanning = false, isSpacePressed = false, isDraggingLayer = false;
let startPan = {x:0, y:0}, startCoords = {x:0, y:0}, currentCoords = {x:0, y:0}, startLayerPos = {x:0, y:0};

// Modalità Strumenti
let isCropMode = false, isCropDragging = false;
let isTextMode = false;
let isCloneMode = false, isCloning = false;
let cloneSource = null, cloneOffset = {dx:0, dy:0}, hoverCoords = null;
let isBrushMode = false, isBrushing = false;

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

function saveHistory() {
    if (layers.length === 0) return;
    const state = layers.map(l => {
        let imgDataSrc = l.img.src;
        if(l.workingCanvas) { imgDataSrc = l.workingCanvas.toDataURL(); }
        return { ...l, imgData: imgDataSrc, workingCanvas: null }; 
    });
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.stringify(state));
    historyIndex++;
}

document.getElementById('undo-btn').onclick = () => { if (historyIndex > 0) { historyIndex--; loadHistoryState(); }};
document.getElementById('redo-btn').onclick = () => { if (historyIndex < history.length - 1) { historyIndex++; loadHistoryState(); }};

async function loadHistoryState() {
    const data = JSON.parse(history[historyIndex]);
    const promises = data.map(l => new Promise(res => {
        const img = new Image(); img.onload = () => { 
            l.img = img; 
            if(l.id === 'base') {
                l.workingCanvas = document.createElement('canvas'); l.workingCanvas.width = l.w; l.workingCanvas.height = l.h;
                l.workingCanvas.getContext('2d').drawImage(img, 0, 0);
            }
            res(l); 
        }; 
        img.src = l.imgData;
    }));
    layers = await Promise.all(promises);
    updateLayersUI(); updateBaseFilters();
}

function applySharpen(data, w, h, amount) {
    if (amount <= 0) return data;
    const weights = [0, -amount, 0, -amount, 1 + amount * 4, -amount, 0, -amount, 0];
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4; let r=0, g=0, b=0;
            for (let cy=0; cy<3; cy++) {
                for (let cx=0; cx<3; cx++) {
                    const iy = Math.min(h-1, Math.max(0, y + cy - 1)); const ix = Math.min(w-1, Math.max(0, x + cx - 1));
                    const srcI = (iy * w + ix) * 4; const wt = weights[cy * 3 + cx];
                    r += data[srcI] * wt; g += data[srcI+1] * wt; b += data[srcI+2] * wt;
                }
            }
            out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=data[i+3];
        }
    }
    return out;
}

function updateBaseFilters() {
    if (layers.length === 0) return;
    const base = layers[0];
    const tCanvas = document.createElement('canvas'); tCanvas.width = base.w; tCanvas.height = base.h;
    const tCtx = tCanvas.getContext('2d'); 
    tCtx.drawImage(base.workingCanvas || base.img, 0, 0);

    let imgData = tCtx.getImageData(0, 0, base.w, base.h);
    let data = imgData.data;

    const effOp = parseInt(s.effOp?.value || 100) / 100;
    const sharp = parseInt(s.sharp?.value || 0) / 100;
    const temp = parseInt(s.temp?.value || 0); const tint = parseInt(s.tint?.value || 0);
    const exp = parseInt(s.exp?.value || 0); const cont = parseInt(s.cont?.value || 0);
    const shadows = parseInt(s.shadows?.value || 0); const high = parseInt(s.high?.value || 0);
    const sat = parseInt(s.sat?.value || 100) / 100; 
    
    const factor = (259 * (cont + 255)) / (255 * (259 - cont));
    const lutSize = activeLUT ? activeLUT.size - 1 : 0;

    for (let i = 0; i < data.length; i += 4) {
        // Applica 3D LUT se presente (Nearest Neighbor per prestazioni)
        if(activeLUT) {
            let cr = Math.max(0, Math.min(255, data[i])); let cg = Math.max(0, Math.min(255, data[i+1])); let cb = Math.max(0, Math.min(255, data[i+2]));
            let bx = Math.round((cr / 255) * lutSize); let by = Math.round((cg / 255) * lutSize); let bz = Math.round((cb / 255) * lutSize);
            let idx = (bz * activeLUT.size * activeLUT.size + by * activeLUT.size + bx) * 3;
            data[i] = activeLUT.data[idx] * 255; data[i+1] = activeLUT.data[idx+1] * 255; data[i+2] = activeLUT.data[idx+2] * 255;
        }

        data[i] = curveLUT[data[i]]; data[i+1] = curveLUT[data[i+1]]; data[i+2] = curveLUT[data[i+2]];
        
        data[i] += temp + exp; data[i+1] += tint + exp; data[i+2] += exp - temp;
        data[i] = factor * (data[i] - 128) + 128; data[i+1] = factor * (data[i+1] - 128) + 128; data[i+2] = factor * (data[i+2] - 128) + 128;
        
        data[i]=Math.min(255,Math.max(0,data[i])); data[i+1]=Math.min(255,Math.max(0,data[i+1])); data[i+2]=Math.min(255,Math.max(0,data[i+2]));
        
        let lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
        if (shadows !== 0 && lum < 128) { let m = (128-lum)/128; data[i]+=shadows*m; data[i+1]+=shadows*m; data[i+2]+=shadows*m; }
        if (high !== 0 && lum > 128) { let m = (lum-128)/127; data[i]-=high*m; data[i+1]-=high*m; data[i+2]-=high*m; }
        
        lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
        data[i]=lum+(data[i]-lum)*sat; data[i+1]=lum+(data[i+1]-lum)*sat; data[i+2]=lum+(data[i+2]-lum)*sat;
    }

    if (sharp > 0) { const sharpened = applySharpen(data, base.w, base.h, sharp); imgData.data.set(sharpened); }

    tCtx.putImageData(imgData, 0, 0);
    offCanvas.width = base.w; offCanvas.height = base.h;
    offCtx.clearRect(0,0,base.w,base.h);
    
    offCtx.drawImage(base.workingCanvas || base.img, 0, 0);
    offCtx.globalAlpha = effOp;
    offCtx.drawImage(tCanvas, 0, 0);
    offCtx.globalAlpha = 1.0;
    
    drawHistogram(offCtx.getImageData(0,0,base.w,base.h).data); renderCanvas();
}

function renderCanvas() {
    if (layers.length === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(panX, panY); ctx.scale(scale, scale);

    layers.forEach((l, i) => {
        if (!l.visible) return; ctx.save();
        if (i === 0) ctx.drawImage(offCanvas, l.x, l.y, l.w, l.h);
        else { ctx.globalAlpha = l.opacity || 1; ctx.globalCompositeOperation = l.blendMode || 'source-over'; ctx.drawImage(l.img, l.x, l.y, l.w, l.h); }
        ctx.restore();
        if (i === activeLayerIndex && i !== 0) { ctx.strokeStyle = '#007aff'; ctx.lineWidth = 2/scale; ctx.strokeRect(l.x, l.y, l.w, l.h); }
    });

    if (isCropMode && (isCropDragging || Math.abs(currentCoords.x - startCoords.x) > 5)) {
        ctx.strokeStyle = '#007aff'; ctx.lineWidth = 2/scale; ctx.setLineDash([5/scale, 5/scale]);
        ctx.strokeRect(startCoords.x, startCoords.y, currentCoords.x - startCoords.x, currentCoords.y - startCoords.y);
    }
    
    if ((isCloneMode || isBrushMode) && hoverCoords && layers.length > 0) {
        const brush = isCloneMode ? parseInt(document.getElementById('clone-size').value) : parseInt(document.getElementById('brush-size').value);
        ctx.beginPath(); ctx.arc(hoverCoords.x, hoverCoords.y, brush, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5/scale; ctx.stroke();
        
        if (isCloneMode && cloneSource) {
            let sx = cloneSource.x, sy = cloneSource.y;
            if (isCloning) { sx = hoverCoords.x + cloneOffset.dx; sy = hoverCoords.y + cloneOffset.dy; }
            ctx.beginPath(); ctx.arc(sx, sy, brush, 0, Math.PI*2);
            ctx.strokeStyle = 'rgba(0,122,255,0.8)'; ctx.lineWidth = 1.5/scale; ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sx - 5/scale, sy); ctx.lineTo(sx + 5/scale, sy);
            ctx.moveTo(sx, sy - 5/scale); ctx.lineTo(sx, sy + 5/scale); ctx.stroke();
        }
    }
    ctx.restore();
}

function getRealCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left;
    const y = (e.clientY || (e.touches ? e.touches[0].clientY : 0)) - rect.top;
    return { x: (x - panX) / scale, y: (y - panY) / scale };
}

function fitToScreen() {
    if (layers.length === 0) return;
    const base = layers[0]; const sX = (workspace.clientWidth - 40) / base.w, sY = (workspace.clientHeight - 40) / base.h;
    scale = Math.min(sX, sY, 1); panX = (workspace.clientWidth - base.w * scale) / 2; panY = (workspace.clientHeight - base.h * scale) / 2;
    zoomValDisp.textContent = Math.round(scale * 100) + '%'; renderCanvas();
}

canvas.onwheel = (e) => {
    e.preventDefault(); const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top; const oldScale = scale;
    scale *= (e.deltaY < 0 ? 1.1 : 0.9); scale = Math.max(0.05, Math.min(scale, 10));
    panX = mx - (mx - panX) * (scale / oldScale); panY = my - (my - panY) * (scale / oldScale);
    zoomValDisp.textContent = Math.round(scale * 100) + '%'; renderCanvas();
};

document.getElementById('upload-btn').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;

    try {
        const exifData = await exifr.parse(file, {tiff: true, ifd0: true, exif: true});
        if(exifData) {
            exifBar.style.display = 'flex';
            document.getElementById('exif-camera').innerHTML = `<i class="fa-solid fa-camera"></i> ${exifData.Make || ''} ${exifData.Model || 'Camera'} `;
            const fNum = exifData.FNumber ? `f/${exifData.FNumber}` : '';
            const expTime = exifData.ExposureTime ? `1/${Math.round(1/exifData.ExposureTime)}s` : '';
            const iso = exifData.ISO ? `ISO ${exifData.ISO}` : '';
            document.getElementById('exif-settings').innerHTML = `<i class="fa-solid fa-sliders"></i> ${fNum} | ${expTime} | ${iso}`;
        }
    } catch(err) { exifBar.style.display = 'none'; console.log('No EXIF data found'); }

    let targetSrc = '';
    const isRaw = file.name.toLowerCase().match(/\.(rw2|cr2|nef|arw)$/);
    if (isRaw) {
        try { targetSrc = await exifr.thumbnailUrl(file); if(!targetSrc) throw new Error("Anteprima non trovata"); } 
        catch(err) { alert("Impossibile estrarre l'anteprima da questo RAW. Prova con un JPEG."); return; }
    } else { targetSrc = URL.createObjectURL(file); }

    const img = new Image();
    img.onload = () => {
        const wCanvas = document.createElement('canvas'); wCanvas.width = img.width; wCanvas.height = img.height;
        wCanvas.getContext('2d').drawImage(img, 0, 0);
        layers = [{ id: 'base', img, workingCanvas: wCanvas, w: img.width, h: img.height, x: 0, y: 0, visible: true, name: "Sfondo", opacity: 1, blendMode: 'source-over' }];
        activeLayerIndex = 0; canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight;
        noPhotoMsg.style.display = 'none'; canvas.style.display = 'block'; document.querySelector('.zoom-bar').style.display = 'flex';
        saveHistory(); updateBaseFilters(); fitToScreen(); updateLayersUI();
    };
    img.src = targetSrc;
};

document.getElementById('add-layer-btn').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            layers.push({ id: 'layer', img, w: img.width, h: img.height, x: 0, y: 0, visible: true, name: "Livello " + layers.length, opacity: 1, blendMode: 'source-over' });
            activeLayerIndex = layers.length - 1; saveHistory(); updateLayersUI(); renderCanvas();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
};

canvas.onmousedown = (e) => {
    if (layers.length === 0) return;
    const coords = getRealCoords(e);
    if (isSpacePressed || e.button === 1) { isPanning = true; startPan = { x: e.clientX - panX, y: e.clientY - panY }; return; }
    
    if (isCloneMode) {
        if (e.altKey) { cloneSource = {...coords}; renderCanvas(); return; }
        if (cloneSource) { isCloning = true; cloneOffset = { dx: cloneSource.x - coords.x, dy: cloneSource.y - coords.y }; applyCloneStroke(coords); }
        return;
    }

    if (isBrushMode) { isBrushing = true; applyBrushStroke(coords); return; }

    if (isTextMode) {
        const txt = document.getElementById('watermark-text').value; if (!txt) return;
        const t = document.createElement('canvas'); t.width = layers[0].w; t.height = layers[0].h;
        const tc = t.getContext('2d'); tc.drawImage(layers[0].workingCanvas || layers[0].img, 0, 0);
        tc.font = "bold 60px sans-serif"; tc.fillStyle = document.getElementById('watermark-color').value;
        tc.fillText(txt, coords.x, coords.y);
        layers[0].workingCanvas = t; saveHistory(); updateBaseFilters();
        isTextMode = false; document.getElementById('text-btn').classList.remove('active-action');
        return;
    }
    if (isCropMode) { isCropDragging = true; startCoords = coords; return; }
    if (activeLayerIndex > 0) {
        const l = layers[activeLayerIndex];
        if (coords.x >= l.x && coords.x <= l.x + l.w && coords.y >= l.y && coords.y <= l.y + l.h) {
            isDraggingLayer = true; startLayerPos = { mx: coords.x, my: coords.y, lx: l.x, ly: l.y };
        }
    }
};

function applyCloneStroke(coords) {
    if(!layers[0].workingCanvas) return;
    const ctxW = layers[0].workingCanvas.getContext('2d');
    const brush = parseInt(document.getElementById('clone-size').value);
    const sx = coords.x + cloneOffset.dx; const sy = coords.y + cloneOffset.dy;
    
    ctxW.save(); ctxW.beginPath(); ctxW.arc(coords.x, coords.y, brush, 0, Math.PI*2); ctxW.clip();
    ctxW.drawImage(layers[0].workingCanvas, sx - brush, sy - brush, brush*2, brush*2, coords.x - brush, coords.y - brush, brush*2, brush*2);
    ctxW.restore(); updateBaseFilters();
}

function applyBrushStroke(coords) {
    if(!layers[0].workingCanvas) return;
    const ctxW = layers[0].workingCanvas.getContext('2d');
    const mode = document.getElementById('brush-mode').value;
    const brush = parseInt(document.getElementById('brush-size').value);
    const flow = parseInt(document.getElementById('brush-flow').value) / 100;
    
    ctxW.save();
    const grad = ctxW.createRadialGradient(coords.x, coords.y, 0, coords.x, coords.y, brush);
    if(mode === 'dodge') { grad.addColorStop(0, `rgba(255,255,255,${flow})`); grad.addColorStop(1, 'rgba(255,255,255,0)'); ctxW.globalCompositeOperation = 'soft-light'; }
    if(mode === 'burn') { grad.addColorStop(0, `rgba(0,0,0,${flow})`); grad.addColorStop(1, 'rgba(0,0,0,0)'); ctxW.globalCompositeOperation = 'soft-light'; }
    
    ctxW.fillStyle = grad; ctxW.beginPath(); ctxW.arc(coords.x, coords.y, brush, 0, Math.PI*2); ctxW.fill();
    ctxW.restore(); updateBaseFilters();
}

window.onmousemove = (e) => {
    hoverCoords = getRealCoords(e);
    if (isPanning) { panX = e.clientX - startPan.x; panY = e.clientY - startPan.y; renderCanvas(); }
    else if (isCloning) { applyCloneStroke(hoverCoords); }
    else if (isBrushing) { applyBrushStroke(hoverCoords); }
    else if (isDraggingLayer) {
        const l = layers[activeLayerIndex]; l.x = startLayerPos.lx + (hoverCoords.x - startLayerPos.mx); l.y = startLayerPos.ly + (hoverCoords.y - startLayerPos.my); renderCanvas();
    } else if (isCropDragging) { currentCoords = hoverCoords; renderCanvas(); }
    else if (isCloneMode || isBrushMode) { renderCanvas(); }
};

window.onmouseup = () => { 
    if(isCloning || isBrushing) { saveHistory(); }
    isPanning = isDraggingLayer = isCropDragging = isCloning = isBrushing = false; 
};

// --- STRUMENTI UI ---
document.getElementById('zoom-fit').onclick = fitToScreen;
document.getElementById('zoom-in').onclick = () => { scale *= 1.2; zoomValDisp.textContent = Math.round(scale*100)+'%'; renderCanvas(); };
document.getElementById('zoom-out').onclick = () => { scale /= 1.2; zoomValDisp.textContent = Math.round(scale*100)+'%'; renderCanvas(); };

function toggleTool(toolBtn, settingsId, modeFlag) {
    isCropMode = false; isTextMode = false; isCloneMode = false; isBrushMode = false;
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active-action'));
    document.getElementById('clone-settings').style.display = 'none';
    document.getElementById('brush-settings').style.display = 'none';
    canvas.style.cursor = 'default';
    if(modeFlag) {
        toolBtn.classList.add('active-action');
        if(settingsId) document.getElementById(settingsId).style.display = 'block';
        canvas.style.cursor = 'crosshair';
    }
}

document.getElementById('clone-btn').onclick = () => { isCloneMode = !isCloneMode; toggleTool(document.getElementById('clone-btn'), 'clone-settings', isCloneMode); if(!isCloneMode) cloneSource = null; renderCanvas(); };
document.getElementById('clone-size').oninput = (e) => { document.getElementById('clone-size-val').textContent = e.target.value + 'px'; renderCanvas(); };

document.getElementById('brush-btn').onclick = () => { isBrushMode = !isBrushMode; toggleTool(document.getElementById('brush-btn'), 'brush-settings', isBrushMode); renderCanvas(); };
document.getElementById('brush-size').oninput = (e) => { document.getElementById('brush-size-val').textContent = e.target.value + 'px'; renderCanvas(); };
document.getElementById('brush-flow').oninput = (e) => { document.getElementById('brush-flow-val').textContent = e.target.value + '%'; };

document.getElementById('rotate-btn').onclick = () => {
    if(layers.length===0) return;
    const t = document.createElement('canvas'); t.width = layers[0].h; t.height = layers[0].w;
    const tc = t.getContext('2d'); tc.translate(t.width/2, t.height/2); tc.rotate(Math.PI/2); tc.drawImage(layers[0].workingCanvas || layers[0].img, -layers[0].w/2, -layers[0].h/2);
    layers[0].workingCanvas = t; layers[0].w = t.width; layers[0].h = t.height; saveHistory(); updateBaseFilters(); fitToScreen();
};

document.getElementById('crop-btn').onclick = () => {
    isCropMode = !isCropMode; toggleTool(document.getElementById('crop-btn'), null, isCropMode);
    if (!isCropMode && Math.abs(currentCoords.x - startCoords.x) > 20) {
        const x = Math.min(startCoords.x, currentCoords.x), y = Math.min(startCoords.y, currentCoords.y), w = Math.abs(currentCoords.x - startCoords.x), h = Math.abs(currentCoords.y - startCoords.y);
        const t = document.createElement('canvas'); t.width = w; t.height = h;
        t.getContext('2d').drawImage(layers[0].workingCanvas || layers[0].img, x, y, w, h, 0, 0, w, h);
        layers[0].workingCanvas = t; layers[0].w = w; layers[0].h = h; saveHistory(); updateBaseFilters(); fitToScreen();
    }
};

document.getElementById('text-btn').onclick = () => { isTextMode = !isTextMode; toggleTool(document.getElementById('text-btn'), null, isTextMode); canvas.style.cursor = isTextMode ? 'text' : 'default'; };

document.querySelectorAll('.preset-card').forEach(b => {
    b.onclick = (e) => {
        const p = e.target.dataset.preset;
        if (p==='normal') { s.effOp.value=100; s.temp.value=0; s.tint.value=0; s.exp.value=0; s.cont.value=0; s.shadows.value=0; s.high.value=0; s.sat.value=100; s.sharp.value=0; curvePoint={x:128, y:128}; }
        if (p==='vintage') { s.effOp.value=100; s.temp.value=15; s.tint.value=10; s.exp.value=5; s.cont.value=-10; s.shadows.value=15; s.high.value=-10; s.sat.value=80; s.sharp.value=15; curvePoint={x:128, y:100}; }
        if (p==='cinematic') { s.effOp.value=100; s.temp.value=-10; s.tint.value=5; s.exp.value=-5; s.cont.value=20; s.shadows.value=20; s.high.value=5; s.sat.value=90; s.sharp.value=25; curvePoint={x:128, y:150}; }
        if (p==='bw') { s.effOp.value=100; s.sat.value=0; s.exp.value=5; s.sharp.value=30; s.cont.value=15; s.shadows.value=0; s.high.value=0; s.temp.value=0; s.tint.value=0; curvePoint={x:128, y:120}; }
        Object.keys(s).forEach(k => { if(s[k] && v[k]) v[k].textContent = s[k].value + (k==='sat'?'%':''); });
        drawCurveGraph(); updateBaseFilters(); saveHistory();
    };
});

Object.keys(s).forEach(k => { if(s[k]) s[k].oninput = () => { v[k].textContent = s[k].value + (k==='sat'?'%':''); updateBaseFilters(); }; });
Object.keys(s).forEach(k => { if(s[k]) s[k].onchange = () => saveHistory(); });

function drawHistogram(data) {
    histCtx.clearRect(0,0,310,80); let lums = new Array(256).fill(0);
    for(let i=0; i<data.length; i+=4) lums[Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])]++;
    let max = Math.max(...lums); histCtx.fillStyle = '#666';
    for(let i=0; i<256; i++) histCtx.fillRect(i*(310/256), 80-(lums[i]/max)*80, 1, (lums[i]/max)*80);
}

document.getElementById('download-btn').onclick = () => {
    const e = document.createElement('canvas'); e.width = layers[0].w; e.height = layers[0].h; const ec = e.getContext('2d');
    layers.forEach((l, i) => { if(!l.visible) return; if(i===0) ec.drawImage(offCanvas, 0, 0); else { ec.globalAlpha = l.opacity; ec.globalCompositeOperation = l.blendMode; ec.drawImage(l.img, l.x, l.y, l.w, l.h); } });
    const a = document.createElement('a'); a.download = 'FastPhoto_Pro_G97.png'; a.href = e.toDataURL('image/png', 1.0); a.click();
};

function updateLayersUI() {
    const list = document.getElementById('layers-list'); list.innerHTML = '';
    layers.forEach((l, i) => {
        const div = document.createElement('div'); div.className = `layer-item ${i === activeLayerIndex ? 'active' : ''}`;
        div.innerHTML = `<span><i class="fa-solid fa-layer-group"></i> ${l.name}</span> <i class="fa-solid ${l.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
        div.onclick = (e) => { if(e.target.classList.contains('fa-eye')||e.target.classList.contains('fa-eye-slash')) l.visible = !l.visible; else activeLayerIndex = i; updateLayersUI(); renderCanvas(); };
        list.appendChild(div);
    });
    document.getElementById('layer-settings').style.display = activeLayerIndex > 0 ? 'block' : 'none';
}

document.getElementById('layer-opacity').oninput = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].opacity = e.target.value/100; document.getElementById('layer-opacity-val').textContent = e.target.value + '%'; renderCanvas(); }};
document.getElementById('layer-blend').onchange = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].blendMode = e.target.value; renderCanvas(); }};
document.getElementById('del-layer-btn').onclick = () => { if(activeLayerIndex>0) { layers.splice(activeLayerIndex, 1); activeLayerIndex=0; updateLayersUI(); renderCanvas(); saveHistory(); } };

window.onkeydown = (e) => { if(e.code==='Space') { isSpacePressed=true; canvas.style.cursor='grab'; } };
window.onkeyup = (e) => { if(e.code==='Space') { isSpacePressed=false; canvas.style.cursor= (isCloneMode||isBrushMode) ? 'crosshair' : 'default'; } };
window.onresize = () => { if(layers.length > 0){ canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight; renderCanvas();} };
document.getElementById('reset-btn').onclick = () => location.reload();

