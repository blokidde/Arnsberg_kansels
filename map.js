/* =================================
   CONFIGURATION
   ================================= */

// Application configuration object containing API endpoints, map settings, and boundaries
const CONFIG = {
    API_URL: "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app", // Backend API URL
    START_COORDS: [51.4372855, 7.8781002], // Initial map center coordinates (Arnsberg)
    START_ZOOM: 15, // Initial zoom level
    // Map boundary coordinates to restrict panning
    MAP_BOUNDS: [
        [51.4486358805082, 7.85711288452149], // top left bound
        [51.4462895254982, 7.89839744567871], // top right bound
        [51.4215025017151, 7.89968490600586], // bottom right bound
        [51.4227863001803, 7.85419464111328]  // bottom left bound
    ],
    MIN_ZOOM: 15, // Minimum allowed zoom level
    MAX_ZOOM: 17  // Maximum allowed zoom level
};

// Header to skip ngrok browser warning
const NGROK_SKIP_HEADER = { 'ngrok-skip-browser-warning': 'skip-browser-warning' };

/* =================================
   STATE MANAGEMENT
   ================================= */

// Global application state object
const state = {
    markers: [],        // Array of hunting hut markers
    zones: [],          // Array of zone polygons (feeding areas, boundaries, etc.)
    drawing: false,     // Whether user is currently drawing a zone
    drawingType: null,  // Type of zone being drawn (grens, voederplek, etc.)
    drawingPoints: [],  // Array of points for current drawing
    tempMarkers: [],    // Temporary markers shown during drawing
    tempLine: null,     // Temporary line shown during drawing
    selectedZone: null, // Currently selected zone for editing
    editHandles: [],    // Array of drag handles for zone editing
    zoneId: 1,          // Counter for zone IDs
    hutMode: null       // Current mode for hut interaction (add, edit, delete)
};

// Global map reference for use across functions
let mapGlobal;

/* =================================
   AUTHENTICATION HELPERS
   ================================= */

// Check if user is currently logged in
function isLoggedIn() {
    return !!localStorage.getItem("token");
}

// Show error message when user tries to perform action without login
function showLoginError() {
    alert("Je bent niet ingelogd. Je kunt niet editen, toevoegen of verwijderen.");
}

// Get authentication headers for API requests
function getAuthHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/* =================================
   MAP INITIALIZATION
   ================================= */

// Initialize the Leaflet map with all required settings
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

// Setup map tile layers and layer control
function setupMapLayers(map) {
    // Satellite imagery layer
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
    // Light themed map layer
    const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');

    // Add layer control to switch between map types
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

// Setup map boundaries to restrict panning
function setupMapBounds(map) {
    const bounds = L.latLngBounds(CONFIG.MAP_BOUNDS);
    map.setMaxBounds(bounds);
    // Ensure map stays within bounds when dragging
    map.on('drag', function () {
        map.panInsideBounds(bounds, { animate: false });
    });
}

// Setup map controls (location button, etc.)
function setupMapControls(map) {
    // Create location button control
    const locate = L.control({ position: 'topleft' });
    locate.onAdd = function () {
        const btn = L.DomUtil.create('button', 'locate-btn');
        btn.innerHTML = 'Locatie';
        // Handle location button click
        L.DomEvent.on(btn, 'click', function (e) {
            L.DomEvent.stopPropagation(e);
            map.locate({ setView: true, maxZoom: CONFIG.START_ZOOM });
        });
        return btn;
    };
    locate.addTo(map);

    // Handle successful location finding
    map.on('locationfound', function (e) {
        // Remove previous location marker if exists
        if (map._locationMarker) {
            map.removeLayer(map._locationMarker);
        }
        // Add new location marker
        map._locationMarker = L.marker(e.latlng).addTo(map);
    });
}

/* =================================
   API COMMUNICATION
   ================================= */

// Enhanced fetch function with authentication handling
async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);

    // Handle authentication errors
    if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        alert("Je sessie is verlopen – log opnieuw in.");
        document.dispatchEvent(new CustomEvent("userLoggedOut"));
        throw new Error("Unauthorized");
    }
    return res;
}

/* =================================
   MODAL MANAGEMENT
   ================================= */

// Open modal for adding shot information to a hut
function openAddShotModal(hutId) {
    const modal = document.getElementById('add-shot-modal');
    modal.dataset.hutId = hutId;
    // Set current time as default shot time
    document.getElementById('shotTime').value = new Date().toISOString().slice(0, 16);
    modal.classList.remove('hidden');
}

