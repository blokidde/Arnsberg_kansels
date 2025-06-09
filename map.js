const startCoords = [51.4377737, 7.8800099];
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

const addBtn = document.getElementById('add-zone-btn');
const options = document.getElementById('zone-options');
const confirmBtn = document.getElementById('confirm-zone');
const deleteBtn = document.getElementById('delete-zone');

const map = L.map('map', {
    zoomControl: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    touchZoom: false,
    minZoom: startZoom,
    maxZoom: startZoom
}).setView(startCoords, startZoom);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);

// Limit map panning to a fixed boundary
const bounds = L.latLngBounds([
    [51.390, 8.050],
    [51.402, 8.075]
]);
map.setMaxBounds(bounds);
map.on('drag', function() {
    map.panInsideBounds(bounds, { animate: false });
});

function saveMarkers() {
    localStorage.setItem('hutjes', JSON.stringify(markers));
}

function loadMarkers() {
    const data = localStorage.getItem('hutjes');
    if (!data) return;
    JSON.parse(data).forEach(m => {
        const marker = L.marker(m.latlng).addTo(map)
            .bindTooltip(m.name + ' ' + m.number, { permanent: true, direction: 'top' });
        marker.description = m.desc;
        marker.on('click', function(ev) {
            L.popup().setLatLng(ev.latlng)
                .setContent('<strong>' + m.name + ' ' + m.number + '</strong><br>' + m.desc)
                .openOn(map);
        });

        markers.push(m);
    });
}

map.on('click', function(e) {
    if (drawing) {
        addPoint(e.latlng);
        return;
    }
    if (selectedZone) deselectZone();


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
=======
    markers.push({ name, number, desc, latlng: e.latlng });
    saveMarkers();
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

fetch('gebieden.geojson')
    .then(resp => resp.json())
    .then(data => {
        data.features.forEach(f => {
            const coords = f.geometry.coordinates[0].map(c => [c[1], c[0]]);
            createZone(f.properties.type, coords);
        });

    })
    .catch(err => console.error('GeoJSON laden mislukt', err));

// Legend
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML =
        '<i style="background:sienna"></i>Voederplek<br>' +
        '<i style="background:yellow"></i>Wildakker<br>' +

        '<i style="background:green"></i>Bos<br>' +
        '<i style="background:red"></i>Gebiedgrens';
    return div;
};
legend.addTo(map);

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

addBtn.addEventListener('click', () => {
    options.classList.toggle('hidden');
});

options.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    drawing = true;
    drawingType = e.target.dataset.type;
    options.classList.add('hidden');
    clearDrawing();
});

confirmBtn.addEventListener('click', () => {
    if (drawingPoints.length < 3) return;
    createZone(drawingType, drawingPoints);
    clearDrawing();
    drawing = false;
    confirmBtn.classList.add('hidden');
});

deleteBtn.addEventListener('click', () => {
    if (!selectedZone) return;
    map.removeLayer(selectedZone.polygon);
    zones.splice(zones.indexOf(selectedZone), 1);
    deselectZone();
});

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
