// Serializador PURO del editor visual (/dibujar) → flow-spec (mismo formato que consume
// compileFlowSpec). El grafo de React Flow del flow "analisis" es la fuente de verdad de
// las rutas; "seguimientos" (secuencia) y "cita" se editan como formularios.
//
// Convenciones del grafo de analisis:
//   - node 'trigger' (Simpletalk): source handles 'dnc' | 'dna' | 'answered'
//   - node tipo 'stage'   data:{ role }      target handle 'in', source handle 'then'
//   - node tipo 'gpt'     data:{ labels:[{id,name,gptReason,notify}] }  target 'in', source = id de cada label
//   - node tipo 'flowref' id 'ref-seguimientos' | 'ref-cita_agendada'   target 'in'

const REF_TO_FLOW = { "ref-seguimientos": "seguimientos", "ref-cita_agendada": "cita_agendada" };
export const STAGE_PRESETS = ["lead_nuevo", "llamada_curso", "dnc", "dna", "whatsapp", "seguimiento", "no_calificado", "exito"];

export function graphToAnalisis(graph, include = {}) {
  const nodeById = Object.fromEntries((graph.nodes || []).map((n) => [n.id, n]));
  const edgeFrom = (nodeId, handle) =>
    (graph.edges || []).find((e) => e.source === nodeId && (e.sourceHandle ?? null) === (handle ?? null));
  // un flow se considera incluido salvo que include lo marque explícitamente como false
  // (así llamar graphToAnalisis(graph) sin include conserva los "then").
  const flowIncluded = (flow) => include[flow] !== false;

  // Sigue una arista hasta su destino y arma {stage,then?} si es un stage, o marca gpt.
  const resolveEdge = (edge) => {
    if (!edge) return null;
    const target = nodeById[edge.target];
    if (!target) return null;
    if (target.type === "stage") {
      const role = (target.data?.role || "").trim();
      if (!role) return null; // stage sin rol → ruta ignorada (no emite {{ORA_STAGE_}})
      const action = { stage: role };
      const thenEdge = edgeFrom(target.id, "then");
      const thenFlow = thenEdge && REF_TO_FLOW[thenEdge.target];
      // solo enrola si el flow destino está incluido (si no, sería un then colgante)
      if (thenFlow && flowIncluded(thenFlow)) action.then = thenFlow;
      return { kind: "stage", action };
    }
    if (target.type === "gpt") return { kind: "gpt", node: target };
    return null;
  };

  const routes = {};
  for (const tag of ["dnc", "dna", "answered"]) {
    const res = resolveEdge(edgeFrom("trigger", tag));
    if (!res) continue;
    if (res.kind === "stage") {
      routes[tag] = res.action;
      continue;
    }
    const labels = {};
    for (const label of res.node.data?.labels || []) {
      const name = (label.name || "").trim();
      if (!name || name in labels) continue; // sin nombre o nombre duplicado → se ignora
      const lres = resolveEdge(edgeFrom(res.node.id, label.id));
      if (!lres || lres.kind !== "stage") continue;
      const action = lres.action;
      if (label.gptReason) action.gptReasonRef = "motivo";
      if (label.notify) action.notify = true;
      labels[name] = action;
    }
    if (Object.keys(labels).length === 0) continue; // GPT sin etiquetas válidas → ruta omitida
    routes[tag] = { gptClassify: { promptRef: "clasificacion", labels } };
  }

  return {
    trigger: { type: "webhook" },
    findContactBy: "to_number",
    updateCallSummary: ["transcript", "recording", "duration"],
    routeBy: "simpletalk_tag",
    routes,
  };
}

