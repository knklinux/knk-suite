const STORAGE_KEY = 'knk.assistant.conversation.v1';

export function loadConversation() {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.slice(-80) : [];
  } catch {
    return [];
  }
}

export function saveConversation(messages) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-80)));
  } catch {
    // El asistente sigue funcionando aunque el perfil del navegador no permita
    // almacenamiento persistente.
  }
}

export function clearConversation() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function onConversationChange(callback) {
  const onStorage = (event) => {
    if (event.key !== STORAGE_KEY) return;
    callback(loadConversation());
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
