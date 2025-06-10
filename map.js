const API_URL = "https://461a-2001-1c08-883-4400-f0c3-e205-3254-d3c3.ngrok-free.app" 

const startCoords = [51.4372855, 7.8781002];
const startZoom = 13;
const markers = [];

const zones = [];
let drawing = false;
let drawingType = null;
let drawingPoints = [];
let tempMarkers = [];
let tempLine = null;
let selectedZone = null;
let editHandles = [];
let zoneId = 1;
let hutMode = null;

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

// Limit map panning to a fixed boundary
const bounds = L.latLngBounds([
    [51.432, 7.873],
    [51.442, 7.883]
]);
map.setMaxBounds(bounds);
map.on('drag', function() {
    map.panInsideBounds(bounds, { animate: false });
});

async function saveMarker(marker) {
    await fetch(`${API_URL}/hutjes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(marker)
    });
}

async function loadMarkers() {
    console.log("GET hutjes from:", `${API_URL}/hutjes`);
    const res = await fetch(`${API_URL}/hutjes`);
    console.log("Response status:", res.status);
    const data = await res.json();
    console.log("Data ontvangen:", data);
    data.forEach(m => {
        console.log("Marker info:", m);
        if (!m.lat || !m.lng) {
            console.error("FOUT: m.lat of m.lng ontbreekt:", m);
            return;
        }
        const marker = L.marker([m.lat, m.lng]).addTo(map)
            .bindTooltip(m.name + ' ' + m.number, { permanent: true, direction: 'top' });
        marker.description = m.desc;
        marker.on('click', async function(ev) {
            if (hutMode === "edit") {
                const newName = prompt('Nieuwe naam:', m.name);
                const newDesc = prompt('Nieuwe beschrijving:', m.desc);
                if (!newName) return;

                m.name = newName;
                m.desc = newDesc;
                marker.bindTooltip(newName + ' ' + m.number, { permanent: true, direction: 'top' }).openTooltip();
                
                await fetch(`${API_URL}/hutjes/${m.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(m)
                });

            } else if (hutMode === "delete") {
                if (!confirm(`Verwijder ${m.name} ${m.number}?`)) return;
                map.removeLayer(marker);
                await fetch(`${API_URL}/hutjes/${m.id}`, {
                    method: "DELETE"
                });
            } else {
                L.popup().setLatLng(ev.latlng)
                    .setContent('<strong>' + m.name + ' ' + m.number + '</strong><br>' + m.desc)
                    .openOn(map);
            }
        });
        markers.push(m);
    });
}


map.on('click', async function(e) {
    if (drawing) {
        addPoint(e.latlng);
        return;
    }

    if (selectedZone) deselectZone();

    if (hutMode !== "add") return;

    const name = prompt('Naam van de hut?');
    if (!name) return;
    const number = prompt('Nummer?');
    if (number === null) return;
    const desc = prompt('Korte beschrijving?') || '';

    const marker = L.marker(e.latlng).addTo(map)
        .bindTooltip(name + ' ' + number, { permanent: true, direction: 'top' });
    marker.description = desc;
    marker.on('click', function(ev) {
        L.popup().setLatLng(ev.latlng)
            .setContent('<strong>' + name + ' ' + number + '</strong><br>' + desc)
            .openOn(map);
    });

    const markerData = {
        name,
        number,
        desc,
        lat: e.latlng.lat,
        lng: e.latlng.lng
    };

    markers.push(markerData);
    const res = await saveMarker(markerData);
    markerData.id = (await res.json()).id;
});



function zoneStyle(obj) {
    const type = obj.type || (obj.properties && obj.properties.type);
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
    }
}

// Locate button
const locate = L.control({ position: 'topleft' });
locate.onAdd = function() {
    const btn = L.DomUtil.create('button', 'locate-btn');
    btn.innerHTML = 'Locatie';
    L.DomEvent.on(btn, 'click', function(e) {
        L.DomEvent.stopPropagation(e);
        map.locate({ setView: true, maxZoom: startZoom });
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

loadMarkers();

function addPoint(latlng) {
    const m = L.circleMarker(latlng, { radius: 4 }).addTo(map);
    tempMarkers.push(m);
    drawingPoints.push(latlng);
    if (!tempLine) {
        tempLine = L.polyline(drawingPoints, { dashArray: '4,4' }).addTo(map);
    } else {
        tempLine.setLatLngs(drawingPoints);
    }
    if (drawingPoints.length >= 3) confirmBtn.classList.remove('hidden');
}

function clearDrawing() {
    tempMarkers.forEach(m => map.removeLayer(m));
    tempMarkers = [];
    if (tempLine) { map.removeLayer(tempLine); tempLine = null; }
    drawingPoints = [];
}

function createZone(type, latlngs) {
    const poly = L.polygon(latlngs, zoneStyle({type})).addTo(map);
    const zone = { id: zoneId++, type, polygon: poly, latlngs: latlngs.slice() };
    poly.on('click', function(e) {
        L.DomEvent.stopPropagation(e);
        selectZone(zone);
        poly.openPopup(e.latlng);
    });
    poly.bindPopup('Type: ' + type + '<br>ID: ' + zone.id);
    zones.push(zone);
    return zone;
}

function selectZone(zone) {
    deselectZone();
    selectedZone = zone;
    deleteBtn.classList.remove('hidden');
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
        editHandles.push(handle);
    });
}

function deselectZone() {
    if (!selectedZone) return;
    editHandles.forEach(h => map.removeLayer(h));
    editHandles = [];
    deleteBtn.classList.add('hidden');
    selectedZone = null;
}

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

document.getElementById("mode-add").addEventListener("click", function () {
    hutMode = "add";
});

document.getElementById("mode-edit").addEventListener("click", function () {
    hutMode = "edit";
});

document.getElementById("mode-delete").addEventListener("click", function () {
    hutMode = "delete";
});

document.getElementById("zone-types").addEventListener("click", e => {
    if (e.target.tagName !== 'BUTTON') return;
    drawing = true;
    drawingType = e.target.dataset.type;
    document.getElementById("zone-types").classList.add("hidden");
    clearDrawing();
});

document.getElementById("delete-zone").addEventListener("click", () => {
    if (!selectedZone) return;
    map.removeLayer(selectedZone.polygon);
    zones.splice(zones.indexOf(selectedZone), 1);
    deselectZone();
});

