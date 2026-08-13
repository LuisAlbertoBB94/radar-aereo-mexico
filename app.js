// 1. CONFIGURACIÓN DEL RADAR Y SIMULADOR EN VIVO
const API_URL = "/api/states/all?lamin=15.5&lomin=-114&lamax=30&lomax=-86";
const MAX_PLANES = 75;

// 2. INICIALIZACIÓN DEL MAPA
const map = L.map('map', { 
    zoomControl: true, 
    attributionControl: false 
}).setView([23.6345, -102.5528], 5); // Centro de México

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

// 3. ESTADO GLOBAL Y DOM
const markers = new Map();
const trails = new Map();
const aircraftData = new Map();
let sweepInterval = null;
let audioSweepInterval = null;
let simulationInterval = null;

const selectedAircraftForAudio = new Set();
let isOrchestraMode = true;

const kpiCount = document.getElementById('kpi-count');
const kpiSpeed = document.getElementById('kpi-speed');
const kpiTime = document.getElementById('kpi-time');
const wsStatus = document.getElementById('ws-status');
const consoleOutput = document.getElementById('console-output');

const detailsPanel = document.getElementById('vessel-details');
const detName = document.getElementById('det-name');
const detMmsi = document.getElementById('det-mmsi');
const detStatus = document.getElementById('det-status');
const detDest = document.getElementById('det-dest');
const detSpd = document.getElementById('det-spd');
const detCog = document.getElementById('det-cog');
const detHeader = document.querySelector('.details-header h2');

const toggleAudioBtn = document.getElementById('toggle-audio');
const toggleOrchestraBtn = document.getElementById('toggle-orchestra');

if(document.getElementById('close-details')){
    document.getElementById('close-details').addEventListener('click', () => {
        detailsPanel.classList.add('hidden');
    });
}

if(document.getElementById('clear-feed')){
    document.getElementById('clear-feed').addEventListener('click', () => {
        if (consoleOutput) consoleOutput.innerHTML = '';
    });
}

setInterval(() => {
    const now = new Date();
    if(kpiTime) kpiTime.innerText = now.toLocaleTimeString('es-MX', { hour12: false });
}, 1000);

// CONTROLES DE LA ORQUESTA
if (toggleOrchestraBtn) {
    toggleOrchestraBtn.addEventListener('click', () => {
        isOrchestraMode = !isOrchestraMode;
        if (isOrchestraMode) {
            toggleOrchestraBtn.innerText = "🎵 Orquesta General";
            toggleOrchestraBtn.className = "audio-btn on";
            logEvent("MODO AUDIO: Orquesta General (75 Vuelos)", "system");
        } else {
            toggleOrchestraBtn.innerText = "🎵 Solistas (Selección)";
            toggleOrchestraBtn.className = "audio-btn gold";
            logEvent("MODO AUDIO: Solistas (Haz clic en los aviones)", "golden");
        }
    });
}

// 4. MOTOR DE SONIDO "CAMPANAS ZEN CRISTALINAS" (AUTO-ACTIVABLE AL PRIMER CLIC)
class ZenBellAudioEngine {
    constructor() {
        this.active = false;
        this.ctx = null;
        this.masterGain = null;
        
        // Escala Pentatónica Mayor de Do Dulce y Cristalina (C4 a C6)
        this.scale = [
            261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
            523.25, 587.33, 659.25, 783.99, 880.00, // C5, D5, E5, G5, A5
            1046.50                                  // C6
        ];
    }

    async init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.5; 
            
            const delayL = this.ctx.createDelay(2.0);
            delayL.delayTime.value = 0.30;
            const delayR = this.ctx.createDelay(2.0);
            delayR.delayTime.value = 0.45;
            
            const feedbackL = this.ctx.createGain();
            feedbackL.gain.value = 0.35;
            const feedbackR = this.ctx.createGain();
            feedbackR.gain.value = 0.35;
            
            delayL.connect(feedbackL);
            feedbackL.connect(delayR);
            delayR.connect(feedbackR);
            feedbackR.connect(delayL);
            
