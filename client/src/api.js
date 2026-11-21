export class ApiError extends Error {
  constructor(code, status, body) { super(code); this.code = code; this.status = status; this.body = body; }
}

export async function api(path, { method = 'GET', body, keepalive } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      keepalive,
      headers: { 'X-Requested-With': 'baqara', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'generic', res.status, data);
  return data;
}
