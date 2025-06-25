// Configuration
const CONFIG = {
    API_URL: "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app",
    START_COORDS: [51.4372855, 7.8781002],
    START_ZOOM: 15,
    MAP_BOUNDS: [
        [51.4486358805082, 7.85711288452149], // top left bound
        [51.4462895254982, 7.89839744567871], // top right bound
        [51.4215025017151, 7.89968490600586], // bottom right bound
        [51.4227863001803, 7.85419464111328]  // bottom left bound
    ],
    MIN_ZOOM: 15,
    MAX_ZOOM: 17
};

const NGROK_SKIP_HEADER = { 'ngrok-skip-browser-warning': 'skip-browser-warning' };

// State management
const state = {
    markers: [],
    zones: [],
    drawing: false,
    drawingType: null,
    drawingPoints: [],
    tempMarkers: [],
    tempLine: null,
    selectedZone: null,
    editHandles: [],
    zoneId: 1,
    hutMode: null
};

function isLoggedIn() {
    return !!localStorage.getItem("token");
}

function showLoginError() {
    alert("Je bent niet ingelogd. Je kunt niet editen, toevoegen of verwijderen.");
}

function getAuthHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// Map initialization
function initializeMap() {
    const map = L.map('map', {
        zoomControl: true,
        doubleClickZoom: true,
        scrollWheelZoom: true,
        boxZoom: true,
        touchZoom: true,
        minZoom: CONFIG.MIN_ZOOM,
        maxZoom: CONFIG.MAX_ZOOM
    }).setView(CONFIG.START_COORDS, CONFIG.START_ZOOM);

    setupMapLayers(map);
    setupMapBounds(map);
    setupMapControls(map);

    return map;
}

function setupMapLayers(map) {
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
    const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');

    L.control.layers(
        {
            "Licht": light,
            "Satelliet": satellite
        },
        null,
        { position: 'bottomright' }
    ).addTo(map);


    satellite.addTo(map);
}

function setupMapBounds(map) {
    const bounds = L.latLngBounds(CONFIG.MAP_BOUNDS);
    map.setMaxBounds(bounds);
    map.on('drag', function () {
        map.panInsideBounds(bounds, { animate: false });
    });
}

function setupMapControls(map) {
    const locate = L.control({ position: 'topleft' });
    locate.onAdd = function () {
        const btn = L.DomUtil.create('button', 'locate-btn');
        btn.innerHTML = 'Locatie';
        L.DomEvent.on(btn, 'click', function (e) {
            L.DomEvent.stopPropagation(e);
            map.locate({ setView: true, maxZoom: CONFIG.START_ZOOM });
        });
        return btn;
    };
    locate.addTo(map);

    map.on('locationfound', function (e) {
        if (map._locationMarker) {
            map.removeLayer(map._locationMarker);
        }
        map._locationMarker = L.marker(e.latlng).addTo(map);
    });
}

async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);

    if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        alert("Je sessie is verlopen – log opnieuw in.");
        document.dispatchEvent(new CustomEvent("userLoggedOut"));
        throw new Error("Unauthorized");
    }
    return res;
}

const api = {
    async testConnection() {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        try {
            const res = await apiFetch(`${CONFIG.API_URL}/test-db`, { headers });
            const text = await res.text();
            console.log("API connection test succeeded:", JSON.parse(text));
            return true;
        } catch (err) {
            console.error("API connection test failed:", err);
            return false;
        }
    },

    async saveMarker(markerData) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes`, {
            method: "POST",
            headers,
            body: JSON.stringify(markerData)
        });
        return res.json();
    },

    async loadMarkers() {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes`, { headers });
        return res.json();                 // [] bij geen records
    },

    async updateMarker(markerId, markerData) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes/${markerId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(markerData)
        });
        return res.json();
    },

    async deleteMarker(markerId) {
        const headers = { ...getAuthHeaders() };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes/${markerId}`, {
            method: "DELETE",
            headers
        });
        return res.json();
    },

    async saveZone(zone) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/zones`, {
            method: "POST",
            headers,
            body: JSON.stringify(zone)
        });
        return res.json();
    },

    async loadZones() {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/zones`, { headers });
        return res.json();
    },

    async updateZone(zoneId, zoneData) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/zones/${zoneId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(zoneData)
        });
        return res.json();
    },

    async deleteZone(zoneId) {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/zones/${zoneId}`, {
            method: "DELETE",
            headers
        });
        return res.json();
    },
};


