export async function apiFetch(url, opts = {}) {
  const request = {
    credentials: 'same-origin',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  };
  let response = await fetch('/api' + url, request);
  if (response.status === 401) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    response = await fetch('/api' + url, request);
  }
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { ok: response.ok, status: response.status, text }; }
}

export function backendWsUrl(path = '/ws/terminal') {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
