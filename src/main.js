import './style.css';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(e => console.error(e)));
}

const uploadInput = document.getElementById('upload-btn');
const canvas = document.getElementById('photo-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true }); 
const histCanvas = document.getElementById('hist-canvas');
const histCtx = histCanvas.getContext('2d');
const noPhotoMsg = document.getElementById('no-photo-msg');

const cropBtn = document.getElementById('crop-btn');
const rotateBtn = document.getElementById('rotate-btn');
const textBtn = document.getElementById('text-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

const textInput = document.getElementById('watermark-text');
const colorInput = document.getElementById('watermark-color');

const s = {
    temp: document.getElementById('temp-slider'), tint: document.getElementById('tint-slider'),
    exp: document.getElementById('exposure-slider'), cont: document.getElementById('contrast-slider'),
    shadows: document.getElementById('shadows-slider'), highlights: document.getElementById('highlights-slider'),
    sat: document.getElementById('saturation-slider')
};
const v = {
    temp: document.getElementById('temp-val'), tint: document.getElementById('tint-val'),
    exp: document.getElementById('exposure-val'), cont: document.getElementById('contrast-val'),
    shadows: document.getElementById('shadows-val'), highlights: document.getElementById('highlights-val'),
    sat: document.getElementById('saturation-val')
};

let originalImage = null; 
// Variabili Strumenti
let isCropMode = false; let isTextMode = false; let isDragging = false;
let startPos = { x: 0, y: 0 }; let currentPos = { x: 0, y: 0 };

// --- CRONOLOGIA (UNDO/REDO) ---
let history = [];
let historyIndex = -1;

function saveHistory() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalImage.width; tempCanvas.height = originalImage.height;
    tempCanvas.getContext('2d').drawImage(originalImage, 0, 0);
    
    // Taglia la storia se facciamo una nuova azione dopo un "Undo"
    history = history.slice(0, historyIndex + 1);
    history.push(tempCanvas.toDataURL());
    historyIndex++;
}

undoBtn.addEventListener('click', () => {
    if (historyIndex > 0) {
        historyIndex--;
        const img = new Image();
        img.onload = () => { originalImage = img; canvas.width = img.width; canvas.height = img.height; applyFilters(); };
        img.src = history[historyIndex];
    }
});

redoBtn.addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const img = new Image();
        img.onload = () => { originalImage = img; canvas.width = img.width; canvas.height = img.height; applyFilters(); };
        img.src = history[historyIndex];
    }
});


// --- MOTORE DI COLOR GRADING & ISTOGRAMMA ---
function drawHistogram(imgData) {
    histCtx.clearRect(0, 0, histCanvas.width, histCanvas.height);
    let lum = new Array(256).fill(0);
    
    for (let i = 0; i < imgData.data.length; i += 4) {
        let l = Math.round(0.299 * imgData.data[i] + 0.587 * imgData.data[i+1] + 0.114 * imgData.data[i+2]);
        if(l >= 0 && l <= 255) lum[l]++;
    }
    
    let max = Math.max(...lum);
    histCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    
    for (let i = 0; i < 256; i++) {
        let h = (lum[i] / max) * histCanvas.height;
        histCtx.fillRect(i * (histCanvas.width / 256), histCanvas.height - h, histCanvas.width / 256 + 0.5, h);
    }
}

function applyFilters() {
    if (!originalImage) return;

    ctx.drawImage(originalImage, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    const temp = parseInt(s.temp.value); const tint = parseInt(s.tint.value);
    const exp = parseInt(s.exp.value); const cont = parseInt(s.cont.value);
    const shadows = parseInt(s.shadows.value); const highlights = parseInt(s.highlights.value);
    const sat = parseInt(s.sat.value) / 100;
    const factor = (259 * (cont + 255)) / (255 * (259 - cont));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i]; let g = data[i+1]; let b = data[i+2];

        r += temp; b -= temp; g += tint;
        r += exp; g += exp; b += exp;

        r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;

        r = Math.min(255, Math.max(0, r)); g = Math.min(255, Math.max(0, g)); b = Math.min(255, Math.max(0, b));

        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (shadows !== 0 && lum < 128) { let sm = (128 - lum) / 128; r += shadows * sm; g += shadows * sm; b += shadows * sm; }
        if (highlights !== 0 && lum > 128) { let hm = (lum - 128) / 127; r -= highlights * hm; g -= highlights * hm; b -= highlights * hm; }

        lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;

        data[i] = r; data[i+1] = g; data[i+2] = b;
    }

    ctx.putImageData(imgData, 0, 0);
    drawHistogram(imgData); // Aggiorna l'istogramma in tempo reale!

    if (isCropMode && (isDragging || Math.abs(currentPos.x - startPos.x) > 0)) {
        ctx.strokeStyle = '#007aff'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
        ctx.strokeRect(startPos.x, startPos.y, currentPos.x - startPos.x, currentPos.y - startPos.y); ctx.setLineDash([]);
    }
}

Object.keys(s).forEach(key => {
    s[key].addEventListener('input', () => {
        v[key].textContent = key === 'sat' ? s[key].value + '%' : s[key].value;
        applyFilters();
    });
});

uploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width; canvas.height = img.height;
                originalImage = img;
                history = []; historyIndex = -1; // Resetta cronologia
                saveHistory(); // Salva stato base
                noPhotoMsg.style.display = 'none'; canvas.style.display = 'block';
                document.getElementById('reset-btn').click();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// --- STRUMENTI FOTOGRAFICI ---
function setSliders(b, c, sVal, sep, blur) {
    if (!originalImage) return;
    s.exp.value = b; v.exp.textContent = b;
    s.cont.value = c; v.cont.textContent = c;
    s.sat.value = sVal; v.sat.textContent = sVal + '%';
    s.temp.value = sep; v.temp.textContent = sep;
    s.tint.value = blur; v.tint.textContent = blur;
    s.shadows.value = 0; v.shadows.textContent = '0';
    s.highlights.value = 0; v.highlights.textContent = '0';
    applyFilters();
}

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const p = e.target.dataset.preset;
        if (p === 'normal') setSliders(0, 0, 100, 0, 0);
        if (p === 'vintage') setSliders(10, -10, 80, 20, -10);
        if (p === 'cinematic') setSliders(-10, 30, 80, -10, 10);
        if (p === 'bw') setSliders(0, 40, 0, 0, 0);
    });
});

rotateBtn.addEventListener('click', () => {
    if (!originalImage) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalImage.height; tempCanvas.height = originalImage.width;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    tempCtx.rotate(Math.PI / 2);
    tempCtx.drawImage(originalImage, -originalImage.width / 2, -originalImage.height / 2);

    const newImg = new Image();
    newImg.onload = () => {
        originalImage = newImg; canvas.width = tempCanvas.width; canvas.height = tempCanvas.height;
        saveHistory(); // Salva nella cronologia!
        applyFilters();
    };
    newImg.src = tempCanvas.toDataURL();
});

// TESTO / WATERMARK
textBtn.addEventListener('click', () => {
    if (!originalImage) return;
    if (isCropMode) cropBtn.click(); // Spegne il crop se attivo
    isTextMode = !isTextMode;
    textBtn.classList.toggle('active-action', isTextMode);
    canvas.style.cursor = isTextMode ? 'text' : 'crosshair';
});

// TAGLIO
cropBtn.addEventListener('click', () => {
    if (!originalImage) return;
    if (isTextMode) textBtn.click(); // Spegne il testo se attivo
    isCropMode = !isCropMode;
    cropBtn.classList.toggle('active-action', isCropMode);
    cropBtn.textContent = isCropMode ? '✅ Conferma' : '✂️ Taglia';
    if (!isCropMode && Math.abs(currentPos.x - startPos.x) > 20) executeCrop();
    applyFilters();
});

function executeCrop() {
    const x = Math.min(startPos.x, currentPos.x); const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x); const h = Math.abs(currentPos.y - startPos.y);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w; tempCanvas.height = h;
    tempCanvas.getContext('2d').drawImage(originalImage, x, y, w, h, 0, 0, w, h);
    const newImg = new Image();
    newImg.onload = () => { 
        originalImage = newImg; canvas.width = w; canvas.height = h; 
        saveHistory(); // Salva nella cronologia!
        applyFilters(); 
    };
    newImg.src = tempCanvas.toDataURL();
}

// GESTIONE MOUSE / TOUCH SULLA TELA
function getCoords(e) {
    const rect = canvas.getBoundingClientRect(); const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height;
    const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0); const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

const start = (e) => { 
    if (!originalImage) return;
    
    // Logica se stiamo aggiungendo testo
    if (isTextMode && textInput.value.trim() !== '') {
        const coords = getCoords(e);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
        const tCtx = tempCanvas.getContext('2d');
        tCtx.drawImage(originalImage, 0, 0);
        
        tCtx.font = "bold 60px -apple-system, sans-serif";
        tCtx.fillStyle = colorInput.value;
        tCtx.fillText(textInput.value, coords.x, coords.y);
        
        const newImg = new Image();
        newImg.onload = () => {
            originalImage = newImg;
            saveHistory(); // Salva nella cronologia!
            applyFilters();
        }
        newImg.src = tempCanvas.toDataURL();
        
        // Spegniamo il tool del testo dopo averlo posizionato
        textBtn.click();
        return;
    }

    if (!isCropMode) return; 
    isDragging = true; startPos = getCoords(e); currentPos = { ...startPos }; 
};

const move = (e) => { if (!isCropMode || !isDragging) return; currentPos = getCoords(e); applyFilters(); };
const stop = () => { isDragging = false; };

canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
canvas.addEventListener('touchstart', start, {passive: false}); canvas.addEventListener('touchmove', move, {passive: false}); window.addEventListener('touchend', stop);

document.getElementById('reset-btn').addEventListener('click', () => {
    if (!originalImage) return;
    setSliders(0, 0, 100, 0, 0);
    isCropMode = false; cropBtn.classList.remove('active-action'); cropBtn.textContent = '✂️ Taglia';
    isTextMode = false; textBtn.classList.remove('active-action'); canvas.style.cursor = 'crosshair';
});

document.getElementById('download-btn').addEventListener('click', () => {
    if (!originalImage) return;
    const link = document.createElement('a'); link.download = 'FastPhoto_Pro_Export.png'; link.href = canvas.toDataURL('image/png', 1.0); link.click();
});

