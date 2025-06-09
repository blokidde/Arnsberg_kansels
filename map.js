const startCoords = [51.395, 8.06];
const startZoom = 13;
const markers = [];

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
        markers.push(m);
    });
}

map.on('click', function(e) {
    const name = prompt('Naam van de hut?');
    if (!name) return;
    const number = prompt('Nummer?');
    if (number === null) return;
    const desc = prompt('Korte beschrijving?') || '';

    const marker = L.marker(e.latlng).addTo(map)
        .bindTooltip(name + ' ' + number, { permanent: true, direction: 'top' });
    marker.description = desc;
    markers.push({ name, number, desc, latlng: e.latlng });
    saveMarkers();
});

function zoneStyle(feature) {
    switch (feature.properties.type) {
        case 'voederzone':
            return { color: 'orange', fillColor: 'orange', fillOpacity: 0.5 };
        case 'wildakker':
            return { color: 'purple', fillColor: 'purple', fillOpacity: 0.5 };
        case 'bos':
            return { color: 'green', fillColor: 'green', fillOpacity: 0.5 };
        case 'grens':
            return { color: 'red', fillOpacity: 0, dashArray: '5,5' };
    }
}

fetch('gebieden.geojson')
    .then(resp => resp.json())
    .then(data => {
        L.geoJSON(data, {
            style: zoneStyle,
            onEachFeature: function(feature, layer) {
                layer.bindTooltip(feature.properties.name || feature.properties.type);
            }
        }).addTo(map);
    })
    .catch(err => console.error('GeoJSON laden mislukt', err));

// Legend
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML =
        '<i style="background:orange"></i>Voederzone<br>' +
        '<i style="background:purple"></i>Wildakker<br>' +
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
