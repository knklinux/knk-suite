const MAX_HISTORY = 100;
const VALID_TYPES = ['scan_complete', 'vulnerability_found', 'tool_installed', 'error', 'info'];

class AlertManager {
  constructor(wss) {
    this.wss = wss;
    this.subscribers = new Set();
    // OJO: se llama `items` y no `history` porque la propiedad tapaba al
    // método history() y get().history(limit) reventaba (TypeError).
    this.items = [];
  }

  subscribe(ws) {
    this.subscribers.add(ws);
  }

  unsubscribe(ws) {
    this.subscribers.delete(ws);
  }

  emit(type, data) {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`Invalid alert type: ${type}. Valid types: ${VALID_TYPES.join(', ')}`);
    }

    const alert = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      type,
      data,
      timestamp: Date.now()
    };

    this.items.unshift(alert);
    if (this.items.length > MAX_HISTORY) {
      this.items = this.items.slice(0, MAX_HISTORY);
    }

    const message = JSON.stringify(alert);
    for (const client of this.subscribers) {
      if (client.readyState === 1) {
        try {
          client.send(message);
        } catch (err) {
          this.subscribers.delete(client);
        }
      }
    }

    return alert;
  }

  history(limit = 50) {
    return this.items.slice(0, limit);
  }
}

module.exports = { AlertManager };