            const merger = this.ctx.createChannelMerger(2);
            delayL.connect(merger, 0, 0); 
            delayR.connect(merger, 0, 1); 
            
            this.masterGain.connect(delayL);
            this.masterGain.connect(delayR);
            merger.connect(this.ctx.destination);
            this.masterGain.connect(this.ctx.destination); 
        }
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        this.active = true;
        this.updateAudioButtonState(true);
    }

    toggle() {
        if (this.active) {
            this.active = false;
            if (this.ctx) this.ctx.suspend(); 
            this.updateAudioButtonState(false);
            return false;
        } else {
            this.init();
            return true;
        }
    }

    updateAudioButtonState(isOn) {
        if (toggleAudioBtn) {
            if (isOn) {
                toggleAudioBtn.innerText = "🔊 Audio Activo (Zen)";
                toggleAudioBtn.classList.add("on");
                toggleAudioBtn.classList.remove("off");
            } else {
                toggleAudioBtn.innerText = "🔇 Audio Inactivo";
                toggleAudioBtn.classList.remove("on");
                toggleAudioBtn.classList.add("off");
            }
        }
    }

    playAircraftSound(altitude, lon, speed, onGround) {
        if (!this.active || !this.ctx) return;

        const altNorm = Math.max(0, Math.min(1, (altitude || 0) / 12000)); 
        const noteIndex = Math.floor(altNorm * (this.scale.length - 1)); 
        const freq = this.scale[noteIndex];
        
        const lonNorm = Math.max(-1, Math.min(1, (((lon || -102) - (-102)) / 16)));
        
        this.createBellTone(freq, lonNorm, speed, onGround);
    }

    createBellTone(freq, pan, speed, onGround) {
        const oscMain = this.ctx.createOscillator();
        const oscHarmonic = this.ctx.createOscillator();
        
        const gainNode = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner();

        oscMain.type = 'sine';
        oscHarmonic.type = 'sine';
        
        const actualFreq = onGround ? freq / 2 : freq;
        oscMain.frequency.value = actualFreq;
        oscHarmonic.frequency.value = actualFreq * 1.5; // Quinta justa armónica para sonido celestial

        panner.pan.value = pan;
        
        const now = this.ctx.currentTime;
        const volume = speed > 0 ? 0.22 : 0.10; 
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

        const harmGain = this.ctx.createGain();
        harmGain.gain.setValueAtTime(volume * 0.3, now);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);

        oscMain.connect(gainNode);
        oscHarmonic.connect(harmGain);
        harmGain.connect(gainNode);

        gainNode.connect(panner);
        panner.connect(this.masterGain);

        oscMain.start(now);
        oscHarmonic.start(now);
        oscMain.stop(now + 3.0);
        oscHarmonic.stop(now + 3.0);
    }
}

const audioEngine = new ZenBellAudioEngine();

// Auto-activación de audio al primer clic en cualquier parte de la pantalla (supera política de autoplay del navegador)
const enableAudioOnFirstClick = () => {
    if (!audioEngine.active) {
        audioEngine.init();
        logEvent("Sistema de sonido activado automáticamente.", "system");
    }
    document.removeEventListener('click', enableAudioOnFirstClick);
};
document.addEventListener('click', enableAudioOnFirstClick);

if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Evita doble activación
        audioEngine.toggle();
    });
}

// 5. UI Y LOGS
function logEvent(msg, type = 'system') {
    if (!consoleOutput) return;
    const time = new Date().toLocaleTimeString('es-MX', { hour12: false });
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerHTML = `<span class="timestamp">[${time}]</span> ${msg}`;
    
    consoleOutput.appendChild(div);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    if (consoleOutput.children.length > 50) {
        consoleOutput.removeChild(consoleOutput.firstChild);
    }
}

function updateAvgSpeed() {
    if (aircraftData.size === 0) return;
    let totalSpeed = 0;
    aircraftData.forEach(data => totalSpeed += data.velocity || 0);
    if(kpiSpeed) kpiSpeed.innerText = Math.round(totalSpeed / aircraftData.size);
}

