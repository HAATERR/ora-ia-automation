# Templates de workflows

Los templates son **workflows de n8n exportados a JSON** con los valores variables
reemplazados por placeholders `{{ORA_*}}`. El motor de alta
(`provision/provision-client.mjs`) los lee, inyecta los valores del cliente, los
sanitiza y los crea vía Public API de n8n.

## Convención de placeholders

| Placeholder | Lo provee | Qué es |
|---|---|---|
| `{{ORA_CRED_ID}}` | **automático** | ID de la credencial Custom Auth recién creada (PIT del cliente) |
| `{{ORA_CRED_NAME}}` | **automático** | Nombre de esa credencial |
| `{{ORA_LOCATION_ID}}` | **automático** | `locationId` del cliente |
| `{{ORA_OUTCOME_MAP}}` | **automático** | El `outcomeMap` del cliente (objeto JSON) |
| `{{ORA_WEBHOOK_ID}}` | **automático** | UUID único generado por workflow |
| `{{ORA_GHL_BASE}}` / `{{ORA_GHL_VERSION}}` | **automático** | Base URL y header Version de GHL |
| `{{ORA_WEBHOOK_PATH}}` | `templates[].tokens` | Path del webhook (ej. `acme-postcall`) |
| `{{ORA_PROMPT}}` | `templates[].tokens` | Prompt del chatbot (usá `@prompts/acme.txt`) |
| `{{ORA_VAR_*}}` | `templates[].tokens` | Cualquier variable propia del template |

> **Regla de oro:** cada `{{ORA_*}}` debe vivir **dentro de un string JSON** del
> template (que es como siempre quedan al exportar de n8n). El motor escapa el valor
> para contexto de string JSON, así que objetos (como `{{ORA_OUTCOME_MAP}}`) y
> strings con comillas/saltos se inyectan sin romper el JSON.
>
> Las expresiones de n8n (`={{ $json.x }}`) **no** se tocan: el motor solo reemplaza
> placeholders con prefijo `ORA_`.

## Cómo convertir un workflow tuyo en template

1. En n8n: abrí el workflow → **⋯ → Download** (export a JSON).
2. Reemplazá los valores variables por placeholders `{{ORA_*}}`.
3. En los nodos `HTTP Request` que peguen a GHL, usá la credencial Custom Auth:
   ```json
   "parameters": {
     "authentication": "genericCredentialType",
     "genericAuthType": "httpCustomAuth"
   },
   "credentials": {
     "httpCustomAuth": { "id": "{{ORA_CRED_ID}}", "name": "{{ORA_CRED_NAME}}" }
   }
   ```
   (No pongas el header `Version` ni el `Authorization` en el nodo: los inyecta la credencial.)
4. No te preocupes por limpiar `id`/`active`/etc. del export: el motor los quita solo.

---

## `postcall-cableado.template.json` — 🟡 v0

Cableado post-llamada: **Webhook (Simpletalk) → mapear outcome → mover stage / taggear**.

```
Webhook · Simpletalk
   └─▶ Mapear outcome → acciones (Code, usa {{ORA_OUTCOME_MAP}})
          ├─▶ ¿Hay tags? ─▶ GHL · Agregar tags    (POST /contacts/{id}/tags)
          └─▶ ¿Mover stage? ─▶ GHL · Mover de stage (PUT /opportunities/{id})
```

**Pendiente de fijar con un payload real de Simpletalk:** el Code node extrae
`contactId` / `opportunityId` / `outcome` con nombres tentativos
(`contact_id`, `outcome`, `tags`…). Mandame un payload real y lo dejo exacto.

> Nota: si Simpletalk manda `contact_id` pero **no** `opportunity_id`, hay que
> agregar antes del "Mover de stage" un nodo que busque la opportunity del contacto
> (`GET /opportunities/search?location_id=…&contact_id=…`). Lo agrego cuando
> confirmemos el payload.

## `chatbot.template.json` — ⛔ pendiente

Pegá acá tu **export del template de chatbot** de n8n. Después lo parametrizo:
- el/los nodo(s) HTTP de GHL → credencial Custom Auth (`{{ORA_CRED_ID}}`),
- el prompt → `{{ORA_PROMPT}}`,
- el path del webhook (si tiene) → `{{ORA_WEBHOOK_PATH}}`.

Mientras no exista este archivo, quitá su bloque de `templates` en la config del
cliente (o el alta fallará al no encontrarlo).
