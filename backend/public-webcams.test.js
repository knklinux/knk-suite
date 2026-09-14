'use strict';

// ============================================================================
// public-webcams.test.js — tests sin red
//
// Verifican las barreras del módulo: validación de identificadores, allowlist
// del relay de red privada, parsers de cada fuente y decodificación del
// transporte de DGT. Ninguna prueba abre sockets ni consulta fuentes externas.
// ============================================================================

const assert = require('assert');
const cams = require('./lib/public-webcams');

// ── identificadores de cámara ───────────────────────────────────────
assert.strictEqual(cams.isValidCameraId('dgt', '176130'), true);
assert.strictEqual(cams.isValidCameraId('dgt', '12'), false, 'ids demasiado cortos se rechazan');
assert.strictEqual(cams.isValidCameraId('dgt', '176130/../../admin'), false);
assert.strictEqual(cams.isValidCameraId('dgt', '176130.jpg'), false);
assert.strictEqual(cams.isValidCameraId('tfl', '00002.00865'), true);
assert.strictEqual(cams.isValidCameraId('tfl', '0002.00865'), false, 'TfL exige 5+5 dígitos');
assert.strictEqual(cams.isValidCameraId('tfl', '../../etc/passwd'), false);
assert.strictEqual(cams.isValidCameraId('madrid', '06303'), true);
assert.strictEqual(cams.isValidCameraId('madrid', '633'), false, 'Madrid exige 5 dígitos');
assert.strictEqual(cams.isValidCameraId('madrid', '06303.jpg'), false);
assert.strictEqual(cams.isValidCameraId('digitraffic', 'C0150301'), true);
assert.strictEqual(cams.isValidCameraId('digitraffic', 'c01503'), false, 'Digitraffic exige 6-12 alfanuméricos en mayúsculas');
assert.strictEqual(cams.isValidCameraId('vegagerdin', 'hellisheidi_1'), true);
assert.strictEqual(cams.isValidCameraId('vegagerdin', '../../x'), false);
assert.strictEqual(cams.isValidCameraId('vegagerdin', 'a'), false);
assert.strictEqual(cams.isValidCameraId('windy', '1234567'), true);
assert.strictEqual(cams.isValidCameraId('windy', '-1'), false);
assert.strictEqual(cams.isValidCameraId('desconocida', '123'), false);

// ── IPv4 privada RFC1918 (relay local) ──────────────────────────────
assert.strictEqual(cams.isPrivateLanIpv4('192.168.1.64'), true);
assert.strictEqual(cams.isPrivateLanIpv4('10.0.0.5'), true);
assert.strictEqual(cams.isPrivateLanIpv4('172.16.0.1'), true);
assert.strictEqual(cams.isPrivateLanIpv4('172.31.255.254'), true);
assert.strictEqual(cams.isPrivateLanIpv4('172.32.0.1'), false);
assert.strictEqual(cams.isPrivateLanIpv4('127.0.0.1'), false, 'loopback nunca');
assert.strictEqual(cams.isPrivateLanIpv4('169.254.169.254'), false, 'metadata cloud nunca');
assert.strictEqual(cams.isPrivateLanIpv4('8.8.8.8'), false);
assert.strictEqual(cams.isPrivateLanIpv4('localhost'), false);
assert.strictEqual(cams.isPrivateLanIpv4('192.168.1.300'), false);

