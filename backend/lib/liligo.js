'use strict';

// ============================================================================
// liligo.js — LILIGO ESP32 integration (TTGO T-Beam, LoRa, WiFi, BLE)
// ============================================================================

let SerialPort, ReadlineParser;
try {
  SerialPort = require('serialport').SerialPort;
  ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
} catch (e) {
  // serialport not installed - module will return empty results
  SerialPort = null;
  ReadlineParser = null;
}

class LiligoDetector {
  constructor() {
    this.port = null;
    this.connected = false;
    this.info = null;
    this.parser = null;
  }

  async detect() {
    if (!SerialPort) return null;
    try {
      const ports = await SerialPort.list();
      const liligo = ports.find(p =>
        p.vendorId === '10C4' && p.productId === 'EA60' ||
        p.manufacturer?.toLowerCase().includes('silicon labs') ||
        p.path?.includes('COM') && p.pnpId?.toLowerCase().includes('cp210')
      );
      return liligo || null;
    } catch (e) {
      return null;
    }
  }

  async detectAll() {
    if (!SerialPort) return [];
    try {
      const ports = await SerialPort.list();
      return ports.filter(p =>
        p.vendorId === '10C4' ||
        p.manufacturer?.toLowerCase().includes('silicon') ||
        p.manufacturer?.toLowerCase().includes('ch340') ||
        p.manufacturer?.toLowerCase().includes('ftdi')
      );
    } catch (e) {
      return [];
    }
  }

  async connect(path, baud = 115200) {
    if (!SerialPort) throw new Error('serialport not installed - run: npm install serialport');
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path, baudRate: baud, autoOpen: false });
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.port.open((err) => {
        if (err) return reject(err);
        this.connected = true;
        this.parser.on('data', (line) => this._onData(line));
        resolve(true);
      });
    });
  }

  _onData(line) {
    this._lastResponse = line;
    if (this._pendingResolve) {
      this._pendingResolve(line);
      this._pendingResolve = null;
    }
  }

  async sendCommand(cmd, timeout = 5000) {
    if (!this.connected) throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Command timeout')), timeout);
      this._pendingResolve = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      this.port.write(cmd + '\r\n');
    });
  }

  async getInfo() {
    try {
      const chip = await this.sendCommand('esptool.py chip_id');
      const firmware = await this.sendCommand('get_version');
      this.info = { chip, firmware, connected: true };
      return this.info;
    } catch (e) {
      return { connected: false, error: e.message };
    }
  }

  async scanWiFi() {
    try {
      const result = await this.sendCommand('wifi_scan');
      return result.split('\n').map(line => {
        const [ssid, rssi, bssid, channel] = line.split(',');
        return { ssid, rssi: parseInt(rssi), bssid, channel: parseInt(channel) };
      }).filter(w => w.ssid);
    } catch (e) {
      return [];
    }
  }

  async scanBLE() {
    try {
      const result = await this.sendCommand('ble_scan');
      return result.split('\n').map(line => {
        const [name, address, rssi] = line.split(',');
        return { name, address, rssi: parseInt(rssi) };
      }).filter(b => b.address);
    } catch (e) {
      return [];
    }
  }

  async scanLoRa(frequency = 868) {
    try {
      const result = await this.sendCommand(`lora_scan --freq ${frequency}`);
      return result.split('\n').filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async sendIR(signal) {
    return this.sendCommand(`ir_send ${signal}`);
  }

  async learnIR() {
    return this.sendCommand('ir_learn 30');
  }

  async sendRFID(type, data) {
    return this.sendCommand(`rfid_send --type ${type} --data ${data}`);
  }

  async runScript(script) {
    return this.sendCommand(`run_script ${script}`);
  }

  disconnect() {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.connected = false;
  }
}

const liligo = new LiligoDetector();

module.exports = {
  detect: () => liligo.detect(),
  detectAll: () => liligo.detectAll(),
  connect: (path, baud) => liligo.connect(path, baud),
  getInfo: () => liligo.getInfo(),
  scanWiFi: () => liligo.scanWiFi(),
  scanBLE: () => liligo.scanBLE(),
  scanLoRa: (freq) => liligo.scanLoRa(freq),
  sendIR: (signal) => liligo.sendIR(signal),
  learnIR: () => liligo.learnIR(),
  sendRFID: (type, data) => liligo.sendRFID(type, data),
  runScript: (script) => liligo.runScript(script),
  disconnect: () => liligo.disconnect(),
  isConnected: () => liligo.connected,
  sendCommand: (cmd) => liligo.sendCommand(cmd),
};