// Close the add shot modal and reset form
function closeAddShotModal() {
    document.getElementById('add-shot-modal').classList.add('hidden');
    document.getElementById('add-shot-form').reset();
}

function openReportChoiceModal(hutId) {
    document.getElementById('report-choice-modal').dataset.hutId = hutId;
    document.getElementById('report-choice-modal').classList.remove('hidden');
}

function openSightingModal(hutId) {
    document.getElementById("sighting-modal").dataset.hutId = hutId;
    document.getElementById("sighting-modal").classList.remove("hidden");
}

/* =================================
   API METHODS
   ================================= */

// API object containing all backend communication methods
const api = {
    // Test database connection
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

    // Save new hunting hut marker to database
    async saveMarker(markerData) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes`, {
            method: "POST",
            headers,
            body: JSON.stringify(markerData)
        });
        return res.json();
    },

    // Load all hunting hut markers from database
    async loadMarkers() {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes`, { headers });
        return res.json(); // Returns empty array if no records
    },

    // Update existing hunting hut marker
    async updateMarker(markerId, markerData) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes/${markerId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(markerData)
        });
        return res.json();
    },

    // Delete hunting hut marker from database
    async deleteMarker(markerId) {
        const headers = { ...getAuthHeaders() };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes/${markerId}`, {
            method: "DELETE",
            headers
        });
        return res.json();
    },

    // Save new zone to database
    async saveZone(zone) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/zones`, {
            method: "POST",
            headers,
            body: JSON.stringify(zone)
        });
        return res.json();
    },

    // Load all zones from database
    async loadZones() {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/zones`, { headers });
        return res.json();
    },

    // Update existing zone
    async updateZone(zoneId, zoneData) {
        const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/zones/${zoneId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify(zoneData)
        });
        return res.json();
    },

    // Delete zone from database
    async deleteZone(zoneId) {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/zones/${zoneId}`, {
            method: "DELETE",
            headers
        });
        return res.json();
    },

    // Load all shots for a specific hut
    async loadSchoten(hutId) {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const url = `${CONFIG.API_URL}/schoten?hut_id=${hutId}`;
        const res = await apiFetch(url, { headers });
        return res.json(); // Returns array of shot objects
    },
};

/* =================================
   MARKER FUNCTIONS
   ================================= */

// Create a visual marker element on the map
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

    // Store marker data for later use
    marker.description = markerData.desc;
    marker.markerData = markerData;

    // Handle marker clicks based on current mode
    marker.on('click', function (e) {
        handleMarkerClick(e, marker, markerData, map);
    });

    return marker;
}

// Handle marker click events based on current interaction mode
function handleMarkerClick(event, marker, markerData, map) {
    if (state.hutMode === "edit") {
        editMarker(marker, markerData);
    } else if (state.hutMode === "delete") {
        deleteMarker(marker, markerData, map);
    } else {
        // Default action: show marker popup with information
        showMarkerPopup(event, markerData, map);
    }
}

// Edit marker information (name and description)
async function editMarker(marker, markerData) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }

    // Get new values from user
    const newName = prompt('Nieuwe naam:', markerData.name);
    const newDesc = prompt('Nieuwe beschrijving:', markerData.desc);

    if (!newName) return;

    const updatedData = {
        ...markerData,
        name: newName,
        desc: newDesc
    };

    try {
        // Update in database
        await api.updateMarker(markerData.id, updatedData);

        // Update marker tooltip
        marker.bindTooltip(`${newName} ${markerData.number}`, {
            permanent: true,
            direction: 'top'
        }).openTooltip();

        // Update marker data
        marker.markerData = updatedData;

        // Update in application state
        const index = state.markers.findIndex(m => m.id === markerData.id);
        if (index !== -1) {
            state.markers[index] = updatedData;
        }
    } catch (error) {
        alert('Fout bij het bijwerken van de marker');
    }
}

// Delete marker after confirmation
async function deleteMarker(marker, markerData, map) {
    if (!confirm(`Verwijder ${markerData.name} ${markerData.number}?`)) return;

    try {
        // Delete from database
        await api.deleteMarker(markerData.id);
        // Remove from map
        map.removeLayer(marker);

        // Remove from application state
        const index = state.markers.findIndex(m => m.id === markerData.id);
        if (index !== -1) {
            state.markers.splice(index, 1);
        }
    } catch (error) {
        alert('Fout bij het verwijderen van de marker');
    }
}

