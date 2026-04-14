import './style.css';

const workspace = document.getElementById('workspace');
const canvas = document.getElementById('photo-canvas');
const ctx = canvas.getContext('2d'); 
const offscreenCanvas = document.createElement('canvas');
const offCtx = offscreenCanvas.getContext('2d'); // Rimosso willReadFrequently per compatibilità Safari
const histCanvas = document.getElementById('hist-canvas');
const histCtx = histCanvas.getContext('2d');

const noPhotoMsg = document.getElementById('no-photo-msg');
const zoomValDisplay = document.getElementById('zoom-val');

const cropBtn = document.getElementById('crop-btn');
const rotateBtn = document.getElementById('rotate-btn');
const textBtn = document.getElementById('text-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

let history = [];
let historyIndex = -1;

function saveHistory() {
    if (layers.length === 0) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = layers[0].w; 
    tempCanvas.height = layers[0].h;
    tempCanvas.getContext('2d').drawImage(layers[0].img, 0, 0);
    
    history = history.slice(0, historyIndex + 1);
    history.push(tempCanvas.toDataURL());
    historyIndex++;
}

if (undoBtn) undoBtn.addEventListener('click', () => {
    if (historyIndex > 0) {
        historyIndex--;
        const img = new Image();
        img.onload = () => { layers[0].img = img; layers[0].w = img.width; layers[0].h = img.height; updateBaseFilters(); fitToScreen(); };
        img.src = history[historyIndex];
    }
});

if (redoBtn) redoBtn.addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const img = new Image();
        img.onload = () => { layers[0].img = img; layers[0].w = img.width; layers[0].h = img.height; updateBaseFilters(); fitToScreen(); };
        img.src = history[historyIndex];
    }
});

// --- SISTEMA LIVELLI ---
let layers = [];
let activeLayerIndex = -1;

const layerSettingsPanel = document.getElementById('layer-settings');
const layerOpacitySlider = document.getElementById('layer-opacity');
const layerOpacityVal = document.getElementById('layer-opacity-val');
const layerBlendSelect = document.getElementById('layer-blend');

function addLayer(img, name) {
    layers.push({
        id: Date.now(),
        name: name,
        img: img,
        x: layers.length === 0 ? 0 : (canvas.width/scale - img.width)/2, 
        y: layers.length === 0 ? 0 : (canvas.height/scale - img.height)/2,
        w: img.width,
        h: img.height,
        visible: true,
        opacity: 1, 
        blendMode: 'source-over' 
    });
    activeLayerIndex = layers.length - 1;
    updateLayersUI();
    
    if(layers.length === 1) {
        history = []; historyIndex = -1; saveHistory();
        updateBaseFilters(); 
    } else {
        renderCanvas();
    }
}

function updateLayersUI() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    list.innerHTML = '';
    layers.forEach((layer, index) => {
        const div = document.createElement('div');
        div.className = `layer-item ${index === activeLayerIndex ? 'active' : ''}`;
        div.innerHTML = `
            <span>${layer.name}</span>
            <span class="layer-visibility" data-index="${index}">${layer.visible ? '👁️' : '🚫'}</span>
        `;
        div.onclick = (e) => {
            if(e.target.classList.contains('layer-visibility')) {
                layer.visible = !layer.visible;
            } else {
                activeLayerIndex = index;
            }
            updateLayersUI();
            renderCanvas();
        };
        list.appendChild(div);
    });

    if(layerSettingsPanel && activeLayerIndex > 0) {
        layerSettingsPanel.style.display = 'block';
        if (layerOpacitySlider) layerOpacitySlider.value = layers[activeLayerIndex].opacity * 100;
        if (layerOpacityVal) layerOpacityVal.textContent = Math.round(layers[activeLayerIndex].opacity * 100) + '%';
        if (layerBlendSelect) layerBlendSelect.value = layers[activeLayerIndex].blendMode;
    } else if (layerSettingsPanel) {
        layerSettingsPanel.style.display = 'none';
    }
}

if (layerOpacitySlider) layerOpacitySlider.addEventListener('input', (e) => {
    if(activeLayerIndex > 0) {
        layers[activeLayerIndex].opacity = e.target.value / 100;
        layerOpacityVal.textContent = e.target.value + '%';
        renderCanvas();
    }
});

