import './style.css';

// ============================================================================
// 1. DATABASE & PROJECTS SYSTEM
// ============================================================================
const DB_NAME = 'FastPhotoDB'; let db;
async function initDB() {
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            let d = e.target.result;
            if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
            if (!d.objectStoreNames.contains('photos')) { let ps = d.createObjectStore('photos', { keyPath: 'id' }); ps.createIndex('folderId', 'folderId'); }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(); };
    });
}
function dbPut(s, d) { return new Promise(res => { let tx = db.transaction(s, 'readwrite'); tx.objectStore(s).put(d); tx.oncomplete = () => res(); }); }
function dbGetAll(s) { return new Promise(res => { let tx = db.transaction(s, 'readonly'); let req = tx.objectStore(s).getAll(); req.onsuccess = () => res(req.result); }); }
function dbGetByIndex(s, i, v) { return new Promise(res => { let tx = db.transaction(s, 'readonly'); let req = tx.objectStore(s).index(i).getAll(v); req.onsuccess = () => res(req.result); }); }

// ============================================================================
// 2. GPU WEBGL ENGINE
// ============================================================================
const glCanvas = document.getElementById('webgl-canvas');
const gl = glCanvas.getContext('webgl', { preserveDrawingBuffer: true });

const vertexShaderSource = `attribute vec2 a_p; attribute vec2 a_t; varying vec2 v_t; void main(){ gl_Position=vec4(a_p,0,1); v_t=a_t; }`;
const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_i; uniform sampler2D u_c;
    uniform float u_exp, u_cont, u_shadows, u_high, u_sat, u_clpS, u_clpH;
    uniform vec3 u_lift, u_gamma, u_gain;
    varying vec2 v_t;

    vec3 rgb2hsl(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y); float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }
    vec3 hsl2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
        vec4 color = texture2D(u_i, v_t);
        vec3 rgb = color.rgb;

        rgb = rgb * (1.0 - u_lift) + u_lift;
        rgb = pow(max(vec3(0.0), rgb), 1.0 / max(vec3(0.01), 1.0 + u_gamma));
        rgb = rgb * (1.0 + u_gain);

        rgb.r = texture2D(u_c, vec2(rgb.r, 0.5)).r;
        rgb.g = texture2D(u_c, vec2(rgb.g, 0.5)).g;
        rgb.b = texture2D(u_c, vec2(rgb.b, 0.5)).b;

        rgb.r += u_exp; rgb.b += u_exp; rgb.g += u_exp;
        float f = (259.0 * (u_cont * 255.0 + 255.0)) / (255.0 * (259.0 - u_cont * 255.0));
        rgb = f * (rgb - 0.5) + 0.5;
        
        vec3 hsl = rgb2hsl(clamp(rgb, 0.0, 1.0));
        if(u_shadows > 0.0 && hsl.z < 0.4) rgb += (u_shadows * (0.4 - hsl.z) * 1.5);
        if(u_high > 0.0 && hsl.z > 0.6) rgb -= (u_high * (hsl.z - 0.6) * 1.5);

        hsl = rgb2hsl(clamp(rgb, 0.0, 1.0)); hsl.y *= u_sat; rgb = hsl2rgb(hsl);

        if (u_clpS == 1.0 && length(rgb) < 0.05) rgb = vec3(0,0,1);
        else if (u_clpH == 1.0 && length(rgb) > 1.6) rgb = vec3(1,0,0);

        gl_FragColor = vec4(rgb, color.a);
    }