// ── validación de URL del relay ─────────────────────────────────────
assert.strictEqual(cams.validateLocalSnapshotUrl('http://192.168.1.64:8080/cgi-bin/snapshot.cgi').ok, true);
assert.strictEqual(cams.validateLocalSnapshotUrl('http://192.168.1.64/cgi-bin/mjpg/video.cgi?channel=1').ok, true);
assert.strictEqual(cams.validateLocalSnapshotUrl('https://10.0.0.9:8443/ISAPI/Streaming/channels/101/picture').ok, true);
assert.strictEqual(cams.validateLocalSnapshotUrl('http://8.8.8.8/snapshot.jpg').ok, false, 'IP pública rechazada');
assert.strictEqual(cams.validateLocalSnapshotUrl('http://127.0.0.1:8086/api/status').ok, false, 'loopback rechazado');
assert.strictEqual(cams.validateLocalSnapshotUrl('http://169.254.169.254/latest/meta-data/').ok, false, 'metadata rechazada');
assert.strictEqual(cams.validateLocalSnapshotUrl('http://192.168.1.64:22/snapshot.jpg').ok, false, 'puerto no permitido');
assert.strictEqual(cams.validateLocalSnapshotUrl('http://admin:pass@192.168.1.64/snapshot.jpg').ok, false, 'credenciales rechazadas');
assert.strictEqual(cams.validateLocalSnapshotUrl('ftp://192.168.1.64/snapshot.jpg').ok, false, 'protocolo rechazado');
assert.strictEqual(cams.validateLocalSnapshotUrl('file:///etc/passwd').ok, false);
assert.strictEqual(cams.validateLocalSnapshotUrl('no-es-una-url').ok, false);
assert.strictEqual(cams.validateLocalSnapshotUrl('').ok, false);

// ── allowlists ──────────────────────────────────────────────────────
for (const host of ['etraffic.dgt.es', 's3-eu-west-1.amazonaws.com', 'informo.madrid.es', 'weathercam.digitraffic.fi', 'www.vegagerdin.is', 'cwwp2.dot.ca.gov', '511ny.org']) {
  assert.ok(cams.SNAPSHOT_HOSTS.has(host), `falta ${host} en la allowlist de snapshots`);
}
for (const host of ['evil.example.com', '127.0.0.1', 'localhost', '169.254.169.254']) {
  assert.strictEqual(cams.SNAPSHOT_HOSTS.has(host), false, `${host} no debe estar permitido`);
}
assert.ok(cams.LIST_HOSTS.has('tie.digitraffic.fi'));
assert.ok(cams.LIST_HOSTS.has('gagnaveita.vegagerdin.is'));
assert.strictEqual(cams.LIST_HOSTS.has('evil.example.com'), false);

// ── URL de imagen TfL ───────────────────────────────────────────────
assert.strictEqual(
  cams.buildTflImageUrl('00002.00865'),
  'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg',
);

// ── parser del KML municipal de Madrid ──────────────────────────────
const madridKml = `<kml><Document>
  <Placemark>
    <description>&lt;img src=https://informo.madrid.es/cameras/Camara06303.jpg?v=1/&gt;</description>
    <ExtendedData>
      <Data name="Numero"><Value>06303</Value></Data>
      <Data name="Nombre"><Value>PLAZA DE CASTILLA (NORTE)</Value></Data>
    </ExtendedData>
    <Point><coordinates>-3.68894207537291,40.466063829633,10 </coordinates></Point>
  </Placemark>
  <Placemark>
    <ExtendedData><Data name="Numero"><Value>no-valido</Value></Data></ExtendedData>
    <Point><coordinates>-3.7,40.4,0</coordinates></Point>
  </Placemark>
  <Placemark>
    <ExtendedData><Data name="Numero"><Value>01111</Value></Data></ExtendedData>
  </Placemark>
</Document></kml>`;
const madrid = cams.parseMadridKml(madridKml);
assert.strictEqual(madrid.length, 1, 'solo el placemark completo y válido debe entrar');
assert.strictEqual(madrid[0].id, '06303');
assert.strictEqual(madrid[0].name, 'PLAZA DE CASTILLA (NORTE)');
assert.ok(Math.abs(madrid[0].lat - 40.466063829633) < 1e-9, 'KML guarda lon,lat: el lat debe ser el segundo valor');
assert.ok(Math.abs(madrid[0].lon - -3.68894207537291) < 1e-9);
assert.deepStrictEqual(cams.parseMadridKml(''), []);