if (layerBlendSelect) layerBlendSelect.addEventListener('change', (e) => {
    if(activeLayerIndex > 0) {
        layers[activeLayerIndex].blendMode = e.target.value;
        renderCanvas();
    }
});

const delBtn = document.getElementById('del-layer-btn');
if (delBtn) delBtn.addEventListener('click', () => {
    if (activeLayerIndex > 0) { 
        layers.splice(activeLayerIndex, 1);
        activeLayerIndex = layers.length - 1;
        updateLayersUI();
        renderCanvas();
    } else {
        alert("Non puoi eliminare il livello di Sfondo!");
    }
});

// SEQUENZA DI CARICAMENTO CORAZZATA
document.getElementById('upload-btn').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                // 1. Accendiamo l'interfaccia prima di fare calcoli
                const zc = document.querySelector('.zoom-controls');
                if (zc) zc.style.display = 'flex';
                if (noPhotoMsg) noPhotoMsg.style.display = 'none';
                canvas.style.display = 'block';
                
                // 2. Impostiamo le dimensioni corrette
                canvas.width = workspace.clientWidth; 
                canvas.height = workspace.clientHeight;
                
                // 3. Aggiungiamo il livello e calcoliamo i filtri
                layers = []; 
                addLayer(img, "Sfondo");
                
                // 4. Centriamo l'immagine
                fitToScreen();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
    // Resetta l'input per poter ricaricare la stessa foto se serve
    e.target.value = "";
});

const addLayerBtn = document.getElementById('add-layer-btn');
if (addLayerBtn) addLayerBtn.addEventListener('change', (e) => {
    if(layers.length === 0) return alert("Carica prima uno sfondo!");
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => addLayer(img, `Livello ${layers.length}`);
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
    e.target.value = ""; 
});

// --- MOTORE SVILUPPO ---
const effectOpacitySlider = document.getElementById('effect-opacity-slider');
const effectOpacityVal = document.getElementById('effect-opacity-val');

const s = { temp: document.getElementById('temp-slider'), tint: document.getElementById('tint-slider'), exp: document.getElementById('exposure-slider'), cont: document.getElementById('contrast-slider'), shadows: document.getElementById('shadows-slider'), highlights: document.getElementById('highlights-slider'), sat: document.getElementById('saturation-slider') };
const v = { temp: document.getElementById('temp-val'), tint: document.getElementById('tint-val'), exp: document.getElementById('exposure-val'), cont: document.getElementById('contrast-val'), shadows: document.getElementById('shadows-val'), highlights: document.getElementById('highlights-val'), sat: document.getElementById('saturation-val') };

function getSliderValue(slider, defaultVal) { return slider ? parseFloat(slider.value) : defaultVal; }

function updateBaseFilters() {
    if (layers.length === 0) return;
    const baseLayer = layers[0];
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = baseLayer.w; tempCanvas.height = baseLayer.h;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(baseLayer.img, 0, 0);
    
    const imgData = tCtx.getImageData(0, 0, baseLayer.w, baseLayer.h);
    const data = imgData.data;

    const temp = getSliderValue(s.temp, 0); 
    const tint = getSliderValue(s.tint, 0); 
    const exp = getSliderValue(s.exp, 0); 
    const cont = getSliderValue(s.cont, 0); 
    const shadows = getSliderValue(s.shadows, 0); 
    const highlights = getSliderValue(s.highlights, 0); 
    const sat = getSliderValue(s.sat, 100) / 100;
    
    const factor = (259 * (cont + 255)) / (255 * (259 - cont));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i]; let g = data[i+1]; let b = data[i+2];
        r += temp; b -= temp; g += tint; r += exp; g += exp; b += exp;
        r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;
        r = Math.min(255, Math.max(0, r)); g = Math.min(255, Math.max(0, g)); b = Math.min(255, Math.max(0, b));
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (shadows !== 0 && lum < 128) { let sm = (128 - lum) / 128; r += shadows * sm; g += shadows * sm; b += shadows * sm; }
        if (highlights !== 0 && lum > 128) { let hm = (lum - 128) / 127; r -= highlights * hm; g -= highlights * hm; b -= highlights * hm; }
        lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
        data[i] = r; data[i+1] = g; data[i+2] = b;
    }
    tCtx.putImageData(imgData, 0, 0);
    
    offscreenCanvas.width = baseLayer.w; offscreenCanvas.height = baseLayer.h;
    offCtx.clearRect(0, 0, baseLayer.w, baseLayer.h);
    offCtx.drawImage(baseLayer.img, 0, 0);
    
    // Fusione Trasparenza Sicura
    const effectAlpha = effectOpacitySlider ? parseInt(effectOpacitySlider.value) / 100 : 1.0;
    offCtx.globalAlpha = effectAlpha;
    offCtx.drawImage(tempCanvas, 0, 0);
    offCtx.globalAlpha = 1.0; 

    const finalData = offCtx.getImageData(0, 0, baseLayer.w, baseLayer.h);
    histCtx.clearRect(0, 0, histCanvas.width, histCanvas.height);
    let lumArr = new Array(256).fill(0);
    for (let i = 0; i < finalData.data.length; i += 4) { let l = Math.round(0.299 * finalData.data[i] + 0.587 * finalData.data[i+1] + 0.114 * finalData.data[i+2]); if(l >= 0 && l <= 255) lumArr[l]++; }
    let max = Math.max(...lumArr); histCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (let i = 0; i < 256; i++) { let h = (lumArr[i] / max) * histCanvas.height; histCtx.fillRect(i * (histCanvas.width / 256), histCanvas.height - h, histCanvas.width / 256 + 0.5, h); }
    
    renderCanvas();
}