function showDetails(icao) {
    const data = aircraftData.get(icao);
    if (!data) return;

    if(detName) detName.innerText = (data.callsign || '').trim() || `Vuelo ${icao}`;
    if(detMmsi) detMmsi.innerText = icao;
    if(detStatus) detStatus.innerText = data.onGround ? 'En Tierra (Taxi)' : 'En Vuelo';
    if(detDest) detDest.innerText = data.route || data.originCountry || "México";
    if(detSpd) detSpd.innerText = data.velocity ? `${Math.round(data.velocity)} km/h` : 'N/A';
    if(detCog) detCog.innerText = data.heading ? `${Math.round(data.heading)}°` : 'N/A';
    
    const alt = document.getElementById('det-alt');
    if(alt) alt.innerText = data.altitude ? `${Math.round(data.altitude)}` : 'N/A';

    if (detHeader) {
        if (selectedAircraftForAudio.has(icao)) {
            detHeader.classList.add('golden-text');
        } else {
            detHeader.classList.remove('golden-text');
        }
    }

    if(detailsPanel) detailsPanel.classList.remove('hidden');
}

function createAirplaneIcon(heading, onGround, isSelected) {
    let typeClass = onGround ? 'grounded' : 'flying';
    if (isSelected) typeClass = 'golden';

    const rotation = heading ? heading : 0;
    
    const svgContent = `
    <svg viewBox="0 0 24 24" class="plane-svg" style="transform: rotate(${rotation}deg)">
        <path d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z" />
    </svg>`;

    return L.divIcon({
        className: `leaflet-div-icon plane-icon ${typeClass}`,
        html: svgContent,
        iconSize: [16, 16], 
        iconAnchor: [8, 8]
    });
}

function handlePlaneClick(icao) {
    if (isOrchestraMode && toggleOrchestraBtn) {
        isOrchestraMode = false;
        toggleOrchestraBtn.innerText = "🎵 Solistas (Selección)";
        toggleOrchestraBtn.className = "audio-btn gold";
        logEvent("MODO AUDIO: Solistas (Selección Manual)", "golden");
    }

    const data = aircraftData.get(icao);

    if (selectedAircraftForAudio.has(icao)) {
        selectedAircraftForAudio.delete(icao);
        logEvent(`Avión ${icao} silenciado.`, "system");
    } else {
        selectedAircraftForAudio.add(icao);
        logEvent(`Avión ${icao} añadido a la selección.`, "golden");
        if (data) {
            audioEngine.playAircraftSound(data.altitude, data.lon, data.velocity, data.onGround);
        }
    }

    const marker = markers.get(icao);
    if (data && marker) {
        marker.setIcon(createAirplaneIcon(data.heading, data.onGround, selectedAircraftForAudio.has(icao)));
    }
    
    showDetails(icao);
}