// ── parser de Digitraffic (Finlandia) ───────────────────────────────
const digitraffic = cams.mapDigitrafficStations({
  features: [{
    properties: { id: 'C01503', name: 'kt51_Inkoo', presets: [{ id: 'C0150301', inCollection: true }, { id: 'C0150302', inCollection: false }, { id: 'x' }] },
    geometry: { type: 'Point', coordinates: [23.99616, 60.05374, 0] },
  }, {
    properties: { id: 'C99999', name: 'sin geometria', presets: [{ id: 'C9999901' }] },
  }],
});
assert.strictEqual(digitraffic.length, 1, 'presets fuera de colección, ids inválidos y estaciones sin geometría se descartan');
assert.strictEqual(digitraffic[0].id, 'C0150301');
assert.strictEqual(digitraffic[0].name, 'kt51_Inkoo (1)');
assert.strictEqual(digitraffic[0].lat, 60.05374);
assert.strictEqual(digitraffic[0].lon, 23.99616);

// ── parser de Vegagerðin (Islandia) ─────────────────────────────────
const vegagerdin = cams.mapVegagerdin([
  { Myndavel: 'Hellisheiði', Skyring: 'séð til vesturs', Vegheiti: 'Hringvegur', Slod: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg', Breidd: 64.018296, Lengd: -21.342636 },
  { Myndavel: 'ajena', Slod: 'https://evil.example.com/cam/x.jpg', Breidd: 1, Lengd: 1 },
  { Myndavel: 'sin coords', Slod: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/sin_coords.jpg' },
]);
assert.strictEqual(vegagerdin.length, 1, 'solo se aceptan URLs bajo la base oficial y con coordenadas');
assert.strictEqual(vegagerdin[0].id, 'hellisheidi_1');
assert.ok(vegagerdin[0].name.includes('Hellisheiði'));
assert.strictEqual(vegagerdin[0].road, 'Hringvegur');

// ── entrelazado por fuente ──────────────────────────────────────────
const interleaved = cams.interleaveBySource([
  { source: 'a', id: '1' }, { source: 'a', id: '2' }, { source: 'b', id: '3' },
]);
assert.deepStrictEqual(interleaved.map((c) => `${c.source}${c.id}`), ['a1', 'b3', 'a2']);

// ── decodificación del transporte de DGT (base64 + XOR) ─────────────
const dgtJson = '{"camaras":[{"idCamara":"176130"}],"urlBase":"https://etraffic.dgt.es/camarasEtraffic/"}';
const xorMask = 'function{var ent3}'.charCodeAt(0);
const encoded = Buffer.from([...Buffer.from(dgtJson, 'utf8')].map((b) => b ^ xorMask)).toString('base64');
assert.deepStrictEqual(cams.decodeDgt(encoded), JSON.parse(dgtJson));

// ── utilidades geográficas ──────────────────────────────────────────
assert.ok(cams.distanceKm(36.7213, -4.4213, 36.7213, -4.4213) < 0.001);
assert.ok(cams.distanceKm(36.7213, -4.4213, 40.4168, -3.7038) > 400, 'Málaga–Madrid debe superar 400 km');
assert.ok(cams.distanceKm(64.018296, -21.342636, 64.989933, -21.057783) > 100, 'Islandia: estaciones lejanas');
assert.strictEqual(cams.clampRadius(0), 50);
assert.strictEqual(cams.clampRadius(9999), 2000);
assert.strictEqual(cams.clampRadius('25'), 25);
assert.deepStrictEqual(cams.finiteLatLon('36.72', '-4.42'), { lat: 36.72, lon: -4.42 });
assert.strictEqual(cams.finiteLatLon('999', '0'), null);

// ── catálogo de fuentes y categorías ────────────────────────────────
// Aislar del entorno: el proceso de test es efímero, así que vaciar el config
// garantiza el contrato 'sin clave → configured=false' tanto si esta máquina
// tiene windyApiKey real en config.json como si no.
cams.setConfigForTest({});
const sources = cams.listSources();
assert.strictEqual(sources.length, 8);
assert.deepStrictEqual(sources.map((s) => s.id).sort(), ['caltrans', 'dgt', 'digitraffic', 'madrid', 'ny511', 'tfl', 'vegagerdin', 'windy']);
assert.ok(sources.every((s) => s.id && s.label && s.attribution && s.kind && s.region));
assert.strictEqual(sources.find((s) => s.id === 'dgt').country, 'ES');
assert.strictEqual(sources.find((s) => s.id === 'vegagerdin').kind, 'weather');
assert.strictEqual(sources.find((s) => s.id === 'windy').configured, false, 'Windy sin clave aparece como no configurada');
assert.ok(Object.keys(cams.KIND_LABELS).includes('traffic') && Object.keys(cams.KIND_LABELS).includes('weather'));

// ── parser de Caltrans (California) ─────────────────────────────────
const caltransJson = { data: [
  { cctv: { inService: 'true', location: { locationName: 'TV102 -- I-580', nearbyPlace: 'Oakland', route: 'I-580', district: '4', latitude: '37.82539', longitude: '-122.27291' }, imageData: { static: { currentImageURL: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102i580westofsr24/tv102i580westofsr24.jpg' } } } },
  { cctv: { inService: 'false', location: { latitude: 1, longitude: 1 }, imageData: { static: { currentImageURL: 'https://cwwp2.dot.ca.gov/data/d4/cctv/image/fuera/fuera.jpg' } } } },
  { cctv: { inService: 'true', location: { latitude: 2, longitude: 2 }, imageData: { static: { currentImageURL: 'https://evil.example.com/data/d4/cctv/image/ajena/ajena.jpg' } } } },
] };
const caltrans = cams.mapCaltrans(caltransJson);
assert.strictEqual(caltrans.length, 1, 'fuera de servicio, hosts ajenos y basenames inválidos se descartan');
assert.strictEqual(caltrans[0].id, 'tv102i580westofsr24');
assert.ok(caltrans[0].name.includes('I-580'));
assert.strictEqual(cams.caltransBasenameFromUrl('https://evil.example.com/data/d4/cctv/image/x/x.jpg'), null, 'solo cwwp2.dot.ca.gov');
assert.strictEqual(cams.isValidCameraId('caltrans', '../../x'), false);

// ── parser de 511NY (Nueva York) ────────────────────────────────────
const ny = cams.mapNy511([
  { ID: 'NYSDOT-abc', Name: 'NY 33 at NY 198', RoadwayName: 'NY 33', Latitude: 42.88, Longitude: -78.87, Url: 'https://511ny.org/map/Cctv/4436', Disabled: false, VideoUrl: 'https://example.com/x.m3u8' },
  { ID: 'off', Name: 'apagada', Latitude: 1, Longitude: 1, Url: 'https://511ny.org/map/Cctv/2', Disabled: true },
  { ID: 'evil', Name: 'ajena', Latitude: 2, Longitude: 2, Url: 'https://evil.example.com/Cctv/3', Disabled: false },
]);
assert.strictEqual(ny.length, 1, 'apagadas y URLs ajenas al visor oficial se descartan');
assert.strictEqual(ny[0].id, '4436');
assert.ok(ny[0].video);
assert.strictEqual(cams.isValidCameraId('ny511-view', '4436'), true);
assert.strictEqual(cams.isValidCameraId('ny511-view', '4436; DROP'), false);

// ── errores tempranos, sin tocar la red ─────────────────────────────
(async () => {
  const unknown = await cams.listCameras({ source: 'inventada' });
  assert.strictEqual(unknown.ok, false);
  assert.ok(/fuente desconocida/.test(unknown.error));

  const badId = await cams.getSnapshot({ source: 'dgt', id: '../../etc/passwd' });
  assert.strictEqual(badId.ok, false);

  const badSource = await cams.getSnapshot({ source: 'nope', id: '176130' });
  assert.strictEqual(badSource.ok, false);

  const badRelay = await cams.relayLocalSnapshot('http://127.0.0.1:8086/api/status');
  assert.strictEqual(badRelay.ok, false);

  console.log('public-webcams: OK');
})().catch((error) => {
  console.error('public-webcams: FALLO —', error.message);
  process.exit(1);
});