// Marker functions
function createMarkerElement(markerData, map) {
    const marker = L.circleMarker([markerData.lat, markerData.lng], {
        radius: 6,
        fillColor: "blue",
        color: "white",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9
    }).addTo(map).bindTooltip(`${markerData.name} ${markerData.number}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -8]
    });

    marker.description = markerData.desc;
    marker.markerData = markerData;

    marker.on('click', function (e) {
        handleMarkerClick(e, marker, markerData, map);
    });

    return marker;
}

function handleMarkerClick(event, marker, markerData, map) {
    if (state.hutMode === "edit") {
        editMarker(marker, markerData);
    } else if (state.hutMode === "delete") {
        deleteMarker(marker, markerData, map);
    } else {
        showMarkerPopup(event, markerData, map);
    }
}

async function editMarker(marker, markerData) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }
    const newName = prompt('Nieuwe naam:', markerData.name);
    const newDesc = prompt('Nieuwe beschrijving:', markerData.desc);

    if (!newName) return;

    const updatedData = {
        ...markerData,
        name: newName,
        desc: newDesc
    };

    try {
        await api.updateMarker(markerData.id, updatedData);

        marker.bindTooltip(`${newName} ${markerData.number}`, {
            permanent: true,
            direction: 'top'
        }).openTooltip();

        marker.markerData = updatedData;

        // Update in state
        const index = state.markers.findIndex(m => m.id === markerData.id);
        if (index !== -1) {
            state.markers[index] = updatedData;
        }
    } catch (error) {
        alert('Fout bij het bijwerken van de marker');
    }
}

async function deleteMarker(marker, markerData, map) {
    if (!confirm(`Verwijder ${markerData.name} ${markerData.number}?`)) return;

    try {
        await api.deleteMarker(markerData.id);
        map.removeLayer(marker);

        // Remove from state
        const index = state.markers.findIndex(m => m.id === markerData.id);
        if (index !== -1) {
            state.markers.splice(index, 1);
        }
    } catch (error) {
        alert('Fout bij het verwijderen van de marker');
    }
}

function showMarkerPopup(event, markerData, map) {
    L.popup()
        .setLatLng(event.latlng)
        .setContent(`<strong>${markerData.name} ${markerData.number}</strong><br>${markerData.desc}`)
        .openOn(map);
}

async function loadAndDisplayMarkers(map) {
    try {
        const markersData = await api.loadMarkers();
        console.log("Processing markers data:", markersData);

        markersData.forEach(markerData => {
            console.log("Creating marker for:", markerData);
            const marker = createMarkerElement(markerData, map);
            state.markers.push(markerData);
        });

        console.log(`Loaded ${markersData.length} markers`);
    } catch (error) {
        console.error('Failed to load markers:', error);
        alert('Fout bij het laden van markers');
    }
}

async function loadAndDisplayZones(map) {
    try {
        const zones = await api.loadZones();
        zones.forEach(z => {
            createZone(z.type, z.latlngs, map, z);   // let op extra param!
        });
        console.log(`Loaded ${zones.length} zones`);
    } catch (err) {
        console.error('Failed to load zones:', err);
        alert('Fout bij het laden van zones');
    }
}

async function addNewMarker(event, map) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }
    if (state.hutMode !== "add") return;

    const name = prompt('Naam van de hut?');
    if (!name) return;

    const number = prompt('Nummer?');
    if (number === null) return;

    const desc = prompt('Korte beschrijving?') || '';

    const markerData = {
        name,
        number,
        desc,
        lat: event.latlng.lat,
        lng: event.latlng.lng
    };

    try {
        const response = await api.saveMarker(markerData);
        markerData.id = response.id;

        const marker = createMarkerElement(markerData, map);
        state.markers.push(markerData);

        console.log("New marker added:", markerData);
    } catch (error) {
        console.error('Failed to save marker:', error);
        alert('Fout bij het opslaan van de marker');
    }
}

// Zone functions
function getZoneStyle(type) {
    switch (type) {
        case 'voederplek':
        case 'voederzone':
            return { color: 'sienna', fillColor: 'sienna', fillOpacity: 0.5 };
        case 'wildakker':
            return { color: 'yellow', fillColor: 'yellow', fillOpacity: 0.5 };
        case 'bos':
            return { color: 'green', fillColor: 'green', fillOpacity: 0.5 };
        case 'grens':
            return { color: 'red', weight: 3, fillOpacity: 0 };
        default:
            return { color: 'blue', fillColor: 'blue', fillOpacity: 0.3 };
    }
}

function createZone(type, latlngs, map, fromServer = null) {
    const adding = (fromServer === null);
    if (adding && !isLoggedIn()) {
        showLoginError();
        return;
    }

    const poly = (type === 'grens')
        ? L.polyline(latlngs, getZoneStyle(type)).addTo(map)
        : L.polygon(latlngs, getZoneStyle(type)).addTo(map);

    const zone = {
        id: adding ? null : fromServer.id,
        type,
        label: adding ? '' : (fromServer.label || ''),
        polygon: poly,
        latlngs: latlngs.slice()         // eigen kopie
    };

    poly.bindPopup(() => {
        const idTxt = zone.id ?? '-';
        return `${zone.label || type}<br>ID: ${idTxt}`;
    });

    poly.on('click', e => {
        L.DomEvent.stopPropagation(e);
        selectZone(zone, map);
        poly.openPopup(e.latlng);
    });

    state.zones.push(zone);
    return zone;
}

function selectZone(zone, map) {
    deselectZone(map);
    state.selectedZone = zone;
    document.getElementById('delete-zone').classList.remove('hidden');

    const polyLL = zone.polygon.getLatLngs();
    zone.latlngs = (zone.type === 'grens') ? polyLL : polyLL[0];
    zone.latlngs.forEach((latlng, idx) => {
        const handle = L.marker(latlng, {
            draggable: true,
            icon: L.divIcon({ className: 'vertex-handle' })
        }).addTo(map);

        handle.on('dragend', async () => {
            try {
                await api.updateZone(zone.id, {
                    type: zone.type,
                    label: zone.label,
                    latlngs: zone.latlngs
                });
            } catch (err) {
                alert('Fout bij opslaan grens-wijziging');
                console.error(err);
            }
        });

        state.editHandles.push(handle);
    });
}

function deselectZone(map) {
    if (!state.selectedZone) return;

    state.editHandles.forEach(h => map.removeLayer(h));
    state.editHandles = [];
    document.getElementById('delete-zone').classList.add('hidden');
    state.selectedZone = null;
}

async function deleteSelectedZone(map) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }
    if (!state.selectedZone) return;

    const id = state.selectedZone.id;
    const poly = state.selectedZone.polygon;

    try {
        await api.deleteZone(id);
        map.removeLayer(poly);
        state.zones = state.zones.filter(z => z.id !== id);
        deselectZone(map);
    } catch (err) {
        alert("Fout bij verwijderen zone uit database");
        console.error(err);
    }
}

// Drawing functions
function addDrawingPoint(latlng, map) {
    const marker = L.circleMarker(latlng, { radius: 4 }).addTo(map);
    state.tempMarkers.push(marker);
    state.drawingPoints.push(latlng);

    if (!state.tempLine) {
        state.tempLine = L.polyline(state.drawingPoints, { dashArray: '4,4' }).addTo(map);
    } else {
        state.tempLine.setLatLngs(state.drawingPoints);
    }

    const minPts = (state.drawingType === 'grens') ? 2 : 3;
    if (state.drawingPoints.length >= minPts) {
        document.getElementById('confirm-zone').classList.remove('hidden');
    }
}

function clearDrawing(map) {
    state.tempMarkers.forEach(m => map.removeLayer(m));
    state.tempMarkers = [];

    if (state.tempLine) {
        map.removeLayer(state.tempLine);
        state.tempLine = null;
    }

    state.drawingPoints = [];

    const confirmBtn = document.getElementById('confirm-zone');
    if (confirmBtn) confirmBtn.classList.add('hidden');
}

// Event handlers
function setupEventHandlers(map) {
    // Map click handler
    map.on('click', function (e) {
        if (state.drawing) {
            addDrawingPoint(e.latlng, map);
            return;
        }

        if (state.selectedZone) {
            deselectZone(map);
        }

        addNewMarker(e, map);
    });

    // Map zoom handler
    map.on('zoomend', () => {
        const zoom = map.getZoom();              // 13–17
        document.body.classList
            .forEach(c => { if (c.startsWith('zoom-')) document.body.classList.remove(c); });
        document.body.classList.add(`zoom-${zoom}`);
    });

    // UI event handlers
    console.log("Edit toggle geladen");
    document.getElementById("toggle-edit").addEventListener("click", () => {
        document.getElementById("edit-options").classList.toggle("hidden");
        document.getElementById("legend-box").classList.add("hidden");
    });

    document.getElementById("toggle-legend").addEventListener("click", () => {
        document.getElementById("legend-box").classList.toggle("hidden");
        document.getElementById("edit-options").classList.add("hidden");
    });

    document.getElementById("add-zone").addEventListener("click", () => {
        document.getElementById("zone-types").classList.toggle("hidden");
    });

    document.getElementById("mode-add").addEventListener("click", () => {
        state.hutMode = "add";
    });

    document.getElementById("mode-edit").addEventListener("click", () => {
        state.hutMode = "edit";
    });

    document.getElementById("mode-delete").addEventListener("click", () => {
        state.hutMode = "delete";
    });

    document.getElementById("zone-types").addEventListener("click", e => {
        if (e.target.tagName !== 'BUTTON') return;

        state.drawing = true;
        state.drawingType = e.target.dataset.type;
        document.getElementById("zone-types").classList.add("hidden");
        clearDrawing(map);
    });

    document.getElementById("delete-zone").addEventListener("click", () => {
        deleteSelectedZone(map);
    });

    document.getElementById('confirm-zone').addEventListener('click', async () => {
        const minPts = (state.drawingType === 'grens') ? 2 : 3;
        if (!(state.drawing && state.drawingPoints.length >= minPts && state.drawingType)) return;

        const label = prompt('Naam/label voor deze zone?') || state.drawingType;
        const zone = createZone(state.drawingType, state.drawingPoints, map);
        zone.label = label;

        try {
            const res = await api.saveZone({ type: zone.type, label, latlngs: zone.latlngs });
            zone.id = res.id;
            zone.polygon.setPopupContent(`${label}<br>ID ${zone.id}`);
        } catch (err) {
            alert('Kon zone niet opslaan!');
            map.removeLayer(zone.polygon);
            return;
        }

        clearDrawing(map);
        state.drawing = false;
        state.drawingType = null;
    });
}

// Main initialization
async function init() {
    console.log("Initializing map application...");

    // Test API connection first
    const apiConnected = await api.testConnection();
    if (!apiConnected) {
        console.error("API connection failed - markers will not load");
    }

    const map = initializeMap();
    setupEventHandlers(map);

    console.log("Loading markers...");
    await loadAndDisplayMarkers(map);
    await loadAndDisplayZones(map);

    console.log("Map application initialized successfully");
}

// Start the application
init().catch(error => {
    console.error('Failed to initialize application:', error);
    alert('Fout bij het laden van de applicatie');
});