`;

const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, vertexShaderSource); gl.compileShader(vs);
const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fragmentShaderSource); gl.compileShader(fs);
const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
const pBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
const tBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1, 1,1, 0,0, 0,0, 1,1, 1,0]), gl.STATIC_DRAW);
const iTex = gl.createTexture(); const cTex = gl.createTexture();

// ============================================================================
// 3. MAIN STATE & UI ELEMENTS (Aggiunto Video)
// ============================================================================
const workspace = document.getElementById('workspace');
const canvas = document.getElementById('photo-canvas'); const ctx = canvas.getContext('2d');
const offCanvas = document.createElement('canvas'); const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
const histCanvas = document.getElementById('hist-canvas'); const histCtx = histCanvas.getContext('2d');

let videoElement = null; 
let isVideoPlaying = false;

let currentFolderId = null;
let layers = []; let activeLayerIndex = -1; let scale = 1, panX = 0, panY = 0; let isSplitView = false, splitPos = 0.5;
let isPanning = false, isSpacePressed = false, startPan = {x:0, y:0}, isDraggingLayer = false, startLayerPos = {x:0, y:0};
let showShadowClipping = false, showHighlightClipping = false, isExporting = false;
let isCloneMode = false, isBrushing = false, isCropMode = false, isCropDragging = false, isTextMode = false;
let startCoords = {x:0, y:0}, currentCoords = {x:0, y:0}, hoverCoords = null, cloneSource = null, cloneOffset = {dx:0, dy:0}, isCloning = false;

let curvePoint = { x: 128, y: 128 }; let curveLUT = new Uint8Array(256);
let grading = { shadows: {r:0,g:0,b:0}, midtones: {r:0,g:0,b:0}, highlights: {r:0,g:0,b:0} };
let hslState = { red: {h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} };
let copiedSettings = null; let activeLUT = null; let customPresets = JSON.parse(localStorage.getItem('fastphoto_presets')) || [];

const s = { 
    sharp: document.getElementById('sharpness-slider'), exp: document.getElementById('exposure-slider'), 
    shadows: document.getElementById('shadows-slider'), high: document.getElementById('highlights-slider'), 
    cont: document.getElementById('contrast-slider'), sat: { value: 100 }
};

// ============================================================================
// 4. RENDERING ENGINE & LAYERS
// ============================================================================
function updateBaseFilters() {
    if (layers.length === 0) return; const base = layers[0];
    glCanvas.width = base.w; glCanvas.height = base.h; gl.viewport(0, 0, base.w, base.h);
    
    // Supporto Video in WebGL
    gl.bindTexture(gl.TEXTURE_2D, iTex); 
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, base.workingCanvas || base.img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    
    const cData = new Uint8Array(256 * 4); for(let i=0; i<256; i++) { cData[i*4]=cData[i*4+1]=cData[i*4+2]=curveLUT[i]; cData[i*4+3]=255; }
    gl.bindTexture(gl.TEXTURE_2D, cTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, cData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    
    gl.useProgram(prog);
    const pLoc = gl.getAttribLocation(prog, "a_p"); gl.enableVertexAttribArray(pLoc); gl.bindBuffer(gl.ARRAY_BUFFER, pBuf); gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
    const tLoc = gl.getAttribLocation(prog, "a_t"); gl.enableVertexAttribArray(tLoc); gl.bindBuffer(gl.ARRAY_BUFFER, tBuf); gl.vertexAttribPointer(tLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(prog, "u_i"), 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, iTex);
    gl.uniform1i(gl.getUniformLocation(prog, "u_c"), 1); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, cTex);
    
    gl.uniform1f(gl.getUniformLocation(prog, "u_exp"), s.exp.value/255);
    gl.uniform1f(gl.getUniformLocation(prog, "u_cont"), s.cont.value/255); 
    gl.uniform1f(gl.getUniformLocation(prog, "u_shadows"), s.shadows.value/100);
    gl.uniform1f(gl.getUniformLocation(prog, "u_high"), s.high.value/100); 
    gl.uniform1f(gl.getUniformLocation(prog, "u_sat"), s.sat.value/100);
    gl.uniform1f(gl.getUniformLocation(prog, "u_clpS"), (!isExporting && showShadowClipping)?1:0); 
    gl.uniform1f(gl.getUniformLocation(prog, "u_clpH"), (!isExporting && showHighlightClipping)?1:0);
    gl.uniform3f(gl.getUniformLocation(prog, "u_lift"), grading.shadows.r, grading.shadows.g, grading.shadows.b);
    gl.uniform3f(gl.getUniformLocation(prog, "u_gamma"), grading.midtones.r, grading.midtones.g, grading.midtones.b);
    gl.uniform3f(gl.getUniformLocation(prog, "u_gain"), grading.highlights.r, grading.highlights.g, grading.highlights.b);
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const tCanvas = document.createElement('canvas'); tCanvas.width=base.w; tCanvas.height=base.h; const tCtx = tCanvas.getContext('2d');
    tCtx.drawImage(glCanvas, 0, 0);
    let imgData = tCtx.getImageData(0,0,base.w,base.h); let data = imgData.data;
    
    const activeHsl = []; const keys = ['red', 'orange', 'yellow', 'green', 'blue', 'magenta']; const targets = [0, 30, 60, 120, 240, 300];
    for(let j=0; j<6; j++) { let ch = hslState[keys[j]]; if(ch.h!==0 || ch.s!==0 || ch.l!==0) activeHsl.push({ th: targets[j], dh: ch.h*0.5, ds: ch.s/100, dl: ch.l/100 }); }
    const lutSize = activeLUT ? activeLUT.size - 1 : 0;

    if (activeHsl.length > 0 || activeLUT) {
        for (let i = 0; i < data.length; i += 4) {
            if (activeHsl.length > 0) {
                let r=data[i]/255, g=data[i+1]/255, b=data[i+2]/255;
                let max=Math.max(r,g,b), min=Math.min(r,g,b), h=0, s_hsl=0, l=(max+min)/2;
                if(max!==min){ let d=max-min; s_hsl=l>0.5?d/(2-max-min):d/(max+min); if(max===r) h=(g-b)/d+(g<b?6:0); else if(max===g) h=(b-r)/d+2; else h=(r-g)/d+4; h/=6; }
                h*=360;
                for(let j=0; j<activeHsl.length; j++) {
                    let a=activeHsl[j]; let dist=Math.abs(h-a.th); if(dist>180) dist=360-dist;
                    if(dist<45) { let w=1-(dist/45); h=(h+a.dh*w+360)%360; s_hsl=Math.max(0,Math.min(1,s_hsl+a.ds*w)); l=Math.max(0,Math.min(1,l+a.dl*w)); }
                }
                h/=360; let q=l<0.5?l*(1+s_hsl):l+s_hsl-l*s_hsl, p=2*l-q;
                const h2r = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
                data[i]=h2r(p,q,h+1/3)*255; data[i+1]=h2r(p,q,h)*255; data[i+2]=h2r(p,q,h-1/3)*255;
            }
            if (activeLUT) {
                let cr = Math.max(0, Math.min(255, data[i])); let cg = Math.max(0, Math.min(255, data[i+1])); let cb = Math.max(0, Math.min(255, data[i+2]));
                let bx = Math.round((cr / 255) * lutSize); let by = Math.round((cg / 255) * lutSize); let bz = Math.round((cb / 255) * lutSize);
                let idx = (bz * activeLUT.size * activeLUT.size + by * activeLUT.size + bx) * 3;
                data[i] = activeLUT.data[idx] * 255; data[i+1] = activeLUT.data[idx+1] * 255; data[i+2] = activeLUT.data[idx+2] * 255;
            }
        }
        tCtx.putImageData(imgData, 0, 0);
    }
    
    const sharpAmt = s.sharp ? parseInt(s.sharp.value)/100 : 0;
    if (sharpAmt > 0) {
        const weights = [0, -sharpAmt, 0, -sharpAmt, 1 + sharpAmt * 4, -sharpAmt, 0, -sharpAmt, 0];
        const out = new Uint8ClampedArray(data.length);
        for (let y = 0; y < base.h; y++) { for (let x = 0; x < base.w; x++) { const i = (y * base.w + x) * 4; let r=0, g=0, b=0; for (let cy=0; cy<3; cy++) { for (let cx=0; cx<3; cx++) { const iy = Math.min(base.h-1, Math.max(0, y + cy - 1)); const ix = Math.min(base.w-1, Math.max(0, x + cx - 1)); const srcI = (iy * base.w + ix) * 4; const wt = weights[cy * 3 + cx]; r += data[srcI] * wt; g += data[srcI+1] * wt; b += data[srcI+2] * wt; } } out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=data[i+3]; } }
        imgData.data.set(out); tCtx.putImageData(imgData, 0, 0);
    }

    offCanvas.width = base.w; offCanvas.height = base.h; offCtx.drawImage(tCanvas, 0, 0);
    drawHistogram(offCtx.getImageData(0,0,base.w,base.h).data); renderCanvas();
}

function renderCanvas() {
    if (layers.length === 0) return; ctx.clearRect(0,0,canvas.width,canvas.height);
    const drawFinal = (c) => {
        c.save(); c.translate(panX, panY); c.scale(scale, scale);
        layers.forEach((l, i) => { 
            if(!l.visible) return; c.save(); 
            if(i===0) c.drawImage(offCanvas, l.x, l.y); 
            else { c.globalAlpha=l.opacity; c.globalCompositeOperation=l.blendMode; c.drawImage(l.img, l.x, l.y, l.w, l.h); } 
            c.restore(); 
            if (i === activeLayerIndex && i !== 0 && !isSplitView) { c.strokeStyle = '#007aff'; c.lineWidth = 2/scale; c.strokeRect(l.x, l.y, l.w, l.h); }
        });
        
        if ((isCloneMode || isBrushMode) && hoverCoords && !isSplitView) {
            const brush = isCloneMode ? parseInt(document.getElementById('clone-size').value) : parseInt(document.getElementById('brush-size').value);
            c.beginPath(); c.arc(hoverCoords.x, hoverCoords.y, brush, 0, Math.PI*2); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5/scale; c.stroke();
            if (isCloneMode && cloneSource) {
                let sx = cloneSource.x, sy = cloneSource.y;
                if (isCloning) { sx = hoverCoords.x + cloneOffset.dx; sy = hoverCoords.y + cloneOffset.dy; }
                c.beginPath(); c.arc(sx, sy, brush, 0, Math.PI*2); c.strokeStyle = 'rgba(0,122,255,0.8)'; c.lineWidth = 1.5/scale; c.stroke();
                c.beginPath(); c.moveTo(sx - 5/scale, sy); c.lineTo(sx + 5/scale, sy); c.moveTo(sx, sy - 5/scale); c.lineTo(sx, sy + 5/scale); c.stroke();
            }
        }
        if (isCropMode && (isCropDragging || Math.abs(currentCoords.x - startCoords.x) > 5)) {
            c.strokeStyle = '#007aff'; c.lineWidth = 2/scale; c.setLineDash([5/scale, 5/scale]);
            c.strokeRect(startCoords.x, startCoords.y, currentCoords.x - startCoords.x, currentCoords.y - startCoords.y);
        }
        c.restore();
    };

    if (isSplitView) {
        let x = canvas.width * splitPos;
        ctx.save(); ctx.beginPath(); ctx.rect(0,0,x,canvas.height); ctx.clip(); ctx.translate(panX, panY); ctx.scale(scale, scale); ctx.drawImage(layers[0].workingCanvas || layers[0].img, 0, 0); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(x,0,canvas.width,canvas.height); ctx.clip(); drawFinal(ctx); ctx.restore();
        ctx.fillStyle='white'; ctx.fillRect(x-1,0,2,canvas.height);
        ctx.beginPath(); ctx.arc(x, canvas.height / 2, 14, 0, Math.PI*2); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 5; ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#333'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('< >', x, canvas.height / 2);
    } else drawFinal(ctx);
}

function updateLayersUI() {
    const list = document.getElementById('layers-list'); list.innerHTML = '';
    layers.forEach((l, i) => {
        const div = document.createElement('div'); div.className = `layer-item ${i === activeLayerIndex ? 'active' : ''}`;
        div.innerHTML = `<span><i class="fa-solid fa-layer-group"></i> ${l.name}</span> <i class="fa-solid ${l.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
        div.onclick = (e) => { if(e.target.tagName.toLowerCase() === 'path' || e.target.tagName.toLowerCase() === 'svg') l.visible = !l.visible; else activeLayerIndex = i; updateLayersUI(); renderCanvas(); };
        list.appendChild(div);
    });
    document.getElementById('layer-settings').style.display = activeLayerIndex > 0 ? 'flex' : 'none';
    if(activeLayerIndex > 0) {
        document.getElementById('layer-opacity').value = layers[activeLayerIndex].opacity * 100;
        document.getElementById('layer-opacity-val').textContent = (layers[activeLayerIndex].opacity * 100) + '%';
        document.getElementById('layer-blend').value = layers[activeLayerIndex].blendMode;
    }
}

