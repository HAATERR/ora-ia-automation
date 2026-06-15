# Guía del developer — dar de alta un cliente

Cómo usar el generador para montar el cableado + chatbot de un cliente nuevo en n8n, a partir
de la **imagen del flujograma**. Lectura de 10 min; alta de un cliente ~30 min.

> Visión general y por qué de las decisiones: [README.md](../README.md) · [architecture.md](architecture.md).
> Endpoints exactos: [api-reference.md](api-reference.md).

---

## 0. Setup inicial (una sola vez)

```bash
npm install
cp .env.example .env
```

Editá `.env` con 3 cosas:

| Variable | De dónde sale |
|---|---|
| `N8N_BASE_URL` | URL de tu n8n (ej. `https://oraia.up.railway.app`) |
| `N8N_API_KEY` | n8n → Settings → **n8n API** → Create an API key |
| `ANTHROPIC_API_KEY` | tu key de Claude (para `extract-flow`) |

Requisitos: **Node ≥ 18**, n8n con la **Public API** habilitada (viene activa por defecto en self-hosted).

---

## El pipeline (qué hace cada comando)

```
imagen del flujograma
   │  extract-flow.mjs   → Claude lee la imagen
   ▼
flows/<cliente>.flow.json     ← REVISALO (human-in-the-loop)
   │  generate.mjs       → compila a workflows
   ▼
templates/*.template.json     ← workflows tokenizados (se regeneran cada vez)
   │  provision-client.mjs   → crea/activa en n8n
   ▼
workflows en n8n
```

---

## 1. Imagen → flow-spec

Conseguí el flujograma como **imagen** (PNG/JPG, o SVG exportado de Miro/Figma). Después:

```bash
node provision/extract-flow.mjs flujograma.png miclientenuevo
```

Genera `flows/miclientenuevo.flow.json`. **Abrilo y revisalo** — Claude lee el diagrama muy
bien, pero vos confirmás que los `stages`, las rutas y los labels del GPT estén como los
acordaron con el cliente. (Ej.: el flujograma puede decir "Contestó → Éxito/No Calificado/WhatsApp",
pero si tu GPT real clasifica en `llamada ia`/`seguimiento manual`/`whatsapp`, ajustá los labels acá.)

> Formato del flow-spec y qué significa cada campo: [../templates/README.md](../templates/README.md)
> y el ejemplo [../flows/primedental.flow.json](../flows/primedental.flow.json).

## 2. flow-spec → templates

```bash
node provision/generate.mjs flows/miclientenuevo.flow.json
```

Escribe `templates/analisis_postllamada.template.json`, `seguimientos.template.json`,
`cita_agendada.template.json`. (Son **artefactos** — se regeneran por cliente. El chatbot es
aparte, ver §6.)

## 3. Pasos manuales en GHL

Estos no se automatizan (ver [alta-cliente.md](alta-cliente.md) para el checklist completo):

- [ ] Crear la **subcuenta** con tu snapshot (pipelines, custom fields, calendarios, Voice AI).
- [ ] Generar el **PIT** (Settings → Private Integrations) → guardalo en `secrets/<cliente>.pit`.
- [ ] Setear los **Custom Values** de Simpletalk (`client_id`, `from_number`, `agent_id`).
- [ ] Workflow GHL **"tag `llamar` → webhook `POST https://voice.simpletalk.ai/call`"** (con merge fields).
      Esto es lo que dispara las llamadas; n8n solo pone el tag.

## 4. Config del cliente

Copiá el ejemplo y completá:

```bash
cp config/clients/_example.client.json config/clients/miclientenuevo.client.json
```

**El `--dry-run` te imprime los IDs reales** (pipelines, stages, custom fields, custom values):

```bash
node provision/provision-client.mjs config/clients/miclientenuevo.client.json --dry-run
```

Copiá de esa salida los IDs a los tokens de la config. Qué token sale de dónde:

| Token | De dónde |
|---|---|
| `locationId`, `ghlPrivateToken` | de la subcuenta (PIT en `@secrets/<cliente>.pit`) |
| `ORA_PIPELINE_ID`, `ORA_STAGE_*` | del **`--dry-run`** (pipelines + stages) |
| `ORA_CF_TRANSCRIPT/RECORDING/DURATION` | del **`--dry-run`** (custom fields: AI Transcript, etc.) |
| `ORA_OPENAI_CRED_ID` | id de la credencial de OpenAI en tu n8n *(elegí una con cupo)* |
| `ORA_OPENAI_MODEL` | `gpt-4o-mini` (o el que uses) |
| `ORA_GPT_CLASSIFY_PROMPT` / `_REASON_PROMPT` | `@prompts/<cliente>-clasificacion.txt` / `-motivo.txt` |
| `ORA_WEBHOOK_PATH` (por template) | lo elegís vos (ej. `miclientenuevo-analisis`) |

> El motor inyecta solo: `ORA_PIT`, `ORA_LOCATION_ID`, `ORA_WEBHOOK_ID` (uuid), y las
> **URLs de webhook entre flows** (`ORA_WEBHOOK_SEGUIMIENTOS`, etc.) para el enrollment automático.

## 5. Crear los workflows en n8n

```bash
node provision/provision-client.mjs config/clients/miclientenuevo.client.json
```

Crea cada workflow (inactivo si `activate:false`), te imprime la **URL del webhook** de cada uno
y deja un reporte en `config/clients/miclientenuevo.provisioned.json`.

## 6. De vuelta en GHL + test

- [ ] Pegá las **URLs de webhook** que imprimió el motor donde GHL/Simpletalk mandan los eventos
      (post-llamada → análisis; inbound message → chatbot).
- [ ] Activá los workflows en n8n y mandá un evento de prueba.

---

## 6 bis. El chatbot

El chatbot sale del **export de n8n del cliente** (no del flujograma). Para uno nuevo:
1. Exportá el workflow del chatbot de n8n a JSON.
2. Templatizalo (ajustá el mapa de IDs en [`templates/_templatize-chatbot.mjs`](../templates/_templatize-chatbot.mjs)):
   ```bash
   node templates/_templatize-chatbot.mjs "ruta/al/export.json"
   ```
3. Agregá el bloque del chatbot a la config del cliente (ver `primedental.client.json` de ejemplo).

---

## Troubleshooting

| Síntoma | Causa / fix |
|---|---|
| `GHL … → 403: token does not have access to this location` | El PIT no es de esa subcuenta. Verificá `locationId` ↔ PIT. |
| `Credential with ID "…" does not exist for type "openAiApi"` | El `ORA_OPENAI_CRED_ID` no existe en tu n8n. Listá las credenciales y poné una válida. |
| `The service is receiving too many requests` (en la ejecución) | Rate-limit de **OpenAI** (esa cuenta saturada). Usá otra credencial de OpenAI con cupo. |
| El workflow corre `success` pero no mueve stage | El **Find Contact** no encontró al lead (teléfono no matchea, o lag de indexación si recién se creó). |
| `Placeholders sin resolver: {{ORA_…}}` | Falta ese token en la config del cliente. |
| Listar workflows/credenciales de tu n8n | `node provision/verify-workflow.mjs <workflowId>` (verifica uno desplegado). |

---

## Notas

- Los `templates/*.template.json` del cableado son **generados** (se pisan por cliente). El de
  **chatbot** sí es fuente.
- Nunca hardcodees el PIT: va en `secrets/<cliente>.pit` (gitignoreado) y se referencia con `@`.
- Las llamadas las lanza **GHL** (tag `llamar`), no n8n — así n8n no necesita agent/client ids.