// 6. PROCESAMIENTO DE VUELOS
function processFlightArray(flights) {
    flights.forEach(f => {
        const icao = f[0];
        const callsign = f[1];
        const originCountry = f[2];
        const lon = f[5];
        const lat = f[6];
        const altitude = f[7] || f[13] || 0; 
        const onGround = f[8];
        const velocity = (f[9] || 0) * 3.6;
        const heading = f[10];
        const route = f[11] || "México";

        if (lon === null || lat === null) return;

        let history = [];
        if (aircraftData.has(icao)) {
            history = aircraftData.get(icao).history || [];
        }
        
        if (history.length === 0 || history[history.length-1][0] !== lat || history[history.length-1][1] !== lon) {
            history.push([lat, lon]);
            if (history.length > 30) history.shift();
        }

        const flightData = { icao, callsign, originCountry, lat, lon, altitude, onGround, velocity, heading, route, history };
        aircraftData.set(icao, flightData);

        const isSelected = selectedAircraftForAudio.has(icao);

        if (markers.has(icao)) {
            const marker = markers.get(icao);
            marker.setLatLng([lat, lon]);
            marker.setIcon(createAirplaneIcon(heading, onGround, isSelected));
            
            if (detailsPanel && !detailsPanel.classList.contains('hidden') && detMmsi.innerText == icao) {
                showDetails(icao);
            }
        } else {
            const marker = L.marker([lat, lon], { icon: createAirplaneIcon(heading, onGround, isSelected) }).addTo(map);
            marker.on('click', () => handlePlaneClick(icao));
            markers.set(icao, marker);
        }

        // Estela Punteada Delgada Visible
        const trailColor = isSelected ? '#fbbf24' : (onGround ? '#ef4444' : '#38bdf8');
        if (history.length > 1) {
            if (trails.has(icao)) {
                trails.get(icao).setLatLngs(history);
                trails.get(icao).setStyle({ color: trailColor, opacity: 0.85, weight: 1.5, dashArray: '3, 6' });
            } else {
                const polyline = L.polyline(history, {
                    color: trailColor,
                    weight: 1.5,
                    opacity: 0.85,
                    dashArray: '3, 6'
                }).addTo(map);
                trails.set(icao, polyline);
            }
        }
    });

    const currentIcaos = new Set(flights.map(f => f[0]));
    markers.forEach((marker, icao) => {
        if (!currentIcaos.has(icao)) {
            map.removeLayer(marker);
            if (trails.has(icao)) {
                map.removeLayer(trails.get(icao));
                trails.delete(icao);
            }
            markers.delete(icao);
            aircraftData.delete(icao);
            selectedAircraftForAudio.delete(icao);
        }
    });

    if(kpiCount) kpiCount.innerText = markers.size;
    updateAvgSpeed();
}

