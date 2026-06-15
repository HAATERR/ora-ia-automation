# Cheat-sheet de APIs (verificado)

Resumen de los endpoints que usa este repo, **verificados contra documentación
oficial** (cada hallazgo pasó por verificación adversarial). Fechas/valores a
2026-06.

---

## GoHighLevel — API v2

- **Base URL:** `https://services.leadconnectorhq.com`
- **Headers obligatorios en CADA request:**
  - `Authorization: Bearer <PRIVATE_INTEGRATION_TOKEN>`
  - `Version: 2021-07-28`  ← valor literal del header (el "v3" del marketplace es solo el selector de la UI de docs)
  - `Content-Type: application/json`

### Private Integration Token (PIT)
- Se genera **por subcuenta**: entrar a la Location → *Settings → Private
  Integrations → Create new Integration* → elegir scopes → copiar token
  (**se muestra una sola vez**).
- Actúa como un access token OAuth2 **fijo**: **no se auto-refresca**; para
  renovarlo hay que rotarlo/regenerarlo manualmente.
- Hasta **5 PIT por nivel** (agencia / subcuenta).
- Scopes necesarios para este repo: `contacts.readonly`, `contacts.write`,
  `opportunities.readonly`, `opportunities.write`.

### Endpoints usados
| Acción | Método + path | Body / query | Notas |
|---|---|---|---|
| Listar pipelines + stages | `GET /opportunities/pipelines?locationId={id}` | query `locationId` | de acá salen `pipelineId` y `pipelineStageId` |
| Mover opportunity de stage | `PUT /opportunities/{id}` | `{"pipelineStageId":"..."}` | `pipelineId` **solo** si además cambiás de pipeline |
| Cambiar solo estado | `PUT /opportunities/{id}/status` | `{"status":"open\|won\|lost\|abandoned"}` | no mueve de stage |
| Crear opportunity | `POST /opportunities/` | `{pipelineId, locationId, name, pipelineStageId, contactId, ...}` | 201 |
| Agregar tags | `POST /contacts/{contactId}/tags` | `{"tags":["a","b"]}` | 201 |
| Quitar tags | `DELETE /contacts/{contactId}/tags` | `{"tags":["a","b"]}` | 200 |
| Buscar contacto | `POST /contacts/search` | `{locationId, page, pageLimit, filters}` | `GET /contacts/` está **deprecado** |

> ⚠️ El esquema exacto del campo `filters` de `POST /contacts/search` no está
> documentado en texto plano (la página del marketplace se renderiza con JS).
> Validar el shape (field/operator/value, grupos AND/OR) con un request real o en
> el repo oficial `github.com/GoHighLevel/highlevel-api-docs` antes de codificarlo.

### Rate limits (OAuth / PIT)
- **Burst:** 100 requests / 10 s
- **Diario:** 200.000 requests / día
- Por app (cliente) y por recurso (Location/Company). Al exceder → `429`.

### Versionado
- **API v1 llegó a fin de soporte el 31-dic-2025.** Conexiones existentes siguen
  funcionando sin soporte/updates. Usar **v2** para todo lo nuevo.

### Mensajería, custom fields/values, appointments (subcuenta)
| Acción | Método + path | Notas |
|---|---|---|
| Enviar mensaje | `POST /conversations/messages` | `{type, contactId, message}`. `type`: `SMS`/`WhatsApp`/`Email`/`RCS`/`IG`/`FB`/`Custom`/`Live_Chat`/`TIKTOK`. El canal lo rutea el **proveedor de la subcuenta** → AppLevel enmascara (no hace falta `conversationProviderId`) |
| Webhook inbound (trigger chatbot) | `InboundMessage` | payload: `contactId`, `conversationId`, `messageId`, `locationId`, `body`, `messageType`, `from`, `to`… |
| Escribir custom fields | `PUT /contacts/{contactId}` | `{customFields:[{id, field_value}]}` ⚠️ la clave es **`field_value`**, NO `value` |
| Leer custom fields (sacar ids) | `GET /locations/{locationId}/customFields` | devuelve `id`, `fieldKey`, `dataType`, `name`… |
| Custom values (prompt, ids Simpletalk) | `GET/POST/PUT /locations/{locationId}/customValues` | acá va lo **dinámico por cliente** *(validar shape en tu instancia)* |
| Crear appointment | `POST /calendars/events/appointments` | requeridos `calendarId`, `locationId`, `contactId`, `startTime` |
| Webhook cita creada | `AppointmentCreate` | NO existe webhook "Customer Booked Appointment" a nivel API (es trigger de Workflow) |

