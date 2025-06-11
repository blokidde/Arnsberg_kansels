// Configuration
const CONFIG = {
    API_URL: "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app",
    START_COORDS: [51.4372855, 7.8781002],
    START_ZOOM: 13,
    MAP_BOUNDS: [
        [51.4486358805082, 7.85711288452149], // top left bound
        [51.4462895254982, 7.89839744567871], // top right bound
        [51.4215025017151, 7.89968490600586], // bottom right bound
        [51.4227863001803, 7.85419464111328]  // bottom left bound
    ],
    MIN_ZOOM: 14,
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

const smallMarkerIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconSize: [20, 32],
    iconAnchor: [10, 32],
    popupAnchor: [0, -32]
});


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

    L.control.layers({
        "Licht": light,
        "Satelliet": satellite
    }).addTo(map);

    satellite.addTo(map);
}

function setupMapBounds(map) {
    const bounds = L.latLngBounds(CONFIG.MAP_BOUNDS);
    map.setMaxBounds(bounds);
    map.on('drag', function() {
        map.panInsideBounds(bounds, { animate: false });
    });
}

function setupMapControls(map) {
    const locate = L.control({ position: 'topleft' });
    locate.onAdd = function() {
        const btn = L.DomUtil.create('button', 'locate-btn');
        btn.innerHTML = 'Locatie';
        L.DomEvent.on(btn, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            map.locate({ setView: true, maxZoom: CONFIG.START_ZOOM });
        });
        return btn;
    };
    locate.addTo(map);

    map.on('locationfound', function(e) {
        if (map._locationMarker) {
            map.removeLayer(map._locationMarker);
        }
        map._locationMarker = L.marker(e.latlng).addTo(map);
    });
}

// API functions
const api = {
    async testConnection() {
        console.log("Testing API connection...");

        try {
            const response = await fetch(`${CONFIG.API_URL}/test`, { headers: { ...NGROK_SKIP_HEADER } });
            console.log("Response status:", response.status);

            if (!response.ok) {
                console.error("API connection test failed: HTTP status", response.status);
                return false;
            }

            const text = await response.text();
            try {
                const data = JSON.parse(text);
                console.log("API connection test succeeded:", data);
                return true;
            } catch (error) {
                console.error("API connection test failed: Invalid JSON response", error);
                console.log("Raw response:", text);
                return false;
            }
        } catch (error) {
            console.error("API connection test failed:", error);
            return false;
        }
    },

    async saveMarker(markerData) {
        try {
            const response = await fetch(`${CONFIG.API_URL}/hutjes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(markerData)
            });
            return await response.json();
        } catch (error) {
            console.error('Error saving marker:', error);
            throw error;
        }
    },

    async loadMarkers() {
        console.log("Loading markers from API...");
        console.log("API URL:", `${CONFIG.API_URL}/hutjes`);

        try {
            const response = await fetch(`${CONFIG.API_URL}/hutjes`, { headers: { ...NGROK_SKIP_HEADER } });
            console.log("Response status:", response.status);
            console.log("Response headers:", response.headers);

            if (!response.ok) {
                console.error("Error loading markers: HTTP status", response.status);
                return [];
            }

            const text = await response.text();
            console.log("Raw response:", text);

            try {
                const data = JSON.parse(text);
                console.log("Processing markers data:", data);
                return data;
            } catch (error) {
                console.error("Error loading markers: Invalid JSON response", error);
                console.log("Raw response:", text);
                return [];
            }
        } catch (error) {
            console.error("Error loading markers:", error);
            return [];
        }
    },

    async updateMarker(markerId, markerData) {
        try {
            const response = await fetch(`${CONFIG.API_URL}/hutjes/${markerId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(markerData)
            });
            return await response.json();
        } catch (error) {
            console.error('Error updating marker:', error);
            throw error;
        }
    },

    async deleteMarker(markerId) {
        try {
            const response = await fetch(`${CONFIG.API_URL}/hutjes/${markerId}`, { 
                method: "DELETE" 
            });
            return await response.json();
        } catch (error) {
            console.error('Error deleting marker:', error);
            throw error;
        }
    }
};

// Marker functions
function createMarkerElement(markerData, map) {
    const marker = L.marker([markerData.lat, markerData.lng], { icon: smallMarkerIcon }).addTo(map)
        .bindTooltip(`${markerData.name} ${markerData.number}`, { 
            permanent: true, 
            direction: 'top' 
        });

    marker.description = markerData.desc;
    marker.markerData = markerData;

    marker.on('click', function(e) {
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

async function addNewMarker(event, map) {
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
            return { color: 'red', fillOpacity: 0, dashArray: '5,5' };
        default:
            return { color: 'blue', fillColor: 'blue', fillOpacity: 0.3 };
    }
}

function createZone(type, latlngs, map) {
    const poly = L.polygon(latlngs, getZoneStyle(type)).addTo(map);
    const zone = { 
        id: state.zoneId++, 
        type, 
        polygon: poly, 
        latlngs: latlngs.slice() 
    };
    
    poly.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        selectZone(zone, map);
        poly.openPopup(e.latlng);
    });
    
    poly.bindPopup(`Type: ${type}<br>ID: ${zone.id}`);
    state.zones.push(zone);
    
    return zone;
}

function selectZone(zone, map) {
    deselectZone(map);
    state.selectedZone = zone;
    document.getElementById('delete-zone').classList.remove('hidden');
    
    zone.latlngs = zone.polygon.getLatLngs()[0];
    zone.latlngs.forEach((latlng, idx) => {
        const handle = L.marker(latlng, {
            draggable: true,
            icon: L.divIcon({ className: 'vertex-handle' })
        }).addTo(map);
        
        handle.on('drag', ev => {
            zone.latlngs[idx] = ev.target.getLatLng();
            zone.polygon.setLatLngs(zone.latlngs);
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

function deleteSelectedZone(map) {
    if (!state.selectedZone) return;
    
    map.removeLayer(state.selectedZone.polygon);
    state.zones.splice(state.zones.indexOf(state.selectedZone), 1);
    deselectZone(map);
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
    
    if (state.drawingPoints.length >= 3) {
        // Show confirm button if it exists
        const confirmBtn = document.getElementById('confirm-zone');
        if (confirmBtn) confirmBtn.classList.remove('hidden');
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
}

// Event handlers
function setupEventHandlers(map) {
    // Map click handler
    map.on('click', function(e) {
        if (state.drawing) {
            addDrawingPoint(e.latlng, map);
            return;
        }

        if (state.selectedZone) {
            deselectZone(map);
        }

        addNewMarker(e, map);
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
    
    console.log("Map application initialized successfully");
}

// Start the application
init().catch(error => {
    console.error('Failed to initialize application:', error);
    alert('Fout bij het laden van de applicatie');
});