// ============================================================================
// 5. COLOR WHEELS, CURVES, PRESETS & LUTS
// ============================================================================
function hslToRgb(h, s, l) { let r, g, b; if (s == 0) r = g = b = l; else { const h2r = (p, q, t) => { if(t < 0) t += 1; if(t > 1) t -= 1; if(t < 1/6) return p + (q - p) * 6 * t; if(t < 1/2) return q; if(t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; }; const q = l < 0.5 ? l*(1+s) : l+s-l*s; const p = 2*l-q; r = h2r(p, q, h + 1/3); g = h2r(p, q, h); b = h2r(p, q, h - 1/3); } return [r*255, g*255, b*255]; }
function updateWheels(id, e) { const wheel = document.getElementById(id); const rect = wheel.getBoundingClientRect(); const x = e.clientX - rect.left - rect.width/2; const y = e.clientY - rect.top - rect.height/2; const dist = Math.min(rect.width/2, Math.sqrt(x*x + y*y)); const angle = Math.atan2(y, x); const handle = wheel.querySelector('.wheel-handle'); handle.style.left = (50 + (x/rect.width)*100) + '%'; handle.style.top = (50 + (y/rect.height)*100) + '%'; const sat = dist / (rect.width/2); const hue = (angle + Math.PI) / (2 * Math.PI); const rgb = hslToRgb(hue, sat, 0.5); const key = id.split('-')[1]; grading[key] = { r: (rgb[0]-128)/255, g: (rgb[1]-128)/255, b: (rgb[2]-128)/255 }; updateBaseFilters(); }
['wheel-shadows', 'wheel-midtones', 'wheel-highlights'].forEach(id => { let w = document.getElementById(id); w.onmousedown = (e) => { const move = (me) => updateWheels(id, me); window.addEventListener('mousemove', move); window.addEventListener('mouseup', () => { window.removeEventListener('mousemove', move); }, {once:true}); updateWheels(id, e); }; });

const curveCanvas = document.getElementById('curve-canvas'); const curveCtx = curveCanvas.getContext('2d'); let isDraggingCurve = false;
function drawCurveGraph() {
    curveCtx.clearRect(0, 0, 256, 256); curveCtx.strokeStyle = '#333'; curveCtx.lineWidth = 1;
    for(let i=1; i<4; i++) { curveCtx.beginPath(); curveCtx.moveTo(i*64, 0); curveCtx.lineTo(i*64, 256); curveCtx.stroke(); curveCtx.beginPath(); curveCtx.moveTo(0, i*64); curveCtx.lineTo(256, i*64); curveCtx.stroke(); }
    curveCtx.beginPath(); curveCtx.moveTo(0, 256); const cx = 2 * curvePoint.x - 128; const cy = 2 * curvePoint.y - 128;
    curveCtx.quadraticCurveTo(cx, cy, 256, 0); curveCtx.strokeStyle = '#007aff'; curveCtx.lineWidth = 2; curveCtx.stroke();
    curveCtx.beginPath(); curveCtx.arc(curvePoint.x, curvePoint.y, 6, 0, Math.PI*2); curveCtx.fillStyle = 'white'; curveCtx.fill(); curveCtx.strokeStyle = '#000'; curveCtx.stroke();
    for(let i=0; i<256; i++) { let t = i / 255; let val = Math.pow(1-t, 2)*256 + 2*(1-t)*t*cy; curveLUT[i] = Math.max(0, Math.min(255, 256 - val)); }
}
drawCurveGraph();
curveCanvas.onmousedown = () => isDraggingCurve = true;
window.addEventListener('mousemove', (e) => { if(isDraggingCurve) { const rect = curveCanvas.getBoundingClientRect(); curvePoint.x = Math.max(0, Math.min(256, (e.clientX - rect.left) * (256/rect.width))); curvePoint.y = Math.max(0, Math.min(256, (e.clientY - rect.top) * (256/rect.height))); drawCurveGraph(); updateBaseFilters(); } });
window.addEventListener('mouseup', () => isDraggingCurve = false);

function renderCustomPresets() {
    const grid = document.getElementById('custom-presets-grid'); grid.innerHTML = '';
    customPresets.forEach((p, index) => {
        const btn = document.createElement('button'); btn.className = 'preset-card'; btn.innerHTML = `<i class="fa-solid fa-star" style="color:#007aff;"></i> ${p.name}`;
        btn.onclick = () => { copiedSettings = p; document.getElementById('paste-settings-btn').click(); }; 
        btn.oncontextmenu = (e) => { e.preventDefault(); if(confirm(`Eliminare il preset "${p.name}"?`)) { customPresets.splice(index, 1); localStorage.setItem('fastphoto_presets', JSON.stringify(customPresets)); renderCustomPresets(); } };
        grid.appendChild(btn);
    });
}
renderCustomPresets();
document.getElementById('save-preset-btn').onclick = () => { const name = prompt("Nome del filtro:"); if(!name) return; document.getElementById('copy-settings-btn').click(); const preset = { name, ...copiedSettings }; customPresets.push(preset); localStorage.setItem('fastphoto_presets', JSON.stringify(customPresets)); renderCustomPresets(); };
document.getElementById('lut-upload').onchange = (e) => {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = (ev) => {
        const text = ev.target.result; const lines = text.split('\n'); let size = 0; let data = [];
        for(let line of lines) { line = line.trim(); if(!line || line.startsWith('#')) continue; if(line.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(' ')[1]); else if(/^[0-9.-]/.test(line)) { const parts = line.split(/\s+/).map(Number); if(parts.length === 3) data.push(parts[0], parts[1], parts[2]); } }
        if(size > 0 && data.length > 0) { activeLUT = { size, data, name: file.name }; document.getElementById('remove-lut-btn').style.display = 'block'; updateBaseFilters(); }
    }; reader.readAsText(file); e.target.value = "";
};
document.getElementById('remove-lut-btn').onclick = () => { activeLUT = null; document.getElementById('remove-lut-btn').style.display = 'none'; updateBaseFilters(); };

document.querySelectorAll('.preset-card').forEach(b => { 
    b.onclick = (e) => { 
        const p = e.target.closest('.preset-card').dataset.preset; 
        if(!p) return;
        if (p==='normal') { s.exp.value=0; s.cont.value=0; s.shadows.value=0; s.high.value=0; s.sharp.value=0; curvePoint={x:128, y:128}; grading={ shadows: {r:0,g:0,b:0}, midtones: {r:0,g:0,b:0}, highlights: {r:0,g:0,b:0} }; hslState={ red:{h:0,s:0,l:0}, orange:{h:0,s:0,l:0}, yellow:{h:0,s:0,l:0}, green:{h:0,s:0,l:0}, blue:{h:0,s:0,l:0}, magenta:{h:0,s:0,l:0} };} 
        if (p==='vintage') { s.exp.value=5; s.cont.value=0; s.shadows.value=15; s.high.value=0; s.sharp.value=15; curvePoint={x:128, y:100}; grading={ shadows: {r:0,g:0,b:0.1}, midtones: {r:0.1,g:0.05,b:0}, highlights: {r:0.1,g:0.1,b:0} }; } 
        if (p==='cinematic') { s.exp.value=-5; s.cont.value=0; s.shadows.value=20; s.high.value=15; s.sharp.value=25; curvePoint={x:128, y:150}; grading={ shadows: {r:-0.1,g:0,b:0.2}, midtones: {r:0,g:0,b:0}, highlights: {r:0.2,g:0.1,b:-0.1} }; } 
        if (p==='bw') { s.exp.value=5; s.sharp.value=30; s.cont.value=0; s.shadows.value=0; s.high.value=0; curvePoint={x:128, y:120}; hslState={ red:{h:0,s:-100,l:0}, orange:{h:0,s:-100,l:0}, yellow:{h:0,s:-100,l:0}, green:{h:0,s:-100,l:0}, blue:{h:0,s:-100,l:0}, magenta:{h:0,s:-100,l:0} };} 
        
        Object.keys(s).forEach(k => { if(s[k] && document.getElementById(k+'-val')) document.getElementById(k+'-val').textContent=s[k].value; });
        const ch = document.getElementById('hsl-channel').value; document.getElementById('hsl-h').value = hslState[ch].h; document.getElementById('hsl-s').value = hslState[ch].s; document.getElementById('hsl-l').value = hslState[ch].l; document.getElementById('hsl-h-val').textContent = hslState[ch].h; document.getElementById('hsl-s-val').textContent = hslState[ch].s; document.getElementById('hsl-l-val').textContent = hslState[ch].l;
        document.querySelectorAll('.wheel-handle').forEach(h => { h.style.left='50%'; h.style.top='50%'; });
        drawCurveGraph(); updateBaseFilters(); 
    }; 
});

// ============================================================================
// 6. INITIALIZATION, AI & MEDIA LOADING
// ============================================================================
initDB().then(() => loadFolders());
async function loadFolders() {
    const folders = await dbGetAll('folders'); const list = document.getElementById('folders-list'); list.innerHTML = '';
    folders.forEach(f => {
        const div = document.createElement('div'); div.className = 'folder-item'; div.innerHTML = `<i class="fa-solid fa-folder" style="color:#0a84ff;"></i> <span class="text-ellipsis">${f.name}</span>`;
        div.onclick = () => openFolder(f.id, f.name); list.appendChild(div);
    });
}
async function openFolder(id, name) {
    document.getElementById('folders-list').style.display = 'none'; document.getElementById('active-folder-view').style.display = 'block';
    currentFolderId = id; document.getElementById('current-folder-name').textContent = name;
    const photos = await dbGetByIndex('photos', 'folderId', id);
    const grid = document.getElementById('folder-photos-grid'); grid.innerHTML = '';
    photos.forEach(p => { const img = document.createElement('img'); img.className = 'photo-thumb'; img.src = p.thumb || p.data; img.onclick = () => loadToApp(p.data); grid.appendChild(img); });
}

function loadToApp(src) {
    if (videoElement) { videoElement.pause(); isVideoPlaying = false; }
    document.getElementById('play-pause-btn').style.display = 'none';
    
    const img = new Image(); img.onload = () => {
        let wc = document.createElement('canvas'); wc.width=img.width; wc.height=img.height; wc.getContext('2d').drawImage(img,0,0);
        layers = [{id:'base', img, workingCanvas:wc, w:img.width, h:img.height, x:0, y:0, visible:true, name:'Sfondo', opacity:1, blendMode:'source-over', isVideo: false}]; activeLayerIndex = 0;
        canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight;
        document.querySelector('.zoom-bar').style.display='flex'; document.getElementById('no-photo-msg').style.display='none';
        canvas.style.display='block'; fitToScreen(); updateLayersUI(); updateBaseFilters();
    }; img.src = src;
}

function loadVideoToApp(src) {
    if (videoElement) { videoElement.pause(); }
    videoElement = document.createElement('video');
    videoElement.src = src;
    videoElement.muted = true;
    videoElement.loop = true;
    videoElement.playsInline = true;
    
    videoElement.onloadeddata = () => {
        layers = [{id:'base', img: videoElement, workingCanvas:null, w:videoElement.videoWidth, h:videoElement.videoHeight, x:0, y:0, visible:true, name:'Video', opacity:1, blendMode:'source-over', isVideo: true}]; 
        activeLayerIndex = 0;
        canvas.width = workspace.clientWidth; canvas.height = workspace.clientHeight;
        document.querySelector('.zoom-bar').style.display='flex'; 
        document.getElementById('play-pause-btn').style.display='block';
        document.getElementById('play-pause-btn').innerHTML = '<i class="fa-solid fa-play"></i>';
        document.getElementById('no-photo-msg').style.display='none';
        canvas.style.display='block'; 
        fitToScreen(); updateLayersUI(); updateBaseFilters();
    };
    videoElement.load();
}

function videoLoop() {
    if (layers.length > 0 && layers[0].isVideo && isVideoPlaying) {
        updateBaseFilters();
        requestAnimationFrame(videoLoop);
    }
}

function fitToScreen() { if (layers.length === 0) return; const base = layers[0]; const sX = (workspace.clientWidth - 80) / base.w, sY = (workspace.clientHeight - 80) / base.h; scale = Math.min(sX, sY, 1); panX = (workspace.clientWidth - base.w * scale) / 2; panY = (workspace.clientHeight - base.h * scale) / 2; document.getElementById('zoom-val').textContent = Math.round(scale * 100) + '%'; renderCanvas(); }
function getRealCoords(e) { const rect = canvas.getBoundingClientRect(); const x = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left; const y = (e.clientY || (e.touches ? e.touches[0].clientY : 0)) - rect.top; return { x: (x - panX) / scale, y: (y - panY) / scale }; }

// ============================================================================
// 7. TOOL INTERACTIONS & MOUSE EVENTS
// ============================================================================
function applyCloneStroke(coords) { if(!layers[0].workingCanvas) return; const ctxW = layers[0].workingCanvas.getContext('2d'); const brush = parseInt(document.getElementById('clone-size').value); const sx = coords.x + cloneOffset.dx; const sy = coords.y + cloneOffset.dy; ctxW.save(); ctxW.beginPath(); ctxW.arc(coords.x, coords.y, brush, 0, Math.PI*2); ctxW.clip(); ctxW.drawImage(layers[0].workingCanvas, sx - brush, sy - brush, brush*2, brush*2, coords.x - brush, coords.y - brush, brush*2, brush*2); ctxW.restore(); updateBaseFilters(); }
function applyBrushStroke(coords) { if(!layers[0].workingCanvas) return; const ctxW = layers[0].workingCanvas.getContext('2d'); const mode = document.getElementById('brush-mode').value; const brush = parseInt(document.getElementById('brush-size').value); const flow = 10 / 100; ctxW.save(); const grad = ctxW.createRadialGradient(coords.x, coords.y, 0, coords.x, coords.y, brush); if(mode === 'dodge') { grad.addColorStop(0, `rgba(255,255,255,${flow})`); grad.addColorStop(1, 'rgba(255,255,255,0)'); ctxW.globalCompositeOperation = 'soft-light'; } if(mode === 'burn') { grad.addColorStop(0, `rgba(0,0,0,${flow})`); grad.addColorStop(1, 'rgba(0,0,0,0)'); ctxW.globalCompositeOperation = 'soft-light'; } ctxW.fillStyle = grad; ctxW.beginPath(); ctxW.arc(coords.x, coords.y, brush, 0, Math.PI*2); ctxW.fill(); ctxW.restore(); updateBaseFilters(); }

canvas.onmousedown = (e) => {
    if (layers.length === 0) return; 
    const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left; const coords = getRealCoords(e);
    if (isSplitView && Math.abs(mouseX - canvas.width * splitPos) < 20) { isDraggingSplit = true; return; }
    if (isSpacePressed || e.button === 1) { isPanning = true; startPan = { x: e.clientX - panX, y: e.clientY - panY }; return; }
    if (isCloneMode && !isSplitView) { if (e.altKey) { cloneSource = {...coords}; renderCanvas(); return; } if (cloneSource) { isCloning = true; cloneOffset = { dx: cloneSource.x - coords.x, dy: cloneSource.y - coords.y }; applyCloneStroke(coords); } return; }
    if (isBrushMode && !isSplitView) { isBrushing = true; applyBrushStroke(coords); return; }
    if (isTextMode && !isSplitView) { const txt = document.getElementById('watermark-text').value; if (!txt) return; const t = document.createElement('canvas'); t.width = layers[0].w; t.height = layers[0].h; const tc = t.getContext('2d'); tc.drawImage(layers[0].workingCanvas || layers[0].img, 0, 0); tc.font = "bold 60px sans-serif"; tc.fillStyle = document.getElementById('watermark-color').value; tc.fillText(txt, coords.x, coords.y); layers[0].workingCanvas = t; updateBaseFilters(); isTextMode = false; document.getElementById('text-btn').classList.remove('active-action'); document.getElementById('tool-options-bar').style.display='none'; document.getElementById('text-settings').style.display='none'; canvas.style.cursor='default'; return; }
    if (isCropMode && !isSplitView) { isCropDragging = true; startCoords = coords; return; }
    if (activeLayerIndex > 0 && !isSplitView) { const l = layers[activeLayerIndex]; if (coords.x >= l.x && coords.x <= l.x + l.w && coords.y >= l.y && coords.y <= l.y + l.h) { isDraggingLayer = true; startLayerPos = { mx: coords.x, my: coords.y, lx: l.x, ly: l.y }; } }
};
window.addEventListener('mousemove', (e) => { 
    if(layers.length===0) return;
    const rect = canvas.getBoundingClientRect(); const mouseX = (e.clientX || (e.touches ? e.touches[0].clientX : 0)) - rect.left; hoverCoords = getRealCoords(e); 
    if (isSplitView) { if (Math.abs(mouseX - canvas.width * splitPos) < 20) canvas.style.cursor = 'ew-resize'; else if (!isSpacePressed) canvas.style.cursor = 'default'; }
    if (isDraggingSplit) { splitPos = Math.max(0, Math.min(1, mouseX / canvas.width)); renderCanvas(); return; }
    if (isPanning) { panX = e.clientX - startPan.x; panY = e.clientY - startPan.y; renderCanvas(); } 
    else if (isCloning) { applyCloneStroke(hoverCoords); } 
    else if (isBrushing) { applyBrushStroke(hoverCoords); } 
    else if (isDraggingLayer) { const l = layers[activeLayerIndex]; l.x = startLayerPos.lx + (hoverCoords.x - startLayerPos.mx); l.y = startLayerPos.ly + (hoverCoords.y - startLayerPos.my); renderCanvas(); }
    else if (isCropDragging) { currentCoords = hoverCoords; renderCanvas(); } 
    else if (isCloneMode || isBrushMode) { renderCanvas(); } 
});
window.addEventListener('mouseup', () => { isPanning = isCropDragging = isCloning = isBrushing = isDraggingSplit = isDraggingLayer = false; });
canvas.onwheel = (e) => { e.preventDefault(); const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const oldScale = scale; scale *= (e.deltaY < 0 ? 1.1 : 0.9); scale = Math.max(0.05, Math.min(scale, 10)); panX = mx - (mx - panX) * (scale / oldScale); panY = my - (my - panY) * (scale / oldScale); document.getElementById('zoom-val').textContent = Math.round(scale * 100) + '%'; renderCanvas(); };

function drawHistogram(data) { histCtx.clearRect(0,0,340,80); let lums=new Array(256).fill(0); for(let i=0;i<data.length;i+=4) lums[Math.round(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])]++; let max=Math.max(...lums); histCtx.fillStyle='#0a84ff'; for(let i=0;i<256;i++) histCtx.fillRect(i*(340/256), 80-(lums[i]/max)*80, 1, 80); }

