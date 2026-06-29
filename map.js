/* =================================
   CONFIGURATION
   ================================= */

// Application configuration object containing API endpoints, map settings, and boundaries
const CONFIG = {
    API_URL: window.CONFIG?.API_URL || "", // Backend API URL
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
    MAX_ZOOM: 17, // Maximum allowed zoom level
    MAP_BOUNDS_PADDING: 0.25, // Extra pan room around the managed Arnsberg area
    VECTOR_RENDER_PADDING: 1.5, // Draw vector layers well beyond the visible viewport while panning
    TILE_KEEP_BUFFER: 6, // Preload extra map tiles around the viewport
    WIND_BOUNDS_PADDING: 0.55, // Extend wind data beyond the maximum visible map bounds
    WIND_MAX_GRID_POINTS: 45000,
    WIND_CANVAS_BUFFER_PX: 240,
    WIND_RESTART_DELAY_MS: 40,
    WIND_FRAME_RATE: 18,
    WIND_PARTICLE_AGE: 80,
    WIND_PARTICLE_MULTIPLIER: 1 / 520,
    WIND_LINE_WIDTH: 1,
    WIND_VELOCITY_SCALE: 0.008
};

// Marker colors
const MARKER_DEFAULT_COLOR = "#1fdf64"; // green for free huts
const MARKER_OCCUPIED_COLOR = "#e53935"; // red for occupied huts

// Header to skip ngrok browser warning
const NGROK_SKIP_HEADER = window.CONFIG?.NGROK_SKIP_HEADER || { 'ngrok-skip-browser-warning': 'skip-browser-warning' };

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
    hutMode: null,      // Current mode for hut interaction (add, edit, delete)
    layers: {},         // Store overlay layers like wind
    windHandlersReady: false,
    windRestartTimer: null
};

// Global map reference for use across functions
let mapGlobal;

// Location tracking variables
let locationMarker = null;   // behoud één marker
let locationWatchId = null;  // id van map.locate({ watch:true })
let locationDirectionMarker = null;  // richtingsindicator marker
let currentHeading = null;   // huidige kompasrichting
let shouldCenterOnNextLocation = false; // one-time centering after starting location tracking

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
        preferCanvas: true,
        renderer: L.canvas({ padding: CONFIG.VECTOR_RENDER_PADDING }),
        zoomControl: false, // Disable zoom buttons but keep zoom functionality
        doubleClickZoom: true,
        scrollWheelZoom: true,
        boxZoom: true,
        touchZoom: true,
        minZoom: CONFIG.MIN_ZOOM,
        maxZoom: CONFIG.MAX_ZOOM,
        maxBoundsViscosity: 1.0
    }).setView(CONFIG.START_COORDS, CONFIG.START_ZOOM);

    setupMapLayers(map);
    setupMapBounds(map);
    setupMapControls(map);
    return map;
}

// Setup map tile layers and layer control
function setupMapLayers(map) {
    // Satellite imagery layer
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        keepBuffer: CONFIG.TILE_KEEP_BUFFER
    });
    // Topographic map with elevation data
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        keepBuffer: CONFIG.TILE_KEEP_BUFFER,
        attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap'
    });

    // Base layers for switching between map types
    const baseLayers = {
        "Hoogte": topo,
        "Satelliet": satellite
    };

    // Overlay layers (will be populated by wind layer)
    const overlayLayers = {};

    // Add layer control to switch between map types and overlays
    const layerControl = L.control.layers(baseLayers, overlayLayers, { 
        position: 'bottomright' 
    }).addTo(map);

    // Store layer control reference for adding overlays later
    state.layerControl = layerControl;

    satellite.addTo(map);
}

// Setup map boundaries to restrict panning
function setupMapBounds(map) {
    const bounds = getConfiguredMapBounds(CONFIG.MAP_BOUNDS_PADDING);
    map.setMaxBounds(bounds);
    // Ensure map stays within bounds when dragging
    map.on('drag', function () {
        map.panInsideBounds(bounds, { animate: false });
    });
}

function getConfiguredMapBounds(padding = 0) {
    return L.latLngBounds(CONFIG.MAP_BOUNDS).pad(padding);
}