// Problemas del grafo de analisis para mostrar en el editor ANTES de provisionar (cosas que
// el serializador descarta en silencio: stage conectado sin rol, GPT sin etiquetas válidas,
// etiquetas con nombre repetido). Devuelve mensajes en español, sin duplicados.
export function analisisProblems(graph) {
  const nodeById = Object.fromEntries((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const p = [];

  // stages conectados (target de trigger o de una etiqueta GPT) pero sin rol elegido
  const connectedStages = new Set(
    edges
      .filter((e) => nodeById[e.target]?.type === "stage" && (nodeById[e.source]?.type === "trigger" || nodeById[e.source]?.type === "gpt"))
      .map((e) => e.target),
  );
  for (const id of connectedStages) {
    if (!(nodeById[id]?.data?.role || "").trim()) p.push("Hay un stage conectado sin rol elegido (se ignoraría).");
  }

  // nodos GPT colgados del trigger
  const gptIds = edges.filter((e) => nodeById[e.source]?.type === "trigger" && nodeById[e.target]?.type === "gpt").map((e) => e.target);
  for (const gid of gptIds) {
    const labels = nodeById[gid]?.data?.labels || [];
    const names = labels.map((l) => (l.name || "").trim()).filter(Boolean);
    const dups = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (dups.length) p.push(`El nodo de IA tiene etiquetas con nombre repetido (${dups.join(", ")}); una se perdería.`);
    const valid = labels.filter(
      (l) => (l.name || "").trim() && edges.some((e) => e.source === gid && e.sourceHandle === l.id && (nodeById[e.target]?.data?.role || "").trim()),
    );
    if (valid.length === 0) p.push("Un nodo de IA conectado no tiene etiquetas válidas (cada etiqueta necesita nombre y un stage con rol).");
  }

  return [...new Set(p)];
}

export function modelToSpec(model) {
  const flows = {};
  if (model.include.analisis_postllamada) flows.analisis_postllamada = graphToAnalisis(model.analisis, model.include);
  if (model.include.seguimientos) {
    flows.seguimientos = { trigger: { type: "webhook" }, sequence: model.seguimientos.sequence };
  }
  if (model.include.cita_agendada && String(model.cita.stage || "").trim()) {
    flows.cita_agendada = {
      trigger: { type: "tag", tag: "cita agendada" },
      stage: model.cita.stage,
      ...(model.cita.reminders ? { reminders: [{ before: "1d", via: "ghl" }, { before: "4h", via: "ghl" }] } : {}),
    };
  }
  return {
    project: (model.project || "cliente").trim() || "cliente",
    description: model.description || "",
    stages: model.stages,
    flows,
  };
}

// Modelo inicial (reproduce el cableado de primedental) para que el canvas arranque con algo
// editable y válido en vez de vacío.
export function defaultModel() {
  const nodes = [
    { id: "trigger", type: "trigger", position: { x: 0, y: 180 }, data: {}, deletable: false },
    { id: "s_dnc", type: "stage", position: { x: 340, y: 0 }, data: { role: "dnc" } },
    { id: "s_dna", type: "stage", position: { x: 340, y: 110 }, data: { role: "dna" } },
    {
      id: "gpt", type: "gpt", position: { x: 340, y: 240 },
      data: {
        labels: [
          { id: "l_wa", name: "whatsapp", gptReason: false, notify: false },
          { id: "l_ia", name: "llamada ia", gptReason: false, notify: false },
          { id: "l_man", name: "seguimiento manual", gptReason: true, notify: true },
        ],
      },
    },
    { id: "s_wa", type: "stage", position: { x: 720, y: 210 }, data: { role: "whatsapp" } },
    { id: "s_seg1", type: "stage", position: { x: 720, y: 320 }, data: { role: "seguimiento" } },
    { id: "s_seg2", type: "stage", position: { x: 720, y: 430 }, data: { role: "seguimiento" } },
    { id: "ref-seguimientos", type: "flowref", position: { x: 1060, y: 320 }, data: { flow: "seguimientos" }, deletable: false },
    { id: "ref-cita_agendada", type: "flowref", position: { x: 1060, y: 430 }, data: { flow: "cita_agendada" }, deletable: false },
  ];
  const e = (id, source, sourceHandle, target) => ({ id, source, sourceHandle, target, targetHandle: "in" });
  const edges = [
    e("e1", "trigger", "dnc", "s_dnc"),
    e("e2", "trigger", "dna", "s_dna"),
    e("e3", "trigger", "answered", "gpt"),
    e("e4", "s_dna", "then", "ref-seguimientos"),
    e("e5", "gpt", "l_wa", "s_wa"),
    e("e6", "gpt", "l_ia", "s_seg1"),
    e("e7", "gpt", "l_man", "s_seg2"),
    e("e8", "s_seg1", "then", "ref-seguimientos"),
  ];
  return {
    project: "",
    description: "",
    stages: [...STAGE_PRESETS],
    analisis: { nodes, edges },
    include: { analisis_postllamada: true, seguimientos: true, cita_agendada: true },
    seguimientos: {
      sequence: [
        { wait: "2h" },
        { call: true },
        { wait: "24h" },
        { call: true },
      ],
    },
    cita: { stage: "exito", reminders: true },
  };
}