// ============================================================================
// 8. TENSORFLOW AI (BODYPIX)
// ============================================================================
document.getElementById('ai-mask-btn').onclick = async () => {
    if(layers.length === 0) return;
    if(layers[0].isVideo) { alert("L'AI Mask non è ancora supportata sui file video."); return; }
    
    const btn = document.getElementById('ai-mask-btn');
    const originalHTML = btn.innerHTML;
    
    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Modello AI...';
        btn.disabled = true;
        const net = await bodyPix.load();
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scontorno...';
        const baseCanvas = layers[0].workingCanvas || layers[0].img;
        
        const segmentation = await net.segmentPerson(baseCanvas, { internalResolution: 'medium', segmentationThreshold: 0.7 });

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = baseCanvas.width; maskCanvas.height = baseCanvas.height;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(baseCanvas, 0, 0);
        const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

        for (let i = 0; i < imgData.data.length; i += 4) {
            if (segmentation.data[i/4] === 0) { imgData.data[i + 3] = 0; }
        }
        maskCtx.putImageData(imgData, 0, 0);

        const newImg = new Image();
        newImg.onload = () => {
            layers.push({ id: Date.now().toString(), img: newImg, w: newImg.width, h: newImg.height, x: 0, y: 0, visible: true, name: 'Soggetto AI', opacity: 1, blendMode: 'source-over' });
            activeLayerIndex = layers.length - 1; updateLayersUI(); renderCanvas();
        };
        newImg.src = maskCanvas.toDataURL('image/png');
    } catch (err) {
        alert("Errore AI. Assicurati di essere online per scaricare il modello iniziale."); console.error(err);
    } finally {
        btn.innerHTML = originalHTML; btn.disabled = false;
    }
};