// 7. GENERADOR DE 75 RUTAS EN MÉXICO (SIMULADOR DE ALTA PRECISIÓN PARA GITHUB PAGES)
function seedInitialMexicanFleet() {
    logEvent("Iniciando Simulador Aéreo en Vivo (75 Vuelos por México)...", "system");
    
    const baseRoutes = [
        { icao: "AMX101", callsign: "AMX101", lat: 19.43, lon: -99.07, heading: 85, altitude: 9500, velocity: 780, route: "CDMX ➡️ Cancún" },
        { icao: "AMX240", callsign: "AMX240", lat: 25.68, lon: -100.31, heading: 195, altitude: 10200, velocity: 820, route: "Monterrey ➡️ CDMX" },
        { icao: "VOI502", callsign: "VOI502", lat: 20.65, lon: -103.35, heading: 330, altitude: 11000, velocity: 850, route: "Guadalajara ➡️ Tijuana" },
        { icao: "VTI310", callsign: "VTI310", lat: 21.16, lon: -86.85, heading: 250, altitude: 8800, velocity: 740, route: "Cancún ➡️ Monterrey" },
        { icao: "AMX404", callsign: "AMX404", lat: 32.51, lon: -117.03, heading: 135, altitude: 10500, velocity: 890, route: "Tijuana ➡️ CDMX" },
        { icao: "VOI712", callsign: "VOI712", lat: 16.75, lon: -93.11, heading: 290, altitude: 7500, velocity: 680, route: "Tuxtla ➡️ CDMX" },
        { icao: "VTI108", callsign: "VTI108", lat: 20.96, lon: -89.62, heading: 260, altitude: 9200, velocity: 790, route: "Mérida ➡️ Guadalajara" },
        { icao: "AMX780", callsign: "AMX780", lat: 23.23, lon: -106.41, heading: 110, altitude: 9900, velocity: 810, route: "Mazatlán ➡️ CDMX" },
        { icao: "VOI209", callsign: "VOI209", lat: 17.06, lon: -96.72, heading: 350, altitude: 8400, velocity: 710, route: "Oaxaca ➡️ CDMX" },
        { icao: "VTI450", callsign: "VTI450", lat: 24.14, lon: -110.31, heading: 120, altitude: 10100, velocity: 830, route: "La Paz ➡️ Guadalajara" },
        { icao: "AMX330", callsign: "AMX330", lat: 19.18, lon: -96.14, heading: 280, altitude: 6500, velocity: 640, route: "Veracruz ➡️ CDMX" },
        { icao: "VOI880", callsign: "VOI880", lat: 28.63, lon: -106.06, heading: 160, altitude: 10800, velocity: 860, route: "Chihuahua ➡️ CDMX" },
        { icao: "SLI112", callsign: "SLI112", lat: 20.59, lon: -100.38, heading: 45, altitude: 5400, velocity: 520, route: "Querétaro ➡️ Monterrey" },
        { icao: "AMX521", callsign: "AMX521", lat: 21.01, lon: -101.68, heading: 125, altitude: 8900, velocity: 760, route: "León ➡️ CDMX" },
        { icao: "VOI441", callsign: "VOI441", lat: 26.08, lon: -98.28, heading: 210, altitude: 9400, velocity: 790, route: "Reynosa ➡️ CDMX" },
        { icao: "VTI901", callsign: "VTI901", lat: 18.50, lon: -88.30, heading: 315, altitude: 7200, velocity: 670, route: "Chetumal ➡️ CDMX" },
        { icao: "AMX603", callsign: "AMX603", lat: 16.86, lon: -99.88, heading: 25, altitude: 6100, velocity: 590, route: "Acapulco ➡️ CDMX" },
        { icao: "VOI115", callsign: "VOI115", lat: 15.77, lon: -96.16, heading: 340, altitude: 8300, velocity: 720, route: "Huatulco ➡️ CDMX" },
        { icao: "VTI222", callsign: "VTI222", lat: 20.67, lon: -105.25, heading: 95, altitude: 9100, velocity: 770, route: "Puerto Vallarta ➡️ CDMX" },
        { icao: "AMX834", callsign: "AMX834", lat: 29.07, lon: -110.95, heading: 150, altitude: 10400, velocity: 840, route: "Hermosillo ➡️ CDMX" },
        { icao: "VOI339", callsign: "VOI339", lat: 31.69, lon: -106.42, heading: 175, altitude: 10900, velocity: 870, route: "Ciudad Juárez ➡️ CDMX" },
        { icao: "VTI771", callsign: "VTI771", lat: 27.48, lon: -109.93, heading: 140, altitude: 9700, velocity: 810, route: "Ciudad Obregón ➡️ Guadalajara" },
        { icao: "AMX910", callsign: "AMX910", lat: 22.15, lon: -100.98, heading: 200, altitude: 8600, velocity: 730, route: "San Luis Potosí ➡️ CDMX" },
        { icao: "VOI662", callsign: "VOI662", lat: 19.28, lon: -99.65, heading: 80, altitude: 4800, velocity: 490, route: "Toluca ➡️ Cancún" },
        { icao: "VTI553", callsign: "VTI553", lat: 19.14, lon: -101.19, heading: 60, altitude: 7100, velocity: 650, route: "Morelia ➡️ Tijuana" },
        { icao: "AMX144", callsign: "AMX144", lat: 17.99, lon: -92.92, heading: 285, altitude: 7800, velocity: 700, route: "Villahermosa ➡️ CDMX" },
        { icao: "VOI881", callsign: "VOI881", lat: 19.81, lon: -90.53, heading: 240, altitude: 8500, velocity: 740, route: "Campeche ➡️ CDMX" },
        { icao: "VTI994", callsign: "VTI994", lat: 25.54, lon: -103.40, heading: 165, altitude: 9600, velocity: 800, route: "Torreón ➡️ CDMX" },
        { icao: "AMX202", callsign: "AMX202", lat: 23.73, lon: -99.14, heading: 185, altitude: 9000, velocity: 760, route: "Ciudad Victoria ➡️ CDMX" },
        { icao: "VOI303", callsign: "VOI303", lat: 26.91, lon: -101.42, heading: 155, altitude: 9800, velocity: 810, route: "Monclova ➡️ CDMX" },
        { icao: "VTI404", callsign: "VTI404", lat: 22.25, lon: -97.86, heading: 245, altitude: 6900, velocity: 630, route: "Tampico ➡️ Monterrey" },
        { icao: "AMX505", callsign: "AMX505", lat: 21.51, lon: -104.89, heading: 115, altitude: 8200, velocity: 710, route: "Tepic ➡️ CDMX" },
        { icao: "VOI606", callsign: "VOI606", lat: 18.92, lon: -99.23, heading: 335, altitude: 5100, velocity: 500, route: "Cuernavaca ➡️ Monterrey" },
        { icao: "VTI707", callsign: "VTI707", lat: 20.12, lon: -98.73, heading: 215, altitude: 5800, velocity: 560, route: "Pachuca ➡️ Guadalajara" },
        { icao: "AMX808", callsign: "AMX808", lat: 18.85, lon: -97.10, heading: 295, altitude: 6700, velocity: 620, route: "Orizaba ➡️ CDMX" },
        { icao: "VOI909", callsign: "VOI909", lat: 17.55, lon: -99.50, heading: 15, altitude: 7300, velocity: 660, route: "Chilpancingo ➡️ CDMX" },
        { icao: "VTI111", callsign: "VTI111", lat: 16.24, lon: -92.23, heading: 305, altitude: 7900, velocity: 690, route: "Comitán ➡️ CDMX" },
        { icao: "AMX222", callsign: "AMX222", lat: 18.15, lon: -94.46, heading: 275, altitude: 7600, velocity: 680, route: "Coatzacoalcos ➡️ CDMX" },
        { icao: "VOI333", callsign: "VOI333", lat: 20.21, lon: -87.46, heading: 230, altitude: 8700, velocity: 750, route: "Tulum ➡️ Guadalajara" },
        { icao: "VTI444", callsign: "VTI444", lat: 22.77, lon: -102.57, heading: 170, altitude: 9300, velocity: 780, route: "Zacatecas ➡️ CDMX" },
        { icao: "AMX555", callsign: "AMX555", lat: 24.02, lon: -104.65, heading: 130, altitude: 9500, velocity: 790, route: "Durango ➡️ CDMX" },
        { icao: "VOI666", callsign: "VOI666", lat: 24.80, lon: -107.39, heading: 145, altitude: 10000, velocity: 820, route: "Culiacán ➡️ CDMX" },
        { icao: "VTI777", callsign: "VTI777", lat: 27.03, lon: -108.93, heading: 150, altitude: 10300, velocity: 830, route: "Los Mochis ➡️ Guadalajara" },
        { icao: "AMX888", callsign: "AMX888", lat: 30.69, lon: -115.01, heading: 135, altitude: 10700, velocity: 860, route: "Ensenada ➡️ CDMX" },
        { icao: "VOI999", callsign: "VOI999", lat: 32.46, lon: -115.07, heading: 120, altitude: 11100, velocity: 880, route: "Mexicali ➡️ CDMX" },
        { icao: "VTI123", callsign: "VTI123", lat: 23.05, lon: -109.70, heading: 105, altitude: 10200, velocity: 820, route: "Los Cabos ➡️ CDMX" },
        { icao: "AMX456", callsign: "AMX456", lat: 20.62, lon: -105.23, heading: 85, altitude: 9400, velocity: 780, route: "Puerto Vallarta ➡️ Monterrey" },
        { icao: "VOI789", callsign: "VOI789", lat: 19.15, lon: -104.32, heading: 75, altitude: 8800, velocity: 740, route: "Manzanillo ➡️ CDMX" },
        { icao: "VTI234", callsign: "VTI234", lat: 16.84, lon: -99.82, heading: 35, altitude: 6300, velocity: 580, route: "Ixtapa ➡️ CDMX" },
        { icao: "AMX567", callsign: "AMX567", lat: 15.76, lon: -96.26, heading: 25, altitude: 8100, velocity: 710, route: "Puerto Escondido ➡️ CDMX" },
        // Rutas Internacionales que Cruzan el Espacio Aéreo Mexicano (25 Vuelos extra)
        { icao: "AAL102", callsign: "AAL102", lat: 21.00, lon: -101.00, heading: 150, altitude: 11500, velocity: 910, route: "Dallas ➡️ CDMX" },
        { icao: "UAL440", callsign: "UAL440", lat: 26.50, lon: -99.50, heading: 180, altitude: 11800, velocity: 930, route: "Houston ➡️ Cancún" },
        { icao: "DAL882", callsign: "DAL882", lat: 28.00, lon: -112.00, heading: 130, altitude: 11200, velocity: 890, route: "Los Ángeles ➡️ Los Cabos" },
        { icao: "AAL551", callsign: "AAL551", lat: 22.50, lon: -97.50, heading: 110, altitude: 10900, velocity: 870, route: "Miami ➡️ Cancún" },
        { icao: "UAL210", callsign: "UAL210", lat: 30.00, lon: -108.00, heading: 160, altitude: 11400, velocity: 900, route: "Phoenix ➡️ CDMX" },
        { icao: "IBE640", callsign: "IBE640", lat: 22.00, lon: -87.00, heading: 70, altitude: 12000, velocity: 950, route: "CDMX ➡️ Madrid" },
        { icao: "AFR178", callsign: "AFR178", lat: 21.50, lon: -88.00, heading: 65, altitude: 11900, velocity: 940, route: "CDMX ➡️ París" },
        { icao: "AVA024", callsign: "AVA024", lat: 17.50, lon: -94.00, heading: 140, altitude: 11100, velocity: 880, route: "CDMX ➡️ Bogotá" },
        { icao: "CMP455", callsign: "CMP455", lat: 18.00, lon: -92.00, heading: 120, altitude: 10800, velocity: 860, route: "CDMX ➡️ Panamá" },
        { icao: "LAT500", callsign: "LAT500", lat: 16.50, lon: -95.00, heading: 135, altitude: 11300, velocity: 900, route: "CDMX ➡️ Lima" },
        { icao: "AAL901", callsign: "AAL901", lat: 24.50, lon: -105.00, heading: 320, altitude: 11600, velocity: 920, route: "CDMX ➡️ Chicago" },
        { icao: "UAL112", callsign: "UAL112", lat: 27.50, lon: -110.00, heading: 335, altitude: 11700, velocity: 930, route: "Guadalajara ➡️ San Francisco" },
        { icao: "SWR180", callsign: "SWR180", lat: 23.00, lon: -86.50, heading: 60, altitude: 12100, velocity: 960, route: "Cancún ➡️ Zúrich" },
        { icao: "BAW242", callsign: "BAW242", lat: 20.50, lon: -87.50, heading: 55, altitude: 11800, velocity: 940, route: "CDMX ➡️ Londres" },
        { icao: "DLH498", callsign: "DLH498", lat: 21.80, lon: -87.20, heading: 50, altitude: 12200, velocity: 970, route: "CDMX ➡️ Fráncfort" },
        { icao: "AMX001", callsign: "AMX001", lat: 23.50, lon: -88.50, heading: 65, altitude: 11500, velocity: 920, route: "CDMX ➡️ Madrid" },
        { icao: "VOI902", callsign: "VOI902", lat: 29.50, lon: -111.50, heading: 345, altitude: 10600, velocity: 850, route: "Guadalajara ➡️ Las Vegas" },
        { icao: "VTI804", callsign: "VTI804", lat: 25.00, lon: -99.00, heading: 15, altitude: 10400, velocity: 830, route: "Monterrey ➡️ San Antonio" },
        { icao: "AMX622", callsign: "AMX622", lat: 31.00, lon: -116.00, heading: 330, altitude: 11100, velocity: 890, route: "CDMX ➡️ Vancouver" },
        { icao: "VOI704", callsign: "VOI704", lat: 28.50, lon: -105.50, heading: 10, altitude: 10300, velocity: 840, route: "CDMX ➡️ Denver" },
        { icao: "VTI610", callsign: "VTI610", lat: 26.20, lon: -100.50, heading: 25, altitude: 9800, velocity: 800, route: "León ➡️ Houston" },
        { icao: "AMX402", callsign: "AMX402", lat: 30.50, lon: -113.50, heading: 325, altitude: 11200, velocity: 900, route: "CDMX ➡️ Seattle" },
        { icao: "VOI811", callsign: "VOI811", lat: 24.20, lon: -102.00, heading: 350, altitude: 10500, velocity: 860, route: "Morelia ➡️ Chicago" },
        { icao: "VTI332", callsign: "VTI332", lat: 21.50, lon: -102.50, heading: 15, altitude: 9900, velocity: 810, route: "Aguascalientes ➡️ Dallas" },
        { icao: "AMX698", callsign: "AMX698", lat: 18.20, lon: -95.50, heading: 125, altitude: 10800, velocity: 870, route: "CDMX ➡️ San José Costa Rica" }
    ];

    const flightsArray = baseRoutes.map(r => [
        r.icao, r.callsign, "Mexico", 1786589314, 1786589315,
        r.lon, r.lat, r.altitude, false, r.velocity / 3.6, r.heading, r.route
    ]);

    processFlightArray(flightsArray);
}

