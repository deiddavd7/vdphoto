import './style.css';

const uploadInput = document.getElementById('upload-btn');
const canvas = document.getElementById('photo-canvas');
// willReadFrequently velocizza l'estrazione dei pixel ( getImageData )
const ctx = canvas.getContext('2d', { willReadFrequently: true }); 
const noPhotoMsg = document.getElementById('no-photo-msg');
const cropBtn = document.getElementById('crop-btn');
const rotateBtn = document.getElementById('rotate-btn');

// Selezioniamo tutti i nuovi controlli RAW
const s = {
    temp: document.getElementById('temp-slider'),
    tint: document.getElementById('tint-slider'),
    exp: document.getElementById('exposure-slider'),
    cont: document.getElementById('contrast-slider'),
    shadows: document.getElementById('shadows-slider'),
    highlights: document.getElementById('highlights-slider'),
    sat: document.getElementById('saturation-slider')
};

const v = {
    temp: document.getElementById('temp-val'),
    tint: document.getElementById('tint-val'),
    exp: document.getElementById('exposure-val'),
    cont: document.getElementById('contrast-val'),
    shadows: document.getElementById('shadows-val'),
    highlights: document.getElementById('highlights-val'),
    sat: document.getElementById('saturation-val')
};

let originalImage = null; 
let isCropMode = false; let isDragging = false;
let startPos = { x: 0, y: 0 }; let currentPos = { x: 0, y: 0 };

// IL NUOVO MOTORE DI COLOR GRADING MANUALE (Infallibile)
function applyFilters() {
    if (!originalImage) return;

    // 1. Disegniamo l'immagine originale pura per catturarne i pixel
    ctx.drawImage(originalImage, 0, 0);
    
    // 2. Estraiamo tutti i pixel (Array infinito di R,G,B,Alpha)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // 3. Leggiamo i valori scelti dall'utente
    const temp = parseInt(s.temp.value); // -50 a 50 (Blu/Giallo)
    const tint = parseInt(s.tint.value); // -50 a 50 (Verde/Magenta)
    const exp = parseInt(s.exp.value);   // -100 a 100
    const cont = parseInt(s.cont.value); // -100 a 100
    const shadows = parseInt(s.shadows.value); // -100 a 100
    const highlights = parseInt(s.highlights.value); // -100 a 100
    const sat = parseInt(s.sat.value) / 100; // 0.0 a 2.0

    const factor = (259 * (cont + 255)) / (255 * (259 - cont));

    // 4. Modifichiamo la foto PIXEL per PIXEL (La vera elaborazione RAW)
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i+1];
        let b = data[i+2];

        // --- Temperatura & Tinta ---
        r += temp; // Aggiunge rosso/giallo o toglie se negativo
        b -= temp; // L'opposto per il blu
        g += tint; // Verde o Magenta

        // --- Esposizione ---
        r += exp; g += exp; b += exp;

        // --- Contrasto ---
        r = factor * (r - 128) + 128;
        g = factor * (g - 128) + 128;
        b = factor * (b - 128) + 128;

        // Limita i valori tra 0 e 255 prima dei calcoli successivi
        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));

        // --- Ombre & Luci ---
        let lum = 0.299 * r + 0.587 * g + 0.114 * b; // Luminanza percepita
        if (shadows !== 0 && lum < 128) {
            let shadowMult = (128 - lum) / 128; // Applica l'effetto solo sulle zone scure
            r += shadows * shadowMult; g += shadows * shadowMult; b += shadows * shadowMult;
        }
        if (highlights !== 0 && lum > 128) {
            let highMult = (lum - 128) / 127; // Applica l'effetto solo sulle zone chiare
            r -= highlights * highMult; g -= highlights * highMult; b -= highlights * highMult;
        }

        // --- Saturazione ---
        lum = 0.299 * r + 0.587 * g + 0.114 * b; // Ricalcola luminanza
        r = lum + (r - lum) * sat;
        g = lum + (g - lum) * sat;
        b = lum + (b - lum) * sat;

        // Rimetti i pixel al loro posto
        data[i] = r;
        data[i+1] = g;
        data[i+2] = b;
    }

    // 5. Stampa la foto processata sul Canvas
    ctx.putImageData(imgData, 0, 0);

    // 6. Rettangolo di taglio (se attivo)
    if (isCropMode && (isDragging || Math.abs(currentPos.x - startPos.x) > 0)) {
        ctx.strokeStyle = '#007aff'; 
        ctx.lineWidth = 3; 
        ctx.setLineDash([8, 8]);
        ctx.strokeRect(startPos.x, startPos.y, currentPos.x - startPos.x, currentPos.y - startPos.y); 
        ctx.setLineDash([]);
    }
}

// Ascoltatori per gli slider
Object.keys(s).forEach(key => {
    s[key].addEventListener('input', () => {
        v[key].textContent = key === 'sat' ? s[key].value + '%' : s[key].value;
        applyFilters();
    });
});

// Caricamento Foto
uploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width; canvas.height = img.height;
                originalImage = img;
                noPhotoMsg.style.display = 'none'; canvas.style.display = 'block';
                document.getElementById('reset-btn').click();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Rotazione
rotateBtn.addEventListener('click', () => {
    if (!originalImage) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalImage.height; 
    tempCanvas.height = originalImage.width;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2);
    tempCtx.rotate(Math.PI / 2);
    tempCtx.drawImage(originalImage, -originalImage.width / 2, -originalImage.height / 2);

    const newImg = new Image();
    newImg.onload = () => {
        originalImage = newImg;
        canvas.width = tempCanvas.width;
        canvas.height = tempCanvas.height;
        applyFilters();
    };
    newImg.src = tempCanvas.toDataURL();
});

// Logica Taglio
cropBtn.addEventListener('click', () => {
    if (!originalImage) return;
    isCropMode = !isCropMode;
    cropBtn.classList.toggle('active-crop', isCropMode);
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
    newImg.onload = () => { originalImage = newImg; canvas.width = w; canvas.height = h; applyFilters(); };
    newImg.src = tempCanvas.toDataURL();
}

function getCoords(e) {
    const rect = canvas.getBoundingClientRect(); const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height;
    const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0); const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

const start = (e) => { if (!isCropMode) return; isDragging = true; startPos = getCoords(e); currentPos = { ...startPos }; };
const move = (e) => { if (!isCropMode || !isDragging) return; currentPos = getCoords(e); applyFilters(); };
const stop = () => { isDragging = false; };
canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
canvas.addEventListener('touchstart', start, {passive: false}); canvas.addEventListener('touchmove', move, {passive: false}); window.addEventListener('touchend', stop);

// Reset
document.getElementById('reset-btn').addEventListener('click', () => {
    if (!originalImage) return;
    Object.keys(s).forEach(k => { s[k].value = k === 'sat' ? 100 : 0; v[k].textContent = s[k].value + (k==='sat'?'%':''); });
    isCropMode = false; cropBtn.classList.remove('active-crop'); cropBtn.textContent = '✂️ Taglia';
    applyFilters();
});

// Esporta
document.getElementById('download-btn').addEventListener('click', () => {
    if (!originalImage) return;
    const link = document.createElement('a'); link.download = 'ColorGraded_Export.png'; link.href = canvas.toDataURL('image/png', 1.0); link.click();
});