// ============================================================================
// 9. BATCH SYNC & UI BINDINGS
// ============================================================================
document.getElementById('copy-settings-btn').onclick = () => { copiedSettings = { exp: s.exp.value, cont: s.cont.value, shadows: s.shadows.value, high: s.high.value, sharp: s.sharp.value, grading: JSON.parse(JSON.stringify(grading)), hsl: JSON.parse(JSON.stringify(hslState)), curve: {...curvePoint}, lut: activeLUT }; alert("Modifiche copiate negli appunti!"); };
document.getElementById('paste-settings-btn').onclick = () => { if(!copiedSettings)return; s.exp.value=copiedSettings.exp; s.cont.value=copiedSettings.cont; s.shadows.value=copiedSettings.shadows; s.high.value=copiedSettings.high; s.sharp.value=copiedSettings.sharp; grading=JSON.parse(JSON.stringify(copiedSettings.grading)); hslState=JSON.parse(JSON.stringify(copiedSettings.hsl)); curvePoint={...copiedSettings.curve}; activeLUT = copiedSettings.lut; if(activeLUT) document.getElementById('remove-lut-btn').style.display='block'; Object.keys(s).forEach(k => { if(s[k] && document.getElementById(k+'-val')) document.getElementById(k+'-val').textContent=s[k].value; }); drawCurveGraph(); updateBaseFilters(); };