### Snapshots (nivel agencia)
- Un Snapshot incluye **Workflows, Triggers, Pipelines, Custom Fields/Values, Calendars,
  Voice AI Agents, WhatsApp templates**… (configuración; NO contactos/citas/conversaciones).
- ⚠️ **NO hay API para cargar/pushear un snapshot a una subcuenta existente.** Solo UI
  (Load Snapshot / share link).
- ✅ Única vía programática: `POST /locations/` con **`snapshotId`** al **crear** la
  subcuenta → carga el cableado completo. Requiere **token de agencia** (Agency-Access).
- API de snapshots = casi solo lectura: `GET /snapshots/`, `POST /snapshots/share/link`,
  `GET /snapshots/snapshot-status/{id}`.
- Las referencias internas (workflow→stage, workflow→custom field) **se re-mapean solas**
  al cargar; las referencias a IDs externos se rompen → por eso lo dinámico va en
  **Custom Values**.

---

## n8n — Public REST API (self-hosted)

- **Base path:** `https://<tu-instancia>/api/v1`
- **Auth:** header `X-N8N-API-KEY: <api-key>` (Settings → n8n API → Create an API key).
- **Habilitada por defecto** en self-hosted (`N8N_PUBLIC_API_DISABLED=false`).
  Playground Swagger en `/api/v1/docs` (solo self-hosted).
- API keys no-Enterprise: acceso completo. En Enterprise se limita por *Scopes*.

### Workflows
| Acción | Método + path | Notas |
|---|---|---|
| Crear | `POST /api/v1/workflows` | requiere **`name`, `nodes`, `connections`, `settings`** (los 4). `id`/`active` son readOnly → **no enviarlos** |
| Obtener (template) | `GET /api/v1/workflows/{id}` | `excludePinnedData` opcional |
| Listar | `GET /api/v1/workflows` | filtros `active`, `tags`, `name`, `projectId`, `limit`, `cursor` |
| Actualizar | `PUT /api/v1/workflows/{id}` | objeto workflow completo |
| Activar / Desactivar | `POST /api/v1/workflows/{id}/activate` · `/deactivate` | en v1 "activate" = publicar |

> `settings` tiene `additionalProperties: false` → solo claves válidas
> (`executionOrder: "v1"`, etc.). Propiedades extra → `400 Bad Request`.
> Al clonar un workflow exportado hay que **quitar** `id`, `createdAt`, `updatedAt`,
> `active`, `versionId`, `triggerCount`, `tags`, `isArchived` (todos readOnly).

### Credentials
| Acción | Método + path | Notas |
|---|---|---|
| Crear | `POST /api/v1/credentials` | `{name, type, data}` — **sí se puede por API** |
| Schema de un tipo | `GET /api/v1/credentials/schema/{credentialTypeName}` | para saber qué campos lleva `data` |
| Actualizar | `PATCH /api/v1/credentials/{id}` | (versiones actuales; `isPartialData` permite merge) |
| Borrar | `DELETE /api/v1/credentials/{id}` | |

> 🔒 La Public API **no devuelve los secretos** de credenciales (`data` es
> write-only). No se pueden leer tokens ya guardados.

### Nodo HighLevel vs HTTP Request
- Nodo nativo `n8n-nodes-base.highLevel`: recursos Contact / Opportunity / Task /
  Calendar. Credencial **OAuth2** (API v2) → requiere app de Marketplace (Client
  ID/Secret), **no** un PIT. Y **no tiene operación de tags**.
- ➡️ Por eso este repo usa **`HTTP Request` + credencial "Custom Auth"
  (`httpCustomAuth`)** que inyecta los headers `Authorization` + `Version`. Una
  credencial por cliente, con su PIT.

---

## Fuentes principales
- GHL: `marketplace.gohighlevel.com/docs`, `help.gohighlevel.com` (Private Integrations, rate limits, deprecación v1).
- n8n: `docs.n8n.io/api`, `github.com/n8n-io/n8n-docs` (`openapi.yml`), doc del nodo HighLevel.
- Simpletalk: `docs.simpletalk.ai` (integración GHL, tags, webhooks). **No** publica una REST API formal.
