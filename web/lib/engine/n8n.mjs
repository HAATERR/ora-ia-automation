// Cliente mínimo de la Public API de n8n (self-hosted).
// Puro: usa fetch global, sin file I/O. Portado de provision/lib/n8n.mjs.

export function n8nClient({ baseUrl, apiKey }) {
  if (!baseUrl || !apiKey) throw new Error('n8nClient: faltan N8N_BASE_URL / N8N_API_KEY.');
  const base = baseUrl.replace(/\/$/, '') + '/api/v1';

  async function req(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      throw new Error(`n8n ${method} ${path} → ${res.status}: ${detail}`);
    }
    return data;
  }

  return {
    req,
    createCredential: (name, type, data) => req('POST', '/credentials', { name, type, data }),
    getCredentialSchema: (type) => req('GET', `/credentials/schema/${type}`),
    createWorkflow: (workflow) => req('POST', '/workflows', workflow),
    activateWorkflow: (id) => req('POST', `/workflows/${id}/activate`),
    getWorkflow: (id) => req('GET', `/workflows/${id}`),
  };
}