function toggleTool(btn, set, flag) { 
    isCropMode=isCloneMode=isBrushMode=isTextMode=false; 
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-action')); 
    document.querySelectorAll('.tool-settings-group').forEach(b => b.style.display='none'); 
    canvas.style.cursor='default'; 
    if(flag) { 
        btn.classList.add('active-action'); 
        document.getElementById('tool-options-bar').style.display='flex';
        if(set) document.getElementById(set).style.display='flex'; 
        canvas.style.cursor='crosshair'; 
    } else {
        document.getElementById('tool-options-bar').style.display='none';
    }
}
function updateToolValue(sliderId, valId) { const slider = document.getElementById(sliderId); const valDisplay = document.getElementById(valId); if(slider && valDisplay) { slider.oninput = () => { valDisplay.textContent = slider.value + "px"; if (isCloneMode || isBrushMode) renderCanvas(); } } }
updateToolValue('clone-size', 'clone-size-val'); updateToolValue('brush-size', 'brush-size-val');

document.getElementById('clone-btn').onclick = () => { isSplitView=false; isCloneMode = !isCloneMode; toggleTool(document.getElementById('clone-btn'), 'clone-settings', isCloneMode); if(!isCloneMode) cloneSource = null; renderCanvas(); }; 
document.getElementById('brush-btn').onclick = () => { isSplitView=false; isBrushMode = !isBrushMode; toggleTool(document.getElementById('brush-btn'), 'brush-settings', isBrushMode); renderCanvas(); }; 
document.getElementById('text-btn').onclick = () => { isSplitView=false; isTextMode = !isTextMode; toggleTool(document.getElementById('text-btn'), 'text-settings', isTextMode); canvas.style.cursor = isTextMode ? 'text' : 'default'; };
document.getElementById('crop-btn').onclick = () => { isSplitView=false; isCropMode = !isCropMode; toggleTool(document.getElementById('crop-btn'), null, isCropMode); if (!isCropMode && Math.abs(currentCoords.x - startCoords.x) > 20) { const x = Math.min(startCoords.x, currentCoords.x), y = Math.min(startCoords.y, currentCoords.y), w = Math.abs(currentCoords.x - startCoords.x), h = Math.abs(currentCoords.y - startCoords.y); const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').drawImage(layers[0].workingCanvas || layers[0].img, x, y, w, h, 0, 0, w, h); layers[0].workingCanvas = t; layers[0].w = w; layers[0].h = h; updateBaseFilters(); fitToScreen(); } };
document.getElementById('rotate-btn').onclick = () => { if(layers.length===0 || layers[0].isVideo) return; const t = document.createElement('canvas'); t.width = layers[0].h; t.height = layers[0].w; const tc = t.getContext('2d'); tc.translate(t.width/2, t.height/2); tc.rotate(Math.PI/2); tc.drawImage(layers[0].workingCanvas || layers[0].img, -layers[0].w/2, -layers[0].h/2); layers[0].workingCanvas = t; layers[0].w = t.width; layers[0].h = t.height; updateBaseFilters(); fitToScreen(); };

window.addEventListener('keydown', (e) => {
    if (e.target.tagName.toLowerCase() === 'input' && e.target.type === 'text') return;
    if (e.code === 'Space') { isSpacePressed = true; canvas.style.cursor = 'grab'; return; }
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0; const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (cmdOrCtrl && e.key.toLowerCase() === 'c') { e.preventDefault(); document.getElementById('copy-settings-btn').click(); }
    if (cmdOrCtrl && e.key.toLowerCase() === 'v') { e.preventDefault(); document.getElementById('paste-settings-btn').click(); }
    if (!cmdOrCtrl) {
        if (e.key.toLowerCase() === 'b') document.getElementById('brush-btn').click();
        if (e.key.toLowerCase() === 's') document.getElementById('clone-btn').click();
        if (e.key.toLowerCase() === 'c') document.getElementById('crop-btn').click();
        if (e.key.toLowerCase() === 't') document.getElementById('text-btn').click();
        if (e.key === '\\') document.getElementById('split-view-btn').click();
    }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { isSpacePressed = false; canvas.style.cursor = (isCloneMode||isBrushMode) ? 'crosshair' : (isTextMode ? 'text' : 'default'); } });

document.getElementById('upload-btn').onchange = async (e) => { 
    let f = e.target.files[0]; if(!f) return; 
    if (f.type.startsWith('video/')) {
        document.getElementById('exif-bar').style.display = 'none';
        loadVideoToApp(URL.createObjectURL(f));
    } else {
        try { const exifData = await exifr.parse(f, {tiff: true, ifd0: true, exif: true}); if(exifData) { document.getElementById('exif-bar').style.display = 'flex'; document.getElementById('exif-camera').innerHTML = `<i class="fa-solid fa-camera"></i> ${exifData.Make || ''} ${exifData.Model || 'Camera'} `; const fNum = exifData.FNumber ? `f/${exifData.FNumber}` : ''; const expTime = exifData.ExposureTime ? `1/${Math.round(1/exifData.ExposureTime)}s` : ''; const iso = exifData.ISO ? `ISO ${exifData.ISO}` : ''; document.getElementById('exif-settings').innerHTML = `<i class="fa-solid fa-sliders"></i> ${fNum} | ${expTime} | ${iso}`; } } catch(err) { document.getElementById('exif-bar').style.display = 'none'; } 
        loadToApp(URL.createObjectURL(f)); 
    }
};

document.getElementById('play-pause-btn').onclick = () => {
    if (!videoElement) return;
    if (isVideoPlaying) {
        videoElement.pause(); isVideoPlaying = false; document.getElementById('play-pause-btn').innerHTML = '<i class="fa-solid fa-play"></i>';
    } else {
        videoElement.play(); isVideoPlaying = true; document.getElementById('play-pause-btn').innerHTML = '<i class="fa-solid fa-pause"></i>'; videoLoop();
    }
};

document.getElementById('toggle-library-btn').onclick = () => { let p = document.getElementById('library-panel'); p.style.display = p.style.display === 'none' ? 'flex' : 'none'; };
document.getElementById('new-folder-btn').onclick = async () => { let n = prompt("Nome progetto:"); if(n) { await dbPut('folders', {id: Date.now().toString(), name: n}); loadFolders(); } };
document.getElementById('back-folders-btn').onclick = () => { document.getElementById('folders-list').style.display='flex'; document.getElementById('active-folder-view').style.display='none'; currentFolderId=null; };
document.getElementById('reset-btn').onclick = () => location.reload();
document.getElementById('open-export-btn').onclick = () => document.getElementById('export-modal').style.display='flex';
document.getElementById('close-export').onclick = () => document.getElementById('export-modal').style.display='none';
document.getElementById('split-view-btn').onclick = () => { isSplitView = !isSplitView; renderCanvas(); };
document.getElementById('zoom-in').onclick = () => { scale *= 1.2; document.getElementById('zoom-val').textContent = Math.round(scale*100)+'%'; renderCanvas(); }; document.getElementById('zoom-out').onclick = () => { scale /= 1.2; document.getElementById('zoom-val').textContent = Math.round(scale*100)+'%'; renderCanvas(); }; document.getElementById('zoom-fit').onclick = fitToScreen;
document.getElementById('clip-shadows-btn').onclick = function() { showShadowClipping = !showShadowClipping; this.classList.toggle('active-action', showShadowClipping); updateBaseFilters(); };
document.getElementById('clip-highlights-btn').onclick = function() { showHighlightClipping = !showHighlightClipping; this.classList.toggle('active-action', showHighlightClipping); updateBaseFilters(); };

document.getElementById('add-layer-btn').onchange = (e) => { let f = e.target.files[0]; if(!f) return; let img = new Image(); img.onload = () => { layers.push({id: Date.now().toString(), img, w:img.width, h:img.height, x:0, y:0, visible:true, name:`Livello ${layers.length}`, opacity:1, blendMode:'source-over'}); activeLayerIndex = layers.length - 1; updateLayersUI(); renderCanvas(); }; img.src = URL.createObjectURL(f); e.target.value = ""; };
document.getElementById('layer-opacity').oninput = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].opacity = e.target.value/100; document.getElementById('layer-opacity-val').textContent = e.target.value + '%'; renderCanvas(); }}; 
document.getElementById('layer-blend').onchange = (e) => { if(activeLayerIndex>0) { layers[activeLayerIndex].blendMode = e.target.value; renderCanvas(); }}; 
document.getElementById('del-layer-btn').onclick = () => { if(activeLayerIndex>0) { layers.splice(activeLayerIndex, 1); activeLayerIndex=0; updateLayersUI(); renderCanvas(); } };

