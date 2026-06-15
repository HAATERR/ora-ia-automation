# Alta de un cliente nuevo — checklist

Qué se llena **a mano** por cliente y qué hace el **motor** automáticamente.

## 1. En GHL (a mano)
- [ ] Crear la subcuenta (con tu snapshot: pipelines, custom fields, calendarios, Voice AI).
- [ ] Generar el **PIT** (Settings → Private Integrations) y copiarlo. *(No hay API para esto.)*
- [ ] Anotar el **locationId** de la subcuenta.
- [ ] Anotar los **calendar IDs** (CDMX, Querétaro, Virtual) → Calendars.
- [ ] Setear los **Custom Values** del agente de voz / Simpletalk (`client_id`, `from_number`, `agent_id`…).
- [ ] **Workflow "lanzar llamada"** (lo dispara n8n con el tag `llamar`):
      - Trigger: *Contact Tag* = `llamar`
      - Acción 1 (recomendado): *Remove Tag* `llamar` (para que sea re-disparable)
      - Acción 2: *Webhook* `POST https://voice.simpletalk.ai/call` con body:
        `client_id={{custom_values.client_id}}`, `to_number={{contact.phone_raw}}`,
        `from_number={{custom_values.from_number}}`, `agent_id=<agent>`,
        `contact_name={{contact.name}}`, `contact_email={{contact.email}}`,
        `contact_id={{contact.id}}`, `first_name={{contact.first_name}}`
      - *(Esto vive en GHL porque consume sus merge fields. n8n solo pone el tag.)*

## 2. En la config de n8n (`client.json`)
Copiá `config/clients/_example.client.json` → `config/clients/<cliente>.client.json` y completá:
- [ ] `locationId`  → se inyecta como `{{ORA_LOCATION_ID}}`
- [ ] `ghlPrivateToken` (PIT) → guardalo en `secrets/<cliente>.pit` y referencialo con `@`
- [ ] `ORA_CAL_CDMX`, `ORA_CAL_CDMX_AVAIL`, `ORA_CAL_QUERETARO`, `ORA_CAL_VIRTUAL` (calendar IDs)
- [ ] `ORA_FROM_NUMBER`, `ORA_SIMPLETALK_CLIENT_ID`, `ORA_GHL_CALL_HOOK_URL`
- [ ] `ORA_WEBHOOK_PATH` (ej. `<cliente>-chatbot`)
- [ ] `ORA_PROMPT` → `@prompts/<cliente>.txt` (sale de tu pipeline de prompts)

> El motor inyecta solo: `ORA_PIT` (del PIT), `ORA_LOCATION_ID` (del locationId) y
> `ORA_WEBHOOK_ID` (un uuid). El resto sale de los `tokens` de la config.

## 3. Correr el motor
```
node provision/provision-client.mjs config/clients/<cliente>.client.json
```
→ clona el/los workflow(s), los **activa**, y te imprime la **URL del webhook** del chatbot
y un reporte en `config/clients/<cliente>.provisioned.json`.

## 4. De vuelta en GHL (a mano)
- [ ] Pegar la **URL del webhook de n8n** (la que imprimió el motor) donde GHL manda el inbound
      message hacia el chatbot.
- [ ] Verificar las variables de Simpletalk.

## 5. Test
- [ ] Mandar un mensaje de prueba al WhatsApp → el chatbot responde.
- [ ] (Opcional) Disparar una llamada de prueba y verificar el cableado.

---

**Único paso irreductiblemente manual del lado código:** generar el PIT (GHL no lo expone por
API). Todo lo demás del lado n8n lo hace el motor.