// Show detailed popup with marker information and shot history
async function showMarkerPopup(event, markerData, map) {
    // Add shot button only if user is logged in
    const addShotBtn = isLoggedIn()
        ? `<br><button class="add-shot-btn" data-hut-id="${markerData.id}">
               Voeg rapportage toe
           </button>`
        : '';

    // Create and show popup
    const popup = L.popup()
        .setLatLng(event.latlng)
        .setContent(`
            <strong>${markerData.name} ${markerData.number}</strong><br>
            ${markerData.desc}
            <div id="shot-list">laden …</div>
            ${addShotBtn}
        `)
        .openOn(map);

    // Load and display shot history
    try {
        const schoten = await api.loadSchoten(markerData.id);

        // Generate shot list HTML
        const listHtml = schoten.length
            ? `<ul>${schoten.map(s => `
        <li>
            ${new Date(s.shot_at).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })} –
            ${s.soort}
            ${s.geslacht || ''}${s.gewicht_kg ? `, ${s.gewicht_kg} kg` : ''}
            ${s.gebruiker === localStorage.getItem("username") || localStorage.getItem("username") === "admin"
                    ? ` <button class="delete-shot-btn" data-id="${s.id}">✖</button>` : ''}
        </li>
    `).join('')}</ul>`
            : '<em>Geen schoten geregistreerd</em>';


        // Update popup content with shot list
        const container = popup.getElement();
        container.querySelector('#shot-list').innerHTML = listHtml;
        // Voeg delete-knoppen toe (alleen zichtbaar voor eigenaar of admin)
        container.querySelectorAll(".delete-shot-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("Weet je zeker dat je dit schot wilt verwijderen?")) return;

                try {
                    const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
                    const res = await apiFetch(`${CONFIG.API_URL}/schoten/${btn.dataset.id}`, {
                        method: "DELETE",
                        headers
                    });
                    if (!res.ok) throw new Error("Delete mislukt");

                    // Refresh popup om bijgewerkte lijst te tonen
                    const marker = state.markers.find(m => m.id === markerData.id);
                    if (marker) {
                        const latlng = L.latLng(marker.lat, marker.lng);
                        showMarkerPopup({ latlng }, marker, mapGlobal);
                    }
                } catch (err) {
                    alert("Kon schot niet verwijderen");
                    console.error(err);
                }
            });
        });
    } catch (err) {
        // Show error message if loading fails
        const container = popup.getElement();
        container.querySelector('#shot-list').innerHTML =
            '<em style="color:red">Kon lijst niet laden</em>';
        console.error(err);
    }
}