document.getElementById('hsl-channel').onchange = (e) => { const ch = e.target.value; document.getElementById('hsl-h').value = hslState[ch].h; document.getElementById('hsl-s').value = hslState[ch].s; document.getElementById('hsl-l').value = hslState[ch].l; document.getElementById('hsl-h-val').textContent = hslState[ch].h; document.getElementById('hsl-s-val').textContent = hslState[ch].s; document.getElementById('hsl-l-val').textContent = hslState[ch].l; };
['h', 's', 'l'].forEach(prop => { document.getElementById(`hsl-${prop}`).oninput = (e) => { const ch = document.getElementById('hsl-channel').value; hslState[ch][prop] = parseInt(e.target.value); document.getElementById(`hsl-${prop}-val`).textContent = e.target.value; updateBaseFilters(); }; });
Object.keys(s).forEach(k => { if(s[k] && s[k].oninput !== undefined) s[k].oninput = (e) => { if(document.getElementById(k+'-val')) document.getElementById(k+'-val').textContent=e.target.value; updateBaseFilters(); }; });

// ============================================================================
// 10. EXPORT & BATCH EXPORT LOGIC
// ============================================================================
document.getElementById('confirm-export-btn').onclick = () => {
    if(layers.length === 0) return;
    const format = document.getElementById('export-format').value; const quality = document.getElementById('export-quality').value / 100; const scaleFac = document.getElementById('export-scale').value / 100;
    isExporting = true; updateBaseFilters();
    const eCanvas = document.createElement('canvas'); eCanvas.width = layers[0].w * scaleFac; eCanvas.height = layers[0].h * scaleFac; const eCtx = eCanvas.getContext('2d'); eCtx.scale(scaleFac, scaleFac);
    layers.forEach((l, i) => { if(!l.visible) return; eCtx.save(); if(i === 0) eCtx.drawImage(offCanvas, 0, 0); else { eCtx.globalAlpha = l.opacity; eCtx.globalCompositeOperation = l.blendMode; eCtx.drawImage(l.img, l.x, l.y, l.w, l.h); } eCtx.restore(); });
    isExporting = false; updateBaseFilters();
    eCanvas.toBlob((blob) => { if (!blob) { alert("Errore di memoria."); return; } const url = URL.createObjectURL(blob); const link = document.createElement('a'); let ext = format.split('/')[1]; if (ext === 'jpeg') ext = 'jpg'; link.download = `FastPhoto_Pro_Edit.${ext}`; link.href = url; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); document.getElementById('export-modal').style.display = 'none'; }, format, quality);
};

