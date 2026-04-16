import './style.css';

const workspace = document.getElementById('workspace');
const canvas = document.getElementById('photo-canvas');
const ctx = canvas.getContext('2d');
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');
const histCanvas = document.getElementById('hist-canvas');
const histCtx = histCanvas.getContext('2d');

// --- NUOVO: SETUP CURVE ---
const curveCanvas = document.getElementById('curve-canvas');
const curveCtx = curveCanvas.getContext('2d');
let curvePoint = { x: 128, y: 128 }; // Punto di controllo (Mezzitoni)
let isDraggingCurve = false;
let curveLUT = new Uint8Array(256);

function drawCurveGraph() {
    curveCtx.clearRect(0, 0, 256, 256);
    // Griglia
    curveCtx.strokeStyle = '#333'; curveCtx.lineWidth = 1;
    for(let i=1; i<4; i++) {
        curveCtx.beginPath(); curveCtx.moveTo(i*64, 0); curveCtx.lineTo(i*64, 256); curveCtx.stroke();
        curveCtx.beginPath(); curveCtx.moveTo(0, i*64); curveCtx.lineTo(256, i*64); curveCtx.stroke();
    }
    // Curva Quadratica Bezier (da Ombre 0,256 a Luci 256,0 passando per il nostro punto)
    curveCtx.beginPath();
    curveCtx.moveTo(0, 256);
    // Control point per far passare la curva vicina al nostro punto
    const cx = 2 * curvePoint.x - 128;
    const cy = 2 * curvePoint.y - 128;
    curveCtx.quadraticCurveTo(cx, cy, 256, 0);
    curveCtx.strokeStyle = '#007aff'; curveCtx.lineWidth = 2; curveCtx.stroke();
    
    // Disegna il punto
    curveCtx.beginPath();
    curveCtx.arc(curvePoint.x, curvePoint.y, 6, 0, Math.PI*2);
    curveCtx.fillStyle = 'white'; curveCtx.fill();
    curveCtx.strokeStyle = '#000'; curveCtx.stroke();

    // Ricalcola la LUT (Look-Up Table) per applicare la curva ai pixel velocemente
    for(let i=0; i<256; i++) {
        let t = i / 255;
        // Formula Bezier inversa semplificata
        let val = Math.pow(1-t, 2)*256 + 2*(1-t)*t*cy + Math.pow(t, 2)*0;
        curveLUT[i] = Math.max(0, Math.min(255, 256 - val)); // Invertiamo Y per il canvas
    }
}
drawCurveGraph();

curveCanvas.onmousedown = () => isDraggingCurve = true;
window.addEventListener('mousemove', (e) => {
    if(isDraggingCurve) {
        const rect = curveCanvas.getBoundingClientRect();
        // Mappa la X e Y del mouse allo spazio 0-256 del canvas interno
        const scaleX = 256 / rect.width;
        const scaleY = 256 / rect.height;
        curvePoint.x = Math.max(0, Math.min(256, (e.clientX - rect.left) * scaleX));
        curvePoint.y = Math.max(0, Math.min(256, (e.clientY - rect.top) * scaleY));
        drawCurveGraph();
        updateBaseFilters(); // Applica la curva in tempo reale!
    }
});
window.addEventListener('mouseup', () => isDraggingCurve = false);

const zoomValDisp = document.getElementById('zoom-val');
const noPhotoMsg = document.getElementById('no-photo-msg');

let layers = [];
let activeLayerIndex = -1;
let history = [];
let historyIndex = -1;
let scale = 1, panX = 0, panY = 0;
let isPanning = false, isSpacePressed = false, isDraggingLayer = false, isCropDragging = false;
let startPan = {x:0, y:0}, startCoords = {x:0, y:0}, currentCoords = {x:0, y:0}, startLayerPos = {x:0, y:0};
let isCropMode = false, isTextMode = false;