// Setup map controls (location button, etc.)
function setupMapControls(map) {
    // Create custom location control with three buttons
    const locationControl = L.control({ position: 'topleft' });
    locationControl.onAdd = function () {
        const container = L.DomUtil.create('div', 'location-control location-idle collapsed');

        const header = L.DomUtil.create('div', 'location-control-header', container);
        const toggleBtn = L.DomUtil.create('button', 'location-toggle', header);
        toggleBtn.type = 'button';
        toggleBtn.innerHTML = '<span aria-hidden="true">⌖</span>';
        toggleBtn.title = 'Locatiepaneel tonen';
        toggleBtn.setAttribute('aria-label', 'Locatiepaneel tonen');
        toggleBtn.setAttribute('aria-expanded', 'false');
        const title = L.DomUtil.create('span', 'location-title', header);
        title.textContent = 'Locatie';
        const status = L.DomUtil.create('span', 'location-status', header);
        status.textContent = 'Uit';

        const actions = L.DomUtil.create('div', 'location-actions', container);
        L.DomEvent.disableClickPropagation(container);

        L.DomEvent.on(toggleBtn, 'click', function (e) {
            L.DomEvent.stopPropagation(e);
            const isCollapsed = container.classList.toggle('collapsed');
            toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
            toggleBtn.title = isCollapsed ? 'Locatiepaneel tonen' : 'Locatiepaneel verbergen';
            toggleBtn.setAttribute('aria-label', toggleBtn.title);
        });
        
        // Start tracking button
        const locateOnceBtn = L.DomUtil.create('button', 'locate-btn locate-once-btn', actions);
        locateOnceBtn.type = 'button';
        locateOnceBtn.innerHTML = '<span aria-hidden="true">⌖</span>';
        locateOnceBtn.title = 'Start locatie tracking';
        locateOnceBtn.setAttribute('aria-label', 'Start locatie tracking');
        
        // Center button (initially hidden)
        const locateCenterBtn = L.DomUtil.create('button', 'locate-btn locate-center-btn hidden', actions);
        locateCenterBtn.type = 'button';
        locateCenterBtn.innerHTML = '<span aria-hidden="true">◎</span>';
        locateCenterBtn.title = 'Centreer op huidige locatie';
        locateCenterBtn.setAttribute('aria-label', 'Centreer op huidige locatie');
        locateCenterBtn.disabled = true;
        
        // Stop button (initially hidden)
        const stopBtn = L.DomUtil.create('button', 'locate-btn locate-stop-btn hidden', actions);
        stopBtn.type = 'button';
        stopBtn.innerHTML = '<span aria-hidden="true">■</span>';
        stopBtn.title = 'Stop locatie tracking';
        stopBtn.setAttribute('aria-label', 'Stop locatie tracking');
        stopBtn.disabled = true;
        
        // Handle locate-once button click
        L.DomEvent.on(locateOnceBtn, 'click', function (e) {
            L.DomEvent.stopPropagation(e);
            
            // Start location watching if not already active
            if (locationWatchId === null) {
                shouldCenterOnNextLocation = true;
                locationWatchId = map.locate({ 
                    watch: true,
                    enableHighAccuracy: true,
                    maximumAge: 30000,
                    timeout: 15000
                });
                locateOnceBtn.classList.add('active');
                setLocationControlStatus('searching');
                
                // Start listening for device orientation
                startCompassTracking();
            }
        });
        
        // Handle locate-center button click
        L.DomEvent.on(locateCenterBtn, 'click', function (e) {
            L.DomEvent.stopPropagation(e);
            
            // Center once on existing arrow marker without enabling continuous follow mode.
            if (locationDirectionMarker) {
                map.setView(locationDirectionMarker.getLatLng(), CONFIG.START_ZOOM);
            }
        });
        
        // Handle stop button click
        L.DomEvent.on(stopBtn, 'click', function (e) {
            L.DomEvent.stopPropagation(e);
            stopLocationTracking(map);
        });
        
        return container;
    };
    locationControl.addTo(map);

    map.on('dragstart zoomstart', function () {
        shouldCenterOnNextLocation = false;
    });

    // Handle successful location finding
    map.on('locationfound', function (e) {
        if (locationDirectionMarker === null) {
            // First location fix: create location marker with direction arrow
            createLocationMarker(e.latlng, map);
            
            if (shouldCenterOnNextLocation) {
                map.setView(e.latlng, CONFIG.START_ZOOM);
                shouldCenterOnNextLocation = false;
            }
            
            // Show the center and stop buttons
            const centerBtn = document.querySelector('.locate-center-btn');
            const stopBtn = document.querySelector('.locate-stop-btn');
            if (centerBtn) {
                centerBtn.classList.remove('hidden');
                centerBtn.disabled = false;
            }
            if (stopBtn) {
                stopBtn.classList.remove('hidden');
                stopBtn.disabled = false;
            }
            setLocationControlStatus('active');
        } else {
            // Subsequent updates: just move the marker smoothly
            updateLocationMarker(e.latlng);
            setLocationControlStatus('active');
        }
    });
    
    // Handle location errors
    map.on('locationerror', function (e) {
        alert('Locatie kon niet worden bepaald: ' + e.message);
        locationWatchId = null;
        shouldCenterOnNextLocation = false;
        const locateBtn = document.querySelector('.locate-once-btn');
        const centerBtn = document.querySelector('.locate-center-btn');
        const stopBtn = document.querySelector('.locate-stop-btn');
        if (locateBtn) locateBtn.classList.remove('active');
        if (centerBtn) {
            centerBtn.classList.add('hidden');
            centerBtn.disabled = true;
        }
        if (stopBtn) {
            stopBtn.classList.add('hidden');
            stopBtn.disabled = true;
        }
        setLocationControlStatus('error');
    });
}

function setLocationControlStatus(status) {
    const control = document.querySelector('.location-control');
    const label = document.querySelector('.location-status');
    if (!control || !label) return;

    control.classList.remove('location-idle', 'location-searching', 'location-active', 'location-error');
    control.classList.add(`location-${status}`);

    const labels = {
        idle: 'Uit',
        searching: 'Zoeken',
        active: 'Actief',
        error: 'Fout'
    };
    label.textContent = labels[status] || labels.idle;
}

/* =================================
   API COMMUNICATION
   ================================= */

// Enhanced fetch function with authentication handling
async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...NGROK_SKIP_HEADER,
            ...(options.headers || {})
        }
    });

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
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }
    document.getElementById('report-choice-modal').dataset.hutId = hutId;
    document.getElementById('report-choice-modal').classList.remove('hidden');
}

function openSightingModal(hutId) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }
    document.getElementById("sighting-modal").dataset.hutId = hutId;
    document.getElementById("sighting-modal").classList.remove("hidden");
}

// Open kansels list modal
// State for kansel visibility
let kanselVisibilityState = []; // Tracks which kansels are selected to be visible
let kanselMarkerRefs = []; // Keep track of marker references to prevent loss when toggling visibility

