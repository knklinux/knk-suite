'use strict';
// ============================================================================
// public-camera-sources.js — Multi-source public camera/stream discovery
//
// Free sources for finding publicly accessible cameras and live streams:
//   1. Insecam.org — Public camera directory
//   2. EarthCam — Public webcams
//   3. Windy Webcams (no key needed for some)
//   4. OpenStreetMap webcam data
//   5. Camera manufacturer default streams
//   6. SHODAN-style dorks for exposed cameras
//   7. Random public IP ranges with common camera ports
//
// All queries return camera metadata, never connect to private IPs.
// ============================================================================

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ============================================================================
// Constants & Configuration
// ============================================================================

const USER_AGENT = 'Mozilla/5.0 (compatible; CameraDiscoveryBot/1.0; research)';
const REQUEST_TIMEOUT = 15000;

const RFC1918_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^localhost$/i,
];

const CAMERA_BRANDS = [
  {
    name: 'Hikvision',
    defaultUser: 'admin',
    defaultPass: 'admin123',
    loginPaths: ['/doc/page/login', '/'],
    snapshotPaths: ['/ISAPI/Streaming/channels/101/picture', '/cgi-bin/snapshot.cgi'],
  },
  {
    name: 'Dahua',
    defaultUser: 'admin',
    defaultPass: 'admin',
    loginPaths: ['/'],
    snapshotPaths: ['/cgi-bin/snapshot.cgi', '/cgi-bin/currentpic.jpg'],
  },
  {
    name: 'Axis',
    defaultUser: 'root',
    defaultPass: 'pass',
    loginPaths: ['/operator/basic.shtml', '/'],
    snapshotPaths: ['/jpg/image.jpg', '/axis-cgi/jpg/image.cgi'],
  },
  {
    name: 'Foscam',
    defaultUser: 'admin',
    defaultPass: '',
    loginPaths: ['/', '/web_pages/login.html'],
    snapshotPaths: ['/snapshot.cgi', '/cgi-bin/CGIView.jpg'],
  },
  {
    name: 'Reolink',
    defaultUser: 'admin',
    defaultPass: 'admin',
    loginPaths: ['/', '/login.html'],
    snapshotPaths: ['/cgi-bin/api.cgi', '/flv/snapshot.jpg'],
  },
  {
    name: 'Amcrest',
    defaultUser: 'admin',
    defaultPass: 'admin',
    loginPaths: ['/'],
    snapshotPaths: ['/cgi-bin/snapshot.cgi', '/cgi-bin/currentpic.jpg'],
  },
  {
    name: 'Sony',
    defaultUser: 'admin',
    defaultPass: 'password',
    loginPaths: ['/'],
    snapshotPaths: ['/jpg/image.jpg', '/command/snapshot.jpg'],
  },
  {
    name: 'Panasonic',
    defaultUser: 'admin',
    defaultPass: '12345',
    loginPaths: ['/'],
    snapshotPaths: ['/jpg/image.jpg', '/SnapshotJPEG'],
  },
  {
    name: 'Samsung',
    defaultUser: 'admin',
    defaultPass: '4321',
    loginPaths: ['/'],
    snapshotPaths: ['/cgi-bin/snapshot.cgi'],
  },
  {
    name: 'Bosch',
    defaultUser: 'admin',
    defaultPass: 'admin',
    loginPaths: ['/'],
    snapshotPaths: ['/snap.jpg', '/cgi-bin/snapshot'],
  },
];

const CAMERA_PORTS = [80, 443, 554, 8000, 8080, 8443, 8554];

// ============================================================================
// Utility Functions
// ============================================================================

function isPrivateIP(target) {
  if (!target || typeof target !== 'string') return false;
  for (const range of RFC1918_RANGES) {
    if (range.test(target)) return true;
  }
  return false;
}

function safeParseInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/json,*/*',
        ...(options.headers || {}),
      },
      timeout: options.timeout || REQUEST_TIMEOUT,
    };

    const req = client.request(reqOptions, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out: ${url}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function extractJsonFromHtml(html) {
  const jsonPattern = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  const match = jsonPattern.exec(html);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (_) {
      // ignore parse errors
    }
  }
  return null;
}

function parseCoordinates(lat, lon) {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { lat: latitude, lon: longitude };
  }
  return null;
}

// ============================================================================
// 1. Insecam.org — Public camera directory
// ============================================================================

async function fetchInsecam(country, category) {
  const validCategories = ['city', 'nature', 'traffic', 'weather', 'other'];
  const cat = validCategories.includes(category) ? category : 'city';
  const cty = (country || 'us').toLowerCase().slice(0, 3);

  const cameras = [];

  try {
    // Attempt to fetch from a known Insecam proxy/mirror structure
    const url = `http://www.insecam.org/en/bycategory/${cat}/?country=${cty}`;
    const response = await fetchUrl(url);

    if (response.statusCode !== 200) {
      return cameras;
    }

    // Parse camera entries from HTML
    const cameraPattern = /<div[^>]*class="[^"]*camera-item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const linkPattern = /href="(\/en\/view\/[^"]+)"/i;
    const namePattern = /<span[^>]*class="[^"]*camera-name[^"]*"[^>]*>([\s\S]*?)<\/span>/i;
    const locationPattern = /<span[^>]*class="[^"]*camera-location[^"]*"[^>]*>([\s\S]*?)<\/span>/i;

    let match;
    while ((match = cameraPattern.exec(response.body)) !== null) {
      const block = match[1];
      const link = linkPattern.exec(block);
      const name = namePattern.exec(block);
      const location = locationPattern.exec(block);

      if (link) {
        const viewUrl = `http://www.insecam.org${link[1]}`;
        const camera = {
          name: name ? name[1].trim().replace(/<[^>]+>/g, '') : 'Unknown',
          url: viewUrl,
          streamUrl: null,
          country: cty.toUpperCase(),
          city: location ? location[1].trim().replace(/<[^>]+>/g, '') : '',
          lat: null,
          lon: null,
          brand: null,
          category: cat,
        };
        cameras.push(camera);
      }
    }

    // If no structured parsing worked, try to extract any /view/ links
    if (cameras.length === 0) {
      const viewLinkPattern = /href="(\/en\/view\/[^"]+)"/gi;
      let viewMatch;
      while ((viewMatch = viewLinkPattern.exec(response.body)) !== null) {
        cameras.push({
          name: 'Camera',
          url: `http://www.insecam.org${viewMatch[1]}`,
          streamUrl: null,
          country: cty.toUpperCase(),
          city: '',
          lat: null,
          lon: null,
          brand: null,
          category: cat,
        });
      }
    }
  } catch (err) {
    // Gracefully handle network errors, return empty array
  }

  return cameras;
}

// ============================================================================
// 2. EarthCam — Public webcams
// ============================================================================

async function fetchEarthCam(category) {
  const validCategories = [
    'traffic', 'weather', 'nature', 'city',
    'beach', 'mountain', 'airport', 'animals',
    'construction', 'harbor',
  ];
  const cat = validCategories.includes(category) ? category : 'city';
  const cameras = [];

  try {
    // EarthCam public directory
    const url = `https://www.earthcam.com/cams/common/mapsearch.php?search=${cat}`;
    const response = await fetchUrl(url, {
      headers: { Accept: 'application/json, text/html, */*' },
    });

    if (response.statusCode === 200) {
      // Try to parse as JSON first
      let data;
      try {
        data = JSON.parse(response.body);
      } catch (_) {
        data = extractJsonFromHtml(response.body);
      }

      if (data && Array.isArray(data.cams)) {
        for (const cam of data.cams) {
          const coords = parseCoordinates(cam.lat, cam.lng);
          cameras.push({
            name: cam.title || cam.name || 'EarthCam',
            url: cam.url || cam.pageUrl || '',
            streamUrl: cam.streamUrl || cam.hlsUrl || null,
            country: cam.country || '',
            city: cam.city || '',
            lat: coords ? coords.lat : null,
            lon: coords ? coords.lon : null,
            brand: null,
            category: cat,
          });
        }
      }

      // Fallback: parse from HTML
      if (cameras.length === 0) {
        const camPattern = /data-lat="([^"]*)"[^>]*data-lng="([^"]*)"[^>]*data-name="([^"]*)"/gi;
        let match;
        while ((match = camPattern.exec(response.body)) !== null) {
          const coords = parseCoordinates(match[1], match[2]);
          cameras.push({
            name: match[3],
            url: '',
            streamUrl: null,
            country: '',
            city: '',
            lat: coords ? coords.lat : null,
            lon: coords ? coords.lon : null,
            brand: null,
            category: cat,
          });
        }
      }
    }
  } catch (err) {
    // Gracefully handle errors
  }

  return cameras;
}

