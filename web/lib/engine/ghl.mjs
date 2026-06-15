// Cliente de la API v2 de GoHighLevel (puro: usa fetch global, sin file I/O).
// Portado de provision/lib/ghl.mjs — idéntico, para que web/ sea self-contained.
//   - ghlClient: operaciones a nivel SUBCUENTA (auth con Private Integration Token).
// Endpoints verificados contra doc oficial (ver docs/api-reference.md del repo raíz).

const DEFAULT_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_VERSION = '2021-07-28';

function makeRequest(base, token, version) {
  return async function req(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: version,
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
      throw new Error(`GHL ${method} ${path} → ${res.status}: ${detail}`);
    }
    return data;
  };
}

// ── Subcuenta (Private Integration Token) ──────────────────────────────────
export function ghlClient({ token, baseUrl = DEFAULT_BASE, version = DEFAULT_VERSION }) {
  if (!token) throw new Error('ghlClient: falta el Private Integration Token.');
  const req = makeRequest(baseUrl.replace(/\/$/, ''), token, version);

  return {
    req,

    // Pipelines / opportunities ----------------------------------------------
    listPipelines: (locationId) =>
      req('GET', `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`),
    moveStage: (opportunityId, pipelineStageId, extra = {}) =>
      req('PUT', `/opportunities/${opportunityId}`, { pipelineStageId, ...extra }),

    // Tags -------------------------------------------------------------------
    addTags: (contactId, tags) => req('POST', `/contacts/${contactId}/tags`, { tags }),
    removeTags: (contactId, tags) => req('DELETE', `/contacts/${contactId}/tags`, { tags }),

    // Mensajería (rutea por el proveedor de la subcuenta -> AppLevel) ---------
    sendMessage: (contactId, type, message, extra = {}) =>
      req('POST', '/conversations/messages', { type, contactId, message, ...extra }),

    // Custom fields del contacto. OJO: la clave del valor es 'field_value' (no 'value').
    listCustomFields: (locationId) => req('GET', `/locations/${locationId}/customFields`),
    setContactCustomFields: (contactId, fields) =>
      req('PUT', `/contacts/${contactId}`, { customFields: fields }), // fields: [{ id, field_value }]

    // Custom values de la subcuenta (lo dinámico por cliente).
    listCustomValues: (locationId) => req('GET', `/locations/${locationId}/customValues`),
    createCustomValue: (locationId, name, value) =>
      req('POST', `/locations/${locationId}/customValues`, { name, value }),
    updateCustomValue: (locationId, id, name, value) =>
      req('PUT', `/locations/${locationId}/customValues/${id}`, { name, value }),
  };
}
