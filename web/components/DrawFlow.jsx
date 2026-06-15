"use client";

// Editor visual de /dibujar: armás el cableado del flow "analisis" como grafo (React Flow)
// y configurás seguimientos/cita como formularios. Genera un flow-spec y lo entrega al
// mismo ConfigProvision (reusa toda la config + provisión + fixes).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { modelToSpec, analisisProblems, defaultModel, STAGE_PRESETS } from "@/lib/draw-spec";
import ConfigProvision from "@/components/ConfigProvision";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
const miniSel = "nodrag rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none";

// ── contexto para que los nodos custom editen su data ──
const EditorCtx = createContext(null);
const useEditor = () => useContext(EditorCtx);

// ── nodos custom ──
function TriggerNode() {
  return (
    <div className="w-[200px] rounded-lg border border-indigo-500 bg-slate-900 text-xs">
      <div className="border-b border-slate-700 px-3 py-2 font-semibold text-indigo-300">Oraia · post-llamada</div>
      <div className="py-1">
        {["dnc", "dna", "answered"].map((t) => (
          <div key={t} className="relative px-3 py-1.5 text-slate-300">
            {t}
            <Handle type="source" position={Position.Right} id={t} style={{ top: "50%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StageNode({ id, data }) {
  const { stages, updateNodeData } = useEditor();
  return (
    <div className="w-[190px] rounded-lg border border-slate-600 bg-slate-900 text-xs">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="px-2 py-1.5">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Stage</div>
        <select className={miniSel + " w-full"} value={data.role || ""} onChange={(e) => updateNodeData(id, { role: e.target.value })}>
          <option value="">— elegí rol —</option>
          {stages.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="relative border-t border-slate-800 px-2 py-1 text-right text-[10px] text-slate-500">
        then →
        <Handle type="source" position={Position.Right} id="then" style={{ top: "50%" }} />
      </div>
    </div>
  );
}

function GptNode({ id, data }) {
  const { updateNodeData, onRemoveLabel } = useEditor();
  const upd = useUpdateNodeInternals();
  const labels = data.labels || [];
  useEffect(() => { upd(id); }, [labels.length, id, upd]);
  const setLabel = (lid, patch) => updateNodeData(id, { labels: labels.map((l) => (l.id === lid ? { ...l, ...patch } : l)) });
  const addLabel = () => updateNodeData(id, { labels: [...labels, { id: "l" + Math.random().toString(36).slice(2, 7), name: "", gptReason: false, notify: false }] });
  const removeLabel = (lid) => onRemoveLabel(id, lid); // poda también la arista colgante
  return (
    <div className="w-[240px] rounded-lg border border-emerald-600 bg-slate-900 text-xs">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="border-b border-slate-700 px-2 py-1.5 font-semibold text-emerald-300">IA · análisis</div>
      <div>
        {labels.map((l) => (
          <div key={l.id} className="relative border-b border-slate-800 px-2 py-1.5">
            <div className="flex items-center gap-1">
              <input className={miniSel + " flex-1"} value={l.name} onChange={(e) => setLabel(l.id, { name: e.target.value })} placeholder="etiqueta" />
              <button className="nodrag px-1 text-slate-500 hover:text-rose-400" onClick={() => removeLabel(l.id)} title="quitar">×</button>
            </div>
            <div className="mt-1 flex gap-3 text-[10px] text-slate-400">
              <label className="flex items-center gap-1"><input type="checkbox" className="nodrag" checked={!!l.gptReason} onChange={(e) => setLabel(l.id, { gptReason: e.target.checked })} />motivo</label>
              <label className="flex items-center gap-1"><input type="checkbox" className="nodrag" checked={!!l.notify} onChange={(e) => setLabel(l.id, { notify: e.target.checked })} />notif</label>
            </div>
            <Handle type="source" position={Position.Right} id={l.id} style={{ top: "50%" }} />
          </div>
        ))}
      </div>
      <button className="nodrag w-full px-2 py-1.5 text-left text-[10px] text-emerald-400 hover:bg-slate-800" onClick={addLabel}>+ etiqueta</button>
    </div>
  );
}

function FlowRefNode({ data }) {
  return (
    <div className="w-[160px] rounded-lg border border-amber-600 bg-slate-900 px-2 py-2 text-xs">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="text-[10px] uppercase tracking-wide text-slate-500">enrolar en</div>
      <div className="font-semibold text-amber-300">{data.flow === "seguimientos" ? "Seguimientos" : "Cita agendada"}</div>
    </div>
  );
}

// Nota libre (estilo FigJam): texto suelto para anotar. No tiene handles → el serializador
// la ignora (no afecta el flow-spec). Se puede mover y borrar.
function NoteNode({ id, data }) {
  const { updateNodeData } = useEditor();
  return (
    <div className="w-[200px] rounded-lg border border-yellow-600/60 bg-yellow-950/30 p-1.5">
      <textarea
        className="nodrag w-full resize-none border-0 bg-transparent text-xs text-yellow-100 placeholder:text-yellow-200/40 focus:outline-none"
        rows={3}
        value={data.text || ""}
        onChange={(e) => updateNodeData(id, { text: e.target.value })}
        placeholder="Nota…"
      />
    </div>
  );
}

const nodeTypes = { trigger: TriggerNode, stage: StageNode, gpt: GptNode, flowref: FlowRefNode, note: NoteNode };

// ── editor de la secuencia de seguimientos ──
const stepType = (s) => (s.wait != null ? "wait" : "call");
function SeqEditor({ seq, onChange }) {
  const set = (i, step) => onChange(seq.map((s, j) => (j === i ? step : s)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= seq.length) return;
    const next = [...seq];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => onChange(seq.filter((_, j) => j !== i));
  const add = () => onChange([...seq, { wait: "2h" }]);
  const changeType = (i, t) => set(i, t === "wait" ? { wait: "2h" } : { call: true });
  return (
    <div className="space-y-2">
      {seq.map((s, i) => {
        const t = stepType(s);
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 p-2">
            <span className="text-[10px] text-slate-500">{i + 1}</span>
            <select className={miniSel} value={t} onChange={(e) => changeType(i, e.target.value)}>
              <option value="wait">esperar</option>
              <option value="call">lanzar llamada</option>
            </select>
            {t === "wait" && (
              <input className={miniSel + " w-24"} value={s.wait} onChange={(e) => set(i, { wait: e.target.value })} placeholder="2h / 30m / 1d" />
            )}
            {t === "call" && <span className="text-[10px] text-slate-500">tag “llamar” (si el lead no salió del seguimiento)</span>}
            <span className="ml-auto flex items-center gap-1">
              <button className="px-1 text-slate-500 hover:text-slate-200" onClick={() => move(i, -1)} title="subir">↑</button>
              <button className="px-1 text-slate-500 hover:text-slate-200" onClick={() => move(i, 1)} title="bajar">↓</button>
              <button className="px-1 text-slate-500 hover:text-rose-400" onClick={() => remove(i)} title="quitar">×</button>
            </span>
          </div>
        );
      })}
      <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={add}>+ paso</button>
    </div>
  );
}

// ── editor principal ──
export default function DrawFlow() {
  const init = useMemo(() => defaultModel(), []);
  const [step, setStep] = useState("draw"); // draw | config
  const [committedSpec, setCommittedSpec] = useState(null);

  const [nodes, setNodes] = useState(init.analisis.nodes);
  const [edges, setEdges] = useState(init.analisis.edges);
  const [project, setProject] = useState(init.project);
  const [description, setDescription] = useState(init.description);
  // El input de stages guarda el TEXTO CRUDO; el array se deriva. Así se pueden tipear comas
  // y espacios sin que se borren (antes el value se re-derivaba del array y los comía).
  const [stagesText, setStagesText] = useState(init.stages.join(", "));
  const stages = useMemo(() => [...new Set(stagesText.split(",").map((s) => s.trim()).filter(Boolean))], [stagesText]);
  const [include, setInclude] = useState(init.include);
  const [seguimientos, setSeguimientos] = useState(init.seguimientos);
  const [cita, setCita] = useState(init.cita);
  const [showJson, setShowJson] = useState(false);

  const idc = useRef(1000);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onNodesChange = useCallback((chs) => setNodes((nds) => applyNodeChanges(chs, nds)), []);
  const onEdgesChange = useCallback((chs) => setEdges((eds) => applyEdgeChanges(chs, eds)), []);
  const updateNodeData = useCallback((id, patch) => setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))), []);
  // borrar una etiqueta GPT: saca la etiqueta del nodo Y poda la arista que salía de su handle
  // (si no, queda una arista colgante → error008 de React Flow + arista huérfana en el estado).
  const onRemoveLabel = useCallback((nodeId, lid) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, labels: (n.data.labels || []).filter((l) => l.id !== lid) } } : n)));
    setEdges((eds) => eds.filter((e) => !(e.source === nodeId && e.sourceHandle === lid)));
  }, []);

  const isValidConnection = useCallback((conn) => {
    const src = nodesRef.current.find((n) => n.id === conn.source);
    const tgt = nodesRef.current.find((n) => n.id === conn.target);
    if (!src || !tgt) return false;
    if (src.type === "trigger") return (tgt.type === "stage" || tgt.type === "gpt") && conn.targetHandle === "in";
    if (src.type === "stage" && conn.sourceHandle === "then") return tgt.type === "flowref" && conn.targetHandle === "in";
    if (src.type === "gpt") return tgt.type === "stage" && conn.targetHandle === "in";
    return false;
  }, []);

  const onConnect = useCallback((params) => {
    setEdges((eds) => {
      // una sola arista por handle de salida (reconectar reemplaza)
      const filtered = eds.filter((e) => !(e.source === params.source && (e.sourceHandle ?? null) === (params.sourceHandle ?? null)));
      return [...filtered, { ...params, id: `e${idc.current++}`, markerEnd: { type: MarkerType.ArrowClosed } }];
    });
  }, []);

  const addStage = () => setNodes((nds) => [...nds, { id: `s${idc.current++}`, type: "stage", position: { x: 420, y: 520 }, data: { role: "" } }]);
  const addGpt = () => setNodes((nds) => [...nds, { id: `g${idc.current++}`, type: "gpt", position: { x: 420, y: 560 }, data: { labels: [] } }]);
  const addNote = () => setNodes((nds) => [...nds, { id: `note${idc.current++}`, type: "note", position: { x: 420, y: 480 }, data: { text: "" } }]);

  // Borra lo seleccionado (nodos borrables + sus aristas + aristas seleccionadas). Complementa
  // la tecla Supr con un botón visible.
  const deleteSelected = () => {
    const del = new Set(nodesRef.current.filter((n) => n.selected && n.deletable !== false).map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !del.has(n.id)));
    setEdges((eds) => eds.filter((e) => !e.selected && !del.has(e.source) && !del.has(e.target)));
  };

  const spec = useMemo(
    () => modelToSpec({ project, description, stages, analisis: { nodes, edges }, include, seguimientos, cita }),
    [project, description, stages, nodes, edges, include, seguimientos, cita],
  );
  const flowNames = Object.keys(spec.flows);

  const editorValue = useMemo(() => ({ stages, updateNodeData, onRemoveLabel }), [stages, updateNodeData, onRemoveLabel]);

  // Al SALIR del campo de stages, reconcilia los roles huérfanos (un rol borrado de la lista que
  // siga guardado en un nodo/cita/secuencia serializaría un stage que no está en spec.stages).
  // Se hace en blur, no en cada tecla, para no romper el tipeo de comas/espacios.
  const reconcileStages = () => {
    const valid = stages;
    setNodes((nds) => nds.map((n) => (n.type === "stage" && n.data.role && !valid.includes(n.data.role) ? { ...n, data: { ...n.data, role: "" } } : n)));
    setCita((c) => (c.stage && !valid.includes(c.stage) ? { ...c, stage: "" } : c));
    setSeguimientos((sg) => ({
      sequence: sg.sequence.map((s) => {
        let ns = s;
        if (s.stage && !valid.includes(s.stage)) ns = { ...ns, stage: "" };
        if (ns.onAnswered?.stage && !valid.includes(ns.onAnswered.stage)) { const { onAnswered, ...rest } = ns; ns = rest; }
        return ns;
      }),
    }));
  };

  const problems = useMemo(() => {
    const p = [];
    if (include.analisis_postllamada) {
      if (Object.keys(spec.flows.analisis_postllamada?.routes || {}).length === 0) {
        p.push("El grafo de análisis no resuelve ninguna ruta: conectá una salida del trigger (dnc/dna/answered) a un stage con rol o a un nodo IA con etiquetas.");
      }
      for (const w of analisisProblems({ nodes, edges })) p.push(w);
    }
    if (include.cita_agendada && !String(cita.stage || "").trim()) p.push("Cita agendada: elegí el stage de éxito.");
    if (include.seguimientos) {
      seguimientos.sequence.forEach((s, i) => {
        const t = stepType(s);
        if (t === "wait" && !/^\d+[hmd]$/.test(String(s.wait || "").trim())) p.push(`Seguimientos paso ${i + 1}: la espera debe ser como 2h / 30m / 1d.`);
      });
    }
    return [...new Set(p)];
  }, [include, spec, nodes, edges, cita, seguimientos]);

  const canContinue = flowNames.length > 0 && problems.length === 0;

  if (step === "config" && committedSpec) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <button onClick={() => setStep("draw")} className="text-sm text-slate-400 hover:text-slate-200">← Volver al editor</button>
        <h1 className="mt-4 text-3xl font-bold">Provisionar</h1>
        <div className="mt-6">
          <ConfigProvision key={JSON.stringify(committedSpec)} spec={committedSpec} project={committedSpec.project || "cliente"} />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">← Volver</Link>
      <h1 className="mt-3 text-3xl font-bold">Dibujar flujograma</h1>
      <p className="mt-2 text-sm text-slate-400">
        Conectá las salidas del trigger (dnc/dna/answered) a stages o a un nodo de IA. La salida <span className="text-slate-300">then</span> de un stage va a Seguimientos/Cita (enrollment).
      </p>

      <div className="mt-6 flex flex-col gap-5 lg:flex-row">
        {/* canvas */}
        <div className="lg:flex-1">
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={addStage} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs hover:border-slate-500">+ Stage</button>
            <button onClick={addGpt} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs hover:border-slate-500">+ IA análisis</button>
            <button onClick={addNote} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs hover:border-slate-500">+ Nota</button>
            <button onClick={deleteSelected} className="rounded-lg border border-rose-800 bg-slate-900 px-3 py-1.5 text-xs text-rose-300 hover:border-rose-600">🗑 Borrar selección</button>
            <span className="self-center text-[11px] text-slate-500">Clic para seleccionar · Supr o el botón para borrar · arrastrá desde un punto para conectar</span>
          </div>
          <div className="h-[600px] rounded-xl border border-slate-800 bg-slate-950">
            <EditorCtx.Provider value={editorValue}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                nodeTypes={nodeTypes}
                deleteKeyCode={["Delete", "Backspace"]}
                fitView
                colorMode="dark"
              >
                <Background />
                <Controls />
              </ReactFlow>
            </EditorCtx.Provider>
          </div>
        </div>

        {/* panel */}
        <div className="space-y-5 lg:w-[380px]">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Nombre del cliente / proyecto</span>
            <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="acme" className={inputCls} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Stages (roles, separados por coma)</span>
            <input value={stagesText} onChange={(e) => setStagesText(e.target.value)} onBlur={reconcileStages} className={inputCls} placeholder="lead_nuevo, dnc, dna, whatsapp, …" />
            <span className="mt-1 block text-[11px] text-slate-500">Estos roles aparecen en los dropdowns de los stages.</span>
          </label>

          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Flows a incluir</span>
            {[
              ["analisis_postllamada", "Análisis post-llamada (el grafo)"],
              ["seguimientos", "Seguimientos"],
              ["cita_agendada", "Cita agendada"],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={!!include[k]} onChange={(e) => setInclude((s) => ({ ...s, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>

          {include.seguimientos && (
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Secuencia de seguimientos</span>
              <SeqEditor seq={seguimientos.sequence} onChange={(sequence) => setSeguimientos({ sequence })} />
            </div>
          )}

          {include.cita_agendada && (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cita agendada</span>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">Stage (éxito)</span>
                <select value={cita.stage} onChange={(e) => setCita((s) => ({ ...s, stage: e.target.value }))} className={inputCls}>
                  <option value="">— stage —</option>
                  {stages.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={!!cita.reminders} onChange={(e) => setCita((s) => ({ ...s, reminders: e.target.checked }))} />
                Tag de recordatorios (los dispara GHL)
              </label>
            </div>
          )}

          <div>
            <button onClick={() => setShowJson((v) => !v)} className="text-xs text-slate-400 hover:text-slate-200">
              {showJson ? "Ocultar" : "Ver"} flow-spec
            </button>
            {showJson && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-400">
                {JSON.stringify(spec, null, 2)}
              </pre>
            )}
          </div>

          {flowNames.length === 0 && <p className="text-xs text-amber-400">Incluí al menos un flow.</p>}
          {problems.length > 0 && (
            <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-400">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          <button
            onClick={() => { setCommittedSpec(spec); setStep("config"); }}
            disabled={!canContinue}
            className="w-full rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Continuar a la config →
          </button>
        </div>
      </div>
    </main>
  );
}