// ============================================================================
// 3. Google Dorks for exposed cameras
// ============================================================================

function generateCameraDorks(brand, country) {
  const validBrands = CAMERA_BRANDS.map((b) => b.name.toLowerCase());
  const targetBrand = (brand || 'hikvision').toLowerCase();
  const countryFilter = country ? ` "${country}"` : '';

  const brandData = CAMERA_BRANDS.find((b) => b.name.toLowerCase() === targetBrand);
  const brandName = brandData ? brandData.name : brand.charAt(0).toUpperCase() + brand.slice(1);

  const dorks = [
    `intitle:"${brandName}" inurl:"/doc/page/login"${countryFilter}`,
    `intitle:"${brandName}" inurl:"/cgi-bin/snapshot"${countryFilter}`,
    `"${brandName}" inurl:"/ISAPI/Streaming"${countryFilter}`,
    `intitle:"Network Camera" "${brandName}" inurl:"/Operator"${countryFilter}`,
    `"${brandName}" "Live View" inurl:"/"${countryFilter}`,
    `inurl:"/cgi-bin/mjpg/video.cgi" "${brandName}"${countryFilter}`,
    `"${brandName}" intext:"Login" inurl:"/web_pages/login.html"${countryFilter}`,
    `filetype:cgi "${brandName}" inurl:"snapshot"${countryFilter}`,
    `inurl:"/snapshot" "Server: ${brandName}"${countryFilter}`,
    `"${brandName}" "Password" "Default"${countryFilter}`,
  ];

  if (brandData) {
    for (const loginPath of brandData.loginPaths) {
      dorks.push(`"${brandName}" inurl:"${loginPath}"${countryFilter}`);
    }
    for (const snapPath of brandData.snapshotPaths) {
      dorks.push(`"${brandName}" inurl:"${snapPath}"${countryFilter}`);
    }
  }

  return dorks;
}

// ============================================================================
// 4. IP Search Service Dorks
// ============================================================================

function generateIPSearchDorks(service, port) {
  const validServices = ['shodan', 'censys', 'fofa', 'zoomeye', 'hunter'];
  const targetService = (service || 'shodan').toLowerCase();
  const targetPort = safeParseInt(port, 80);

  const dorks = [];
  const urls = [];

  const brandKeywords = ['hikvision', 'dahua', 'axis', 'foscam', 'reolink'];
  const portDorks = {
    shodan: [
      `port:${targetPort} "camera" product:"${targetPort === 554 ? "RTSP" : "HTTP"}"`,
      `port:${targetPort} "Login" "Camera"`,
      `port:${targetPort} html.title:"Login" http.title:"Camera"`,
      `port:${targetPort} "snapshot.cgi"`,
      `port:${targetPort} "viewer/index.html"`,
      `port:${targetPort} "Web Viewer"`,
    ],
    censys: [
      `services.port=${targetPort} AND services.service_name="HTTP" AND raw_data:"camera"`,
      `services.port=${targetPort} AND raw_data:"inurl:cgi-bin/snapshot"`,
      `services.port=${targetPort} AND raw_data:"intitle:Network Camera"`,
      `services.port=${targetPort} AND raw_data:"Hikvision"`,
      `services.port=${targetPort} AND raw_data:"Dahua"`,
    ],
    fofa: [
      `port="${targetPort}" && title="Camera"`,
      `port="${targetPort}" && body="Login" && header="Server: GoAhead"`,
      `port="${targetPort}" && body="snapshot.cgi"`,
      `port="${targetPort}" && body="Web Viewer"`,
      `port="${targetPort}" && body="Hikvision"`,
    ],
    zoomeye: [
      `port:${targetPort} app:"GoAhead-Webs"`,
      `port:${targetPort} "camera"`,
      `port:${targetPort} title:"Login"`,
      `port:${targetPort} "snapshot"`,
      `port:${targetPort} "Hikvision"`,
    ],
    hunter: [
      `port:${targetPort} "camera" "login"`,
      `port:${targetPort} "snapshot.cgi"`,
      `port:${targetPort} "Web Viewer"`,
    ],
  };

  if (portDorks[targetService]) {
    dorks.push(...portDorks[targetService]);
  }

  // Add brand-specific dorks for each port
  for (const keyword of brandKeywords) {
    dorks.push(`port:${targetPort} "${keyword}"`);
  }

  // Generate URLs for web-based searches
  switch (targetService) {
    case 'shodan':
      for (const dork of dorks) {
        urls.push(`https://www.shodan.io/search?query=${encodeURIComponent(dork)}`);
      }
      break;
    case 'censys':
      for (const dork of dorks) {
        urls.push(`https://search.censys.io/search?resource=hosts&q=${encodeURIComponent(dork)}`);
      }
      break;
    case 'fofa':
      for (const dork of dorks) {
        urls.push(`https://en.fofa.info/result?qbase64=${encodeURIComponent(Buffer.from(dork).toString('base64'))}`);
      }
      break;
    case 'zoomeye':
      for (const dork of dorks) {
        urls.push(`https://www.zoomeye.org/searchResult?q=${encodeURIComponent(dork)}`);
      }
      break;
    case 'hunter':
      for (const dork of dorks) {
        urls.push(`https://hunter.how/search?search=${encodeURIComponent(dork)}`);
      }
      break;
    default:
      break;
  }

  return {
    service: targetService,
    port: targetPort,
    dorks,
    urls,
  };
}

