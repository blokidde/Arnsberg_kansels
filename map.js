const API_URL = "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app";
const startCoords = [51.4372855, 7.8781002];
const startZoom = 13;
const bounds = L.latLngBounds([[51.432, 7.873], [51.442, 7.883]]);

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

// Map initialization
function initMap() {
  const map = L.map('map', {
    zoomControl: true,
    doubleClickZoom: true,
    scrollWheelZoom: true,
    boxZoom: true,
    touchZoom: true,
    minZoom: 13,
    maxZoom: 17
  }).setView(startCoords, startZoom);

  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
  const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');

  L.control.layers({
    "Licht": light,
    "Satelliet": satellite
  }).addTo(map);

  satellite.addTo(map);
  map.setMaxBounds(bounds);
  map.on('drag', () => map.panInsideBounds(bounds, { animate: false }));

  return map;
}

// Marker functions
async function loadMarkers(map) {
  try {
    const res = await fetch(`${API_URL}/hutjes`);
    const data = await res.json();
    
    data.forEach(markerData => {
      const marker = createMarker(markerData);
      marker.addTo(map);
      state.markers.push({...markerData, leafletObject: marker});
    });
  } catch (error) {
    console.error('Fout bij laden markers:', error);
  }
}

function createMarker(markerData) {
  const marker = L.marker([markerData.lat, markerData.lng])
    .bindTooltip(`${markerData.name} ${markerData.number}`, {
      permanent: true,
      direction: 'top'
    });
  
  marker.description = markerData.desc;
  
  marker.on('click', (ev) => {
    if (state.hutMode === "edit") {
      editMarker(markerData, marker);
    } else if (state.hutMode === "delete") {
      deleteMarker(markerData, marker);
    } else {
      showMarkerPopup(ev, markerData);
    }
  });
  
  return marker;
}

async function saveMarker(markerData) {
  try {
    const res = await fetch(`${API_URL}/hutjes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(markerData)
    });
    return await res.json();
  } catch (error) {
    console.error('Fout bij opslaan marker:', error);
  }
}

async function editMarker(markerData, marker) {
  const newName = prompt('Nieuwe naam:', markerData.name);
  if (!newName) return;
  
  const newDesc = prompt('Nieuwe beschrijving:', markerData.desc) || '';
  
  try {
    await fetch(`${API_URL}/hutjes/${markerData.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...markerData,
        name: newName,
        desc: newDesc
      })
    });
    
    marker.bindTooltip(`${newName} ${markerData.number}`, {
      permanent: true,
      direction: 'top'
    }).openTooltip();
  } catch (error) {
    console.error('Fout bij bijwerken marker:', error);
  }
}

async function deleteMarker(markerData, marker) {
  if (!confirm(`Verwijder ${markerData.name} ${markerData.number}?`)) return;
  
  try {
    await fetch(`${API_URL}/hutjes/${markerData.id}`, { method: "DELETE" });
    marker.remove();
    state.markers = state.markers.filter(m => m.id !== markerData.id);
  } catch (error) {
    console.error('Fout bij verwijderen marker:', error);
  }
}

function showMarkerPopup(ev, markerData) {
  L.popup()
    .setLatLng(ev.latlng)
    .setContent(`<strong>${markerData.name} ${markerData.number}</strong><br>${markerData.desc}`)
    .openOn(map);
}

// Zone functions
function zoneStyle(type) {
  switch (type) {
    case 'voederplek':
    case 'voederzone': return { color: 'sienna', fillColor: 'sienna', fillOpacity: 0.5 };
    case 'wildakker': return { color: 'yellow', fillColor: 'yellow', fillOpacity: 0.5 };
    case 'bos': return { color: 'green', fillColor: 'green', fillOpacity: 0.5 };
    case 'grens': return { color: 'red', fillOpacity: 0, dashArray: '5,5' };
    default: return {};
  }
}

function createZone(type, latlngs, map) {
  const poly = L.polygon(latlngs, zoneStyle(type)).addTo(map);
  const zone = {
    id: state.zoneId++,
    type,
    polygon: poly,
    latlngs: [...latlngs]
  };

  poly.on('click', (e) => {
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
  document.getElementById("delete-zone").classList.remove("hidden");
  
  zone.latlngs = zone.polygon.getLatLngs()[0];
  
  state.editHandles = zone.latlngs.map((latlng, idx) => {
    const handle = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({ className: 'vertex-handle' })
    }).addTo(map);
    
    handle.on('drag', (ev) => {
      zone.latlngs[idx] = ev.target.getLatLng();
      zone.polygon.setLatLngs(zone.latlngs);
    });
    
    return handle;
  });
}

