let invokePromise;

async function invoke(command, args) {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then((module) => module.invoke).catch(() => null);
  }
  const invokeFn = await invokePromise;
  if (!invokeFn) throw new Error('API Tauri no disponible');
  return invokeFn(command, args);
}

export const isTauri = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

export async function backendStatus() {
  if (!isTauri()) return { running: true, url: window.location.origin, reason: 'modo web/desarrollo' };
  return invoke('backend_status');
}

export async function openAssistantWindow() {
  if (!isTauri()) {
    window.open(`${window.location.origin}/#assistant`, '_blank', 'popup,width=380,height=520');
    return;
  }
  return invoke('open_assistant');
}

export async function closeAssistantWindow() {
  if (!isTauri()) { window.close(); return; }
  return invoke('close_assistant');
}
