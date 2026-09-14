'use strict';

// ============================================================================
// team.js — Multi-user session sharing via WebSocket
// ============================================================================
// TeamManager handles WebSocket connections for collaborative work
// Supports chat, findings, and notes sharing between team members
// ============================================================================

const { URL } = require('url');

class TeamManager {
  constructor(wss) {
    this.wss = wss;
    this.members = new Map();
    this.chatHistory = [];
    this.maxHistory = 500;
  }

  handleConnection(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const name = url.searchParams.get('name') || `Member-${this.members.size + 1}`;
    const id = this._generateId();

    this.members.set(ws, {
      id,
      name,
      connectedAt: new Date().toISOString()
    });

    this._broadcast({
      type: 'members',
      data: this.getMembers(),
      from: name,
      timestamp: new Date().toISOString()
    });

    return { id, name };
  }

  broadcast(sender, message) {
    const msg = {
      type: 'chat',
      data: message,
      from: sender,
      timestamp: new Date().toISOString()
    };
    this._addToHistory(msg);
    this._broadcast(msg);
  }

  shareFinding(finding) {
    const msg = {
      type: 'finding',
      data: finding,
      from: finding.from || 'unknown',
      timestamp: new Date().toISOString()
    };
    this._addToHistory(msg);
    this._broadcast(msg);
  }

  shareNote(note) {
    const msg = {
      type: 'note',
      data: note,
      from: note.from || 'unknown',
      timestamp: new Date().toISOString()
    };
    this._addToHistory(msg);
    this._broadcast(msg);
  }

  getMembers() {
    const members = [];
    for (const [ws, info] of this.members) {
      members.push({
        id: info.id,
        name: info.name,
        connectedAt: info.connectedAt
      });
    }
    return members;
  }

  getChatHistory(limit = 100) {
    return this.chatHistory.slice(-Math.min(limit, this.maxHistory));
  }

  disconnect(ws) {
    const member = this.members.get(ws);
    this.members.delete(ws);

    if (member) {
      this._broadcast({
        type: 'members',
        data: this.getMembers(),
        from: member.name,
        timestamp: new Date().toISOString()
      });
    }
  }

  _broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [ws] of this.members) {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(data);
        }
      } catch (e) {
        // Ignore send errors
      }
    }
  }

  _addToHistory(msg) {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > this.maxHistory) {
      this.chatHistory.shift();
    }
  }

  _generateId() {
    return `tm-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;
  }
}

module.exports = { TeamManager };
