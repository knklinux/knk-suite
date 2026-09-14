'use strict';

// ============================================================================
// flipper.js — Flipper Zero USB integration
// Detecta Flipper Zero por USB serial y envía comandos
// ============================================================================

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const path = require('path');
const fs = require('fs');

class FlipperDetector {
  constructor() {
    this.port = null;
    this.connected = false;
    this.info = null;
    this.parser = null;
  }

  async detect() {
    try {
      const ports = await SerialPort.list();
      const flipper = ports.find(p =>
        p.vendorId === '0483' && p.productId === 'df11' ||
        p.manufacturer?.toLowerCase().includes('stm') ||
        p.path?.includes('Flipper') ||
        p.serialNumber?.includes('flipper')
      );
      return flipper || null;
    } catch (e) {
      return null;
    }
  }

  async connect(path) {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path, baudRate: 115200, autoOpen: false });
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
      const name = await this.sendCommand('device_info');
      const fw = await this.sendCommand('version_get');
      this.info = { name, firmware: fw, connected: true };
      return this.info;
    } catch (e) {
      return { connected: false, error: e.message };
    }
  }

  async listApps() {
    try {
      const apps = await this.sendCommand('app_list');
      return apps.split(',').map(a => a.trim());
    } catch (e) {
      return [];
    }
  }

  async runApp(appId, args = '') {
    return this.sendCommand(`app_start ${appId} ${args}`);
  }

  disconnect() {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.connected = false;
  }
}

// Singleton
const flipper = new FlipperDetector();

module.exports = {
  detect: () => flipper.detect(),
  connect: (path) => flipper.connect(path),
  getInfo: () => flipper.getInfo(),
  listApps: () => flipper.listApps(),
  runApp: (appId, args) => flipper.runApp(appId, args),
  disconnect: () => flipper.disconnect(),
  isConnected: () => flipper.connected,
  sendCommand: (cmd) => flipper.sendCommand(cmd),
};
