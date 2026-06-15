// Cliente de la API v2 de GoHighLevel.
//   - ghlClient:       operaciones a nivel SUBCUENTA (auth con Private Integration Token).
//   - ghlAgencyClient: operaciones a nivel AGENCIA  (auth con token de agencia), ej. crear
//                      subcuenta con snapshot.
// Sin dependencias: usa fetch global (Node >= 18). Endpoints verificados contra doc oficial
// (ver docs/api-reference.md). Los de customValues conviene validarlos contra tu instancia.

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
    // type: SMS | WhatsApp | Email | RCS | IG | FB | Custom | Live_Chat | TIKTOK
    sendMessage: (contactId, type, message, extra = {}) =>
      req('POST', '/conversations/messages', { type, contactId, message, ...extra }),

    // Custom fields del contacto. OJO: la clave del valor es 'field_value' (no 'value').
    listCustomFields: (locationId) => req('GET', `/locations/${locationId}/customFields`),
    setContactCustomFields: (contactId, fields) =>
      req('PUT', `/contacts/${contactId}`, { customFields: fields }), // fields: [{ id, field_value }]

    // Custom values de la subcuenta: el lugar para lo dinámico por cliente
    // (prompt, agent_id/client_id de Simpletalk, etc.). Validar shape en tu instancia.
    listCustomValues: (locationId) => req('GET', `/locations/${locationId}/customValues`),
    createCustomValue: (locationId, name, value) =>
      req('POST', `/locations/${locationId}/customValues`, { name, value }),
    updateCustomValue: (locationId, id, name, value) =>
      req('PUT', `/locations/${locationId}/customValues/${id}`, { name, value }),
  };
}

// ── Agencia (token de agencia / OAuth Agency-Access) ───────────────────────
export function ghlAgencyClient({ token, baseUrl = DEFAULT_BASE, version = DEFAULT_VERSION }) {
  if (!token) throw new Error('ghlAgencyClient: falta el token de agencia.');
  const req = makeRequest(baseUrl.replace(/\/$/, ''), token, version);

  return {
    req,
    // Crear subcuenta con un snapshot ya cargado (única vía API para aplicar snapshot).
    // body: { name, companyId, snapshotId, ...address/timezone/etc. }
    createLocation: (body) => req('POST', '/locations/', body),
    listSnapshots: (companyId) =>
      req('GET', `/snapshots/?companyId=${encodeURIComponent(companyId)}`),
  };
}
