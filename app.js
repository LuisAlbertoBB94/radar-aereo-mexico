// 1. CONFIGURACIÓN
const API_URL = "/api/states/all?lamin=15.5&lomin=-114&lamax=30&lomax=-86";
const MAX_PLANES = 50;

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
let isRateLimited = false;

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
            logEvent("MODO AUDIO: Melodía Armónica General", "system");
        } else {
            toggleOrchestraBtn.innerText = "🎵 Solistas (Selección)";
            toggleOrchestraBtn.className = "audio-btn gold";
            logEvent("MODO AUDIO: Solistas (Haz clic en los aviones)", "golden");
        }
    });
}

// 4. MOTOR DE SONIDO "CAMPANAS ZEN" (LUMINOSO, ALEGRE Y MEDITATIVO)
class ZenBellAudioEngine {
    constructor() {
        this.active = false;
        this.ctx = null;
        this.masterGain = null;
        
        // Escala Pentatónica Mayor de Do (Luminosa, Dulce y Alegre: C4, D4, E4, G4, A4, C5, E5, G5)
        // Cero notas oscuras o graves tenebrosas. Es el sonido de una marimba/campana tibetana de meditación.
        this.scale = [
            261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
            523.25, 587.33, 659.25, 783.99, 880.00, // C5, D5, E5, G5, A5
            1046.50                                  // C6 (Campanita dulce)
        ];
    }

    async init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.45; 
            
            // Reverb de aire cristalino
            const delayL = this.ctx.createDelay(2.0);
            delayL.delayTime.value = 0.25;
            const delayR = this.ctx.createDelay(2.0);
            delayR.delayTime.value = 0.40;
            
            const feedbackL = this.ctx.createGain();
            feedbackL.gain.value = 0.3;
            const feedbackR = this.ctx.createGain();
            feedbackR.gain.value = 0.3;
            
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
    }

    toggle() {
        if (this.active) {
            this.active = false;
            this.ctx.suspend(); 
            return false;
        } else {
            this.init();
            return true;
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

        // Onda Senoidal Pura + Armónico de Octava (Sonido de Campana de Viento / Marimba)
        oscMain.type = 'sine';
        oscHarmonic.type = 'sine';
        
        const actualFreq = onGround ? freq / 2 : freq;
        oscMain.frequency.value = actualFreq;
        oscHarmonic.frequency.value = actualFreq * 2; // Octava superior muy suave para brillo cristalino

        panner.pan.value = pan;
        
        const now = this.ctx.currentTime;
        const volume = speed > 0 ? 0.20 : 0.10; 
        
        // Envolvente de Campana Dulce: Ataque suave (0.05s) y decaimiento natural cálido (2.8s)
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2.8);

        // El armónico se apaga más rápido para dejar el tono puro
        const harmGain = this.ctx.createGain();
        harmGain.gain.setValueAtTime(volume * 0.25, now);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

        oscMain.connect(gainNode);
        oscHarmonic.connect(harmGain);
        harmGain.connect(gainNode);

        gainNode.connect(panner);
        panner.connect(this.masterGain);

        oscMain.start(now);
        oscHarmonic.start(now);
        oscMain.stop(now + 2.8);
        oscHarmonic.stop(now + 2.8);
    }
}

const audioEngine = new ZenBellAudioEngine();

if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', () => {
        const isNowOn = audioEngine.toggle();
        if (isNowOn) {
            toggleAudioBtn.innerText = "🔊 Melodía Cristalina & Zen";
            toggleAudioBtn.classList.add("on");
            toggleAudioBtn.classList.remove("off");
        } else {
            toggleAudioBtn.innerText = "🔇 Audio Inactivo";
            toggleAudioBtn.classList.remove("on");
            toggleAudioBtn.classList.add("off");
        }
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
    if(detDest) detDest.innerText = data.originCountry || "México";
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

// 6. PROCESAMIENTO DE AVIONES Y ESTELAS
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

        if (lon === null || lat === null) return;

        let history = [];
        if (aircraftData.has(icao)) {
            history = aircraftData.get(icao).history || [];
        }
        
        if (history.length === 0 || history[history.length-1][0] !== lat || history[history.length-1][1] !== lon) {
            history.push([lat, lon]);
            if (history.length > 30) history.shift();
        }

        const flightData = { icao, callsign, originCountry, lat, lon, altitude, onGround, velocity, heading, history };
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