// Open kansels list modal
function openKanselsModal() {
    const modal = document.getElementById('kansels-modal');
    modal.classList.remove('hidden');
    
    // Initialize visibility state if not exists
    if (kanselVisibilityState.length === 0) {
        kanselVisibilityState = state.markers.map(() => true); // All visible by default
    }
    
    // Initialize marker references if not exists
    if (kanselMarkerRefs.length === 0) {
        kanselMarkerRefs = new Array(state.markers.length).fill(null);
        // Find existing markers on the map and store their references
        state.markers.forEach((markerData, index) => {
            mapGlobal.eachLayer(layer => {
                if (layer.markerData && layer.markerData === markerData) {
                    kanselMarkerRefs[index] = layer;
                }
            });
        });
    }
    
    populateKanselsList();
}

// Close kansels modal
function closeKanselsModal() {
    document.getElementById('kansels-modal').classList.add('hidden');
}

// Populate the kansels list with all markers
function populateKanselsList() {
    const kanselsList = document.getElementById('kansels-list');
    kanselsList.innerHTML = '';

    state.markers.forEach((markerData, index) => {
        const listItem = document.createElement('li');
        listItem.dataset.index = index;
        
        // Check if this kansel is selected for visibility
        const isSelected = kanselVisibilityState[index] !== undefined ? kanselVisibilityState[index] : true;
        if (isSelected) {
            listItem.classList.add('selected');
        }
        
        listItem.innerHTML = `
            <div class="kansel-info">
                <div class="kansel-name">${markerData.name} ${markerData.number}</div>
                <div class="kansel-desc">${markerData.desc || 'Geen beschrijving'}</div>
            </div>
            <div class="kansel-actions">
                <button class="center-kansel" onclick="centerOnKansel(${index})">
                    Centreer
                </button>
                <div class="kansel-checkbox ${isSelected ? 'checked' : ''}" onclick="toggleKanselSelection(${index})"></div>
            </div>
        `;
        
        // Add click handler for the entire list item (except buttons)
        listItem.addEventListener('click', (e) => {
            // Don't trigger if clicking on buttons to prevent double-action
            if (e.target.classList.contains('center-kansel') || e.target.classList.contains('kansel-checkbox')) {
                return;
            }
            toggleKanselSelection(index);
        });
        
        kanselsList.appendChild(listItem);
    });
}

// Toggle kansel selection (checkbox)
function toggleKanselSelection(index) {
    // Ensure the visibility state array is properly sized for dynamic marker additions
    while (kanselVisibilityState.length <= index) {
        kanselVisibilityState.push(true);
    }
    
    // Toggle the state
    kanselVisibilityState[index] = !kanselVisibilityState[index];
    
    // Update the UI
    const listItem = document.querySelector(`#kansels-list li[data-index="${index}"]`);
    const checkbox = listItem.querySelector('.kansel-checkbox');
    
    if (kanselVisibilityState[index]) {
        listItem.classList.add('selected');
        checkbox.classList.add('checked');
    } else {
        listItem.classList.remove('selected');
        checkbox.classList.remove('checked');
    }
}

// Center map on a specific kansel
function centerOnKansel(index) {
    const markerData = state.markers[index];
    mapGlobal.setView([markerData.lat, markerData.lng], CONFIG.START_ZOOM);
}

// Toggle all kansels on
function toggleAllKanselsOn() {
    kanselVisibilityState = state.markers.map(() => true);
    populateKanselsList();
}

// Toggle all kansels off
function toggleAllKanselsOff() {
    kanselVisibilityState = state.markers.map(() => false);
    populateKanselsList();
}

// Apply visibility changes to the map
function confirmKanselVisibility() {
    // Go through all markers and show/hide based on selection
    state.markers.forEach((markerData, index) => {
        const shouldBeVisible = kanselVisibilityState[index];
        let mapMarker = kanselMarkerRefs[index];
        
        // If marker doesn't exist, create it (handles cases where markers were removed)
        if (!mapMarker) {
            mapMarker = createMarkerElement(markerData, mapGlobal);
            kanselMarkerRefs[index] = mapMarker;
        }
        
        if (shouldBeVisible) {
            // Make sure marker is on the map
            if (!mapGlobal.hasLayer(mapMarker)) {
                mapMarker.addTo(mapGlobal);
            }
        } else {
            // Remove marker from map but keep reference for later re-addition
            if (mapGlobal.hasLayer(mapMarker)) {
                mapGlobal.removeLayer(mapMarker);
            }
        }
    });
    
    // Close the modal
    closeKanselsModal();
}

// Make functions globally accessible
window.toggleKanselSelection = toggleKanselSelection;
window.centerOnKansel = centerOnKansel;
window.toggleAllKanselsOn = toggleAllKanselsOn;
window.toggleAllKanselsOff = toggleAllKanselsOff;
window.confirmKanselVisibility = confirmKanselVisibility;