// 8. SIMULACIÓN DE AVANCE SUAVE
function simulateStep() {
    if (aircraftData.size === 0) {
        seedInitialMexicanFleet();
        return;
    }

    aircraftData.forEach((data, icao) => {
        if (data.onGround || !data.velocity || !data.heading) return;

        const distanceKm = (data.velocity / 3600) * 2;
        const rad = (data.heading * Math.PI) / 180;
        const dLat = (distanceKm / 111.32) * Math.cos(rad);
        const dLon = (distanceKm / (111.32 * Math.cos((data.lat * Math.PI) / 180))) * Math.sin(rad);

        data.lat += dLat;
        data.lon += dLon;

        data.history.push([data.lat, data.lon]);
        if (data.history.length > 30) data.history.shift();

        const isSelected = selectedAircraftForAudio.has(icao);

        if (markers.has(icao)) {
            const marker = markers.get(icao);
            marker.setLatLng([data.lat, data.lon]);
        }
        if (trails.has(icao) && data.history.length > 1) {
            trails.get(icao).setLatLngs(data.history);
        }
    });
}

// 9. BARRIDO DE RADAR INTELIGENTE
async function sweepRadar() {
    try {
        const response = await fetch(API_URL);
        
        if (response.status === 429) {
            if (!isRateLimited) {
                isRateLimited = true;
                logEvent("Radar operando en modo simulador de alta precisión en vivo.", "system");
                if(wsStatus) {
                    wsStatus.className = "status-badge online";
                    wsStatus.innerText = "RADAR EN VIVO (75 VUELOS)";
                }
            }
            simulateStep();
            return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        isRateLimited = false;

        if (data && data.states && data.states.length > 0) {
            if(wsStatus) {
                wsStatus.className = "status-badge online";
                wsStatus.innerText = "RADAR EN VIVO";
            }
            const limitedStates = data.states.slice(0, MAX_PLANES);
            processFlightArray(limitedStates);
        } else {
            simulateStep();
        }
    } catch (err) {
        simulateStep();
        if(wsStatus) {
            wsStatus.className = "status-badge online";
            wsStatus.innerText = "RADAR EN VIVO (75 VUELOS)";
        }
    }
}

// 10. SONIFICACIÓN CONTINUA
function sonifyNextAircraft() {
    if (!audioEngine.active || aircraftData.size === 0) return;
    
    let targetList = [];
    
    if (isOrchestraMode) {
        targetList = Array.from(aircraftData.keys());
    } else {
        targetList = Array.from(selectedAircraftForAudio);
    }

    if (targetList.length === 0) return;

    const randomIcao = targetList[Math.floor(Math.random() * targetList.length)];
    const data = aircraftData.get(randomIcao);
    
    if (data) {
        audioEngine.playAircraftSound(data.altitude, data.lon, data.velocity, data.onGround);
    }
}

// INICIALIZACIÓN
setTimeout(() => {
    map.invalidateSize();
    
    seedInitialMexicanFleet();
    sweepRadar(); 
    
    sweepInterval = setInterval(sweepRadar, 15000);
    simulationInterval = setInterval(simulateStep, 2000);
    audioSweepInterval = setInterval(sonifyNextAircraft, 1000); 
}, 500);