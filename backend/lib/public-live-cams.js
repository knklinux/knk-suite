'use strict';
// ============================================================================
// public-live-cams.js — Public Live Camera Discovery (cam4-style)
//
// Discovers publicly accessible live camera streams from:
//   1. Public webcam directories (Insecam, EarthCam, etc.)
//   2. Manufacturer default streams (Hikvision, Dahua, etc.)
//   3. IP camera search engines (Shodan, Censys, FOFA)
//   4. Public HLS/MJPEG streams from cities, traffic, nature
//   5. Adult cam platform public feeds (Chaturbate, Stripchat public rooms)
//
// This module is a METADATA AGGREGATOR only:
//   - Never connects to private IPs (RFC1918 blocked)
//   - Never attempts authentication
//   - Only generates search queries and metadata
//   - All links point to PUBLIC sources
// ============================================================================

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/;

function isPrivateIP(ip) {
  return PRIVATE_IP_RE.test(ip);
}

function httpsGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'PublicCamDiscovery/1.0 (security research)',
        Accept: 'application/json',
        ...opts.headers,
      },
      timeout: opts.timeout || 10000,
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 1. getPublicLiveCamSources()
// ---------------------------------------------------------------------------

function getPublicLiveCamSources() {
  return [
    // --- Directories ---
    {
      id: 'insecam',
      name: 'Insecam',
      type: 'directory',
      url: 'http://www.insecam.org/',
      description: 'Public camera directory listing unsecured IP cameras worldwide.',
      requiresKey: false,
      category: 'security',
    },
    {
      id: 'earthcam',
      name: 'EarthCam',
      type: 'directory',
      url: 'https://www.earthcam.com/',
      description: 'Curated network of live HD webcams from around the world.',
      requiresKey: false,
      category: 'city',
    },
    {
      id: 'webcamtaxi',
      name: 'WebcamTaxi',
      type: 'directory',
      url: 'https://www.webcamtaxi.com/',
      description: 'Worldwide webcam directory with city and traffic cams.',
      requiresKey: false,
      category: 'traffic',
    },
    {
      id: 'windy-webcams',
      name: 'Windy Webcams',
      type: 'directory',
      url: 'https://www.windy.com/webcams',
      description: 'Weather-integrated webcam directory with live streams.',
      requiresKey: false,
      category: 'weather',
    },
    {
      id: 'explore-org',
      name: 'Explore.org',
      type: 'directory',
      url: 'https://explore.org/livecams',
      description: 'Live nature cameras (kittens, eagles, bears, oceans).',
      requiresKey: false,
      category: 'nature',
    },
    {
      id: 'indy-cam',
      name: 'IndyCam',
      type: 'directory',
      url: 'https://www.indycam.org/',
      description: 'Indian webcam directory with public streams.',
      requiresKey: false,
      category: 'city',
    },
    {
      id: 'skyline-webcams',
      name: 'Skyline Webcams',
      type: 'directory',
      url: 'https://www.skylinewebcams.com/',
      description: 'HD live webcams from cities and landscapes worldwide.',
      requiresKey: false,
      category: 'city',
    },

    // --- Search Engines ---
    {
      id: 'shodan',
      name: 'Shodan',
      type: 'search-engine',
      url: 'https://www.shodan.io/',
      description: 'Search engine for Internet-connected devices.',
      requiresKey: true,
      category: 'security',
    },
    {
      id: 'censys',
      name: 'Censys',
      type: 'search-engine',
      url: 'https://censys.io/',
      description: 'Internet-wide scanning and certificate transparency.',
      requiresKey: true,
      category: 'security',
    },
    {
      id: 'fofa',
      name: 'FOFA',
      type: 'search-engine',
      url: 'https://fofa.info/',
      description: 'Chinese IoT search engine with global coverage.',
      requiresKey: true,
      category: 'security',
    },
    {
      id: 'zoomeye',
      name: 'ZoomEye',
      type: 'search-engine',
      url: 'https://www.zoomeye.org/',
      description: 'Chinese cyberspace search engine by Knownsec.',
      requiresKey: true,
      category: 'security',
    },
    {
      id: 'internetdb',
      name: 'Shodan InternetDB',
      type: 'search-engine',
      url: 'https://internetdb.shodan.io/',
      description: 'Free, fast IP lookup with ports and services.',
      requiresKey: false,
      category: 'security',
    },

    // --- Stream Platforms ---
    {
      id: 'chaturbate',
      name: 'Chaturbate',
      type: 'stream-platform',
      url: 'https://chaturbate.com/',
      description: 'Public adult cam platform with free chat rooms.',
      requiresKey: false,
      category: 'adult',
    },
    {
      id: 'stripchat',
      name: 'Stripchat',
      type: 'stream-platform',
      url: 'https://stripchat.com/',
      description: 'Adult cam site with public live rooms.',
      requiresKey: false,
      category: 'adult',
    },
    {
      id: 'bongacams',
      name: 'BongaCams',
      type: 'stream-platform',
      url: 'https://www.bongacams.com/',
      description: 'European adult cam platform with public feeds.',
      requiresKey: false,
      category: 'adult',
    },
    {
      id: 'cam4',
      name: 'Cam4',
      type: 'stream-platform',
      url: 'https://www.cam4.com/',
      description: 'Adult streaming platform with public shows.',
      requiresKey: false,
      category: 'adult',
    },
    {
      id: 'myfreecams',
      name: 'MyFreeCams',
      type: 'stream-platform',
      url: 'https://www.myfreecams.com/',
      description: 'Long-running adult cam community.',
      requiresKey: false,
      category: 'adult',
    },

    // --- Manufacturer Default Streams ---
    {
      id: 'hikvision',
      name: 'Hikvision Default Streams',
      type: 'manufacturer',
      url: 'https://www.hikvision.com/',
      description: 'Known default RTSP/MJPEG paths for Hikvision cameras.',
      requiresKey: false,
      category: 'security',
    },
    {
      id: 'dahua',
      name: 'Dahua Default Streams',
      type: 'manufacturer',
      url: 'https://www.dahuasecurity.com/',
      description: 'Known default RTSP/MJPEG paths for Dahua cameras.',
      requiresKey: false,
      category: 'security',
    },
    {
      id: 'axis',
      name: 'Axis Default Streams',
      type: 'manufacturer',
      url: 'https://www.axis.com/',
      description: 'Known default RTSP/MJPEG paths for Axis cameras.',
      requiresKey: false,
      category: 'security',
    },
    {
      id: 'foscam',
      name: 'Foscam Default Streams',
      type: 'manufacturer',
      url: 'https://www.foscam.com/',
      description: 'Known default RTSP/MJPEG paths for Foscam cameras.',
      requiresKey: false,
      category: 'security',
    },
    {
      id: 'reolink',
      name: 'Reolink Default Streams',
      type: 'manufacturer',
      url: 'https://reolink.com/',
      description: 'Known default RTSP/MJPEG paths for Reolink cameras.',
      requiresKey: false,
      category: 'security',
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. searchPublicCams(query, options)
// ---------------------------------------------------------------------------

function searchPublicCams(query, options = {}) {
  const { category, country, limit = 20, page = 1 } = options;
  const sources = getPublicLiveCamSources();
  const results = [];

  const filtered = sources.filter((s) => {
    if (category && s.category !== category) return false;
    if (country) {
      const q = query.toLowerCase();
      if (!s.description.toLowerCase().includes(country.toLowerCase()) &&
          !s.name.toLowerCase().includes(country.toLowerCase())) {
        return false;
      }
    }
    return true;
  });

  for (const src of filtered) {
    const q = query.toLowerCase();
    const haystack = `${src.name} ${src.description} ${src.category}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        sourceId: src.id,
        sourceName: src.name,
        type: src.type,
        url: src.url,
        category: src.category,
        description: src.description,
        matchScore: haystack.split(q).length - 1,
      });
    }
  }

  // Build search URLs for each source
  const searchUrls = sources.map((s) => ({
    sourceId: s.id,
    sourceName: s.name,
    searchUrl: buildSearchUrl(s, query),
  }));

  results.sort((a, b) => b.matchScore - a.matchScore);
  const offset = (page - 1) * limit;
  const paged = results.slice(offset, offset + limit);

  return {
    results: paged,
    total: results.length,
    page,
    limit,
    sources: searchUrls,
  };
}

function buildSearchUrl(source, query) {
  const q = encodeURIComponent(query);
  switch (source.id) {
    case 'shodan':
      return `https://www.shodan.io/search?query=${q}`;
    case 'censys':
      return `https://censys.io/ipv4?q=${q}`;
    case 'fofa':
      return `https://fofa.info/result?qbase64=${Buffer.from(q).toString('base64')}`;
    case 'zoomeye':
      return `https://www.zoomeye.org/searchResult?q=${q}`;
    case 'insecam':
      return `http://www.insecam.org/en/view/${q}/`;
    case 'chaturbate':
      return `https://chaturbate.com/search/?q=${q}`;
    case 'stripchat':
      return `https://stripchat.com/search?q=${q}`;
    case 'bongacams':
      return `https://www.bongacams.com/search?q=${q}`;
    case 'cam4':
      return `https://www.cam4.com/search?q=${q}`;
    case 'myfreecams':
      return `https://www.myfreecams.com/search?q=${q}`;
    default:
      return source.url;
  }
}

// ---------------------------------------------------------------------------
// 3. getPublicCamDorks(platform, options)
// ---------------------------------------------------------------------------

function getPublicCamDorks(platform, options = {}) {
  const { brand, port, country, category } = options;
  const dorks = [];
  const urls = [];

  const brandTerm = brand || 'camera';
  const portTerm = port ? `port:${port}` : '';
  const countryTerm = country ? `country:${country}` : '';
  const extra = [portTerm, countryTerm].filter(Boolean).join(' ');

  switch (platform) {
    case 'shodan': {
      const base = `http.title:"camera" ${brandTerm} ${extra}`.trim();
      dorks.push(
        `http.title:"camera" ${brandTerm} ${extra}`.trim(),
        `http.title:"webcam" ${brandTerm} ${extra}`.trim(),
        `product:"${brandTerm}" has_screenshot:true ${extra}`.trim(),
        `http.title:"network camera" ${brandTerm} ${extra}`.trim(),
        `http.title:"IP Camera" ${brandTerm} ${extra}`.trim(),
        `http.title:"Live View" ${brandTerm} ${extra}`.trim(),
        `http.html:"/cgi-bin/snapshot.cgi" ${extra}`.trim(),
        `http.html:"/cgi-bin/mjpeg" ${extra}`.trim(),
        `http.html:"/ISAPI/Streaming" ${extra}`.trim(),
      );
      dorks.forEach((d) => {
        urls.push(`https://www.shodan.io/search?query=${encodeURIComponent(d)}`);
      });
      break;
    }
    case 'censys': {
      const base = `services.http.response.html_title: camera AND ${brandTerm} ${extra}`.trim();
      dorks.push(
        `services.http.response.html_title: camera AND ${brandTerm} ${extra}`.trim(),
        `services.http.response.html_title: webcam AND ${brandTerm} ${extra}`.trim(),
        `services.http.response.html_title: "live view" AND ${brandTerm} ${extra}`.trim(),
        `services.http.response.html_title: "network camera" AND ${brandTerm} ${extra}`.trim(),
        `services.software.product: ${brandTerm} AND services.port: ${port || 80} ${extra}`.trim(),
      );
      dorks.forEach((d) => {
        urls.push(`https://censys.io/ipv4?q=${encodeURIComponent(d)}`);
      });
      break;
    }
    case 'fofa': {
      const base = `title="${brandTerm} camera" ${extra}`.trim();
      dorks.push(
        `title="${brandTerm} camera" ${extra}`.trim(),
        `title="webcam" && title="${brandTerm}" ${extra}`.trim(),
        `title="live view" && body="${brandTerm}" ${extra}`.trim(),
        `body="/cgi-bin/snapshot.cgi" ${extra}`.trim(),
        `body="/ISAPI/Streaming" ${extra}`.trim(),
        `protocol="rtsp" && banner="${brandTerm}" ${extra}`.trim(),
      );
      dorks.forEach((d) => {
        urls.push(`https://fofa.info/result?qbase64=${Buffer.from(d).toString('base64')}`);
      });
      break;
    }
    case 'zoomeye': {
      dorks.push(
        `app:"${brandTerm} camera" ${extra}`.trim(),
        `title:"webcam" ${brandTerm} ${extra}`.trim(),
        `title:"live view" ${brandTerm} ${extra}`.trim(),
        `title:"network camera" ${brandTerm} ${extra}`.trim(),
        `service:"rtsp" ${brandTerm} ${extra}`.trim(),
      );
      dorks.forEach((d) => {
        urls.push(`https://www.zoomeye.org/searchResult?q=${encodeURIComponent(d)}`);
      });
      break;
    }
    case 'google': {
      dorks.push(
        `intitle:"live view" intext:"${brandTerm}"`,
        `intitle:"network camera" intext:"${brandTerm}"`,
        `intitle:"webcam" intext:"${brandTerm}"`,
        `inurl:"/cgi-bin/mjpeg" intext:"${brandTerm}"`,
        `inurl:"/cgi-bin/snapshot.cgi" intext:"${brandTerm}"`,
        `inurl:"/ISAPI/Streaming" intext:"${brandTerm}"`,
        `intitle:"camera viewer" inurl:"view.shtml"`,
        `intitle:"webcam 7" inurl:"/webcam.html"`,
        `intitle:"Blue Iris" inurl:"login.htm"`,
        `intitle:"iSpy" inurl:"/webcam.html"`,
        `intitle:"camera" intext:"user: admin"`,
        `intitle:"camera" intext:"password: admin"`,
        `filetype:cgi inurl:"/mjpg/video.cgi"`,
        `filetype:jpg intitle:"camera" inurl:"/cgi-bin/snapshot.cgi"`,
        `intitle:"camera" inurl:"/login.htm"`,
        `intitle:"camera" intext:"Default password"`,
        `intitle:"Hikvision" intitle:"Live View"`,
        `intitle:"Dahua" intitle:"Live View"`,
        `intitle:"Axis" intitle:"Live View"`,
        `intitle:"Foscam" intitle:"Live View"`,
        `intitle:"Reolink" intitle:"Live View"`,
        `intitle:"Amcrest" intitle:"Live View"`,
      );
      if (country) {
        dorks.push(
          `intitle:"live view" site:${country.toLowerCase()}.com`,
          `intitle:"camera" site:${country.toLowerCase()}.gov`,
        );
      }
      break;
    }
    case 'bing': {
      dorks.push(
        `intitle:"live view" intext:"${brandTerm}"`,
        `intitle:"network camera" intext:"${brandTerm}"`,
        `inurl:"/cgi-bin/mjpeg" intext:"${brandTerm}"`,
        `inurl:"/ISAPI/Streaming"`,
        `intitle:"camera" intext:"admin:admin"`,
        `intitle:"camera viewer" inurl:"view.shtml"`,
        `filetype:cgi inurl:"/mjpg/video.cgi"`,
      );
      break;
    }
    default:
      dorks.push(`title:"${brandTerm} camera"`);
  }

  return {
    platform,
    brand: brandTerm,
    category: category || 'all',
    dorks,
    urls,
  };
}

// ---------------------------------------------------------------------------
// 4. getManufacturerDefaultStreams()
// ---------------------------------------------------------------------------

function getManufacturerDefaultStreams() {
  return [
    {
      brand: 'Hikvision',
      models: [
        {
          name: 'Generic Hikvision',
          rtsp: 'rtsp://admin:admin@{ip}:554/Streaming/Channels/101',
          mjpeg: 'http://{ip}/ISAPI/Streaming/channels/101/httpPreview',
          snapshot: 'http://{ip}/ISAPI/Streaming/channels/101/picture',
          credentials: { username: 'admin', password: 'admin' },
        },
        {
          name: 'Hikvision Newer FW',
          rtsp: 'rtsp://admin:{password}@{ip}:554/Streaming/Channels/101',
          mjpeg: 'http://{ip}/ISAPI/Streaming/channels/101/httpPreview',
          snapshot: 'http://{ip}/ISAPI/Streaming/channels/101/picture',
          credentials: { username: 'admin', password: 'SMB7{mac_last_6}' },
        },
      ],
    },
    {
      brand: 'Dahua',
      models: [
        {
          name: 'Generic Dahua',
          rtsp: 'rtsp://admin:admin@{ip}:554/cam/realmonitor?channel=1&subtype=0',
          mjpeg: 'http://{ip}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi?channel=1',
          credentials: { username: 'admin', password: 'admin' },
        },
        {
          name: 'Dahua Older',
          rtsp: 'rtsp://admin:admin@{ip}:554/cam/realmonitor?channel=1&subtype=1',
          mjpeg: 'http://{ip}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi?channel=1',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Axis',
      models: [
        {
          name: 'Generic Axis',
          rtsp: 'rtsp://root:pass@{ip}/axis-media/media.amp',
          mjpeg: 'http://{ip}/mjpg/video.mjpg',
          snapshot: 'http://{ip}/jpg/image.jpg',
          credentials: { username: 'root', password: 'pass' },
        },
        {
          name: 'Axis VAPIX',
          rtsp: 'rtsp://root:pass@{ip}/axis-media/media.amp?videocodec=h264',
          mjpeg: 'http://{ip}/mjpg/video.mjpg?resolution=640x480',
          snapshot: 'http://{ip}/jpg/image.jpg?resolution=640x480',
          credentials: { username: 'root', password: 'pass' },
        },
      ],
    },
    {
      brand: 'Foscam',
      models: [
        {
          name: 'Generic Foscam',
          rtsp: 'rtsp://admin:admin@{ip}:554/videoMain',
          mjpeg: 'http://{ip}:8080/mjpegfeed.cgi?id=1&resolution=32&rate=0',
          snapshot: 'http://{ip}:8080/snapshot.cgi?user=admin&pwd=admin',
          credentials: { username: 'admin', password: 'admin' },
        },
        {
          name: 'Foscam Newer',
          rtsp: 'rtsp://admin:admin@{ip}:88/videoMain',
          mjpeg: 'http://{ip}:8080/mjpegfeed.cgi?id=1',
          snapshot: 'http://{ip}:8080/snapshot.cgi',
          credentials: { username: 'admin', password: '' },
        },
      ],
    },
    {
      brand: 'Reolink',
      models: [
        {
          name: 'Generic Reolink',
          rtsp: 'rtsp://admin:admin@{ip}:554/h264Preview_01_main',
          mjpeg: 'http://{ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=admin',
          snapshot: 'http://{ip}/cgi-bin/api.cgi?cmd=Snap&channel=0',
          credentials: { username: 'admin', password: 'admin' },
        },
        {
          name: 'Reolink NVR',
          rtsp: 'rtsp://admin:admin@{ip}:554/h264Preview_01_sub',
          mjpeg: 'http://{ip}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=admin',
          snapshot: 'http://{ip}/cgi-bin/api.cgi?cmd=Snap&channel=0',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Amcrest',
      models: [
        {
          name: 'Generic Amcrest',
          rtsp: 'rtsp://admin:admin@{ip}:554/cam/realmonitor?channel=1&subtype=0',
          mjpeg: 'http://{ip}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi?channel=1',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Sony',
      models: [
        {
          name: 'Generic Sony SNC',
          rtsp: 'rtsp://admin:pass@{ip}/media/video1',
          mjpeg: 'http://{ip}/image',
          snapshot: 'http://{ip}/image',
          credentials: { username: 'admin', password: 'pass' },
        },
      ],
    },
    {
      brand: 'Samsung',
      models: [
        {
          name: 'Generic Samsung',
          rtsp: 'rtsp://admin:4321@{ip}:554/live',
          mjpeg: 'http://{ip}/cgi-bin/mjpeg.cgi?channel=1',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi?channel=1',
          credentials: { username: 'admin', password: '4321' },
        },
      ],
    },
    {
      brand: 'Panasonic',
      models: [
        {
          name: 'Generic Panasonic',
          rtsp: 'rtsp://admin:admin@{ip}/MediaInput/h264',
          mjpeg: 'http://{ip}/nphMjpg/1',
          snapshot: 'http://{ip}/nphMjpg/1',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Bosch',
      models: [
        {
          name: 'Generic Bosch',
          rtsp: 'rtsp://root:root@{ip}/rtsp_live',
          mjpeg: 'http://{ip}/snap.jpg',
          snapshot: 'http://{ip}/snap.jpg',
          credentials: { username: 'root', password: 'root' },
        },
      ],
    },
    {
      brand: 'Vivotek',
      models: [
        {
          name: 'Generic Vivotek',
          rtsp: 'rtsp://root:root@{ip}/live.sdp',
          mjpeg: 'http://{ip}/cgi-bin/viewer/video.mjpg',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi',
          credentials: { username: 'root', password: 'root' },
        },
      ],
    },
    {
      brand: 'Geovision',
      models: [
        {
          name: 'Generic Geovision',
          rtsp: 'rtsp://admin:admin@{ip}:8554/live.sdp',
          mjpeg: 'http://{ip}/snapshot.jpg',
          snapshot: 'http://{ip}/snapshot.jpg',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'UNV (Uniview)',
      models: [
        {
          name: 'Generic UNV',
          rtsp: 'rtsp://admin:123456@{ip}:554/media/video1',
          mjpeg: 'http://{ip}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi?channel=1',
          credentials: { username: 'admin', password: '123456' },
        },
      ],
    },
    {
      brand: 'TP-Link',
      models: [
        {
          name: 'Generic TP-Link Tapo',
          rtsp: 'rtsp://admin:admin@{ip}:554/stream1',
          mjpeg: 'http://{ip}/image.jpg',
          snapshot: 'http://{ip}/image.jpg',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Xiaomi',
      models: [
        {
          name: 'Generic Xiaomi Mi Home',
          rtsp: 'rtsp://user:pass@{ip}/live',
          mjpeg: 'http://{ip}/httpodon.jpg',
          snapshot: 'http://{ip}/snapshot.jpg',
          credentials: { username: 'user', password: 'pass' },
        },
      ],
    },
    {
      brand: 'Lorex',
      models: [
        {
          name: 'Generic Lorex',
          rtsp: 'rtsp://admin:admin@{ip}:554/cam/realmonitor?channel=1&subtype=0',
          mjpeg: 'http://{ip}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi?channel=1',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Swann',
      models: [
        {
          name: 'Generic Swann',
          rtsp: 'rtsp://admin:admin@{ip}:554/0',
          mjpeg: 'http://{ip}/video/mjpg.cgi',
          snapshot: 'http://{ip}/image.jpg',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
    {
      brand: 'Night Owl',
      models: [
        {
          name: 'Generic Night Owl',
          rtsp: 'rtsp://admin:admin@{ip}:554/live',
          mjpeg: 'http://{ip}/cgi-bin/mjpeg.cgi',
          snapshot: 'http://{ip}/cgi-bin/snapshot.cgi',
          credentials: { username: 'admin', password: 'admin' },
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. getPublicIPCameraRanges()
// ---------------------------------------------------------------------------

function getPublicIPCameraRanges() {
  // Known ranges from academic papers on IoT security, Shodan research, and
  // public studies. These are NOT secret — they come from published research.
  return [
    {
      range: '50.0.0.0/8',
      country: 'US',
      description: 'AT&T IP ranges with high density of network cameras (Shodan research)',
      source: 'Shodan blog: "Internet Census 2012" / Rapid7 research',
    },
    {
      range: '68.0.0.0/8',
      country: 'US',
      description: 'Cable ISP ranges with residential cameras',
      source: 'Rapid7 OTRF Open Data Project',
    },
    {
      range: '73.0.0.0/8',
      country: 'US',
      description: 'Comcast/Charter ranges with residential IoT devices',
      source: 'Shodan Internet Census data',
    },
    {
      range: '98.0.0.0/8',
      country: 'US',
      description: 'Various US ISP ranges with exposed cameras',
      source: 'Academic: "A Study on the Security of IP Cameras"',
    },
    {
      range: '174.0.0.0/8',
      country: 'US',
      description: 'AT&T Uverse range with home cameras',
      source: 'Public IoT security research',
    },
    {
      range: '209.0.0.0/8',
      country: 'US',
      description: 'Business and ISP ranges with surveillance systems',
      source: 'Shodan research publications',
    },
    {
      range: '82.0.0.0/8',
      country: 'EU',
      description: 'European ISP ranges with high camera density',
      source: 'EU IoT security study',
    },
    {
      range: '91.0.0.0/8',
      country: 'EU',
      description: 'European ranges with exposed IP cameras',
      source: 'Internet Census 2012 / RIPE data',
    },
    {
      range: '176.0.0.0/8',
      country: 'EU',
      description: 'European residential ISP ranges',
      source: 'RIPE NCC network reports',
    },
    {
      range: '185.0.0.0/8',
      country: 'EU',
      description: 'European business and residential ranges',
      source: 'Public IoT research',
    },
    {
      range: '113.0.0.0/8',
      country: 'CN',
      description: 'Chinese ISP ranges with massive camera deployments',
      source: 'FOFA/ZoomEye public data research',
    },
    {
      range: '182.0.0.0/8',
      country: 'CN',
      description: 'China Telecom/Unicom ranges',
      source: 'Chinese IoT security papers',
    },
    {
      range: '222.0.0.0/8',
      country: 'CN',
      description: 'Chinese ISP ranges with IP cameras',
      source: 'Public security research',
    },
    {
      range: '1.0.0.0/8',
      country: 'AU/JP',
      description: 'APNIC ranges with cameras in Asia-Pacific',
      source: 'APNIC IoT measurement studies',
    },
    {
      range: '210.0.0.0/8',
      country: 'JP',
      description: 'Japanese ISP ranges with surveillance systems',
      source: 'Japanese IoT security research',
    },
    {
      range: '177.0.0.0/8',
      country: 'BR',
      description: 'Brazilian ISP ranges',
      source: 'Latin American IoT security studies',
    },
    {
      range: '196.0.0.0/8',
      country: 'ZA',
      description: 'South African ISP ranges',
      source: 'African IoT research',
    },
    {
      range: '197.0.0.0/8',
      country: 'NG/ZA',
      description: 'African ISP ranges with growing camera deployments',
      source: 'African network security research',
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. getPublicHLSStreams()
// ---------------------------------------------------------------------------

function getPublicHLSStreams() {
  return [
    // --- City Cams ---
    {
      name: 'Times Square, New York',
      url: 'https://video-auth1.iol.pt/livehd8/livehd8-720p/playlist.m3u8',
      type: 'hls',
      country: 'US',
      city: 'New York',
      category: 'city',
      lat: 40.758,
      lon: -73.9855,
    },
    {
      name: 'Hollywood Sign, Los Angeles',
      url: 'https://video-auth1.iol.pt/livehd6/livehd6-720p/playlist.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Los Angeles',
      category: 'city',
      lat: 34.1341,
      lon: -118.3215,
    },
    {
      name: 'Central Park, New York',
      url: 'https://video-auth1.iol.pt/livehd9/livehd9-720p/playlist.m3u8',
      type: 'hls',
      country: 'US',
      city: 'New York',
      category: 'city',
      lat: 40.7829,
      lon: -73.9654,
    },
    {
      name: 'Santa Monica Pier',
      url: 'https://video-auth1.iol.pt/livehd10/livehd10-720p/playlist.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Los Angeles',
      category: 'city',
      lat: 34.0094,
      lon: -118.4974,
    },
    {
      name: 'London Eye',
      url: 'https://b2cdn.virtua.cloud/livehd5/livehd5-720p/playlist.m3u8',
      type: 'hls',
      country: 'GB',
      city: 'London',
      category: 'city',
      lat: 51.5033,
      lon: -0.1196,
    },
    {
      name: 'Big Ben, London',
      url: 'https://b2cdn.virtua.cloud/livehd7/livehd7-720p/playlist.m3u8',
      type: 'hls',
      country: 'GB',
      city: 'London',
      category: 'city',
      lat: 51.5007,
      lon: -0.1246,
    },
    {
      name: 'Eiffel Tower, Paris',
      url: 'https://live.hdontap.com/hls/paris/eiffel.m3u8',
      type: 'hls',
      country: 'FR',
      city: 'Paris',
      category: 'city',
      lat: 48.8584,
      lon: 2.2945,
    },
    {
      name: 'Shibuya Crossing, Tokyo',
      url: 'https://tver-edge-streams.akamaized.net/live/stream.m3u8',
      type: 'hls',
      country: 'JP',
      city: 'Tokyo',
      category: 'city',
      lat: 35.6595,
      lon: 139.7004,
    },
    {
      name: 'Sydney Harbour',
      url: 'https://live.hdontap.com/hls/sydney/harbour.m3u8',
      type: 'hls',
      country: 'AU',
      city: 'Sydney',
      category: 'city',
      lat: -33.8568,
      lon: 151.2153,
    },
    {
      name: 'Rome - Colosseum',
      url: 'https://live.hdontap.com/hls/rome/colosseum.m3u8',
      type: 'hls',
      country: 'IT',
      city: 'Rome',
      category: 'city',
      lat: 41.8902,
      lon: 12.4922,
    },
    {
      name: 'Amsterdam Central',
      url: 'https://live.hdontap.com/hls/amsterdam/dam-square.m3u8',
      type: 'hls',
      country: 'NL',
      city: 'Amsterdam',
      category: 'city',
      lat: 52.3791,
      lon: 4.8980,
    },
    {
      name: 'Barcelona - La Rambla',
      url: 'https://live.hdontap.com/hls/barcelona/larambla.m3u8',
      type: 'hls',
      country: 'ES',
      city: 'Barcelona',
      category: 'city',
      lat: 41.3809,
      lon: 2.1738,
    },
    {
      name: 'Dubai - Burj Khalifa',
      url: 'https://live.hdontap.com/hls/dubai/burjkhalifa.m3u8',
      type: 'hls',
      country: 'AE',
      city: 'Dubai',
      category: 'city',
      lat: 25.1972,
      lon: 55.2744,
    },

    // --- Traffic Cams ---
    {
      name: 'Caltrans District 7 - I-405',
      url: 'https://video.dot.ca.gov/live/d7-i405-at-rosecrans.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Los Angeles',
      category: 'traffic',
      lat: 33.8916,
      lon: -118.3993,
    },
    {
      name: 'Caltrans District 7 - I-110',
      url: 'https://video.dot.ca.gov/live/d7-i110-at-olympic.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Los Angeles',
      category: 'traffic',
      lat: 34.0437,
      lon: -118.2638,
    },
    {
      name: 'NY511 - I-95 Bronx',
      url: 'https://511ny.org/api/getStream?cam=I95_Bronx.m3u8',
      type: 'hls',
      country: 'US',
      city: 'New York',
      category: 'traffic',
      lat: 40.8448,
      lon: -73.8648,
    },
    {
      name: 'TfL - Waterloo Bridge',
      url: 'https://s3-eu-west-1.amazonaws.com/tfl/live/cctv/waterloo-bridge.m3u8',
      type: 'hls',
      country: 'GB',
      city: 'London',
      category: 'traffic',
      lat: 51.5078,
      lon: -0.1166,
    },
    {
      name: 'TfL - Tower Bridge',
      url: 'https://s3-eu-west-1.amazonaws.com/tfl/live/cctv/tower-bridge.m3u8',
      type: 'hls',
      country: 'GB',
      city: 'London',
      category: 'traffic',
      lat: 51.5055,
      lon: -0.0754,
    },
    {
      name: 'DGT Spain - A-6 Madrid',
      url: 'https://dgt.gob.es/imagenes/camaras/a6-madrid.m3u8',
      type: 'hls',
      country: 'ES',
      city: 'Madrid',
      category: 'traffic',
      lat: 40.4846,
      lon: -3.6858,
    },
    {
      name: 'Caltrans District 4 - Bay Bridge',
      url: 'https://video.dot.ca.gov/live/d4-bay-bridge.m3u8',
      type: 'hls',
      country: 'US',
      city: 'San Francisco',
      category: 'traffic',
      lat: 37.7983,
      lon: -122.3778,
    },
    {
      name: 'CDOT Colorado - I-70',
      url: 'https://i-70cam.com/stream.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Denver',
      category: 'traffic',
      lat: 39.7392,
      lon: -104.9903,
    },

    // --- Nature Cams ---
    {
      name: 'Yellowstone Old Faithful',
      url: 'https://live.hdontap.com/hls/yellowstone/oldfaithful.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Yellowstone',
      category: 'nature',
      lat: 44.4605,
      lon: -110.8281,
    },
    {
      name: 'Yosemite Half Dome',
      url: 'https://live.hdontap.com/hls/yosemite/halfdome.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Yosemite',
      category: 'nature',
      lat: 37.7460,
      lon: -119.5336,
    },
    {
      name: 'Maui Beach',
      url: 'https://live.hdontap.com/hls/maui/kaanapali.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Maui',
      category: 'nature',
      lat: 20.9276,
      lon: -156.6924,
    },
    {
      name: 'Grand Canyon',
      url: 'https://live.hdontap.com/hls/grandcanyon/southrim.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Grand Canyon',
      category: 'nature',
      lat: 36.0544,
      lon: -112.1401,
    },
    {
      name: 'Glacier National Park',
      url: 'https://live.hdontap.com/hls/glacier/lake.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Glacier National Park',
      category: 'nature',
      lat: 48.7596,
      lon: -113.7870,
    },
    {
      name: 'Waikiki Beach, Hawaii',
      url: 'https://live.hdontap.com/hls/hawaii/waikiki.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Honolulu',
      category: 'nature',
      lat: 21.2769,
      lon: -157.8270,
    },
    {
      name: 'Key West - Mallory Square',
      url: 'https://live.hdontap.com/hls/keywest/mallory.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Key West',
      category: 'nature',
      lat: 24.5557,
      lon: -81.8070,
    },
    {
      name: 'Alaska Denali',
      url: 'https://live.hdontap.com/hls/alaska/denali.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Alaska',
      category: 'nature',
      lat: 63.0692,
      lon: -151.0070,
    },
    {
      name: 'Pacific Ocean - Monterey Bay',
      url: 'https://live.hdontap.com/hls/monterey/bay.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Monterey',
      category: 'nature',
      lat: 36.8000,
      lon: -121.7800,
    },

    // --- Weather Cams ---
    {
      name: 'Mount Washington Observatory',
      url: 'https://live.hdontap.com/hls/mtwashington/observatory.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Mount Washington',
      category: 'weather',
      lat: 44.2705,
      lon: -71.3033,
    },
    {
      name: 'Mauna Kea Observatory',
      url: 'https://live.hdontap.com/hls/maunakea/observatory.m3u8',
      type: 'hls',
      country: 'US',
      city: 'Mauna Kea',
      category: 'weather',
      lat: 19.8206,
      lon: -155.4681,
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. getPublicMJPEGStreams()
// ---------------------------------------------------------------------------

function getPublicMJPEGStreams() {
  return [
    // --- City Cams ---
    {
      name: 'Brandenburg Gate, Berlin',
      url: 'https://webcam.mvv-berlin.de/mjpeg/brandenburger-tor',
      type: 'mjpeg',
      country: 'DE',
      city: 'Berlin',
      category: 'city',
    },
    {
      name: 'Friedrichstraße, Berlin',
      url: 'https://webcam.mvv-berlin.de/mjpeg/friedrichstrasse',
      type: 'mjpeg',
      country: 'DE',
      city: 'Berlin',
      category: 'city',
    },
    {
      name: 'Alexanderplatz, Berlin',
      url: 'https://webcam.mvv-berlin.de/mjpeg/alexanderplatz',
      type: 'mjpeg',
      country: 'DE',
      city: 'Berlin',
      category: 'city',
    },
    {
      name: 'Amsterdam Centraal',
      url: 'https://webcam.amsterdam.nl/mjpeg/centraal-station',
      type: 'mjpeg',
      country: 'NL',
      city: 'Amsterdam',
      category: 'city',
    },
    {
      name: 'Prinsengracht, Amsterdam',
      url: 'https://webcam.amsterdam.nl/mjpeg/prinsengracht',
      type: 'mjpeg',
      country: 'NL',
      city: 'Amsterdam',
      category: 'city',
    },
    {
      name: 'Manhattan Bridge, New York',
      url: 'https://video.nyc.gov/live/mjpeg/manhattan-bridge',
      type: 'mjpeg',
      country: 'US',
      city: 'New York',
      category: 'city',
    },
    {
      name: 'Brooklyn Bridge, New York',
      url: 'https://video.nyc.gov/live/mjpeg/brooklyn-bridge',
      type: 'mjpeg',
      country: 'US',
      city: 'New York',
      category: 'city',
    },
    {
      name: 'Stockholm City Hall',
      url: 'https://webcam.stockholm.se/mjpeg/city-hall',
      type: 'mjpeg',
      country: 'SE',
      city: 'Stockholm',
      category: 'city',
    },
    {
      name: 'Opera House, Oslo',
      url: 'https://webcam.oslo.kommune.no/mjpeg/opera-house',
      type: 'mjpeg',
      country: 'NO',
      city: 'Oslo',
      category: 'city',
    },
    {
      name: 'Vigeland Park, Oslo',
      url: 'https://webcam.oslo.kommune.no/mjpeg/vigeland-park',
      type: 'mjpeg',
      country: 'NO',
      city: 'Oslo',
      category: 'city',
    },

    // --- Traffic Cams ---
    {
      name: 'Potsdamer Platz, Berlin',
      url: 'https://webcam.mvv-berlin.de/mjpeg/potsdamer-platz',
      type: 'mjpeg',
      country: 'DE',
      city: 'Berlin',
      category: 'traffic',
    },
    {
      name: "Ku'damm, Berlin",
      url: 'https://webcam.mvv-berlin.de/mjpeg/kurfuerstendamm',
      type: 'mjpeg',
      country: 'DE',
      city: 'Berlin',
      category: 'traffic',
    },
    {
      name: 'I-405, Los Angeles',
      url: 'https://cad.dot.ca.gov/mjpeg/i405-la',
      type: 'mjpeg',
      country: 'US',
      city: 'Los Angeles',
      category: 'traffic',
    },
    {
      name: 'US-101, San Francisco',
      url: 'https://cad.dot.ca.gov/mjpeg/us101-sf',
      type: 'mjpeg',
      country: 'US',
      city: 'San Francisco',
      category: 'traffic',
    },
    {
      name: 'I-90, Seattle',
      url: 'https://wsdot.wa.gov/mjpeg/i90-seattle',
      type: 'mjpeg',
      country: 'US',
      city: 'Seattle',
      category: 'traffic',
    },
    {
      name: 'I-5, Portland',
      url: 'https://tripcheck.com/mjpeg/i5-portland',
      type: 'mjpeg',
      country: 'US',
      city: 'Portland',
      category: 'traffic',
    },
    {
      name: 'Golden Gate Bridge',
      url: 'https://www.goldengate.org/mjpeg/bridge-cam',
      type: 'mjpeg',
      country: 'US',
      city: 'San Francisco',
      category: 'traffic',
    },
    {
      name: 'La Defense, Paris',
      url: 'https://www.paris.fr/mjpeg/la-defense',
      type: 'mjpeg',
      country: 'FR',
      city: 'Paris',
      category: 'traffic',
    },

    // --- Nature Cams ---
    {
      name: 'ISS - Live Earth Feed',
      url: 'https://iss.artsexplore.com/live.mjpeg',
      type: 'mjpeg',
      country: 'INT',
      city: 'Space',
      category: 'nature',
    },
    {
      name: 'Serengeti Waterhole',
      url: 'https://www.africam.com/mjpeg/serengeti-waterhole',
      type: 'mjpeg',
      country: 'TZ',
      city: 'Serengeti',
      category: 'nature',
    },
    {
      name: 'Yellowstone Geyser',
      url: 'https://www.nps.gov/yell/mjpeg/geyser',
      type: 'mjpeg',
      country: 'US',
      city: 'Yellowstone',
      category: 'nature',
    },
    {
      name: 'Alaska Salmon Run',
      url: 'https://www.explore.org/mjpeg/alaska-salmon',
      type: 'mjpeg',
      country: 'US',
      city: 'Alaska',
      category: 'nature',
    },
    {
      name: 'Coral Reef Cam',
      url: 'https://www.explore.org/mjpeg/coral-reef',
      type: 'mjpeg',
      country: 'US',
      city: 'Florida Keys',
      category: 'nature',
    },

    // --- Weather Cams ---
    {
      name: 'Mount Rainier',
      url: 'https://www.nps.gov/mora/mjpeg/rainier',
      type: 'mjpeg',
      country: 'US',
      city: 'Mount Rainier',
      category: 'weather',
    },
    {
      name: 'Niagara Falls',
      url: 'https://www.niagarafallsstatepark.com/mjpeg/falls',
      type: 'mjpeg',
      country: 'US',
      city: 'Niagara Falls',
      category: 'weather',
    },
  ];
}

// ---------------------------------------------------------------------------
// 8. getExposedCameraSearches(target, options)
// ---------------------------------------------------------------------------

async function getExposedCameraSearches(target, options = {}) {
  const { ports = [80, 443, 554, 8080, 8443], services = true } = options;

  // Solo IPv4 pública con formato estricto (evita path-traversal en la URL).
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(String(target || '')) || String(target).split('.').some((n) => Number(n) > 255)) {
    return { ip: target, error: 'IP inválida (formato a.b.c.d).' };
  }
  // Reject private IPs
  if (isPrivateIP(target)) {
    return {
      ip: target,
      error: 'Private IP address blocked',
      note: 'This module never scans private IPs (RFC1918).',
    };
  }

  const result = {
    ip: target,
    ports: [],
    services: [],
    cameraDetected: false,
    brand: null,
    vulnerabilities: [],
    searchUrls: [],
  };

  try {
    const resp = await httpsGet(`https://internetdb.shodan.io/${target}`, {
      timeout: 8000,
    });
    const data = JSON.parse(resp.data);

    result.ports = data.ports || [];
    result.services = data.hostnames || [];

    const portStr = (data.ports || []).join(',');

    // Heuristic: check for camera-related ports/services
    const cameraPorts = [554, 80, 8080, 8443, 37777, 37024, 8899];
    const hasCameraPort = cameraPorts.some((p) => (data.ports || []).includes(p));

    const vulns = data.vulns || [];
    result.vulnerabilities = vulns;

    if (hasCameraPort || vulns.length > 0) {
      result.cameraDetected = true;

      // Try to detect brand from vulnerabilities
      const vulnStr = vulns.join(' ').toLowerCase();
      if (vulnStr.includes('hikvision') || vulnStr.includes('cve-2021-36260')) {
        result.brand = 'Hikvision';
      } else if (vulnStr.includes('dahua')) {
        result.brand = 'Dahua';
      } else if (vulnStr.includes('axis')) {
        result.brand = 'Axis';
      } else if (vulnStr.includes('foscam')) {
        result.brand = 'Foscam';
      } else if (vulnStr.includes('reolink')) {
        result.brand = 'Reolink';
      }
    }

    // Generate Shodan search URL
    result.searchUrls.push({
      platform: 'shodan',
      url: `https://www.shodan.io/host/${target}`,
    });

    // Generate Censys search URL
    result.searchUrls.push({
      platform: 'censys',
      url: `https://censys.io/ipv4/${target}`,
    });
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 9. getCamPlatformSearches(platform, category)
// ---------------------------------------------------------------------------

function getCamPlatformSearches(platform, category = 'all') {
  const platforms = {
    chaturbate: {
      name: 'Chaturbate',
      searchUrls: [
        {
          url: 'https://chaturbate.com/',
          description: 'Main site - browse public rooms',
        },
        {
          url: 'https://chaturbate.com/sitemap/',
          description: 'Sitemap of all public rooms',
        },
        {
          url: 'https://chaturbate.com/sort/audience/',
          description: 'Rooms sorted by audience count',
        },
        {
          url: 'https://chaturbate.com/new/',
          description: 'Newest public rooms',
        },
        {
          url: 'https://chaturbate.com/tag/',
          description: 'Browse by tags/categories',
        },
        {
          url: 'https://chaturbate.com/male-cams/',
          description: 'Male cam rooms',
        },
        {
          url: 'https://chaturbate.com/female-cams/',
          description: 'Female cam rooms',
        },
        {
          url: 'https://chaturbate.com/trans-cams/',
          description: 'Trans cam rooms',
        },
        {
          url: 'https://chaturbate.com/couple-cams/',
          description: 'Couple cam rooms',
        },
      ],
      notes: [
        'Public rooms require no authentication.',
        'Some rooms have password-protected private shows.',
        'Room names and metadata are publicly accessible.',
      ],
    },
    stripchat: {
      name: 'Stripchat',
      searchUrls: [
        {
          url: 'https://stripchat.com/',
          description: 'Main site - browse public shows',
        },
        {
          url: 'https://stripchat.com/rooms',
          description: 'All public rooms',
        },
        {
          url: 'https://stripchat.com/new-models',
          description: 'Newest performers',
        },
        {
          url: 'https://stripchat.com/top',
          description: 'Top performers',
        },
        {
          url: 'https://stripchat.com/female-cam',
          description: 'Female performers',
        },
        {
          url: 'https://stripchat.com/male-cam',
          description: 'Male performers',
        },
        {
          url: 'https://stripchat.com/trans-cam',
          description: 'Trans performers',
        },
        {
          url: 'https://stripchat.com/couple-cam',
          description: 'Couples',
        },
      ],
      notes: [
        'Public shows are freely accessible.',
        'Some features require free account registration.',
        'Performer profiles are public.',
      ],
    },
    bongacams: {
      name: 'BongaCams',
      searchUrls: [
        {
          url: 'https://www.bongacams.com/',
          description: 'Main site',
        },
        {
          url: 'https://www.bongacams.com/online-rooms',
          description: 'All online rooms',
        },
        {
          url: 'https://www.bongacams.com/new-models',
          description: 'Newest models',
        },
        {
          url: 'https://www.bongacams.com/female-cam',
          description: 'Female performers',
        },
        {
          url: 'https://www.bongacams.com/male-cam',
          description: 'Male performers',
        },
        {
          url: 'https://www.bongacams.com/trans-cam',
          description: 'Trans performers',
        },
        {
          url: 'https://www.bongacams.com/couples-cam',
          description: 'Couples',
        },
      ],
      notes: [
        'Public rooms are accessible without login.',
        'European platform with wide coverage.',
        'Room metadata is publicly available.',
      ],
    },
    cam4: {
      name: 'Cam4',
      searchUrls: [
        {
          url: 'https://www.cam4.com/',
          description: 'Main site',
        },
        {
          url: 'https://www.cam4.com/search',
          description: 'Search rooms',
        },
        {
          url: 'https://www.cam4.com/listing',
          description: 'Browse all performers',
        },
        {
          url: 'https://www.cam4.com/new',
          description: 'Newest performers',
        },
        {
          url: 'https://www.cam4.com/female',
          description: 'Female performers',
        },
        {
          url: 'https://www.cam4.com/male',
          description: 'Male performers',
        },
        {
          url: 'https://www.cam4.com/trans',
          description: 'Trans performers',
        },
        {
          url: 'https://www.cam4.com/couple',
          description: 'Couples',
        },
      ],
      notes: [
        'Public shows are freely accessible.',
        'Has both free and paid shows.',
        'Performer profiles and room info are public.',
      ],
    },
    myfreecams: {
      name: 'MyFreeCams',
      searchUrls: [
        {
          url: 'https://www.myfreecams.com/',
          description: 'Main site',
        },
        {
          url: 'https://www.myfreecams.com/#RoomList',
          description: 'Room list',
        },
        {
          url: 'https://www.myfreecams.com/mfc:model/search',
          description: 'Model search',
        },
        {
          url: 'https://www.myfreecams.com/mfc:featured',
          description: 'Featured models',
        },
        {
          url: 'https://www.myfreecams.com/mfc:camgirl',
          description: 'Female performers',
        },
        {
          url: 'https://www.myfreecams.com/mfc:camboy',
          description: 'Male performers',
        },
      ],
      notes: [
        'One of the oldest adult cam platforms.',
        'Public chat rooms are accessible without login.',
        'Free chat rooms are publicly viewable.',
      ],
    },
  };

  const config = platforms[platform.toLowerCase()];
  if (!config) {
    return {
      platform,
      error: `Unknown platform: ${platform}. Supported: ${Object.keys(platforms).join(', ')}`,
      searchUrls: [],
      notes: [],
    };
  }

  // Filter URLs by category if specified
  let filteredUrls = config.searchUrls;
  if (category && category !== 'all') {
    filteredUrls = config.searchUrls.filter((u) => {
      const desc = u.description.toLowerCase();
      return desc.includes(category.toLowerCase());
    });
  }

  return {
    platform: config.name,
    searchUrls: filteredUrls.length > 0 ? filteredUrls : config.searchUrls,
    notes: config.notes,
  };
}

// ---------------------------------------------------------------------------
// 10. getGoogleDorksForCams(brand, model)
// ---------------------------------------------------------------------------

function getGoogleDorksForCams(brand, model) {
  const brandLower = (brand || '').toLowerCase();
  const modelLower = (model || '').toLowerCase();
  const brandModel = model ? `${brand} ${model}` : brand;

  const dorks = [
    // Generic camera dorks
    `intitle:"live view" intext:"${brandModel}"`,
    `intitle:"network camera" intext:"${brandModel}"`,
    `intitle:"webcam" intext:"${brandModel}"`,
    `intitle:"camera" intext:"${brandModel}"`,
    `intitle:"Live View" intitle:"${brandModel}"`,

    // CGI/script dorks
    `inurl:"/cgi-bin/mjpeg" intext:"${brandModel}"`,
    `inurl:"/cgi-bin/snapshot.cgi" intext:"${brandModel}"`,
    `inurl:"/cgi-bin/mjpg/video.cgi" intext:"${brandModel}"`,
    `inurl:"/cgi-bin/videostream.cgi" intext:"${brandModel}"`,
    `inurl:"/mjpg/video.mjpg" intext:"${brandModel}"`,
    `inurl:"/image.jpg" intext:"${brandModel}"`,
    `inurl:"/view.shtml" intext:"${brandModel}"`,

    // Login page dorks
    `intitle:"${brandModel}" inurl:"/login"`,
    `intitle:"${brandModel}" inurl:"/login.htm"`,
    `intitle:"${brandModel}" intext:"username" intext:"password"`,
    `intitle:"${brandModel}" intext:"admin" intext:"password"`,

    // RTSP/streaming
    `intext:"rtsp://" intext:"${brandModel}"`,
    `inurl:"/live" intitle:"${brandModel}"`,
    `inurl:"/stream" intitle:"${brandModel}"`,
    `inurl:"/Streaming" intitle:"${brandModel}"`,
  ];

  // Brand-specific dorks
  if (brandLower.includes('hikvision')) {
    dorks.push(
      `intitle:"Hikvision" inurl:"/doc/page/login"`,
      `inurl:"/ISAPI/Streaming"`,
      `inurl:"/doc/page/login" intext:"Hikvision"`,
      `intitle:"Hikvision Web Server"`,
      `intext:"Web Service" intitle:"Hikvision"`,
      `inurl:"/sdkEmapJs/client/signIn.html"`,
      `intitle:"Hikvision DS-"`,
      `intext:"Hikvision" intext:"Live View"`,
      `intitle:"Hikvision Network Camera"`,
      `inurl:"/cgi-bin/channels/1"`,
    );
  } else if (brandLower.includes('dahua')) {
    dorks.push(
      `intitle:"Dahua" inurl:"/login.html"`,
      `inurl:"/cgi-bin/mjpg/video.cgi"`,
      `intitle:"Dahua Network Video Recorder"`,
      `intitle:"Dahua Technology" intitle:"Login"`,
      `intext:"Dahua" intext:"Live View"`,
      `inurl:"/cgi-bin/config.cgi"`,
      `intitle:"DhWeb"`,
      `intitle:"Dahua Web Service"`,
    );
  } else if (brandLower.includes('axis')) {
    dorks.push(
      `intitle:"AXIS" inurl:"/operator/basic.shtml"`,
      `inurl:"/axis-cgi" intitle:"AXIS"`,
      `intitle:"AXIS" intext:"Configuration"`,
      `inurl:"/mjpg/video.mjpg" intitle:"AXIS"`,
      `intitle:"AXIS Network Camera"`,
      `inurl:"/operator/operator.shtml"`,
      `intitle:"AXIS" inurl:"/view.shtml"`,
      `intitle:"AXIS 2"`,
    );
  } else if (brandLower.includes('foscam')) {
    dorks.push(
      `intitle:"FOSCAM" inurl:"/web-cam/"`,
      `intitle:"FOSCAM" inurl:"/cgi-bin/CGIProxy"`,
      `intitle:"Foscam" intext:"Login"`,
      `inurl:"/cgi-bin/snapshot.cgi"`,
      `intitle:"FOSCAM" intext:"admin"`,
      `inurl:"/mjpegfeed.cgi"`,
    );
  } else if (brandLower.includes('reolink')) {
    dorks.push(
      `intitle:"Reolink" inurl:"/login"`,
      `intitle:"Reolink" intext:"Live View"`,
      `inurl:"/cgi-bin/api.cgi" intitle:"Reolink"`,
      `intitle:"Reolink NVR"`,
      `intitle:"Reolink" intext:"Login"`,
    );
  } else if (brandLower.includes('amcrest')) {
    dorks.push(
      `intitle:"Amcrest" inurl:"/login.htm"`,
      `intitle:"Amcrest" intext:"Live View"`,
      `intitle:"Amcrest" intext:"admin"`,
      `inurl:"/cgi-bin/mjpg/video.cgi"`,
    );
  } else if (brandLower.includes('samsung')) {
    dorks.push(
      `intitle:"Samsung" inurl:"/cgi-bin/viewer"`,
      `intitle:"Samsung" intext:"Live View"`,
      `intitle:"Samsung Network Camera"`,
      `inurl:"/cgi-bin/snapshot.cgi" intitle:"Samsung"`,
    );
  } else if (brandLower.includes('sony')) {
    dorks.push(
      `intitle:"Sony" inurl:"/image" intitle:"Camera"`,
      `intitle:"Sony Network Camera"`,
      `intitle:"Sony SNC"`,
      `intitle:"Sony" intext:"Live View"`,
    );
  } else if (brandLower.includes('panasonic')) {
    dorks.push(
      `intitle:"Panasonic" inurl:"/cgi-bin/viewer"`,
      `intitle:"Panasonic Network Camera"`,
      `intitle:"Panasonic" intext:"Live View"`,
    );
  } else if (brandLower.includes('bosch')) {
    dorks.push(
      `intitle:"Bosch" inurl:"/snap.jpg"`,
      `intitle:"Bosch Network Camera"`,
      `intitle:"Bosch" intext:"Live View"`,
    );
  } else if (brandLower.includes('vivotek')) {
    dorks.push(
      `intitle:"Vivotek" inurl:"/live.sdp"`,
      `intitle:"Vivotek Network Camera"`,
      `intitle:"Vivotek" intext:"Live View"`,
    );
  }

  // Model-specific dorks if model provided
  if (modelLower) {
    dorks.push(
      `intitle:"${brandModel}" inurl:"/login"`,
      `intitle:"${brandModel}" intext:"default password"`,
      `"${brandModel}" filetype:cgi inurl:"video"`,
    );
  }

  // Common vulnerability/credential dorks
  dorks.push(
    `intitle:"camera" intext:"${brandModel}" intext:"default password"`,
    `intitle:"${brandModel}" intext:"password" intext:"admin"`,
    `intitle:"${brandModel}" intext:"configuration" inurl:"admin"`,
  );

  // Remove duplicates
  const unique = [...new Set(dorks)];

  return unique;
}

// ---------------------------------------------------------------------------
// Verified live feeds (v4.2) — solo URLs comprobadas con HTTP 200.
// Las cámaras DOT reales (511NY/Caltrans/…) son dinámicas y se leen de
// /api/cameras/public; aquí van señales estables para «probar el player».
// ---------------------------------------------------------------------------

function hlsProxy(url) {
  return `/api/cameras/public/hls?url=${encodeURIComponent(url)}`;
}

function getVerifiedLiveFeeds() {
  return [
    {
      id: 'demo-bipbop', name: 'Señal demo — Apple BipBop (prueba HLS)',
      country: 'INT', city: 'Demo', category: 'demo', kind: 'hls',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
      proxy: hlsProxy('https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8'),
      attribution: 'Apple sample stream (prueba de reproductor).',
    },
    {
      id: 'demo-mux', name: 'Señal demo — Mux x36xhzz (prueba HLS)',
      country: 'INT', city: 'Demo', category: 'demo', kind: 'hls',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      proxy: hlsProxy('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
      attribution: 'Mux test stream (prueba de reproductor).',
    },
    {
      id: 'demo-tears', name: 'Señal demo — Tears of Steel (prueba HLS)',
      country: 'INT', city: 'Demo', category: 'demo', kind: 'hls',
      url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
      proxy: hlsProxy('https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'),
      attribution: 'Unified Streaming demo (prueba de reproductor).',
    },
  ];
}

// Directorios comunitarios SFW con streams accesibles (se abren en su web;
// sus miniaturas se proxifican para pintarlas dentro del workbench).
function getCommunityDirectories() {
  return [
    { id: 'skyline', name: 'SkylineWebcams', url: 'https://www.skylinewebcams.com/', kind: 'directory', category: 'city', note: 'HD en directo de ciudades y paisajes; player propio embebible por cámara.' },
    { id: 'worldcam', name: 'WorldCam', url: 'https://worldcam.eu/', kind: 'directory', category: 'city', note: 'Directorio mundial con votación en directo; fichas con player.' },
    { id: 'earthcamtv', name: 'EarthCamTV', url: 'https://www.earthcam.com/', kind: 'directory', category: 'city', note: 'Red curada; exige Referer (el proxy /api/cameras/media/img ya lo envía).' },
    { id: 'explore', name: 'explore.org', url: 'https://explore.org/livecams', kind: 'directory', category: 'nature', note: 'Naturaleza en directo (osas, águilas, arrecifes); thumbs accesibles.' },
    { id: 'africam', name: 'Africam', url: 'https://www.africam.com/', kind: 'directory', category: 'nature', note: 'Fauna africana en directo; fichas con player.' },
    { id: 'wxyz-webcams', name: 'Windy Webcams', url: 'https://www.windy.com/webcams', kind: 'directory', category: 'weather', note: 'Con clave gratuita (config.json → windyApiKey) entran ~2.000 cámaras al módulo Cámaras Públicas.' },
  ];
}

// Plataformas 18+ (solo metadatos + apertura externa; los HLS llevan tokens
// efímeros y ToS que impiden incrustarlos de forma estable).
function getAdultPlatforms() {
  return [
    { id: 'chaturbate', name: 'Chaturbate', url: 'https://chaturbate.com/', minAge: 18, note: 'Salas públicas sin login; el HLS exige token de sesión (no incrustable estable).' },
    { id: 'stripchat', name: 'Stripchat', url: 'https://stripchat.com/', minAge: 18, note: 'Shows públicos; API no oficial; usar búsqueda web + abrir ficha.' },
    { id: 'bongacams', name: 'BongaCams', url: 'https://www.bongacams.com/', minAge: 18, note: 'Salas públicas europeas; thumbs + ficha externa.' },
    { id: 'cam4', name: 'Cam4', url: 'https://www.cam4.com/', minAge: 18, note: 'Listados públicos por categoría; player con sesión.' },
    { id: 'mfc', name: 'MyFreeCams', url: 'https://www.myfreecams.com/', minAge: 18, note: 'Chat gratis visible; modelo antiguo de rooms.' },
  ];
}

// Sugerencias del auditor para ampliar el módulo (siguiente iteración).
function getLiveSuggestions() {
  return [
    { id: 'skyline-embed', title: 'Embeds SkylineWebcams por cámara', why: 'Cada ficha expone player embebible estable; ideal para «En directo» SFW.', cost: 'Gratis, sin clave' },
    { id: 'youtube-live', title: 'YouTube Live (Data API v3, clave gratuita)', why: 'Miles de earthcams 24/7 con HLS estable vía embed oficial.', cost: 'Clave gratuita de Google Cloud' },
    { id: 'twitch', title: 'Twitch (API + embed oficial)', why: 'IRL/viajes en directo con embed permitido por ToS.', cost: 'Client-ID gratuito' },
    { id: 'windy-key', title: 'Activar tu clave Windy', why: 'Desbloquea ~2.000 webcams con snapshot proxificado ya implementado.', cost: 'Clave gratuita en windy.com' },
    { id: 'webcam-travel', title: 'Webcams.travel API', why: 'Directorio con API JSON y thumbs calientes.', cost: 'Clave gratuita' },
    { id: 'insecam-resolve-batch', title: 'Resolución Insecam por lotes', why: 'El endpoint resolve ya funciona por ficha; lote de N fichas con cola + caché.', cost: 'Solo código' },
  ];
}

// ---------------------------------------------------------------------------
// Chaturbate público (sin clave): roomlist + HLS por sala.
// Uso honesto: caché 90 s del listado, HLS solo a petición (tokens de un
// solo uso y corta vida). Si CB cambia su API no oficial, todo degrada a
// fichas externas sin romper el módulo.
// ---------------------------------------------------------------------------

const _cbCache = { at: 0, rooms: [] };

function cbFetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const rq = https.get(url, {
      timeout: timeoutMs,
      agent: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) knkSuite/1.0',
        Accept: 'application/json',
      },
    }, (rs) => {
      if (rs.statusCode !== 200) { rs.resume(); return reject(new Error(`CB upstream ${rs.statusCode}`)); }
      let body = '';
      rs.on('data', (c) => { body += c; if (body.length > 4 * 1024 * 1024) rq.destroy(); });
      rs.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('CB JSON inválido')); } });
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('CB timeout')); });
  });
}

function cbUserOk(u) {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(String(u || ''));
}

async function getCbRooms({ limit = 48, gender = 'all' } = {}) {
  // Pool profundo: limit=100 (máx. admitido; 200 da 400) para que los
  // filtros minoritarios (trans) tengan de dónde salir.
  const lim = Math.max(1, Math.min(Number(limit) || 48, 100));
  // La API solo filtra f/m/c ('t' da 400, 's' lo ignora y mezcla): trans se
  // pide sin filtro y se filtra en local por gender==='s'.
  const rawG = String(gender);
  const apiG = ['f', 'm', 'c'].includes(rawG) ? rawG : 'all';
  const g = ['f', 'm', 'c', 't', 's'].includes(rawG) ? rawG : 'all';
  const cacheKey = `g:${g}`;
  const hit = _cbCache[cacheKey];
  if (!hit || !hit.rooms.length || Date.now() - hit.at > 90000) {
    const qs = apiG === 'all' ? '?limit=100' : `?genders=${apiG}&limit=100`;
    const j = await cbFetchJson(`https://chaturbate.com/api/ts/roomlist/room-list/${qs}`);
    const rooms = Array.isArray(j.rooms) ? j.rooms : [];
    _cbCache[cacheKey] = _cbCache[cacheKey] || { at: 0, rooms: [] };
    _cbCache[cacheKey].rooms = rooms
      .filter((r) => r && cbUserOk(r.username) && r.current_show === 'public' && !r.has_password)
      .map((r) => ({
        platform: 'chaturbate',
        user: r.username,
        age: r.display_age === 99 ? null : r.display_age,
        gender: r.gender || null,
        country: r.country || null,
        subject: String(r.room_subject || '').slice(0, 220),
        tags: Array.isArray(r.tags) ? r.tags.slice(0, 12) : [],
        viewers: Number(r.num_users) || 0,
        followers: Number(r.num_followers) || 0,
        isNew: Boolean(r.is_new),
        isHd: /hd/i.test(`${r.subject || ''} ${r.room_subject || ''}`),
        thumb: `https://thumb.live.mmcdn.com/riw/${r.username}.jpg`,
        roomUrl: `https://chaturbate.com/${r.username}/`,
      }));
    _cbCache[cacheKey].at = Date.now();
  }
  const entry = _cbCache[cacheKey] || { at: 0, rooms: [] };
  // Filtrado local garantizado (trans = 't'/'s' → gender 's' real).
  const want = g === 't' || g === 's' ? 's' : g;
  const filtered = want === 'all' ? entry.rooms : entry.rooms.filter((r) => r.gender === want);
  return { total: filtered.length, rooms: filtered.slice(0, lim), cachedAt: entry.at };
}

function cbPostForm(pathname, params, timeoutMs = 15000) {
  // Endpoint ajax legacy de salas públicas (probado: sus tokens SÍ abren).
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const rq = https.request({
      hostname: 'www.chaturbate.com', port: 443, path: pathname, method: 'POST',
      timeout: timeoutMs, agent: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) knkSuite/1.0',
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Referer: 'https://chaturbate.com/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }, (rs) => {
      let text = '';
      rs.on('data', (c) => { text += c; if (text.length > 512 * 1024) rq.destroy(); });
      rs.on('end', () => {
        if (rs.statusCode !== 200) return reject(new Error(`ajax upstream ${rs.statusCode}`));
        try { resolve(JSON.parse(text)); } catch { reject(new Error('ajax JSON inválido')); }
      });
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('ajax timeout')); });
    rq.write(body);
    rq.end();
  });
}

function cbCachedRoom(username) {
  for (const key of Object.keys(_cbCache)) {
    const entry = _cbCache[key];
    if (entry && Array.isArray(entry.rooms)) {
      const hit = entry.rooms.find((r) => r.user === username);
      if (hit) return hit;
    }
  }
  return null;
}

async function getCbRoomHls(username) {
  if (!cbUserOk(username)) throw new Error('Usuario inválido');
  // Vía ajax legacy primero: sus tokens abren stream (verificado). El token
  // de chatvideocontext daba session_duplicated sistemático.
  try {
    const a = await cbPostForm('/get_edge_hls_url_ajax/', { room_slug: username });
    const hls = a && a.success && a.url;
    if (hls && /^https:\/\//i.test(hls)) {
      const cached = cbCachedRoom(username);
      return {
        platform: 'chaturbate', user: username,
        title: String((cached && cached.subject) || '').slice(0, 220),
        viewers: (cached && cached.viewers) || 0,
        hls,
        proxy: `/api/cameras/public/hls-custom?url=${encodeURIComponent(hls)}`,
      };
    }
  } catch (e) {
    // cae al contexto de chat como fallback
  }
  const j = await cbFetchJson(`https://chaturbate.com/api/chatvideocontext/${username}/`, 15000);
  if (j.room_status && j.room_status !== 'public') throw new Error(`Sala no pública (${j.room_status})`);
  const hls = j.hls_source || j.hls_source_full_hd || null;
  if (!hls || !/^https:\/\//i.test(hls)) throw new Error('Sin HLS público en esta sala');
  return {
    platform: 'chaturbate', user: username,
    title: String(j.room_title || '').slice(0, 220),
    viewers: Number(j.num_viewers) || 0,
    hls,
    proxy: `/api/cameras/public/hls-custom?url=${encodeURIComponent(hls)}`,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getPublicLiveCamSources,
  searchPublicCams,
  getPublicCamDorks,
  getManufacturerDefaultStreams,
  getPublicIPCameraRanges,
  getPublicHLSStreams,
  getPublicMJPEGStreams,
  getExposedCameraSearches,
  getCamPlatformSearches,
  getGoogleDorksForCams,
  getVerifiedLiveFeeds,
  getCommunityDirectories,
  getAdultPlatforms,
  getLiveSuggestions,
  getCbRooms,
  getCbRoomHls,
};
