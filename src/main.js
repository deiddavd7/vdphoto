import './style.css';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(err => console.error(err)));
}

const uploadInput = document.getElementById('upload-btn');
const canvas = document.getElementById('photo-canvas');
const ctx = canvas.getContext('2d');
const noPhotoMsg = document.getElementById('no-photo-msg');

const cropBtn = document.getElementById('crop-btn');
const sliders = {
    brightness: document.getElementById('brightness-slider'),
    contrast: document.getElementById('contrast-slider'),
    saturation: document.getElementById('saturation-slider'),
    sepia: document.getElementById('sepia-slider'),
    blur: document.getElementById('blur-slider'),
};
const values = {
    brightness: document.getElementById('brightness-val'),
    contrast: document.getElementById('contrast-val'),
    saturation: document.getElementById('saturation-val'),
    sepia: document.getElementById('sepia-val'),
    blur: document.getElementById('blur-val'),
};

let originalImage = null; 

// Variabili per lo strumento di Taglio
let isCropMode = false;
let isDragging = false;
let startPos = { x: 0, y: 0 };
let currentPos = { x: 0, y: 0 };

// --- MOTORE GRAFICO ---
function applyFilters() {
    if (!originalImage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = `
        brightness(${sliders.brightness.value}%) 
        contrast(${sliders.contrast.value}%) 
        saturate(${sliders.saturation.value}%) 
        sepia(${sliders.sepia.value}%) 
        blur(${sliders.blur.value}px)
    `;
    ctx.drawImage(originalImage, 0, 0);

    // Se stiamo tagliando e abbiamo trascinato il cursore, disegna il rettangolo tratteggiato
    if (isCropMode && (isDragging || Math.abs(currentPos.x - startPos.x) > 0)) {
        ctx.filter = 'none'; // Spegniamo i filtri per il pennello, altrimenti anche la linea viene sfocata!
        ctx.strokeStyle = '#007aff';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 10]); // Crea una linea tratteggiata
        ctx.strokeRect(startPos.x, startPos.y, currentPos.x - startPos.x, currentPos.y - startPos.y);
        ctx.setLineDash([]); // Resetta il pennello
    }
}

// Aggiorna filtri al movimento degli slider
Object.keys(sliders).forEach(key => {
    sliders[key].addEventListener('input', () => {
        const unit = key === 'blur' ? 'px' : '%';
        values[key].textContent = sliders[key].value + unit;
        applyFilters();
    });
});

// Caricamento Foto
uploadInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader(); 
        reader.onload = function(e) {
            const img = new Image(); 
            img.onload = function() {
                canvas.width = img.width; canvas.height = img.height;
                originalImage = img; 
                noPhotoMsg.style.display = 'none'; canvas.style.display = 'block';
                document.getElementById('reset-btn').click(); 
            };
            img.src = e.target.result; 
        };
        reader.readAsDataURL(file);
    }
});

// --- LOGICA DEL TAGLIO ---
cropBtn.addEventListener('click', () => {
    if (!originalImage) return;
    
    isCropMode = !isCropMode; // Accende/spegne la modalità
    cropBtn.classList.toggle('active-crop', isCropMode);
    
    if (isCropMode) {
        cropBtn.textContent = '✅ Conferma Taglio';
        startPos = { x: 0, y: 0 }; currentPos = { x: 0, y: 0 };
    } else {
        cropBtn.textContent = '✂️ Taglia Foto';
        
        // Se abbiamo disegnato un rettangolo abbastanza grande, eseguiamo il taglio
        const width = Math.abs(currentPos.x - startPos.x);
        const height = Math.abs(currentPos.y - startPos.y);
        
        if (width > 20 && height > 20) {
            executeCrop();
        } else {
            applyFilters(); // Se ha solo cliccato senza trascinare, cancella il rettangolo
        }
    }
});

function executeCrop() {
    const x = Math.min(startPos.x, currentPos.x);
    const y = Math.min(startPos.y, currentPos.y);
    const w = Math.abs(currentPos.x - startPos.x);
    const h = Math.abs(currentPos.y - startPos.y);

    // Creiamo una tela invisibile temporanea per "ritagliare" l'originale
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w; tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');

    // Ritagliamo solo la porzione che ci interessa
    tempCtx.drawImage(originalImage, x, y, w, h, 0, 0, w, h);

    // Sostituiamo l'immagine originale con quella ritagliata
    const newImg = new Image();
    newImg.onload = () => {
        originalImage = newImg;
        canvas.width = w; canvas.height = h;
        applyFilters(); // Riapplica i filtri alla nuova foto rimpicciolita
    };
    newImg.src = tempCanvas.toDataURL();
}

// Calcola le coordinate esatte del mouse/dito sulla tela
function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    // Supporto per il Touchscreen del telefono
    let clientX = e.clientX; let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX; clientY = e.touches[0].clientY;
    }
    
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

// Ascoltatori per il Mouse / Touch
const startDrag = (e) => {
    if (!isCropMode) return;
    isDragging = true;
    startPos = getCoords(e);
    currentPos = { ...startPos };
};
const moveDrag = (e) => {
    if (!isCropMode || !isDragging) return;
    currentPos = getCoords(e);
    applyFilters(); // Disegna in tempo reale il rettangolo mentre trascini
};
const stopDrag = () => {
    if (!isCropMode) return;
    isDragging = false;
};

canvas.addEventListener('mousedown', startDrag);
canvas.addEventListener('mousemove', moveDrag);
window.addEventListener('mouseup', stopDrag);

// Supporto per i telefoni
canvas.addEventListener('touchstart', startDrag, {passive: true});
canvas.addEventListener('touchmove', moveDrag, {passive: true});
window.addEventListener('touchend', stopDrag);

// --- ALTRI BOTTONI ---
document.getElementById('reset-btn').addEventListener('click', function() {
    if (!originalImage) return;
    sliders.brightness.value = 100; values.brightness.textContent = '100%';
    sliders.contrast.value = 100; values.contrast.textContent = '100%';
    sliders.saturation.value = 100; values.saturation.textContent = '100%';
    sliders.sepia.value = 0; values.sepia.textContent = '0%';
    sliders.blur.value = 0; values.blur.textContent = '0px';
    isCropMode = false; cropBtn.textContent = '✂️ Taglia Foto'; cropBtn.classList.remove('active-crop');
    applyFilters();
});

document.getElementById('download-btn').addEventListener('click', function() {
    if (!originalImage) return;
    const link = document.createElement('a');
    link.download = 'FastPhoto_Pro_Export.png';
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
});