Object.keys(s).forEach(key => { 
    if (s[key]) {
        s[key].addEventListener('input', () => { 
            if (v[key]) v[key].textContent = key === 'sat' ? s[key].value + '%' : s[key].value; 
            updateBaseFilters(); 
        }); 
    }
});

if (effectOpacitySlider) {
    effectOpacitySlider.addEventListener('input', (e) => {
        if (effectOpacityVal) effectOpacityVal.textContent = e.target.value + '%';
        updateBaseFilters();
    });
}

function setSliders(t, ti, e, c, sh, hi, sa) {
    if (layers.length === 0) return;
    if (s.temp) { s.temp.value = t; v.temp.textContent = t; }
    if (s.tint) { s.tint.value = ti; v.tint.textContent = ti; }
    if (s.exp) { s.exp.value = e; v.exp.textContent = e; }
    if (s.cont) { s.cont.value = c; v.cont.textContent = c; }
    if (s.shadows) { s.shadows.value = sh; v.shadows.textContent = sh; }
    if (s.highlights) { s.highlights.value = hi; v.highlights.textContent = hi; }
    if (s.sat) { s.sat.value = sa; v.sat.textContent = sa + '%'; }
    
    if (effectOpacitySlider) {
        effectOpacitySlider.value = 100;
        if (effectOpacityVal) effectOpacityVal.textContent = '100%';
    }
    updateBaseFilters();
}

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (layers.length === 0) return;
        const p = e.target.dataset.preset;
        if (p === 'normal') setSliders(0, 0, 0, 0, 0, 0, 100);
        if (p === 'vintage') setSliders(20, 10, 10, -10, 10, -10, 80);
        if (p === 'cinematic') setSliders(-10, 10, -10, 30, 0, 0, 80);
        if (p === 'bw') setSliders(0, 0, 0, 40, 0, 0, 0);
    });
});

function renderCanvas() {
    if (layers.length === 0) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(scale, scale);
    
    layers.forEach((layer, index) => {
        if (!layer.visible) return;
        ctx.save(); 
        if (index === 0) {
            ctx.drawImage(offscreenCanvas, layer.x, layer.y, layer.w, layer.h);
        } else {
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
        }
        ctx.restore(); 

        if (index === activeLayerIndex && index !== 0) {
            ctx.strokeStyle = '#007aff'; ctx.lineWidth = 2 / scale;
            ctx.strokeRect(layer.x, layer.y, layer.w, layer.h);
        }
    });
    
    if (isCropMode && (isDragging || Math.abs(currentPos.x - startPos.x) > 0)) {
        ctx.strokeStyle = '#007aff'; ctx.lineWidth = 3 / scale; 
        ctx.setLineDash([8 / scale, 8 / scale]);
        ctx.strokeRect(startPos.x, startPos.y, currentPos.x - startPos.x, currentPos.y - startPos.y); 
        ctx.setLineDash([]);
    }

    ctx.restore();
}

let scale = 1; let panX = 0; let panY = 0;
let isSpacePressed = false; let isPanning = false; let isDraggingLayer = false;
let startPan = {x: 0, y: 0}; let startLayerPos = {x:0, y:0};