// Load markers from database and display them on map
async function loadAndDisplayMarkers(map) {
    try {
        const markersData = await api.loadMarkers();
        console.log("Processing markers data:", markersData);

        // Create visual marker for each data record
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

// Load zones from database and display them on map
async function loadAndDisplayZones(map) {
    try {
        const zones = await api.loadZones();
        zones.forEach(z => {
            createZone(z.type, z.latlngs, map, z); // Pass zone data as fourth parameter
        });
        console.log(`Loaded ${zones.length} zones`);
    } catch (err) {
        console.error('Failed to load zones:', err);
        alert('Fout bij het laden van zones');
    }
}

// Add new marker to map at clicked location
async function addNewMarker(event, map) {
    // Check if user is logged in
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }

    // Only allow adding marker in correct mode
    if (state.hutMode !== "add") return;

    // Ask user for marker details
    const name = prompt('Naam van de hut?');
    if (!name) {
        state.hutMode = null;         // Reset mode if user cancels
        highlightModeButtons();
        return;
    }

    const number = prompt('Nummer?');
    if (number === null) {
        state.hutMode = null;
        highlightModeButtons();
        return;
    }

    const desc = prompt('Korte beschrijving?') || '';

    // Create marker data object
    const markerData = {
        name,
        number,
        desc,
        lat: event.latlng.lat,
        lng: event.latlng.lng
    };

    try {
        // Save to backend database
        const response = await api.saveMarker(markerData);
        markerData.id = response.id;

        // Create marker on the map
        const marker = createMarkerElement(markerData, map);
        state.markers.push(markerData);

        console.log("New marker added:", markerData);
    } catch (error) {
        console.error('Failed to save marker:', error);
        alert('Fout bij het opslaan van de marker');
    }

    // Always reset add mode after attempt
    state.hutMode = null;
    highlightModeButtons();
}


/* =================================
   ZONE FUNCTIONS
   ================================= */

// Get styling for different zone types
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

// Create zone polygon/line on map
function createZone(type, latlngs, map, fromServer = null) {
    const adding = (fromServer === null); // Determine if this is a new zone or loaded from server
    if (adding && !isLoggedIn()) {
        showLoginError();
        return;
    }

    // Create polygon or polyline based on zone type
    const poly = (type === 'grens')
        ? L.polyline(latlngs, getZoneStyle(type)).addTo(map)
        : L.polygon(latlngs, getZoneStyle(type)).addTo(map);

    // Create zone data object
    const zone = {
        id: adding ? null : fromServer.id,
        type,
        label: adding ? '' : (fromServer.label || ''),
        polygon: poly,
        latlngs: latlngs.slice() // Create copy of coordinates
    };

    // Add popup with zone information
    poly.bindPopup(() => {
        const idTxt = zone.id ?? '-';
        return `${zone.label || type}<br>ID: ${idTxt}`;
    });

    // Handle zone clicks for selection
    poly.on('click', e => {
        L.DomEvent.stopPropagation(e);
        selectZone(zone, map);
        poly.openPopup(e.latlng);
    });

    state.zones.push(zone);
    return zone;
}

// Select zone for editing (show drag handles)
function selectZone(zone, map) {
    deselectZone(map); // Clear any previous selection
    state.selectedZone = zone;
    document.getElementById('delete-zone').classList.remove('hidden');

    // Get zone coordinates
    const polyLL = zone.polygon.getLatLngs();
    zone.latlngs = (zone.type === 'grens') ? polyLL : polyLL[0];

    // Create drag handles for each vertex
    zone.latlngs.forEach((latlng, idx) => {
        const handle = L.marker(latlng, {
            draggable: true,
            icon: L.divIcon({ className: 'vertex-handle' })
        }).addTo(map);

        // Update zone when handle is dragged
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

// Deselect currently selected zone
function deselectZone(map) {
    if (!state.selectedZone) return;

    // Remove all edit handles
    state.editHandles.forEach(h => map.removeLayer(h));
    state.editHandles = [];
    document.getElementById('delete-zone').classList.add('hidden');
    state.selectedZone = null;
}

// Delete currently selected zone
async function deleteSelectedZone(map) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }
    if (!state.selectedZone) return;

    const id = state.selectedZone.id;
    const poly = state.selectedZone.polygon;

    try {
        // Delete from database
        await api.deleteZone(id);
        // Remove from map
        map.removeLayer(poly);
        // Remove from state
        state.zones = state.zones.filter(z => z.id !== id);
        deselectZone(map);
    } catch (err) {
        alert("Fout bij verwijderen zone uit database");
        console.error(err);
    }
}

/* =================================
   DRAWING FUNCTIONS
   ================================= */

// Add point to current drawing
function addDrawingPoint(latlng, map) {
    // Create temporary marker for drawing point
    const marker = L.circleMarker(latlng, { radius: 4 }).addTo(map);
    state.tempMarkers.push(marker);
    state.drawingPoints.push(latlng);

    // Create or update temporary line
    if (!state.tempLine) {
        state.tempLine = L.polyline(state.drawingPoints, { dashArray: '4,4' }).addTo(map);
    } else {
        state.tempLine.setLatLngs(state.drawingPoints);
    }

    // Show confirm button when minimum points reached
    const minPts = (state.drawingType === 'grens') ? 2 : 3;
    if (state.drawingPoints.length >= minPts) {
        document.getElementById('confirm-zone').classList.remove('hidden');
    }
}

// Clear current drawing
function clearDrawing(map) {
    // Remove temporary markers
    state.tempMarkers.forEach(m => map.removeLayer(m));
    state.tempMarkers = [];

    // Remove temporary line
    if (state.tempLine) {
        map.removeLayer(state.tempLine);
        state.tempLine = null;
    }

    // Clear drawing points
    state.drawingPoints = [];

    // Hide confirm button
    const confirmBtn = document.getElementById('confirm-zone');
    if (confirmBtn) confirmBtn.classList.add('hidden');
}

/* =================================
   EVENT HANDLERS
   ================================= */

// Setup all event handlers for the application
function setupEventHandlers(map) {
    // Map click handler - handles drawing, deselecting, and adding markers
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

    // Map zoom handler - updates tooltip font sizes
    map.on('zoomend', () => {
        const zoom = map.getZoom();
        // Remove existing zoom classes
        document.body.classList
            .forEach(c => { if (c.startsWith('zoom-')) document.body.classList.remove(c); });
        // Add current zoom class
        document.body.classList.add(`zoom-${zoom}`);
    });

    // Handle popup opening to attach event listeners to buttons
    map.on('popupopen', (e) => {
        const container = e.popup.getElement();
        const btn = container.querySelector('.add-shot-btn');
        if (!btn) return;

        btn.addEventListener('click', () => {
            openReportChoiceModal(btn.dataset.hutId);
        }, { once: true });

    });

    // UI event handlers
    console.log("Edit toggle geladen");

    // Toggle edit options menu
    document.getElementById("toggle-edit").addEventListener("click", () => {
        document.getElementById("edit-options").classList.toggle("hidden");
        document.getElementById("legend-box").classList.add("hidden");
    });

    // Toggle legend menu
    document.getElementById("toggle-legend").addEventListener("click", () => {
        document.getElementById("legend-box").classList.toggle("hidden");
        document.getElementById("edit-options").classList.add("hidden");
    });

    // Show zone type selection
    document.getElementById("add-zone").addEventListener("click", () => {
        document.getElementById("zone-types").classList.toggle("hidden");
    });

    // Hut interaction mode buttons
    document.getElementById("mode-add").addEventListener("click", () => {
        state.hutMode = "add";
    });

    document.getElementById("mode-edit").addEventListener("click", () => {
        state.hutMode = "edit";
    });

    document.getElementById("mode-delete").addEventListener("click", () => {
        state.hutMode = "delete";
    });

    // Zone type selection handler
    document.getElementById("zone-types").addEventListener("click", e => {
        if (e.target.tagName !== 'BUTTON') return;

        // Start drawing mode
        state.drawing = true;
        state.drawingType = e.target.dataset.type;
        document.getElementById("zone-types").classList.add("hidden");
        clearDrawing(map);
    });

    // Delete selected zone button
    document.getElementById("delete-zone").addEventListener("click", () => {
        deleteSelectedZone(map);
    });

    // Confirm zone creation
    document.getElementById('confirm-zone').addEventListener('click', async () => {
        const minPts = (state.drawingType === 'grens') ? 2 : 3;
        if (!(state.drawing && state.drawingPoints.length >= minPts && state.drawingType)) return;

        // Get zone label from user
        const label = prompt('Naam/label voor deze zone?') || state.drawingType;
        const zone = createZone(state.drawingType, state.drawingPoints, map);
        zone.label = label;

        try {
            // Save zone to database
            const res = await api.saveZone({ type: zone.type, label, latlngs: zone.latlngs });
            zone.id = res.id;
            zone.polygon.setPopupContent(`${label}<br>ID ${zone.id}`);
        } catch (err) {
            alert('Kon zone niet opslaan!');
            map.removeLayer(zone.polygon);
            return;
        }

        // Clean up drawing state
        clearDrawing(map);
        state.drawing = false;
        state.drawingType = null;
    });

    // Modal event handlers
    document.getElementById('cancelShot').addEventListener('click', closeAddShotModal);

    // Handle shot form submission
    document.getElementById('add-shot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const hutId = parseInt(document.getElementById('add-shot-modal').dataset.hutId, 10);

        // Collect form data
        const payload = {
            hut_id: hutId,
            soort: document.getElementById('shotSpecies').value,
            geslacht: document.getElementById('shotGender').value || null,
            gewicht_kg: parseFloat(document.getElementById('shotWeight').value) || null,
            leeftijd_jr: parseInt(document.getElementById('shotAge').value) || null,
            notities: document.getElementById('shotNotes').value || null,
            shot_at: document.getElementById('shotTime').value
        };

        // Extra: stuur zichtwaarneming mee als die er nog is
        const sightingSpecies = document.getElementById('seenSpecies').value;
        if (sightingSpecies) {
            const sightingPayload = {
                hut_id: hutId,
                status: "wel-gezien",
                soort: sightingSpecies,
                aantal: parseInt(document.getElementById("seenCount").value),
                mannetjes: parseInt(document.getElementById("seenMales").value),
                vrouwtjes: parseInt(document.getElementById("seenFemales").value),
                jonkies: parseInt(document.getElementById("seenYoung").value),
                tijd: document.getElementById("seenTime").value
            };
            try {
                await fetch(`${CONFIG.API_URL}/sessies`, {
                    method: "POST",
                    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                    body: JSON.stringify(sightingPayload)
                });
            } catch (err) {
                console.error("Zichtwaarneming niet opgeslagen", err);
            }
        }

        try {
            // Submit shot data to server
            const res = await fetch(`${CONFIG.API_URL}/schoten`, {
                method: 'POST',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(await res.text());

            closeAddShotModal();

            document.getElementById("sighting-modal").classList.add("hidden");
            document.getElementById("sighting-form").reset();

            alert("Schot en sighting opgeslagen!");

            // Refresh marker popup to show new shot
            const marker = state.markers.find(m => m.id === hutId);
            if (marker) {
                const latlng = L.latLng(marker.lat, marker.lng);
                showMarkerPopup({ latlng }, marker, mapGlobal);
            }
        } catch (err) {
            alert("Fout bij opslaan: " + err.message);
        }
    });

    document.getElementById("show-leaderboard").addEventListener("click", async () => {
        const modal = document.getElementById("leaderboard-modal");
        const list = document.getElementById("leaderboard-list");
        list.innerHTML = "<li>Laden…</li>";
        modal.classList.remove("hidden");

        try {
            const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
            const res = await apiFetch(`${CONFIG.API_URL}/leaderboard`, { headers });
            const data = await res.json();
            list.innerHTML = "";
            data.forEach((entry, i) => {
                const li = document.createElement("li");
                li.textContent = `${i + 1}. ${entry.gebruiker} – ${entry.aantal}`;
                list.appendChild(li);
            });
        } catch (err) {
            console.error("Fout bij laden leaderboard", err);
            list.innerHTML = "<li>Kon leaderboard niet laden</li>";
        }
    });

    document.getElementById("close-leaderboard").addEventListener("click", () => {
        document.getElementById("leaderboard-modal").classList.add("hidden");
    });

    // Rapportagekeuze
    document.querySelectorAll(".report-choice-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const choice = btn.dataset.choice;
            const modal = document.getElementById('report-choice-modal');
            const hutId = parseInt(modal.dataset.hutId, 10);
            modal.classList.add("hidden");

            if (choice === "niet-gezien") {
                const payload = {
                    hut_id: hutId,
                    status: "niet-gezien",
                    timestamp: new Date().toISOString()
                };
                fetch(`${CONFIG.API_URL}/sessies`, {
                    method: "POST",
                    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                }).then(() => alert("Rapportage opgeslagen"));
            } else if (choice === "wel-gezien") {
                openSightingModal(hutId);
            }
        });
    });

    document.getElementById("cancelReportChoice").addEventListener("click", () => {
        document.getElementById("report-choice-modal").classList.add("hidden");
    });

    // Zichtwaarneming
    document.getElementById("cancelSighting").addEventListener("click", () => {
        document.getElementById("sighting-modal").classList.add("hidden");
    });

    document.getElementById("saveSighting").addEventListener("click", async () => {
        const hutId = parseInt(document.getElementById("sighting-modal").dataset.hutId, 10);
        const payload = {
            hut_id: hutId,
            status: "wel-gezien",
            soort: document.getElementById("seenSpecies").value,
            aantal: parseInt(document.getElementById("seenCount").value),
            mannetjes: parseInt(document.getElementById("seenMales").value),
            vrouwtjes: parseInt(document.getElementById("seenFemales").value),
            jonkies: parseInt(document.getElementById("seenYoung").value),
            tijd: document.getElementById("seenTime").value
        };
        try {
            await fetch(`${CONFIG.API_URL}/sessies`, {
                method: "POST",
                headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            alert("Waarneming opgeslagen");
            document.getElementById("sighting-modal").classList.add("hidden");
            document.getElementById("sighting-form").reset();
        } catch (err) {
            alert("Fout bij opslaan waarneming");
            console.error(err);
        }
    });

    document.getElementById("continueToShot").addEventListener("click", () => {
        const hutId = parseInt(document.getElementById("sighting-modal").dataset.hutId, 10);
        document.getElementById("sighting-modal").classList.add("hidden");
        openAddShotModal(hutId);
    });

    document.getElementById("sightingBack").addEventListener("click", () => {
        document.getElementById("add-shot-modal").classList.add("hidden");
        document.getElementById("sighting-modal").classList.remove("hidden");
    });

}

/* =================================
   MAIN INITIALIZATION
   ================================= */

// Main initialization function
async function init() {
    console.log("Initializing map application...");

    // Test API connection first
    const apiConnected = await api.testConnection();
    if (!apiConnected) {
        console.error("API connection failed - markers will not load");
    }

    // Initialize map and setup event handlers
    const map = initializeMap();
    mapGlobal = map;
    setupEventHandlers(map);

    // Load data from server
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