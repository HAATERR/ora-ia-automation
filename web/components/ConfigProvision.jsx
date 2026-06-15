"use client";

// Config + provisión. Recibe un flow-spec (ya revisado) y:
//  1. lo compila en el cliente para saber qué tokens pide cada flow,
//  2. valida el PIT y carga pipelines/stages/custom fields de GHL → dropdowns,
//  3. arma la config por flow y llama a /api/provision,
//  4. muestra el reporte con las webhook URLs para pegar en GHL.
// Reutilizable por /importar y /dibujar.

import { useMemo, useState } from "react";
import { compileFlowSpec } from "@/lib/engine/generate.mjs";
import { requiredTokens, enrollmentTargets, fieldMeta, FLOW_LABEL, FLOW_SHORT } from "@/lib/tokens";
import { buildClassifyPrompt, buildReasonPrompt } from "@/lib/prompts";
import { readJsonSafe } from "@/lib/http";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";

const slug = (s) =>
  String(s || "cliente").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "cliente";

export default function ConfigProvision({ spec, project }) {
  // ── compilar el spec (client-side; generate.mjs es JS puro) ──
  const { compiled, compileError } = useMemo(() => {
    try {
      return { compiled: compileFlowSpec(spec), compileError: null };
    } catch (e) {
      return { compiled: {}, compileError: e.message };
    }
  }, [spec]);

  const flowNames = useMemo(() => Object.keys(compiled), [compiled]);
  const flowTokens = useMemo(() => {
    const m = {};
    for (const fn of flowNames) m[fn] = requiredTokens(compiled[fn]);
    return m;
  }, [compiled, flowNames]);

  // ── estado del formulario ──
  const [pit, setPit] = useState("");
  const [locationId, setLocationId] = useState("");
  const [ghl, setGhl] = useState(null); // { pipelines, customFields, customValues }
  const [ghlLoading, setGhlLoading] = useState(false);
  const [ghlError, setGhlError] = useState(null);
  const [pipelineId, setPipelineId] = useState("");

  const [enabled, setEnabled] = useState(() => Object.fromEntries(flowNames.map((fn) => [fn, true])));
  const [activate, setActivate] = useState(() => Object.fromEntries(flowNames.map((fn) => [fn, true])));
  const [names, setNames] = useState(() =>
    Object.fromEntries(flowNames.map((fn) => [fn, `${FLOW_LABEL[fn] || fn} - ${project}`])),
  );
  const [values, setValues] = useState(() => {
    // etiquetas de clasificación del flow (del gptClassify del spec) → para auto-generar el prompt
    const labelsOf = (fn) => {
      const routes = spec.flows?.[fn]?.routes;
      if (routes) for (const r of Object.values(routes)) if (r.gptClassify?.labels) return Object.keys(r.gptClassify.labels);
      return [];
    };
    const v = {};
    for (const fn of flowNames) {
      v[fn] = {};
      for (const tk of flowTokens[fn]) {
        if (tk === "ORA_PIPELINE_ID") continue; // pipeline es global
        const meta = fieldMeta(tk);
        if (tk === "ORA_GPT_CLASSIFY_PROMPT") v[fn][tk] = buildClassifyPrompt(labelsOf(fn));
        else if (tk === "ORA_GPT_REASON_PROMPT") v[fn][tk] = buildReasonPrompt();
        else if (meta.kind === "webhookPath") v[fn][tk] = `${slug(project)}-${FLOW_SHORT[fn] || fn}`;
        else v[fn][tk] = meta.default || "";
      }
    }
    return v;
  });

  const [provisioning, setProvisioning] = useState(false);
  const [report, setReport] = useState(null);
  const [provError, setProvError] = useState(null);

  // generación del prompt con IA (a medida de las etiquetas)
  const [genContext, setGenContext] = useState("");
  const [genBusy, setGenBusy] = useState(null); // flowName en curso
  const [genError, setGenError] = useState(null);

  const setVal = (fn, tk, val) => setValues((s) => ({ ...s, [fn]: { ...s[fn], [tk]: val } }));

  // etiquetas de clasificación de un flow (del gptClassify del spec)
  const labelsForFlow = (fn) => {
    const routes = spec.flows?.[fn]?.routes;
    if (routes) for (const r of Object.values(routes)) if (r.gptClassify?.labels) return Object.keys(r.gptClassify.labels);
    return [];
  };

  async function generatePrompt(fn) {
    const labels = labelsForFlow(fn);
    if (labels.length < 2) {
      setGenError("Necesitás al menos 2 etiquetas en el nodo IA.");
      return;
    }
    setGenError(null);
    setGenBusy(fn);
    try {
      const r = await fetch("/api/gen-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels, project, context: genContext }),
      });
      const data = await readJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "No pude generar el prompt.");
      setVal(fn, "ORA_GPT_CLASSIFY_PROMPT", data.prompt);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenBusy(null);
    }
  }

  const selectedPipeline = ghl?.pipelines?.find((p) => p.id === pipelineId);
  const stageOptions = selectedPipeline?.stages || [];
  const cfOptions = ghl?.customFields || [];

  async function loadGhl() {
    if (!pit.trim() || !locationId.trim()) {
      setGhlError("Completá el PIT y el Location ID de la subcuenta primero.");
      return;
    }
    setGhlError(null);
    setGhlLoading(true);
    try {
      const r = await fetch("/api/ghl-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pit, locationId }),
      });
      const data = await readJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "No pude leer la subcuenta.");
      setGhl(data);
      // Reset de los IDs elegidos: si recargás otra subcuenta, los stage/custom field de la
      // anterior ya no son válidos (sus selects quedarían en blanco pero con valor stale →
      // se provisionaría contra la location equivocada). Los limpiamos siempre.
      setPipelineId(data.pipelines?.length === 1 ? data.pipelines[0].id : "");
      setValues((prev) => {
        const next = {};
        for (const fn of flowNames) {
          next[fn] = { ...prev[fn] };
          for (const tk of flowTokens[fn]) {
            const kind = fieldMeta(tk).kind;
            if (kind === "stage" || kind === "customField") next[fn][tk] = "";
          }
        }
        return next;
      });
    } catch (e) {
      setGhl(null);
      setGhlError(e.message);
    } finally {
      setGhlLoading(false);
    }
  }

  // tokens stage/cf necesitan GHL cargado
  const needsGhl = useMemo(
    () => flowNames.some((fn) => enabled[fn] && flowTokens[fn].some((t) => t.startsWith("ORA_STAGE_") || t.startsWith("ORA_CF_") || t === "ORA_PIPELINE_ID")),
    [flowNames, enabled, flowTokens],
  );

  const missing = useMemo(() => {
    const m = [];
    for (const fn of flowNames) {
      if (!enabled[fn]) continue;
      for (const tk of flowTokens[fn]) {
        if (tk === "ORA_PIPELINE_ID") {
          if (!pipelineId) m.push(`${FLOW_LABEL[fn] || fn}: pipeline`);
          continue;
        }
        if (!String(values[fn]?.[tk] ?? "").trim()) m.push(`${FLOW_LABEL[fn] || fn}: ${fieldMeta(tk).label}`);
      }
    }
    // Dependencias de enrollment: si un flow enrola en otro (then/onAnswered), el destino
    // tiene que estar también activado, si no el motor no puede resolver su URL de webhook.
    for (const fn of flowNames) {
      if (!enabled[fn]) continue;
      for (const target of enrollmentTargets(compiled[fn])) {
        if (!flowNames.includes(target) || !enabled[target]) {
          m.push(`${FLOW_LABEL[fn] || fn} enrola en ${FLOW_LABEL[target] || target}: activá ${FLOW_LABEL[target] || target} o quitá el "then" del flow-spec`);
        }
      }
    }
    return m;
  }, [flowNames, enabled, flowTokens, values, pipelineId, compiled]);

  const anyEnabled = flowNames.some((fn) => enabled[fn]);
  const canProvision = !!pit && !!locationId && anyEnabled && missing.length === 0 && !provisioning;

  async function provision() {
    setProvError(null);
    setProvisioning(true);
    setReport(null);
    try {
      const flows = flowNames
        .filter((fn) => enabled[fn])
        .map((fn) => {
          const tokens = { ...values[fn] };
          if (flowTokens[fn].includes("ORA_PIPELINE_ID")) tokens.ORA_PIPELINE_ID = pipelineId;
          return { flowName: fn, name: names[fn], activate: activate[fn], tokens };
        });
      const r = await fetch("/api/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, pit, locationId, clientName: project, flows }),
      });
      const data = await readJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || "Error provisionando.");
      setReport(data.report);
    } catch (e) {
      setProvError(e.message);
    } finally {
      setProvisioning(false);
    }
  }

  if (compileError) {
    return (
      <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
        No pude compilar el flow-spec: {compileError}
      </div>
    );
  }

  // ── reporte final ──
  if (report) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
          <h3 className="font-semibold text-emerald-300">✅ Provisionado</h3>
          <p className="mt-1 text-sm text-slate-300">
            {report.workflows.length} workflow(s) creados en n8n
            {report.credentialId ? ` · credencial ${report.credentialId}` : ""}.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-300">Webhook URLs (pegalas en GHL/Simpletalk)</h4>
          {report.workflows.map((w) => (
            <div key={w.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{w.name}</span>
                <span className={`text-xs ${w.activated ? "text-emerald-400" : "text-amber-400"}`}>
                  {w.activated ? "activo" : "inactivo"} · {w.id}
                </span>
              </div>
              {w.webhookUrl && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-slate-950 px-2 py-1 text-xs text-indigo-300">
                    {w.webhookUrl}
                  </code>
                  <button
                    onClick={() => navigator.clipboard?.writeText(w.webhookUrl)}
                    className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
                  >
                    copiar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <details className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm">
          <summary className="cursor-pointer text-slate-400">Pipelines y stages (referencia)</summary>
          <pre className="mt-2 overflow-auto text-xs text-slate-400">{JSON.stringify(report.pipelines, null, 2)}</pre>
        </details>

        <button
          onClick={() => setReport(null)}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Volver a la config
        </button>
      </div>
    );
  }

  // ── formulario ──
  return (
    <div className="space-y-8">
      {/* Subcuenta */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">1 · Subcuenta GHL</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Private Integration Token (PIT)</span>
            <input
              type="password"
              value={pit}
              onChange={(e) => setPit(e.target.value)}
              placeholder="pit-..."
              className={inputCls}
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Location ID</span>
            <input value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="HOu6..." className={inputCls} />
          </label>
        </div>
        <p className="text-[11px] text-slate-500">Pegá el PIT y el Location ID de la subcuenta, después tocá el botón para traer pipelines, stages y custom fields.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={loadGhl}
            disabled={ghlLoading}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {ghlLoading ? "Cargando…" : ghl ? "Recargar IDs de GHL" : "Cargar IDs de GHL"}
          </button>
          {ghl && (
            <span className="text-xs text-emerald-400">
              ✓ {ghl.pipelines.length} pipeline(s), {ghl.customFields.length} custom field(s)
            </span>
          )}
        </div>
        {ghlError && <p className="text-sm text-rose-400">{ghlError}</p>}
      </section>

      {/* Pipeline global */}
      {needsGhl && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">2 · Pipeline</h3>
          <select
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
            disabled={!ghl}
            className={inputCls + " disabled:opacity-40"}
          >
            <option value="">{ghl ? "Elegí el pipeline del cableado…" : "Cargá los IDs de GHL primero"}</option>
            {ghl?.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </section>
      )}

      {/* Flows */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">3 · Workflows a crear</h3>
        {flowNames.map((fn) => (
          <div key={fn} className={`rounded-xl border p-4 ${enabled[fn] ? "border-slate-700 bg-slate-900/60" : "border-slate-800 bg-slate-900/20 opacity-60"}`}>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enabled[fn]}
                  onChange={(e) => setEnabled((s) => ({ ...s, [fn]: e.target.checked }))}
                  className="h-4 w-4 accent-indigo-500"
                />
                <span className="font-semibold">{FLOW_LABEL[fn] || fn}</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={activate[fn]}
                  onChange={(e) => setActivate((s) => ({ ...s, [fn]: e.target.checked }))}
                  disabled={!enabled[fn]}
                  className="h-4 w-4 accent-emerald-500"
                />
                activar al crear
              </label>
            </div>

            {enabled[fn] && (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">Nombre en n8n</span>
                  <input value={names[fn]} onChange={(e) => setNames((s) => ({ ...s, [fn]: e.target.value }))} className={inputCls} />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  {flowTokens[fn]
                    .filter((tk) => tk !== "ORA_PIPELINE_ID")
                    .map((tk) => {
                      const meta = fieldMeta(tk);
                      const val = values[fn]?.[tk] ?? "";
                      const common = { value: val, onChange: (e) => setVal(fn, tk, e.target.value) };
                      return (
                        <label key={tk} className={meta.kind === "textarea" ? "block sm:col-span-2" : "block"}>
                          <span className="mb-1 block text-xs text-slate-400">{meta.label}</span>
                          {meta.kind === "stage" ? (
                            <select {...common} disabled={!selectedPipeline} className={inputCls + " disabled:opacity-40"}>
                              <option value="">{selectedPipeline ? "Elegí stage…" : "Elegí pipeline primero"}</option>
                              {stageOptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          ) : meta.kind === "customField" ? (
                            <select {...common} disabled={!ghl} className={inputCls + " disabled:opacity-40"}>
                              <option value="">{ghl ? "Elegí custom field…" : "Cargá los IDs de GHL"}</option>
                              {cfOptions.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          ) : meta.kind === "textarea" ? (
                            <>
                              {tk === "ORA_GPT_CLASSIFY_PROMPT" && (
                                <div className="mb-2 space-y-1.5">
                                  <input
                                    value={genContext}
                                    onChange={(e) => setGenContext(e.target.value)}
                                    placeholder="Contexto del negocio (opcional): ej. clínica dental, valoración $499, sucursales CDMX/Querétaro"
                                    className={inputCls + " text-xs"}
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => generatePrompt(fn)}
                                      disabled={genBusy === fn}
                                      className="rounded-lg border border-indigo-700 bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:border-indigo-500 disabled:opacity-50"
                                    >
                                      {genBusy === fn ? "Generando… (~30s)" : "✨ Generar con IA (según las etiquetas)"}
                                    </button>
                                    {genError && <span className="text-[11px] text-rose-400">{genError}</span>}
                                  </div>
                                </div>
                              )}
                              <textarea {...common} rows={tk === "ORA_GPT_CLASSIFY_PROMPT" ? 10 : 4} className={inputCls + (tk.startsWith("ORA_GPT_") ? " font-mono text-xs leading-relaxed" : "")} placeholder={meta.help} />
                            </>
                          ) : (
                            <input {...common} className={inputCls} placeholder={meta.help} />
                          )}
                          {meta.help && meta.kind !== "textarea" && <span className="mt-1 block text-[11px] text-slate-500">{meta.help}</span>}
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Provisionar */}
      <section className="space-y-3 border-t border-slate-800 pt-5">
        {missing.length > 0 && anyEnabled && (
          <details className="text-xs text-amber-400">
            <summary className="cursor-pointer">Faltan {missing.length} campo(s) por completar</summary>
            <ul className="mt-1 list-inside list-disc text-slate-400">
              {missing.slice(0, 12).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </details>
        )}
        {provError && <p className="text-sm text-rose-400">{provError}</p>}
        <button
          onClick={provision}
          disabled={!canProvision}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {provisioning ? "Provisionando…" : "Provisionar en n8n"}
        </button>
      </section>
    </div>
  );
}