function setZoom(newScale, focalX = canvas.width/2, focalY = canvas.height/2) {
    if(layers.length === 0) return;
    const oldScale = scale; scale = Math.max(0.1, Math.min(newScale, 5));
    panX = focalX - (focalX - panX) * (scale / oldScale); panY = focalY - (focalY - panY) * (scale / oldScale);
    if (zoomValDisplay) zoomValDisplay.textContent = Math.round(scale * 100) + '%'; 
    renderCanvas();
}
function fitToScreen() {
    if(layers.length === 0) return;
    const base = layers[0]; const pad = 40;
    const scaleX = (workspace.clientWidth - pad) / base.w; const scaleY = (workspace.clientHeight - pad) / base.h;
    scale = Math.min(scaleX, scaleY, 1); 
    panX = (workspace.clientWidth - base.w * scale) / 2; panY = (workspace.clientHeight - base.h * scale) / 2;
    if (zoomValDisplay) zoomValDisplay.textContent = Math.round(scale * 100) + '%'; 
    renderCanvas();
}

window.addEventListener('resize', () => {
    if(layers.length > 0) {
        canvas.width = workspace.clientWidth;
        canvas.height = workspace.clientHeight;
        renderCanvas();
    }
});

const zIn = document.getElementById('zoom-in'); if (zIn) zIn.onclick = () => setZoom(scale * 1.2);
const zOut = document.getElementById('zoom-out'); if (zOut) zOut.onclick = () => setZoom(scale / 1.2);
const zFit = document.getElementById('zoom-fit'); if (zFit) zFit.onclick = fitToScreen;

canvas.addEventListener('wheel', (e) => { e.preventDefault(); const rect = canvas.getBoundingClientRect(); setZoom(e.deltaY < 0 ? scale * 1.1 : scale / 1.1, e.clientX - rect.left, e.clientY - rect.top); }, {passive: false});

window.addEventListener('keydown', (e) => { if(e.code === 'Space' && e.target.tagName !== 'INPUT') { isSpacePressed = true; canvas.style.cursor = 'grab'; }});
window.addEventListener('keyup', (e) => { if(e.code === 'Space') { isSpacePressed = false; isPanning = false; canvas.style.cursor = 'default'; }});

function getRealCoords(e) {
    const rect = canvas.getBoundingClientRect(); const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0); const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    return { x: (clientX - rect.left - panX) / scale, y: (clientY - rect.top - panY) / scale };
}