document.getElementById('batch-export-btn').onclick = async () => {
    if(!currentFolderId) { alert("Per l'esportazione batch ZIP, devi prima aprire un progetto dalla Libreria."); return; }
    const photos = await dbGetByIndex('photos', 'folderId', currentFolderId);
    if(photos.length === 0) { alert("Questo progetto è vuoto."); return; }
    const format = document.getElementById('export-format').value; const quality = document.getElementById('export-quality').value / 100; const scaleFac = document.getElementById('export-scale').value / 100;
    let ext = format.split('/')[1]; if (ext === 'jpeg') ext = 'jpg';
    const btn = document.getElementById('batch-export-btn'); const originalText = btn.innerHTML; btn.disabled = true;
    const zip = new JSZip(); const originalLayers = [...layers]; 
    isExporting = true;
    for(let i=0; i<photos.length; i++) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Elaborazione ${i+1}/${photos.length}...`;
        const img = new Image(); await new Promise(res => { img.onload = res; img.src = photos[i].data; });
        const wc = document.createElement('canvas'); wc.width = img.width; wc.height = img.height; wc.getContext('2d').drawImage(img, 0, 0);
        layers[0] = {id:'base', img, workingCanvas:wc, w:img.width, h:img.height, x:0, y:0, visible:true, opacity:1, blendMode:'source-over'};
        updateBaseFilters();
        const eCanvas = document.createElement('canvas'); eCanvas.width = layers[0].w * scaleFac; eCanvas.height = layers[0].h * scaleFac; const eCtx = eCanvas.getContext('2d'); eCtx.scale(scaleFac, scaleFac);
        layers.forEach((l, idx) => { if(!l.visible) return; eCtx.save(); if(idx === 0) eCtx.drawImage(offCanvas, 0, 0); else { eCtx.globalAlpha = l.opacity; eCtx.globalCompositeOperation = l.blendMode; eCtx.drawImage(l.img, l.x, l.y, l.w, l.h); } eCtx.restore(); });
        const blob = await new Promise(res => eCanvas.toBlob(res, format, quality)); zip.file(`FastPhoto_Batch_${i+1}.${ext}`, blob);
    }
    btn.innerHTML = `<i class="fa-solid fa-file-zipper"></i> Creazione ZIP in corso...`;
    const zipBlob = await zip.generateAsync({type:"blob"}); const url = URL.createObjectURL(zipBlob); const a = document.createElement('a'); a.href = url; a.download = `Progetto_FastPhoto.zip`; a.click(); URL.revokeObjectURL(url);
    layers = originalLayers; isExporting = false; updateBaseFilters(); btn.innerHTML = originalText; btn.disabled = false; document.getElementById('export-modal').style.display = 'none';
};