// Filter kansels list based on search input
function filterKanselsList() {
    const searchTerm = document.getElementById('kansels-search').value.toLowerCase();
    const listItems = document.querySelectorAll('#kansels-list li');

    listItems.forEach(item => {
        const kanselName = item.querySelector('.kansel-name').textContent.toLowerCase();
        const kanselDesc = item.querySelector('.kansel-desc').textContent.toLowerCase();
        
        if (kanselName.includes(searchTerm) || kanselDesc.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
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

    // Set occupant name for a hut
    async setHutOccupant(hutId, occupantName) {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER, "Content-Type": "application/json" };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes/${hutId}/occupant`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ occupant_name: occupantName })
        });
        return res.json();
    },

    // Clear occupants from all huts
    async clearAllOccupants() {
        const headers = { ...getAuthHeaders(), ...NGROK_SKIP_HEADER };
        const res = await apiFetch(`${CONFIG.API_URL}/hutjes/occupants`, {
            method: "DELETE",
            headers
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

// Determine marker color based on occupancy
function getMarkerFillColor(markerData) {
    return markerData && markerData.occupant_name
        ? MARKER_OCCUPIED_COLOR
        : MARKER_DEFAULT_COLOR;
}

// Update marker styling after data changes
function updateMarkerAppearance(marker, markerData) {
    if (!marker || !marker.setStyle) return;
    marker.setStyle({ fillColor: getMarkerFillColor(markerData) });
}

// Find an existing map marker by hut id
function findMapMarkerById(hutId) {
    if (!mapGlobal) return null;
    let found = null;
    mapGlobal.eachLayer(layer => {
        if (layer && layer.markerData && layer.markerData.id === Number(hutId)) {
            found = layer;
        }
    });
    return found;
}

// Update marker data in state and on-map marker (if available)
function updateMarkerDataInState(hutId, updates) {
    const index = state.markers.findIndex(m => m.id === Number(hutId));
    if (index === -1) return null;
    state.markers[index] = { ...state.markers[index], ...updates };

    const mapMarker = findMapMarkerById(hutId);
    if (mapMarker) {
        mapMarker.markerData = state.markers[index];
        updateMarkerAppearance(mapMarker, mapMarker.markerData);
    }

    return state.markers[index];
}

// Create a visual marker element on the map
function createMarkerElement(markerData, map) {
    const marker = L.circleMarker([markerData.lat, markerData.lng], {
        radius: 6,
        fillColor: getMarkerFillColor(markerData),
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
        ? `<button class="add-shot-btn" data-hut-id="${markerData.id}">
               Voeg rapportage toe
           </button>`
        : '';

    // Add person button only if user is logged in
    const addPersonBtn = isLoggedIn()
        ? `<button class="add-person-btn" data-hut-id="${markerData.id}">
               Voeg persoon toe
           </button>`
        : '';

    const occupantLine = markerData.occupant_name
        ? `<div class="hut-occupant">Bezet door: <strong>${markerData.occupant_name}</strong></div>`
        : '';

    // Create and show popup
    const popup = L.popup()
        .setLatLng(event.latlng)
        .setContent(`
            <strong>${markerData.name} ${markerData.number}</strong><br>
            ${markerData.desc}
            ${occupantLine}
            <div id="shot-list">laden …</div>
            ${addShotBtn}
            ${addPersonBtn}
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

// Add person/occupant to a hut
async function addPersonToHut(hutId) {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }

    const occupantName = prompt('Naam van persoon?');
    if (!occupantName) return;

    try {
        await api.setHutOccupant(hutId, occupantName);

        const updatedMarkerData = updateMarkerDataInState(hutId, { occupant_name: occupantName });
        const mapMarker = findMapMarkerById(hutId);

        if (mapMarker) {
            updateMarkerAppearance(mapMarker, mapMarker.markerData);
            const latlng = mapMarker.getLatLng();
            showMarkerPopup({ latlng }, updatedMarkerData || mapMarker.markerData, mapGlobal);
        }
    } catch (err) {
        alert('Fout bij opslaan van persoon');
        console.error(err);
    }
}

// Clear all occupants from all huts
async function clearAllOccupants() {
    if (!isLoggedIn()) {
        showLoginError();
        return;
    }

    if (!confirm('Alle personen van kansels verwijderen?')) return;

    try {
        await api.clearAllOccupants();

        // Update state and map markers
        state.markers = state.markers.map(m => ({ ...m, occupant_name: null }));
        if (mapGlobal) {
            mapGlobal.eachLayer(layer => {
                if (layer && layer.markerData) {
                    layer.markerData = { ...layer.markerData, occupant_name: null };
                    updateMarkerAppearance(layer, layer.markerData);
                }
            });
        }
    } catch (err) {
        alert('Fout bij clearen van personen');
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
            
            // Add to kansel tracking arrays if they exist (maintains consistency with modal)
            if (kanselVisibilityState.length > 0) {
                kanselVisibilityState.push(true); // New markers are visible by default
                kanselMarkerRefs.push(marker);
            }
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
        
        // Add to kansel tracking arrays if they exist (maintains consistency with modal)
        if (kanselVisibilityState.length > 0) {
            kanselVisibilityState.push(true); // New markers are visible by default
            kanselMarkerRefs.push(marker);
        }

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
            return { color: '#ff6a00', weight: 3, fillOpacity: 0 };
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
   MODE HIGHLIGHTING FUNCTIONS
   ================================= */

// Update visual highlighting of mode buttons based on current mode
function highlightModeButtons() {
    // Remove active class from all mode buttons
    document.querySelectorAll('#mode-add, #mode-edit, #mode-delete').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to current mode button
    if (state.hutMode === 'add') {
        document.getElementById('mode-add').classList.add('active');
    } else if (state.hutMode === 'edit') {
        document.getElementById('mode-edit').classList.add('active');
    } else if (state.hutMode === 'delete') {
        document.getElementById('mode-delete').classList.add('active');
    }
}

// Exit all edit modes and close any active popups/modals
function exitAllEditModes() {
    // Reset hut mode
    state.hutMode = null;
    
    // Update button highlighting
    highlightModeButtons();
    
    // Close all modals/popups that might be open
    document.getElementById("report-choice-modal").classList.add("hidden");
    document.getElementById("sighting-modal").classList.add("hidden");
    document.getElementById("add-shot-modal").classList.add("hidden");
    document.getElementById("kansels-modal").classList.add("hidden");
    
    // Clear any drawing state
    if (state.tempMarkers) {
        state.tempMarkers.forEach(marker => map.removeLayer(marker));
        state.tempMarkers = [];
    }
    if (state.tempLine) {
        map.removeLayer(state.tempLine);
        state.tempLine = null;
    }
    if (state.tempPolygon) {
        map.removeLayer(state.tempPolygon);
        state.tempPolygon = null;
    }
    state.drawingPoints = [];
    
    // Hide zone-related buttons
    document.getElementById("zone-types").classList.add("hidden");
    document.getElementById("confirm-zone").classList.add("hidden");
    document.getElementById("delete-zone").classList.add("hidden");
    
    console.log("All edit modes exited and popups closed");
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
        if (btn) {
            btn.addEventListener('click', () => {
                openReportChoiceModal(btn.dataset.hutId);
            }, { once: true });
        }

        const personBtn = container.querySelector('.add-person-btn');
        if (personBtn) {
            personBtn.addEventListener('click', () => {
                addPersonToHut(personBtn.dataset.hutId);
            }, { once: true });
        }

    });

    // UI event handlers
    console.log("Menu handlers loaded");

    // Toggle hamburger dropdown menu
    document.getElementById("menu-toggle").addEventListener("click", () => {
        const menuToggle = document.getElementById("menu-toggle");
        const dropdown = document.getElementById("menu-dropdown");
        dropdown.classList.toggle("collapsed");
        menuToggle.setAttribute("aria-expanded", String(!dropdown.classList.contains("collapsed")));
        
        // Close edit options when opening dropdown
        if (!dropdown.classList.contains("collapsed")) {
            document.getElementById("edit-options").classList.add("collapsed");
            
            // Exit all edit modes and close any active popups for clean state
            exitAllEditModes();
        }
    });

    // Handle dropdown Edit option
    document.getElementById("dropdown-edit").addEventListener("click", () => {
        document.getElementById("menu-dropdown").classList.add("collapsed");
        document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
        if (!isLoggedIn()) {
            showLoginError();
            exitAllEditModes(); // Reset all edit states when login fails
            return;
        }
        document.getElementById("edit-options").classList.toggle("collapsed");
    });

    // Handle dropdown Leaderboard option
    document.getElementById("dropdown-leaderboard").addEventListener("click", () => {
        document.getElementById("menu-dropdown").classList.add("collapsed");
        document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
        
        // Check if user is logged in before showing leaderboard
        if (!isLoggedIn()) {
            showLoginError();
            return;
        }
        
        // Show leaderboard modal
        const modal = document.getElementById("leaderboard-modal");
        const list = document.getElementById("leaderboard-list");
        list.innerHTML = "<li>Laden…</li>";
        modal.classList.remove("hidden");

        // Load leaderboard data
        (async () => {
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
        })();
    });

    // Handle dropdown Kansels option
    document.getElementById("dropdown-kansels").addEventListener("click", () => {
        document.getElementById("menu-dropdown").classList.add("collapsed");
        document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
        openKanselsModal();
    });

    // Handle dropdown Clear occupants option
    document.getElementById("dropdown-clear-occupants").addEventListener("click", () => {
        document.getElementById("menu-dropdown").classList.add("collapsed");
        document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
        clearAllOccupants();
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
        const menu = document.getElementById("floating-menu");
        const dropdown = document.getElementById("menu-dropdown");
        const editOptions = document.getElementById("edit-options");
        
        // Close dropdown if clicking outside the menu area
        if (!menu.contains(e.target)) {
            dropdown.classList.add("collapsed");
            editOptions.classList.add("collapsed");
            document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
        }
    });

    // Show zone type selection
    document.getElementById("add-zone").addEventListener("click", () => {
        if (!isLoggedIn()) {
            showLoginError();
            return;
        }
        document.getElementById("zone-types").classList.toggle("hidden");
    });

    // Hut interaction mode buttons
    document.getElementById("mode-add").addEventListener("click", () => {
        if (!isLoggedIn()) {
            showLoginError();
            state.hutMode = null; // Reset mode when login fails to prevent inconsistent state
            highlightModeButtons();
            return;
        }
        state.hutMode = "add";
        highlightModeButtons();
    });

    document.getElementById("mode-edit").addEventListener("click", () => {
        if (!isLoggedIn()) {
            showLoginError();
            state.hutMode = null; // Reset mode when login fails to prevent inconsistent state
            highlightModeButtons();
            return;
        }
        state.hutMode = "edit";
        highlightModeButtons();
    });

    document.getElementById("mode-delete").addEventListener("click", () => {
        if (!isLoggedIn()) {
            showLoginError();
            state.hutMode = null; // Reset mode when login fails to prevent inconsistent state
            highlightModeButtons();
            return;
        }
        state.hutMode = "delete";
        highlightModeButtons();
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
            // Submit sighting data along with shot data for complete record
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
                    headers: { ...getAuthHeaders(), ...NGROK_SKIP_HEADER, "Content-Type": "application/json" },
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
                headers: { ...getAuthHeaders(), ...NGROK_SKIP_HEADER, 'Content-Type': 'application/json' },
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

    document.getElementById("close-leaderboard").addEventListener("click", () => {
        document.getElementById("leaderboard-modal").classList.add("hidden");
    });

    // Close kansels modal
    document.getElementById("close-kansels").addEventListener("click", () => {
        closeKanselsModal();
    });

    // Confirm kansels visibility changes
    document.getElementById("confirm-kansels").addEventListener("click", () => {
        confirmKanselVisibility();
    });

    // Toggle all kansels on
    document.getElementById("toggle-all-on").addEventListener("click", () => {
        toggleAllKanselsOn();
    });

    // Toggle all kansels off
    document.getElementById("toggle-all-off").addEventListener("click", () => {
        toggleAllKanselsOff();
    });

    // Search functionality for kansels modal
    document.getElementById("kansels-search").addEventListener("input", () => {
        filterKanselsList();
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
                    headers: { ...getAuthHeaders(), ...NGROK_SKIP_HEADER, "Content-Type": "application/json" },
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
                headers: { ...getAuthHeaders(), ...NGROK_SKIP_HEADER, "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            alert("Waarneming opgeslagen");
            document.getElementById("sighting-modal").classList.add("hidden");
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
   LOCATION UTILITIES
   ================================= */

// Create location marker with direction arrow
function createLocationMarker(latlng, map) {
    // Only create the direction arrow - no separate location dot
    if (currentHeading !== null) {
        createDirectionArrow(latlng, currentHeading);
    } else {
        // If no heading yet, create a simple arrow pointing north as placeholder
        createDirectionArrow(latlng, 0);
    }
}

// Update location marker position
function updateLocationMarker(latlng) {
    // Only update direction arrow - no separate location marker
    if (currentHeading !== null) {
        updateDirectionArrow(latlng, currentHeading);
    } else {
        // If no heading, just move the arrow to new position
        if (locationDirectionMarker) {
            locationDirectionMarker.setLatLng(latlng);
        }
    }
}

// Create direction arrow
function createDirectionArrow(latlng, heading) {
    if (locationDirectionMarker) {
        mapGlobal.removeLayer(locationDirectionMarker);
    }
    
    // Create custom direction icon (arrow pointing in heading direction)
    const directionIcon = L.divIcon({
        className: 'location-direction-icon',
        html: `<div class="direction-arrow" style="transform: rotate(${heading}deg);">
                 <div class="arrow-shape"></div>
               </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    
    locationDirectionMarker = L.marker(latlng, {
        icon: directionIcon,
        zIndexOffset: 1000
    }).addTo(mapGlobal);
}

// Update direction arrow
function updateDirectionArrow(latlng, heading) {
    if (locationDirectionMarker) {
        locationDirectionMarker.setLatLng(latlng);
        const iconElement = locationDirectionMarker.getElement();
        if (iconElement) {
            const arrowDiv = iconElement.querySelector('.direction-arrow');
            if (arrowDiv) {
                arrowDiv.style.transform = `rotate(${heading}deg)`;
            }
        }
    } else {
        createDirectionArrow(latlng, heading);
    }
}

// Load and display wind overlay from backend
async function loadWindOverlay(map) {
    try {
        const headers = { ...NGROK_SKIP_HEADER };
        const response = await fetch(`${CONFIG.API_URL}/wind/latest`, { headers });
        
        if (!response.ok) {
            console.warn('Wind data unavailable:', response.status);
            return;
        }

        const windData = await response.json();
        console.log('Wind data loaded:', windData);
        const expandedWindData = expandWindDataToBounds(
            windData,
            getConfiguredMapBounds(CONFIG.MAP_BOUNDS_PADDING + CONFIG.WIND_BOUNDS_PADDING)
        );
        state.layers.windData = expandedWindData;

        const shouldShowWind = !state.layers.wind || map.hasLayer(state.layers.wind);

        // Remove existing wind layer if present
        if (state.layers.wind) {
            map.removeLayer(state.layers.wind);
            state.layerControl.removeLayer(state.layers.wind);
        }

        // Create wind velocity layer with proper configuration
        state.layers.wind = L.velocityLayer({
            displayValues: true,
            displayOptions: {
                velocityType: 'Wind',
                displayPosition: 'bottomleft',
                displayEmptyString: 'Wind niet beschikbaar'
            },
            velocityScale: CONFIG.WIND_VELOCITY_SCALE,
            maxVelocity: 15,
            frameRate: CONFIG.WIND_FRAME_RATE,
            particleAge: CONFIG.WIND_PARTICLE_AGE,
            particleMultiplier: CONFIG.WIND_PARTICLE_MULTIPLIER,
            lineWidth: CONFIG.WIND_LINE_WIDTH,
            // Light grey color scale - uniform light grey tones for subtle wind visualization
            // Wind strength is indicated by line density rather than color intensity
            // Light grey color scale - uniform light grey tones for subtle wind visualization
            // Wind strength is indicated by line density rather than color intensity
            colorScale: [
                "rgba(200,200,200,0.3)",   // Light grey, very transparent
                "rgba(190,190,190,0.35)",  // 
                "rgba(180,180,180,0.4)",   // 
                "rgba(170,170,170,0.45)",  // 
                "rgba(160,160,160,0.5)",   // 
                "rgba(150,150,150,0.55)",  // 
                "rgba(140,140,140,0.6)",   // 
                "rgba(130,130,130,0.65)",  // 
                "rgba(120,120,120,0.7)",   // 
                "rgba(110,110,110,0.75)",  // 
                "rgba(100,100,100,0.8)",   // 
                "rgba(95,95,95,0.85)",     // 
                "rgba(90,90,90,0.9)",      // 
                "rgba(85,85,85,0.95)",     // 
                "rgba(80,80,80,1.0)"       // Medium grey for strongest winds
            ],
            opacity: 0.32,
            data: expandedWindData
        });
        patchVelocityLayerForFastPan(state.layers.wind);

        // Add to layer control so you can toggle it
        state.layerControl.addOverlay(state.layers.wind, "Wind");
        if (shouldShowWind) {
            state.layers.wind.addTo(map);
        }
        setupWindInteractionRefresh(map);

        console.log('Wind overlay added to map');

    } catch (error) {
        console.error('Failed to load wind data:', error);
    }
}

function setupWindInteractionRefresh(map) {
    if (state.windHandlersReady) return;
    state.windHandlersReady = true;

    map.on('moveend zoomend', () => {
        refreshWindAnimationSoon(map);
    });

    map.on('mousemove', () => {
        formatWindControlSoon();
    });
}

function refreshWindAnimationSoon(map) {
    if (state.windRestartTimer) clearTimeout(state.windRestartTimer);
    state.windRestartTimer = setTimeout(() => {
        const windLayer = state.layers.wind;
        if (!windLayer || !state.layers.windData || !map.hasLayer(windLayer)) return;

        if (typeof windLayer._clearAndRestart === 'function') {
            windLayer._clearAndRestart();
            return;
        }

        if (typeof windLayer.redraw === 'function') {
            windLayer.redraw();
        }
    }, CONFIG.WIND_RESTART_DELAY_MS);
}

function patchVelocityLayerForFastPan(windLayer) {
    if (!windLayer || windLayer._fastPanPatchApplied) return;
    windLayer._fastPanPatchApplied = true;

    windLayer._startWindy = function () {
        if (!this._map || !this._windy || !this._canvasLayer || !this._canvasLayer._canvas) return;

        const size = this._map.getSize();
        const buffer = CONFIG.WIND_CANVAS_BUFFER_PX;
        const canvasWidth = size.x + buffer * 2;
        const canvasHeight = size.y + buffer * 2;
        const canvas = this._canvasLayer._canvas;

        if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
        if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
        canvas.style.width = `${canvasWidth}px`;
        canvas.style.height = `${canvasHeight}px`;

        const offset = this._map.containerPointToLayerPoint([-buffer, -buffer]);
        L.DomUtil.setPosition(canvas, offset);

        if (this._windy.params) {
            this._windy.params.map = createBufferedWindMapAdapter(this._map, buffer);
        }

        const southWest = this._map.containerPointToLatLng([-buffer, size.y + buffer]);
        const northEast = this._map.containerPointToLatLng([size.x + buffer, -buffer]);
        this._windy.start(
            [[0, 0], [canvasWidth, canvasHeight]],
            canvasWidth,
            canvasHeight,
            [[southWest.lng, southWest.lat], [northEast.lng, northEast.lat]]
        );
    };

    windLayer.onDrawLayer = function () {
        if (!this._windy) {
            this._initWindy(this);
            return;
        }

        if (!this.options.data) return;
        if (this._timer) clearTimeout(this._timer);

        this._timer = setTimeout(() => {
            this._startWindy();
        }, CONFIG.WIND_RESTART_DELAY_MS);
    };
}

function createBufferedWindMapAdapter(map, buffer) {
    return {
        containerPointToLatLng(point) {
            const p = L.point(point);
            return map.containerPointToLatLng([p.x - buffer, p.y - buffer]);
        },
        latLngToContainerPoint(latlng) {
            const p = map.latLngToContainerPoint(latlng);
            return L.point(p.x + buffer, p.y + buffer);
        }
    };
}

function formatWindControlSoon() {
    requestAnimationFrame(formatWindControl);
}

function formatWindControl() {
    const control = document.querySelector('.leaflet-control-velocity');
    if (!control || control.dataset.formatted === control.innerHTML) return;

    const text = control.textContent || '';
    const directionMatch = text.match(/Direction:\s*([0-9.]+)°/i);
    const speedMatch = text.match(/Speed:\s*([0-9.]+)\s*m\/s/i);

    if (!directionMatch || !speedMatch) {
        control.textContent = text.includes('Unavailable') ? 'Wind niet beschikbaar' : text;
        control.dataset.formatted = control.innerHTML;
        return;
    }

    const direction = Math.round(Number(directionMatch[1]));
    const speed = Number(speedMatch[1]).toFixed(1).replace('.', ',');
    control.innerHTML = `<span class="wind-label">Wind</span><span>${direction}°</span><span>${speed} m/s</span>`;
    control.dataset.formatted = control.innerHTML;
}

function expandWindDataToBounds(windData, targetBounds) {
    if (!Array.isArray(windData) || !targetBounds) return windData;
    return windData.map(record => expandWindRecordToBounds(record, targetBounds));
}

function expandWindRecordToBounds(record, targetBounds) {
    const header = record && record.header;
    const data = record && record.data;
    if (!header || !Array.isArray(data) || !header.nx || !header.ny || !header.dx || !header.dy) {
        return record;
    }

    const srcNx = Number(header.nx);
    const srcNy = Number(header.ny);
    const srcDx = Math.abs(Number(header.dx));
    const srcDy = Math.abs(Number(header.dy));
    if (!Number.isFinite(srcNx) || !Number.isFinite(srcNy) || !srcDx || !srcDy || data.length < srcNx * srcNy) {
        return record;
    }

    const srcWest = Number(header.lo1);
    const srcNorth = Number(header.la1);
    const srcEast = Number.isFinite(Number(header.lo2)) ? Number(header.lo2) : srcWest + srcDx * (srcNx - 1);
    const srcSouth = Number.isFinite(Number(header.la2)) ? Number(header.la2) : srcNorth - srcDy * (srcNy - 1);
    if (![srcWest, srcNorth, srcEast, srcSouth].every(Number.isFinite)) return record;

    const targetWest = Math.min(targetBounds.getWest(), srcWest);
    const targetEast = Math.max(targetBounds.getEast(), srcEast);
    const targetSouth = Math.min(targetBounds.getSouth(), srcSouth);
    const targetNorth = Math.max(targetBounds.getNorth(), srcNorth);

    const alreadyCoversTarget =
        srcWest <= targetWest &&
        srcEast >= targetEast &&
        srcSouth <= targetSouth &&
        srcNorth >= targetNorth;
    if (alreadyCoversTarget) return record;

    const rawNx = Math.ceil((targetEast - targetWest) / srcDx) + 1;
    const rawNy = Math.ceil((targetNorth - targetSouth) / srcDy) + 1;
    const pointCount = rawNx * rawNy;
    const spacingScale = pointCount > CONFIG.WIND_MAX_GRID_POINTS
        ? Math.sqrt(pointCount / CONFIG.WIND_MAX_GRID_POINTS)
        : 1;
    const targetDx = srcDx * spacingScale;
    const targetDy = srcDy * spacingScale;
    const targetNx = Math.ceil((targetEast - targetWest) / targetDx) + 1;
    const targetNy = Math.ceil((targetNorth - targetSouth) / targetDy) + 1;

    const expandedData = new Array(targetNx * targetNy);
    for (let y = 0; y < targetNy; y++) {
        const lat = targetNorth - y * targetDy;
        const srcY = clamp(Math.round((srcNorth - lat) / srcDy), 0, srcNy - 1);
        for (let x = 0; x < targetNx; x++) {
            const lon = targetWest + x * targetDx;
            const srcX = clamp(Math.round((lon - srcWest) / srcDx), 0, srcNx - 1);
            expandedData[y * targetNx + x] = data[srcY * srcNx + srcX];
        }
    }

    return {
        ...record,
        header: {
            ...header,
            lo1: targetWest,
            la1: targetNorth,
            lo2: targetWest + targetDx * (targetNx - 1),
            la2: targetNorth - targetDy * (targetNy - 1),
            dx: targetDx,
            dy: targetDy,
            nx: targetNx,
            ny: targetNy
        },
        data: expandedData
    };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// Start tracking device compass/orientation
function startCompassTracking() {
    // Check if device orientation is supported
    if (typeof DeviceOrientationEvent !== 'undefined') {
        // Request permission for iOS devices
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
                        window.addEventListener('deviceorientation', handleOrientation, true);
                    }
                })
                .catch(console.error);
        } else {
            // For Android and other devices
            window.addEventListener('deviceorientationabsolute', handleOrientation, true);
            window.addEventListener('deviceorientation', handleOrientation, true);
        }
    }
}

// Stop tracking device compass/orientation
function stopCompassTracking() {
    window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
    window.removeEventListener('deviceorientation', handleOrientation, true);
}

// Handle device orientation change
function handleOrientation(event) {
    // Get compass heading (0-360 degrees)
    let heading = event.webkitCompassHeading || event.alpha;
    
    if (heading !== null) {
        // Normalize heading for different browsers
        if (event.webkitCompassHeading) {
            // iOS: webkitCompassHeading gives correct compass heading
            currentHeading = heading;
        } else if (event.alpha !== null) {
            // Android: alpha needs to be inverted
            currentHeading = 360 - heading;
        }
        
        // Update direction arrow if location is available
        if (locationDirectionMarker && currentHeading !== null) {
            updateDirectionArrow(locationDirectionMarker.getLatLng(), currentHeading);
        }
    }
}

// Stop location tracking and clean up
function stopLocationTracking(map) {
    if (locationWatchId !== null) {
        map.stopLocate();
        locationWatchId = null;
    }
    shouldCenterOnNextLocation = false;
    
    // Remove only the direction arrow (no separate location marker)
    if (locationDirectionMarker !== null) {
        map.removeLayer(locationDirectionMarker);
        locationDirectionMarker = null;
    }
    
    // Clean up any leftover location marker reference
    locationMarker = null;
    
    // Stop compass tracking
    stopCompassTracking();
    currentHeading = null;
    
    // Hide the center and stop buttons, remove active class
    const centerBtn = document.querySelector('.locate-center-btn');
    const stopBtn = document.querySelector('.locate-stop-btn');
    const locateBtn = document.querySelector('.locate-once-btn');
    
    if (centerBtn) {
        centerBtn.classList.add('hidden');
        centerBtn.disabled = true;
    }
    if (stopBtn) {
        stopBtn.classList.add('hidden');
        stopBtn.disabled = true;
    }
    if (locateBtn) locateBtn.classList.remove('active');
    setLocationControlStatus('idle');
}

/* =================================
   UI VISIBILITY MANAGEMENT
   ================================= */

// Update UI visibility based on login status
function updateUIForLoginStatus() {
    const isUserLoggedIn = isLoggedIn();
    const leaderboardButton = document.getElementById('dropdown-leaderboard');
    const clearOccupantsButton = document.getElementById('dropdown-clear-occupants');
    
    if (leaderboardButton) {
        if (isUserLoggedIn) {
            leaderboardButton.style.display = 'flex'; // Show leaderboard button
        } else {
            leaderboardButton.style.display = 'none'; // Hide leaderboard button
        }
    }

    if (clearOccupantsButton) {
        if (isUserLoggedIn) {
            clearOccupantsButton.style.display = 'flex';
        } else {
            clearOccupantsButton.style.display = 'none';
        }
    }
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

    // Load wind overlay
    console.log("Loading wind overlay...");
    await loadWindOverlay(map);

    // Setup automatic wind data refresh every hour
    setInterval(async () => {
        console.log("Refreshing wind data...");
        await loadWindOverlay(map);
    }, 60 * 60 * 1000); // 1 hour in milliseconds

    // Update UI visibility based on initial login status
    updateUIForLoginStatus();
    
    // Listen for login/logout events to update UI visibility
    document.addEventListener('userLoggedIn', () => {
        updateUIForLoginStatus();
    });
    
    document.addEventListener('userLoggedOut', () => {
        updateUIForLoginStatus();
    });

    console.log("Map application initialized successfully");
}

// Start the application
init().catch(error => {
    console.error('Failed to initialize application:', error);
    alert('Fout bij het laden van de applicatie');
});
