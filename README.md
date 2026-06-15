# ORA IA — Generador de cableados (flujograma → n8n)

Pipeline para que un developer **pase la imagen del flujograma** del cableado acordado con
el cliente y se **generen automáticamente los workflows en n8n** (análisis post-llamada,
seguimientos, cita agendada y el chatbot). El developer solo hace los pasos manuales de GHL.

```
imagen del flujograma (Miro/Figma)
   │  extract-flow.mjs   (Claude Opus 4.8, visión)
   ▼
flows/<cliente>.flow.json      ← flow-spec (el developer lo revisa)
   │  generate.mjs       (compilador flow-spec → templates n8n)
   ▼
templates/*.template.json      ← workflows tokenizados {{ORA_*}}
   │  provision-client.mjs   (Public API de n8n)
   ▼
workflows creados y activados en n8n
```

> **👉 Para usarlo paso a paso (dar de alta un cliente): [docs/GUIA.md](docs/GUIA.md).**

Todo el cableado vive en **n8n** y le pega a GoHighLevel por su **API v2** (con un
**PIT** por subcuenta, vía nodos HTTP Request + credencial Custom Auth). El PIT nunca se
hardcodea en el JSON. Las **llamadas las lanza GHL** (n8n pone el tag `llamar` y un workflow
de GHL dispara `POST voice.simpletalk.ai/call` con merge fields). Detalle en
[docs/architecture.md](docs/architecture.md).

---

## Quickstart

Requisitos: **Node.js ≥ 18**, un **n8n** con la Public API habilitada, y una **API key de
Claude** (para `extract-flow`).

```bash
# 0. Configurar accesos
cp .env.example .env
#   → N8N_BASE_URL, N8N_API_KEY, ANTHROPIC_API_KEY
npm install

# 1. Imagen del flujograma → flow-spec (el developer lo revisa)
node provision/extract-flow.mjs flujograma-acme.png acme

# 2. flow-spec → templates de n8n
node provision/generate.mjs flows/acme.flow.json

# 3. Config del cliente (PIT + IDs reales de la subcuenta)
cp config/clients/_example.client.json config/clients/acme.client.json
#   → locationId, ghlPrivateToken (PIT), stage IDs, calendar IDs, prompt…
#   (un --dry-run te imprime los stage IDs reales:)
node provision/provision-client.mjs config/clients/acme.client.json --dry-run

# 4. Crear + activar los workflows en n8n
node provision/provision-client.mjs config/clients/acme.client.json
```

Pasos manuales de GHL (no se automatizan): crear la subcuenta (snapshot), generar el **PIT**,
setear los **Custom Values** (Simpletalk), y el workflow GHL "tag `llamar` → call". Checklist
completo en [docs/alta-cliente.md](docs/alta-cliente.md).

---

## Estructura del repo

```
.
├── flows/                         # flow-specs (el flujograma, machine-readable)
│   ├── <cliente>.flow.json        # generado por extract-flow, revisado por el dev
│   └── primedental.graph.json     # grafo extraído de la imagen (intermedio)
├── provision/
│   ├── extract-flow.mjs           # imagen → flow-spec  (Claude Opus 4.8, visión)
│   ├── generate.mjs               # flow-spec → templates n8n  (compilador)
│   ├── provision-client.mjs       # crea/activa los workflows en n8n  (CLI)
│   └── lib/{n8n,ghl,template}.mjs  # clientes API + inyección de tokens
├── templates/                     # workflows tokenizados {{ORA_*}} (generados)
│   ├── analisis_postllamada.template.json
│   ├── seguimientos.template.json
│   ├── cita_agendada.template.json
│   ├── chatbot.template.json      # del export del cliente (templatizado)
│   └── README.md                  # convención de placeholders
├── config/
│   ├── client.schema.json
│   └── clients/<cliente>.client.json   # PIT + IDs reales (manual, por subcuenta)
├── prompts/                       # prompts por cliente (@file)
└── docs/
    ├── architecture.md            # decisiones de diseño
    ├── api-reference.md           # cheat-sheet VERIFICADO de GHL v2 y n8n API
    └── alta-cliente.md            # checklist de alta (qué es manual vs automático)
```

---

## Estado

| Pieza | Estado |
|---|---|
| **extract-flow** (imagen → flow-spec) | ✅ Claude Opus 4.8 + visión (falta `ANTHROPIC_API_KEY` para correrlo) |
| **generate** (flow-spec → templates) | ✅ compila análisis + seguimientos + cita |
| **provision** (templates → n8n) | ✅ validado contra n8n real (Railway) |
| Workflow **análisis post-llamada** | ✅ construido + **validado end-to-end** (find contact → GPT → mover stage) |
| Workflow **seguimientos** | ✅ construido (n8n tag `llamar` → GHL lanza la llamada) |
| Workflow **cita agendada** | ✅ v1 (mueve a Éxito + tag para recordatorios de GHL) |
| **Chatbot** | ✅ templatizado (AI Agent + tools de calendario) + validado |

### Pendientes
- Confirmar qué **credencial de OpenAI** usar por cliente (la principal está saturada/429).
- Arreglar el **bug del chatbot de producción** (`locationId` `S8Uc → HOu6`).
- Afinar `extract-flow` con más flujogramas reales (revisión humana del flow-spec).
