import './style.css';

// 1. Selezioniamo gli elementi dell'interfaccia
const uploadInput = document.getElementById('upload-btn');
const canvas = document.getElementById('photo-canvas');
const ctx = canvas.getContext('2d');
const bwBtn = document.getElementById('bw-btn');
const resetBtn = document.getElementById('reset-btn');

// Nuovi elementi dello slider
const brightnessSlider = document.getElementById('brightness-slider');
const brightnessVal = document.getElementById('brightness-val');

let originalImage = null; 

// 2. Caricamento Foto
uploadInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    
    if (file) {
        const reader = new FileReader(); 
        
        reader.onload = function(e) {
            const img = new Image(); 
            
            img.onload = function() {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                originalImage = img; 
                
                // Quando carichiamo una foto nuova, azzeriamo lo slider!
                brightnessSlider.value = 0;
                brightnessVal.textContent = '0';
            };
            
            img.src = e.target.result; 
        };
        
        reader.readAsDataURL(file);
    }
});

// 3. Filtro Bianco e Nero
bwBtn.addEventListener('click', function() {
    if (!originalImage) return; 

    // Qui applichiamo il B/N direttamente su quello che si vede attualmente sulla tela
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data; 
    
    for (let i = 0; i < pixels.length; i += 4) {
        let rosso = pixels[i];
        let verde = pixels[i + 1];
        let blu = pixels[i + 2];
        
        let media = (rosso + verde + blu) / 3;
        
        pixels[i] = media;       
        pixels[i + 1] = media;   
        pixels[i + 2] = media;   
    }
    
    ctx.putImageData(imageData, 0, 0);
});

// 4. REGOLAZIONE LUMINOSITÀ IN TEMPO REALE
// Usiamo 'input' invece di 'click' così si aggiorna mentre trascini!
brightnessSlider.addEventListener('input', function() {
    if (!originalImage) return;

    // Prendiamo il numero dallo slider (da -100 a +100) e aggiorniamo il testo
    const adjustment = parseInt(brightnessSlider.value);
    brightnessVal.textContent = adjustment;

    // A. Prima di tutto, ridisegniamo l'immagine originale pulita sulla tela
    ctx.drawImage(originalImage, 0, 0);

    // B. Prendiamo i pixel puliti
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    // C. Modifichiamo la luminosità aggiungendo o togliendo il valore dello slider
    for (let i = 0; i < pixels.length; i += 4) {
        // Il browser sa già che un colore non può superare il 255 o andare sotto lo 0, 
        // quindi possiamo tranquillamente sommare e sottrarre
        pixels[i] += adjustment;       // R
        pixels[i + 1] += adjustment;   // G
        pixels[i + 2] += adjustment;   // B
    }

    // D. Rimettiamo l'immagine modificata sulla tela
    ctx.putImageData(imageData, 0, 0);
});

// 5. Tasto Reset
resetBtn.addEventListener('click', function() {
    if (!originalImage) return; 
    
    // Ridisegna la foto
    ctx.drawImage(originalImage, 0, 0);
    
    // Riporta lo slider a zero
    brightnessSlider.value = 0;
    brightnessVal.textContent = '0';
});
