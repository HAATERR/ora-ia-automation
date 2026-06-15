# Arquitectura y decisiones de diseño

## Objetivo
Automatizar el "cableado" que se hace por cada cliente nuevo de Ora IA:
1. **Post-llamada** (cableado del agente de voz): mover el lead de stage y
   etiquetarlo en GHL según el resultado de la llamada.
2. **Chatbot**: clonar el workflow de n8n del chatbot desde un template, ya con el
   prompt y el bearer del cliente, activarlo y testearlo.

Ambas cosas normalmente se harían en el apartado *Automation* de GHL, que **no es
accesible por API**. Solución: replicar la lógica en **n8n** y pegarle a GHL por su
**API v2**. Y automatizar la *creación* de esos workflows con la **Public API de n8n**.

---

## Decisión 1 — Simpletalk es "tag-driven", no tiene API REST formal

Hallazgos (verificados contra `docs.simpletalk.ai`):
- Todo gira alrededor de **webhooks**. Las llamadas se lanzan por webhook y la data
  post-llamada se devuelve a un *"return webhook URL"*.
- Post-llamada se entrega: `transcript`, `recording link`, `outcome`, `duration`,
  `confirmed appointment`.
- El **outcome se materializa como TAGS** automáticos en el contacto: `answer`,
  `inbound`, `DNA` (Did Not Answer), `DNC` (Do Not Contact).
- Extracción por keyword en tiempo real: ej. `"keyword":"attending"` →
  `"tag_to_add":"confirmed"`.
- **No** hay una API REST documentada (sin endpoints/keys públicos), ni un JSON de
  payload de retorno publicado.

**Implicación:** el disparador del cableado es **Simpletalk → webhook de n8n** (uno
por cliente). El "flujograma" acordado con el cliente se modela como un mapa
`outcome/tag → { mover a stage, agregar tags }` (ver `outcomeMap` en la config).

**Pendiente:** como el payload exacto no está documentado, el Code node del template
extrae los campos con nombres tentativos (`contact_id`, `outcome`, `tags`, …)
marcados como TODO. Con **1 payload real** se fija definitivamente.

> Alternativa descartada por ahora: disparar desde un webhook saliente de GHL
> ("Contact Tag" trigger). Funciona, pero requiere construir un workflow en GHL por
> cliente — justo lo que se quiere evitar. Si en algún caso Simpletalk no puede
> apuntar a n8n directo, este es el plan B (el trigger en GHL queda fijo).

---

## Decisión 2 — Con PIT, `HTTP Request` + credencial "Custom Auth"

El nodo nativo `HighLevel` de n8n (API v2) usa credencial **OAuth2** → requiere una
app de Marketplace (Client ID/Secret). Vos elegiste **PIT por subcuenta**, que es
mucho más simple. Además el nodo nativo **no soporta tags**.

➡️ Estandarizamos en nodos **`HTTP Request`** con una credencial **"Custom Auth"
(`httpCustomAuth`)** por cliente, que inyecta:
```json
{ "headers": { "Authorization": "Bearer <PIT>", "Version": "2021-07-28" } }
```
Ventajas: uniforme para todas las acciones (mover stage, tags, lo que sea), el PIT
**no se hardcodea** en el JSON del workflow (vive en la credencial), y rotar un
token es cambiar una sola credencial.

---

## Decisión 3 — Híbrido: clonar + config central

Cada cliente tiene **su copia** de los workflows (clonada del template), pero:
- El **bearer (PIT)** va en una **credencial de n8n** (no en el JSON).
- El **prompt / mapeo / IDs** se inyectan desde una **config central por cliente**
  (`config/clients/<cliente>.client.json`).

Así se mantiene la personalización por cliente sin tener tokens ni lógica regados
en N JSONs distintos.

---

## El motor de alta (`provision-client.mjs`)

```
1. Validar PIT         → GET /opportunities/pipelines (de paso lista los stage IDs)
2. Crear credencial    → POST /api/v1/credentials  (httpCustomAuth con el PIT)
3. Clonar template(s)  → leer template → inyectar tokens {{ORA_*}} → sanitizar
4. Crear + activar     → POST /api/v1/workflows  → POST .../activate
5. Reporte             → <cliente>.provisioned.json (cred id, workflow ids, pipelines)
```

Tokens que el motor inyecta automáticamente: `ORA_CRED_ID`, `ORA_CRED_NAME`,
`ORA_LOCATION_ID`, `ORA_GHL_BASE`, `ORA_GHL_VERSION`, `ORA_OUTCOME_MAP`,
`ORA_WEBHOOK_ID` (uuid generado por template). El resto sale de `templates[].tokens`
de la config del cliente. Ver [templates/README.md](../templates/README.md).

---

## Por qué n8n (y no Make/Zapier)
Porque el requerimiento real es **automatizar la creación de automatizaciones**:
n8n tiene **Public API** para crear workflows y credenciales programáticamente,
es self-hosted (PIT de clientes en tu infra, sin costo por operación) y el nodo
`HTTP Request` cubre el 100% de la API de GHL. Make/Zapier no permiten clonar
escenarios por API de forma seria.

---

## Actualización — división final (confirmada con Enzo, 2026-06-13)

**Decidido: GHL hace TODO el cableado (runtime), clonado por Snapshot; n8n = chatbot + provisioning.**

Por qué:
- Enzo ya usa **Snapshots seguido** → los 3 workflows + pipelines + custom fields se clonan solos.
- Las **llamadas de Simpletalk se lanzan desde GHL** (los merge fields del contacto viven ahí).
- La **mensajería va por el nodo de GHL** (Conversations → AppLevel).
- **n8n es débil para recordatorios largos a escala**: el nodo Wait offloada la ejecución a la
  DB sobre 65s y deja registros "waiting" (bloat + picos al reanudar). GHL hace esos
  recordatorios (Step 4: 1 día antes / 4h antes) de forma nativa.

⇒ El template `postcall-cableado.template.json` queda **opcional**: solo se usa si más adelante
querés **centralizar el "cerebro"** (la clasificación GPT del tipo de seguimiento) en un webhook
único de n8n —para no re-pushear el snapshot a todos los clientes cada vez que cambia la lógica—.
Si no, esa lógica vive en GHL (que ya tiene su nodo OpenAI).

### Provisioning por cliente (flujo real)
| Paso | Dónde | ¿Automatizable? |
|---|---|---|
| 1. Crear subcuenta con snapshot | `POST /locations/` (token agencia) **o** UI | ✅ API si creás la subcuenta por API; si no, 1 clic en UI |
| 2. Generar PIT de la subcuenta | UI (Settings → Private Integrations) | ❌ manual (no hay API para crear PITs) |
| 3. Setear custom values (prompt, agent_id Simpletalk…) | `POST/PUT /locations/{id}/customValues` | ✅ API |
| 4. Validar pipelines/custom fields | `GET /opportunities/pipelines`, `GET .../customFields` | ✅ API |
| 5. Clonar chatbot en n8n + bearer + activar | Public API n8n | ✅ (motor actual) |
| 6. Test punta a punta | `InboundMessage` de prueba + validar PIT | ✅ |

**El chatbot (n8n):** trigger = webhook `InboundMessage` de GHL → Text Classifier / IA →
responde con `POST /conversations/messages` (`type: SMS`, que AppLevel enmascara como WhatsApp).