const s = {
    sharp: document.getElementById('sharpness-slider'), temp: document.getElementById('temp-slider'),
    exp: document.getElementById('exposure-slider'), cont: document.getElementById('contrast-slider'),
    shadows: document.getElementById('shadows-slider'), sat: document.getElementById('saturation-slider')
};
const v = {
    sharp: document.getElementById('sharpness-val'), temp: document.getElementById('temp-val'),
    exp: document.getElementById('exposure-val'), cont: document.getElementById('contrast-val'),
    shadows: document.getElementById('shadows-val'), sat: document.getElementById('saturation-val')
};

function saveHistory() {
    if (layers.length === 0) return;
    const state = layers.map(l => ({ ...l, imgData: l.img.src }));
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.stringify(state));
    historyIndex++;
}

document.getElementById('undo-btn').onclick = () => { if (historyIndex > 0) { historyIndex--; loadHistoryState(); }};
document.getElementById('redo-btn').onclick = () => { if (historyIndex < history.length - 1) { historyIndex++; loadHistoryState(); }};

async function loadHistoryState() {
    const data = JSON.parse(history[historyIndex]);
    const promises = data.map(l => new Promise(res => {
        const img = new Image(); img.onload = () => { l.img = img; res(l); }; img.src = l.imgData;
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
            const i = (y * w + x) * 4;
            let r=0, g=0, b=0;
            for (let cy=0; cy<3; cy++) {
                for (let cx=0; cx<3; cx++) {
                    const iy = Math.min(h-1, Math.max(0, y + cy - 1));
                    const ix = Math.min(w-1, Math.max(0, x + cx - 1));
                    const srcI = (iy * w + ix) * 4;
                    const wt = weights[cy * 3 + cx];
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
    const tCtx = tCanvas.getContext('2d'); tCtx.drawImage(base.img, 0, 0);

    let imgData = tCtx.getImageData(0, 0, base.w, base.h);
    let data = imgData.data;

    const temp = parseInt(s.temp?.value || 0), exp = parseInt(s.exp?.value || 0), cont = parseInt(s.cont?.value || 0);
    const shadows = parseInt(s.shadows?.value || 0), sat = parseInt(s.sat?.value || 100) / 100, sharp = parseInt(s.sharp?.value || 0) / 100;
    const factor = (259 * (cont + 255)) / (255 * (259 - cont));

    for (let i = 0; i < data.length; i += 4) {
        // Applica Curve di Tono tramite LUT
        data[i] = curveLUT[data[i]];
        data[i+1] = curveLUT[data[i+1]];
        data[i+2] = curveLUT[data[i+2]];

        data[i] += temp + exp; data[i+1] += exp; data[i+2] += exp - temp;
        data[i] = factor * (data[i] - 128) + 128; data[i+1] = factor * (data[i+1] - 128) + 128; data[i+2] = factor * (data[i+2] - 128) + 128;
        let lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
        if (lum < 128) { let m = (128-lum)/128; data[i]+=shadows*m; data[i+1]+=shadows*m; data[i+2]+=shadows*m; }
        lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
        data[i]=lum+(data[i]-lum)*sat; data[i+1]=lum+(data[i+1]-lum)*sat; data[i+2]=lum+(data[i+2]-lum)*sat;
    }

    if (sharp > 0) { const sharpened = applySharpen(data, base.w, base.h, sharp); imgData.data.set(sharpened); }

    tCtx.putImageData(imgData, 0, 0);
    offCanvas.width = base.w; offCanvas.height = base.h;
    offCtx.clearRect(0,0,base.w,base.h);
    offCtx.drawImage(tCanvas, 0, 0);
    drawHistogram(data); renderCanvas();
}

function renderCanvas() {
    if (layers.length === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.translate(panX, panY); ctx.scale(scale, scale);

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
    const base = layers[0];
    const sX = (workspace.clientWidth - 40) / base.w, sY = (workspace.clientHeight - 40) / base.h;
    scale = Math.min(sX, sY, 1);
    panX = (workspace.clientWidth - base.w * scale) / 2; panY = (workspace.clientHeight - base.h * scale) / 2;
    zoomValDisp.textContent = Math.round(scale * 100) + '%'; renderCanvas();
}

canvas.onwheel = (e) => {
    e.preventDefault(); const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top; const oldScale = scale;
    scale *= (e.deltaY < 0 ? 1.1 : 0.9); scale = Math.max(0.05, Math.min(scale, 10));
    panX = mx - (mx - panX) * (scale / oldScale); panY = my - (my - panY) * (scale / oldScale);
    zoomValDisp.textContent = Math.round(scale * 100) + '%'; renderCanvas();
};

document.getElementById('upload-btn').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            layers = [{ img, w: img.width, h: img.height, x: 0, y: 0, visible: true, name: "Sfondo", opacity: 1, blendMode: 'source-over' }];
            activeLayerIndex = 0; canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight;
            noPhotoMsg.style.display = 'none'; canvas.style.display = 'block'; document.querySelector('.zoom-bar').style.display = 'flex';
            saveHistory(); updateBaseFilters(); fitToScreen(); updateLayersUI();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
};

document.getElementById('add-layer-btn').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            layers.push({ img, w: img.width, h: img.height, x: 0, y: 0, visible: true, name: "Livello " + layers.length, opacity: 1, blendMode: 'source-over' });
            activeLayerIndex = layers.length - 1; updateLayersUI(); renderCanvas();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
};

canvas.onmousedown = (e) => {
    if (layers.length === 0) return;
    const coords = getRealCoords(e);
    if (isSpacePressed || e.button === 1) { isPanning = true; startPan = { x: e.clientX - panX, y: e.clientY - panY }; return; }
    if (isTextMode) {
        const txt = document.getElementById('watermark-text').value; if (!txt) return;
        const t = document.createElement('canvas'); t.width = layers[0].w; t.height = layers[0].h;
        const tc = t.getContext('2d'); tc.drawImage(layers[0].img, 0, 0);
        tc.font = "bold 60px sans-serif"; tc.fillStyle = document.getElementById('watermark-color').value;
        tc.fillText(txt, coords.x, coords.y);
        const ni = new Image(); ni.onload = () => { layers[0].img = ni; saveHistory(); updateBaseFilters(); };
        ni.src = t.toDataURL(); isTextMode = false; document.getElementById('text-btn').classList.remove('active-action');
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

window.onmousemove = (e) => {
    if (isPanning) { panX = e.clientX - startPan.x; panY = e.clientY - startPan.y; renderCanvas(); }
    else if (isDraggingLayer) {
        const c = getRealCoords(e); const l = layers[activeLayerIndex];
        l.x = startLayerPos.lx + (c.x - startLayerPos.mx); l.y = startLayerPos.ly + (c.y - startLayerPos.my); renderCanvas();
    } else if (isCropDragging) { currentCoords = getRealCoords(e); renderCanvas(); }
};
window.onmouseup = () => { isPanning = isDraggingLayer = isCropDragging = false; };

document.getElementById('zoom-fit').onclick = fitToScreen;
document.getElementById('zoom-in').onclick = () => { scale *= 1.2; zoomValDisp.textContent = Math.round(scale*100)+'%'; renderCanvas(); };
document.getElementById('zoom-out').onclick = () => { scale /= 1.2; zoomValDisp.textContent = Math.round(scale*100)+'%'; renderCanvas(); };

document.getElementById('rotate-btn').onclick = () => {
    const t = document.createElement('canvas'); t.width = layers[0].h; t.height = layers[0].w;
    const tc = t.getContext('2d'); tc.translate(t.width/2, t.height/2); tc.rotate(Math.PI/2); tc.drawImage(layers[0].img, -layers[0].w/2, -layers[0].h/2);
    const ni = new Image(); ni.onload = () => { layers[0].img = ni; layers[0].w = ni.width; layers[0].h = ni.height; saveHistory(); updateBaseFilters(); fitToScreen(); };
    ni.src = t.toDataURL();
};

document.getElementById('crop-btn').onclick = () => {
    isCropMode = !isCropMode; document.getElementById('crop-btn').classList.toggle('active-action', isCropMode);
    if (!isCropMode && Math.abs(currentCoords.x - startCoords.x) > 20) {
        const x = Math.min(startCoords.x, currentCoords.x), y = Math.min(startCoords.y, currentCoords.y), w = Math.abs(currentCoords.x - startCoords.x), h = Math.abs(currentCoords.y - startCoords.y);
        const t = document.createElement('canvas'); t.width = w; t.height = h;
        t.getContext('2d').drawImage(layers[0].img, x, y, w, h, 0, 0, w, h);
        const ni = new Image(); ni.onload = () => { layers[0].img = ni; layers[0].w = w; layers[0].h = h; saveHistory(); updateBaseFilters(); fitToScreen(); };
        ni.src = t.toDataURL();
    }
};

document.getElementById('text-btn').onclick = () => { isTextMode = !isTextMode; document.getElementById('text-btn').classList.toggle('active-action', isTextMode); };

document.querySelectorAll('.preset-card').forEach(b => {
    b.onclick = (e) => {
        const p = e.target.dataset.preset;
        if (p==='normal') { s.temp.value=0; s.exp.value=0; s.cont.value=0; s.shadows.value=0; s.sat.value=100; s.sharp.value=0; curvePoint={x:128, y:128}; }
        if (p==='vintage') { s.temp.value=15; s.exp.value=5; s.cont.value=-10; s.shadows.value=15; s.sat.value=80; s.sharp.value=15; curvePoint={x:128, y:100}; }
        if (p==='cinematic') { s.temp.value=-10; s.exp.value=-5; s.cont.value=20; s.shadows.value=20; s.sat.value=90; s.sharp.value=25; curvePoint={x:128, y:150}; }
        if (p==='bw') { s.sat.value=0; s.exp.value=5; s.sharp.value=30; s.cont.value=15; curvePoint={x:128, y:120}; }
        Object.keys(s).forEach(k => { if(s[k] && v[k]) v[k].textContent = s[k].value + (k==='sat'?'%':''); });
        drawCurveGraph(); updateBaseFilters();
    };
});

Object.keys(s).forEach(k => { if(s[k]) s[k].oninput = () => { v[k].textContent = s[k].value + (k==='sat'?'%':''); updateBaseFilters(); }; });

function drawHistogram(data) {
    histCtx.clearRect(0,0,310,100); let lums = new Array(256).fill(0);
    for(let i=0; i<data.length; i+=4) lums[Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])]++;
    let max = Math.max(...lums); histCtx.fillStyle = '#666';
    for(let i=0; i<256; i++) histCtx.fillRect(i*(310/256), 100-(lums[i]/max)*100, 1, (lums[i]/max)*100);
}

document.getElementById('download-btn').onclick = () => {
    const e = document.createElement('canvas'); e.width = layers[0].w; e.height = layers[0].h;
    const ec = e.getContext('2d');
    layers.forEach((l, i) => { if(!l.visible) return; if(i===0) ec.drawImage(offCanvas, 0, 0); else { ec.globalAlpha = l.opacity; ec.globalCompositeOperation = l.blendMode; ec.drawImage(l.img, l.x, l.y, l.w, l.h); } });
    const a = document.createElement('a'); a.download = 'FastPhoto_Pro.png'; a.href = e.toDataURL(); a.click();
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

document.getElementById('layer-opacity').oninput = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].opacity = e.target.value/100; renderCanvas(); }};
document.getElementById('layer-blend').onchange = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].blendMode = e.target.value; renderCanvas(); }};

window.onkeydown = (e) => { if(e.code==='Space') { isSpacePressed=true; canvas.style.cursor='grab'; } };
window.onkeyup = (e) => { if(e.code==='Space') { isSpacePressed=false; canvas.style.cursor='default'; } };
window.onresize = () => { canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight; renderCanvas(); };
document.getElementById('reset-btn').onclick = () => location.reload();