function deselectZone(map) {
  if (!state.selectedZone) return;
  
  state.editHandles.forEach(handle => map.removeLayer(handle));
  state.editHandles = [];
  document.getElementById("delete-zone").classList.add("hidden");
  state.selectedZone = null;
}

function deleteZone(map) {
  if (!state.selectedZone) return;
  
  map.removeLayer(state.selectedZone.polygon);
  state.zones = state.zones.filter(z => z.id !== state.selectedZone.id);
  deselectZone(map);
}

// Drawing functions
function startDrawing(type) {
  state.drawing = true;
  state.drawingType = type;
  state.drawingPoints = [];
  clearTempElements();
}

function addPoint(latlng, map) {
  const m = L.circleMarker(latlng, { radius: 4 }).addTo(map);
  state.tempMarkers.push(m);
  state.drawingPoints.push(latlng);
  
  if (!state.tempLine) {
    state.tempLine = L.polyline(state.drawingPoints, { dashArray: '4,4' }).addTo(map);
  } else {
    state.tempLine.setLatLngs(state.drawingPoints);
  }
  
  if (state.drawingPoints.length >= 3) {
    document.getElementById("confirm-zone").classList.remove("hidden");
  }
}

function confirmZone(map) {
  if (state.drawingPoints.length < 3) return;
  
  createZone(state.drawingType, [...state.drawingPoints], map);
  clearTempElements();
  state.drawing = false;
  document.getElementById("confirm-zone").classList.add("hidden");
}

function clearTempElements() {
  state.tempMarkers.forEach(m => map.removeLayer(m));
  state.tempMarkers = [];
  
  if (state.tempLine) {
    map.removeLayer(state.tempLine);
    state.tempLine = null;
  }
  
  state.drawingPoints = [];
}

// UI Controls
function setupUI(map) {
  // Locate button
  const locate = L.control({ position: 'topleft' });
  locate.onAdd = () => {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.innerHTML = 'Locatie';
    L.DomEvent.on(btn, 'click', (e) => {
      L.DomEvent.stopPropagation(e);
      map.locate({ setView: true, maxZoom: startZoom });
    });
    return btn;
  };
  locate.addTo(map);

  map.on('locationfound', (e) => {
    if (map._locationMarker) map.removeLayer(map._locationMarker);
    map._locationMarker = L.marker(e.latlng).addTo(map);
  });

  // Event listeners
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

  document.getElementById("mode-add").addEventListener("click", () => state.hutMode = "add");
  document.getElementById("mode-edit").addEventListener("click", () => state.hutMode = "edit");
  document.getElementById("mode-delete").addEventListener("click", () => state.hutMode = "delete");
  document.getElementById("delete-zone").addEventListener("click", () => deleteZone(map));
  document.getElementById("confirm-zone").addEventListener("click", () => confirmZone(map));

  document.getElementById("zone-types").addEventListener("click", e => {
    if (e.target.tagName !== 'BUTTON') return;
    startDrawing(e.target.dataset.type);
    document.getElementById("zone-types").classList.add("hidden");
  });

  // Map click handler
  map.on('click', async (e) => {
    if (state.drawing) {
      addPoint(e.latlng, map);
      return;
    }

    if (state.selectedZone) deselectZone(map);
    
    if (state.hutMode !== "add") return;
    
    const name = prompt('Naam van de hut?');
    if (!name) return;
    
    const number = prompt('Nummer?') || '';
    const desc = prompt('Korte beschrijving?') || '';
    
    const markerData = {
      name,
      number,
      desc,
      lat: e.latlng.lat,
      lng: e.latlng.lng
    };
    
    const savedMarker = await saveMarker(markerData);
    if (savedMarker) {
      markerData.id = savedMarker.id;
      const marker = createMarker(markerData).addTo(map);
      state.markers.push({...markerData, leafletObject: marker});
    }
  });
}

// Initialize the application
const map = initMap();
loadMarkers(map);
setupUI(map);