// ============================================================================
// 5. Curated public camera streams
// ============================================================================

function getPublicCameraStreams() {
  // v4.2: solo items REPRODUCIBLES. Las páginas EarthCam no son streams (eran
  // URLs de ficha pintadas como <img> roto + violación CSP). Las cámaras DOT
  // reales viven en /api/cameras/public (ver módulo «En Directo»).
  const px = (u) => `/api/cameras/public/hls?url=${encodeURIComponent(u)}`;
  return [
    {
      name: 'Demo HLS — Apple BipBop',
      url: px('https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8'),
      streamUrl: px('https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8'),
      type: 'hls',
      country: 'INT', city: 'Demo', category: 'demo',
      lat: null, lon: null, playable: true,
    },
    {
      name: 'Demo HLS — Mux',
      url: px('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
      streamUrl: px('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
      type: 'hls',
      country: 'INT', city: 'Demo', category: 'demo',
      lat: null, lon: null, playable: true,
    },
    {
      name: 'Demo HLS — Tears of Steel',
      url: px('https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'),
      streamUrl: px('https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'),
      type: 'hls',
      country: 'INT', city: 'Demo', category: 'demo',
      lat: null, lon: null, playable: true,
    },
    {
      name: '511NY en directo (1.872 cámaras HLS)',
      url: '/api/cameras/public?source=ny511',
      streamUrl: null,
      type: 'live-index',
      country: 'US', city: 'Nueva York', category: 'traffic',
      lat: 40.7128, lon: -74.006, playable: false, action: 'open-live',
    },
    {
      name: 'Caltrans en directo (861 cámaras)',
      url: '/api/cameras/public?source=caltrans',
      streamUrl: null,
      type: 'live-index',
      country: 'US', city: 'California', category: 'traffic',
      lat: 36.7783, lon: -119.4179, playable: false, action: 'open-live',
    },
  ];
}

// ============================================================================
// 6. Search for exposed cameras using free tools
// ============================================================================

async function searchExposedCameras(target, options = {}) {
  const clean = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(target || '').trim());
  const oct = clean ? clean.slice(1, 5).map(Number) : null;
  if (!oct || oct.some((n) => n > 255)) {
    return { ip: target, error: 'IP inválida (formato a.b.c.d).', ports: [], services: [], cameraDetected: false, brand: null, vulnerabilities: [] };
  }
  target = oct.join('.');
  if (isPrivateIP(target)) {
    return {
      ip: target,
      error: 'Private IP detected. Only public IPs are supported.',
      ports: [],
      services: [],
      cameraDetected: false,
      brand: null,
      vulnerabilities: [],
    };
  }

  const result = {
    ip: target,
    ports: [],
    services: [],
    cameraDetected: false,
    brand: null,
    vulnerabilities: [],
    metadata: {},
  };

  try {
    // Use Shodan's InternetDB (no API key required, free, rate-limited)
    const url = `https://internetdb.shodan.io/${target}`;
    const response = await fetchUrl(url);

    if (response.statusCode === 200) {
      let data;
      try {
        data = JSON.parse(response.body);
      } catch (_) {
        data = null;
      }

      if (data) {
        result.ports = data.ports || [];
        result.services = data.hostnames || [];

        // Check if any known camera ports are open
        const cameraPorts = result.ports.filter((p) => CAMERA_PORTS.includes(p));
        if (cameraPorts.length > 0) {
          result.cameraDetected = true;
        }

        // Check for camera-related services in banners
        const bannerPorts = data.cpes || [];
        const vulns = data.vulns || [];
        result.vulnerabilities = vulns;

        // Try to identify brand from service data
        for (const port of result.ports) {
          const brandGuess = await detectBrandFromPort(target, port);
          if (brandGuess) {
            result.brand = brandGuess;
            break;
          }
        }

        result.metadata = {
          countries: data.countries || [],
          hostnames: data.hostnames || [],
          cpes: bannerPorts,
          tags: data.tags || [],
        };
      }
    } else if (response.statusCode === 404) {
      result.error = 'No data available for this IP in InternetDB.';
    } else {
      result.error = `Unexpected response code: ${response.statusCode}`;
    }
  } catch (err) {
    result.error = err.message || 'Failed to query InternetDB.';
  }

  return result;
}

async function detectBrandFromPort(ip, port) {
  if (isPrivateIP(ip)) return null;

  // Try to access common camera endpoints and check response headers
  const protocols = [443, 8443].includes(port) ? ['https'] : ['http'];
  const brandSignatures = [
    { header: 'Server', pattern: /Hikvision/i, brand: 'Hikvision' },
    { header: 'Server', pattern: /Dahua/i, brand: 'Dahua' },
    { header: 'Server', pattern: /GoAhead/i, brand: 'GoAhead (Dahua/Foscam)' },
    { header: 'Server', pattern: /Boa/i, brand: 'Axis/Boa' },
    { header: 'X-Powered-By', pattern: /Hikvision/i, brand: 'Hikvision' },
    { header: 'WWW-Authenticate', pattern: /Hikvision/i, brand: 'Hikvision' },
    { header: 'WWW-Authenticate', pattern: /Dahua/i, brand: 'Dahua' },
  ];

  for (const protocol of protocols) {
    try {
      const url = `${protocol}://${ip}:${port}/`;
      const response = await fetchUrl(url, { timeout: 5000 });

      for (const sig of brandSignatures) {
        const headerValue = response.headers[sig.header.toLowerCase()];
        if (headerValue && sig.pattern.test(headerValue)) {
          return sig.brand;
        }
      }

      // Check response body for brand indicators
      const bodyLower = response.body.toLowerCase();
      if (bodyLower.includes('hikvision') || bodyLower.includes('hik-network')) {
        return 'Hikvision';
      }
      if (bodyLower.includes('dahua')) {
        return 'Dahua';
      }
      if (bodyLower.includes('axis communications')) {
        return 'Axis';
      }
      if (bodyLower.includes('foscam')) {
        return 'Foscam';
      }
      if (bodyLower.includes('reolink')) {
        return 'Reolink';
      }
    } catch (_) {
      // Connection failed, try next protocol
    }
  }

  return null;
}

// ============================================================================
// 7. Camera brands reference data
// ============================================================================

function getCameraBrands() {
  return CAMERA_BRANDS.map((brand) => ({
    name: brand.name,
    defaultCredentials: {
      username: brand.defaultUser,
      password: brand.defaultPass,
    },
    loginPaths: brand.loginPaths,
    snapshotPaths: brand.snapshotPaths,
  }));
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  fetchInsecam,
  fetchEarthCam,
  generateCameraDorks,
  generateIPSearchDorks,
  getPublicCameraStreams,
  searchExposedCameras,
  getCameraBrands,
};
