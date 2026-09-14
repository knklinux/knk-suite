'use strict';

// ============================================================================
// liligo-real.js — Real serial port integration for LILIGO ESP32 board
// ============================================================================
// Scans serial ports for LILIGO board (CH340, CP2102, ESP32-S3)
// Uses child_process.execSync for port detection when serialport unavailable
// ============================================================================

const { execSync } = require('child_process');

let SerialPort;
try {
  SerialPort = require('serialport').SerialPort;
} catch (e) {
  SerialPort = null;
}

const VENDOR_IDS = {
  '1A86': 'CH340',
  '10C4': 'CP2102',
  '303A': 'ESP32-S3'
};

function scanSerialPorts() {
  const ports = [];
  try {
    if (process.platform === 'win32') {
      const output = execSync('mode', { encoding: 'utf8', timeout: 5000 });
      const comPorts = output.match(/COM\d+/g) || [];
      for (const port of comPorts) {
        ports.push({ path: port, vendorId: null, description: port });
      }
    } else if (process.platform === 'linux') {
      const output = execSync('ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true', { encoding: 'utf8', timeout: 5000 });
      const devicePaths = output.trim().split('\n').filter(Boolean);
      for (const device of devicePaths) {
        ports.push({ path: device, vendorId: null, description: device });
      }
    } else if (process.platform === 'darwin') {
      const output = execSync('ls /dev/cu.* 2>/dev/null || true', { encoding: 'utf8', timeout: 5000 });
      const devicePaths = output.trim().split('\n').filter(Boolean);
      for (const device of devicePaths) {
        ports.push({ path: device, vendorId: null, description: device });
      }
    }
  } catch (e) {
    // Command failed, return empty
  }
  return ports;
}

async function detectBoard() {
  if (!SerialPort) {
    return { found: false, port: null, description: null, hint: 'serialport not installed' };
  }

  try {
    const ports = await SerialPort.list();
    for (const port of ports) {
      const vendor = port.vendorId?.toUpperCase();
      if (VENDOR_IDS[vendor]) {
        return {
          found: true,
          port: port.path,
          description: `${VENDOR_IDS[vendor]} (${port.path})`,
          vendorId: vendor,
          manufacturer: port.manufacturer
        };
      }
    }
  } catch (e) {
    // Fallback to manual scan
  }

  const manualPorts = scanSerialPorts();
  for (const port of manualPorts) {
    if (port.path.match(/COM\d+|ttyUSB|ttyACM|cu\./)) {
      return {
        found: true,
        port: port.path,
        description: port.description,
        vendorId: null,
        manufacturer: 'detected via scan'
      };
    }
  }

  return { found: false, port: null, description: null };
}

async function connect(port, baudRate = 115200) {
  if (!SerialPort) {
    return { ok: false, error: 'serialport not installed', hint: 'Run: npm install serialport' };
  }

  try {
    const serialPort = new SerialPort({ path: port, baudRate: parseInt(baudRate, 10) || 115200 });
    await new Promise((resolve, reject) => {
      serialPort.on('open', resolve);
      serialPort.on('error', reject);
    });
    return { ok: true, port: serialPort };
  } catch (e) {
    return { ok: false, error: e.message, hint: 'Check port and baud rate' };
  }
}

async function sendCommand(port, cmd) {
  if (!SerialPort) {
    return { ok: false, error: 'serialport not installed', hint: 'Run: npm install serialport' };
  }

  return new Promise((resolve) => {
    let response = '';
    let resolved = false;

    const onData = (data) => {
      response += data.toString();
      if (response.includes('OK') || response.includes('ERROR') || response.includes('>') || response.includes('\r\n')) {
        if (!resolved) {
          resolved = true;
          try { port.removeListener('data', onData); } catch {}
          resolve({ ok: true, response: response.trim() });
        }
      }
    };

    port.on('data', onData);
    port.write(cmd + '\r\n');

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { port.removeListener('data', onData); } catch {}
        resolve({ ok: true, response: response.trim() || 'OK' });
      }
    }, 5000);
  });
}

async function scanWifi(port) {
  if (!SerialPort) {
    return { ok: false, error: 'serialport not installed', hint: 'Run: npm install serialport' };
  }

  try {
    const result = await sendCommand(port, 'AT+CWLAP');
    if (!result.ok) return { ok: false, error: result.error };

    const networks = [];
    const lines = result.response.split('\n');
    for (const line of lines) {
      const match = line.match(/\+CWLAP:\s*\((\d+),"([^"]+)",(-?\d+),"([^"]+)",(\d+),(\d+),(\d+)/);
      if (match) {
        networks.push({
          ssid: match[2],
          rssi: parseInt(match[3], 10),
          bssid: match[4],
          channel: parseInt(match[5], 10),
          authMode: match[6]
        });
      }
    }
    return { ok: true, networks };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function scanBle(port) {
  if (!SerialPort) {
    return { ok: false, error: 'serialport not installed', hint: 'Run: npm install serialport' };
  }

  try {
    const result = await sendCommand(port, 'AT+BLESCAN');
    if (!result.ok) return { ok: false, error: result.error };

    const devices = [];
    const lines = result.response.split('\n');
    for (const line of lines) {
      const match = line.match(/\+BLESCAN:\s*"([^"]+)",\s*"([^"]+)",\s*(-?\d+)/);
      if (match) {
        devices.push({
          name: match[1],
          address: match[2],
          rssi: parseInt(match[3], 10)
        });
      }
    }
    return { ok: true, devices };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getInfo(port) {
  if (!SerialPort) {
    return { ok: false, error: 'serialport not installed', hint: 'Run: npm install serialport' };
  }

  try {
    const result = await sendCommand(port, 'AT+GMR');
    if (!result.ok) return { ok: false, error: result.error };

    const info = {};
    const lines = result.response.split('\n');
    for (const line of lines) {
      if (line.includes('AT version:')) info.atVersion = line.split(':')[1]?.trim();
      if (line.includes('SDK version:')) info.sdkVersion = line.split(':')[1]?.trim();
      if (line.includes('compile time:')) info.compileTime = line.split(':')[1]?.trim();
      if (line.includes('Bin version:')) info.binVersion = line.split(':')[1]?.trim();
      if (line.includes('v')) info.version = line.trim();
    }
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function disconnect(port) {
  if (!SerialPort) {
    return { ok: false, error: 'serialport not installed', hint: 'Run: npm install serialport' };
  }

  try {
    if (port && port.isOpen) {
      port.close();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  detectBoard,
  connect,
  sendCommand,
  scanWifi,
  scanBle,
  getInfo,
  disconnect,
  VENDOR_IDS
};