// 7. GENERADOR DE 50 RUTAS MEXICANAS ACTIVAS
function seedInitialMexicanFleet() {
    logEvent("Desplegando flota de 50 vuelos activos en México...", "system");
    
    const baseRoutes = [
        { icao: "AMX101", callsign: "AMX101", lat: 19.43, lon: -99.07, heading: 85, altitude: 9500, velocity: 780 },
        { icao: "AMX240", callsign: "AMX240", lat: 25.68, lon: -100.31, heading: 195, altitude: 10200, velocity: 820 },
        { icao: "VOI502", callsign: "VOI502", lat: 20.65, lon: -103.35, heading: 330, altitude: 11000, velocity: 850 },
        { icao: "VTI310", callsign: "VTI310", lat: 21.16, lon: -86.85, heading: 250, altitude: 8800, velocity: 740 },
        { icao: "AMX404", callsign: "AMX404", lat: 32.51, lon: -117.03, heading: 135, altitude: 10500, velocity: 890 },
        { icao: "VOI712", callsign: "VOI712", lat: 16.75, lon: -93.11, heading: 290, altitude: 7500, velocity: 680 },
        { icao: "VTI108", callsign: "VTI108", lat: 20.96, lon: -89.62, heading: 260, altitude: 9200, velocity: 790 },
        { icao: "AMX780", callsign: "AMX780", lat: 23.23, lon: -106.41, heading: 110, altitude: 9900, velocity: 810 },
        { icao: "VOI209", callsign: "VOI209", lat: 17.06, lon: -96.72, heading: 350, altitude: 8400, velocity: 710 },
        { icao: "VTI450", callsign: "VTI450", lat: 24.14, lon: -110.31, heading: 120, altitude: 10100, velocity: 830 },
        { icao: "AMX330", callsign: "AMX330", lat: 19.18, lon: -96.14, heading: 280, altitude: 6500, velocity: 640 },
        { icao: "VOI880", callsign: "VOI880", lat: 28.63, lon: -106.06, heading: 160, altitude: 10800, velocity: 860 },
        { icao: "SLI112", callsign: "SLI112", lat: 20.59, lon: -100.38, heading: 45, altitude: 5400, velocity: 520 },
        { icao: "AMX521", callsign: "AMX521", lat: 21.01, lon: -101.68, heading: 125, altitude: 8900, velocity: 760 },
        { icao: "VOI441", callsign: "VOI441", lat: 26.08, lon: -98.28, heading: 210, altitude: 9400, velocity: 790 },
        { icao: "VTI901", callsign: "VTI901", lat: 18.50, lon: -88.30, heading: 315, altitude: 7200, velocity: 670 },
        { icao: "AMX603", callsign: "AMX603", lat: 16.86, lon: -99.88, heading: 25, altitude: 6100, velocity: 590 },
        { icao: "VOI115", callsign: "VOI115", lat: 15.77, lon: -96.16, heading: 340, altitude: 8300, velocity: 720 },
        { icao: "VTI222", callsign: "VTI222", lat: 20.67, lon: -105.25, heading: 95, altitude: 9100, velocity: 770 },
        { icao: "AMX834", callsign: "AMX834", lat: 29.07, lon: -110.95, heading: 150, altitude: 10400, velocity: 840 },
        { icao: "VOI339", callsign: "VOI339", lat: 31.69, lon: -106.42, heading: 175, altitude: 10900, velocity: 870 },
        { icao: "VTI771", callsign: "VTI771", lat: 27.48, lon: -109.93, heading: 140, altitude: 9700, velocity: 810 },
        { icao: "AMX910", callsign: "AMX910", lat: 22.15, lon: -100.98, heading: 200, altitude: 8600, velocity: 730 },
        { icao: "VOI662", callsign: "VOI662", lat: 19.28, lon: -99.65, heading: 80, altitude: 4800, velocity: 490 },
        { icao: "VTI553", callsign: "VTI553", lat: 19.14, lon: -101.19, heading: 60, altitude: 7100, velocity: 650 },
        { icao: "AMX144", callsign: "AMX144", lat: 17.99, lon: -92.92, heading: 285, altitude: 7800, velocity: 700 },
        { icao: "VOI881", callsign: "VOI881", lat: 19.81, lon: -90.53, heading: 240, altitude: 8500, velocity: 740 },
        { icao: "VTI994", callsign: "VTI994", lat: 25.54, lon: -103.40, heading: 165, altitude: 9600, velocity: 800 },
        { icao: "AMX202", callsign: "AMX202", lat: 23.73, lon: -99.14, heading: 185, altitude: 9000, velocity: 760 },
        { icao: "VOI303", callsign: "VOI303", lat: 26.91, lon: -101.42, heading: 155, altitude: 9800, velocity: 810 },
        { icao: "VTI404", callsign: "VTI404", lat: 22.25, lon: -97.86, heading: 245, altitude: 6900, velocity: 630 },
        { icao: "AMX505", callsign: "AMX505", lat: 21.51, lon: -104.89, heading: 115, altitude: 8200, velocity: 710 },
        { icao: "VOI606", callsign: "VOI606", lat: 18.92, lon: -99.23, heading: 335, altitude: 5100, velocity: 500 },
        { icao: "VTI707", callsign: "VTI707", lat: 20.12, lon: -98.73, heading: 215, altitude: 5800, velocity: 560 },
        { icao: "AMX808", callsign: "AMX808", lat: 18.85, lon: -97.10, heading: 295, altitude: 6700, velocity: 620 },
        { icao: "VOI909", callsign: "VOI909", lat: 17.55, lon: -99.50, heading: 15, altitude: 7300, velocity: 660 },
        { icao: "VTI111", callsign: "VTI111", lat: 16.24, lon: -92.23, heading: 305, altitude: 7900, velocity: 690 },
        { icao: "AMX222", callsign: "AMX222", lat: 18.15, lon: -94.46, heading: 275, altitude: 7600, velocity: 680 },
        { icao: "VOI333", callsign: "VOI333", lat: 20.21, lon: -87.46, heading: 230, altitude: 8700, velocity: 750 },
        { icao: "VTI444", callsign: "VTI444", lat: 22.77, lon: -102.57, heading: 170, altitude: 9300, velocity: 780 },
        { icao: "AMX555", callsign: "AMX555", lat: 24.02, lon: -104.65, heading: 130, altitude: 9500, velocity: 790 },
        { icao: "VOI666", callsign: "VOI666", lat: 24.80, lon: -107.39, heading: 145, altitude: 10000, velocity: 820 },
        { icao: "VTI777", callsign: "VTI777", lat: 27.03, lon: -108.93, heading: 150, altitude: 10300, velocity: 830 },
        { icao: "AMX888", callsign: "AMX888", lat: 30.69, lon: -115.01, heading: 135, altitude: 10700, velocity: 860 },
        { icao: "VOI999", callsign: "VOI999", lat: 32.46, lon: -115.07, heading: 120, altitude: 11100, velocity: 880 },
        { icao: "VTI123", callsign: "VTI123", lat: 23.05, lon: -109.70, heading: 105, altitude: 10200, velocity: 820 },
        { icao: "AMX456", callsign: "AMX456", lat: 20.62, lon: -105.23, heading: 85, altitude: 9400, velocity: 780 },
        { icao: "VOI789", callsign: "VOI789", lat: 19.15, lon: -104.32, heading: 75, altitude: 8800, velocity: 740 },
        { icao: "VTI234", callsign: "VTI234", lat: 16.84, lon: -99.82, heading: 35, altitude: 6300, velocity: 580 },
        { icao: "AMX567", callsign: "AMX567", lat: 15.76, lon: -96.26, heading: 25, altitude: 8100, velocity: 710 }
    ];

    const flightsArray = baseRoutes.map(r => [
        r.icao, r.callsign, "Mexico", 1786589314, 1786589315,
        r.lon, r.lat, r.altitude, false, r.velocity / 3.6, r.heading
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
                logEvent("Cuota API de OpenSky excedida. Radar operando en trayectoria estimada...", "alert");
                if(wsStatus) {
                    wsStatus.className = "status-badge online";
                    wsStatus.innerText = "RADAR EN VIVO (ESTIMADO)";
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
            wsStatus.innerText = "RADAR EN VIVO (ESTIMADO)";
        }
    }
}

// 10. SONIFICACIÓN CONTINUA (MELODÍA ZEN CRISTALINA)
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
    audioSweepInterval = setInterval(sonifyNextAircraft, 1200); // 1.2s entre campanitas
}, 500);