canvas.addEventListener('mousedown', (e) => {
    if (layers.length === 0) return;
    
    if (isTextMode && document.getElementById('watermark-text').value.trim() !== '') {
        const coords = getRealCoords(e);
        const tCtx = document.createElement('canvas').getContext('2d');
        tCtx.canvas.width = layers[0].w; tCtx.canvas.height = layers[0].h;
        tCtx.drawImage(layers[0].img, 0, 0);
        tCtx.font = "bold 60px -apple-system, sans-serif";
        tCtx.fillStyle = document.getElementById('watermark-color').value;
        tCtx.fillText(document.getElementById('watermark-text').value, coords.x, coords.y);
        
        const newImg = new Image();
        newImg.onload = () => { layers[0].img = newImg; saveHistory(); updateBaseFilters(); }
        newImg.src = tCtx.canvas.toDataURL();
        if (textBtn) textBtn.click();
        return;
    }

    if(isSpacePressed || e.button === 1) { 
        isPanning = true; canvas.style.cursor = 'grabbing';
        startPan = { x: (e.clientX||e.touches[0].clientX) - panX, y: (e.clientY||e.touches[0].clientY) - panY };
        return;
    }
    
    if (isCropMode) {
        isDragging = true; startPos = getRealCoords(e); currentPos = { ...startPos }; 
        return;
    }

    if (activeLayerIndex > 0) {
        const coords = getRealCoords(e);
        const l = layers[activeLayerIndex];
        if (coords.x >= l.x && coords.x <= l.x + l.w && coords.y >= l.y && coords.y <= l.y + l.h) {
            isDraggingLayer = true;
            startLayerPos = { mouseX: coords.x, mouseY: coords.y, layerX: l.x, layerY: l.y };
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if(isPanning) {
        panX = (e.clientX||e.touches[0].clientX) - startPan.x; panY = (e.clientY||e.touches[0].clientY) - startPan.y; renderCanvas();
    } else if (isDraggingLayer) {
        const coords = getRealCoords(e);
        const l = layers[activeLayerIndex];
        l.x = startLayerPos.layerX + (coords.x - startLayerPos.mouseX);
        l.y = startLayerPos.layerY + (coords.y - startLayerPos.mouseY);
        renderCanvas();
    } else if (isCropMode && isDragging) {
        currentPos = getRealCoords(e); 
        renderCanvas();
    }
});

window.addEventListener('mouseup', () => { isPanning = false; isDraggingLayer = false; isDragging = false; if(isSpacePressed) canvas.style.cursor = 'grab'; });

if (textBtn) textBtn.addEventListener('click', () => {
    if (layers.length === 0) return;
    if (isCropMode && cropBtn) cropBtn.click(); 
    isTextMode = !isTextMode;
    textBtn.classList.toggle('active-action', isTextMode);
    canvas.style.cursor = isTextMode ? 'text' : 'default';
});

if (rotateBtn) rotateBtn.addEventListener('click', () => {
    if (layers.length === 0) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = layers[0].h; tempCanvas.height = layers[0].w;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    tempCtx.rotate(Math.PI / 2);
    tempCtx.drawImage(layers[0].img, -layers[0].w / 2, -layers[0].h / 2);
    const newImg = new Image();
    newImg.onload = () => { 
        layers[0].img = newImg; layers[0].w = newImg.width; layers[0].h = newImg.height; 
        saveHistory(); updateBaseFilters(); fitToScreen(); 
    };
    newImg.src = tempCanvas.toDataURL();
});

if (cropBtn) cropBtn.addEventListener('click', () => {
    if (layers.length === 0) return;
    if (isTextMode && textBtn) textBtn.click(); 
    isCropMode = !isCropMode;
    cropBtn.classList.toggle('active-action', isCropMode);
    cropBtn.textContent = isCropMode ? '✅ Conferma' : '✂️ Taglia';
    canvas.style.cursor = isCropMode ? 'crosshair' : 'default';
    if (!isCropMode && Math.abs(currentPos.x - startPos.x) > 20) {
        const x = Math.min(startPos.x, currentPos.x); const y = Math.min(startPos.y, currentPos.y);
        const w = Math.abs(currentPos.x - startPos.x); const h = Math.abs(currentPos.y - startPos.y);
        const tempCanvas = document.createElement('canvas'); tempCanvas.width = w; tempCanvas.height = h;
        tempCanvas.getContext('2d').drawImage(layers[0].img, x, y, w, h, 0, 0, w, h);
        const newImg = new Image();
        newImg.onload = () => { 
            layers[0].img = newImg; layers[0].w = w; layers[0].h = h; 
            saveHistory(); updateBaseFilters(); fitToScreen(); 
        };
        newImg.src = tempCanvas.toDataURL();
    }
    renderCanvas();
});

const resetBtn = document.getElementById('reset-btn');
if (resetBtn) resetBtn.addEventListener('click', () => {
    if (layers.length === 0) return;
    setSliders(0, 0, 0, 0, 0, 0, 100);
    if (effectOpacitySlider) { effectOpacitySlider.value = 100; if(effectOpacityVal) effectOpacityVal.textContent = '100%'; }
    isCropMode = false; if (cropBtn) { cropBtn.classList.remove('active-action'); cropBtn.textContent = '✂️ Taglia'; }
    isTextMode = false; if (textBtn) { textBtn.classList.remove('active-action'); }
    canvas.style.cursor = 'default';
    updateBaseFilters();
});

const dwnBtn = document.getElementById('download-btn');
if (dwnBtn) dwnBtn.addEventListener('click', () => {
    if (layers.length === 0) return;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = layers[0].w; exportCanvas.height = layers[0].h;
    const expCtx = exportCanvas.getContext('2d');
    
    layers.forEach((layer, index) => {
        if(!layer.visible) return;
        expCtx.save(); 
        if(index === 0) {
            expCtx.drawImage(offscreenCanvas, 0, 0); 
        } else {
            expCtx.globalAlpha = layer.opacity;
            expCtx.globalCompositeOperation = layer.blendMode;
            expCtx.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h); 
        }
        expCtx.restore();
    });
    
    const link = document.createElement('a'); link.download = 'FastPhoto_Pro_Export.png'; link.href = exportCanvas.toDataURL('image/png', 1.0); link.click();
});

