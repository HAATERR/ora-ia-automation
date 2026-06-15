"use client";

// Flujo de /importar: subir imagen → Claude interpreta → revisar/editar flow-spec → config.
import { useMemo, useState } from "react";
import Link from "next/link";
import { COMPILABLE_FLOWS } from "@/lib/engine/generate.mjs";
import { readJsonSafe } from "@/lib/http";
import ConfigProvision from "@/components/ConfigProvision";

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";

const MAX_INLINE = 3.5 * 1024 * 1024; // límite seguro bajo los 4.5 MB de Vercel
const MAX_DIM = 1600; // px por lado
const MAX_AREA = 4096 * 4096; // tope de área del canvas (algunos browsers cap más bajo)
const TOO_BIG = "La imagen es muy grande incluso al achicarla. Reducila e intentá de nuevo.";

// Achica imágenes raster grandes en el cliente (canvas) limitando ambas dimensiones y el
// área. Sale en JPEG (respeta calidad y queda mucho más chico que PNG para flujogramas).
// SVG pasa tal cual (lo rasteriza el server con resvg). Si el canvas falla por otra causa,
// manda el original; si ni achicando entra en el límite, lanza un error claro.
async function prepareImage(file) {
  if (file.type.includes("svg")) return file;
  if (file.size <= MAX_INLINE) return file;
  let blob;
  try {
    const bitmap = await createImageBitmap(file);
    let scale = Math.min(1, MAX_DIM / bitmap.width, MAX_DIM / bitmap.height);
    if (bitmap.width * bitmap.height * scale * scale > MAX_AREA) {
      scale = Math.min(scale, Math.sqrt(MAX_AREA / (bitmap.width * bitmap.height)));
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (blob && blob.size > MAX_INLINE) blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.7));
  } catch {
    return file; // canvas tainted u otro fallo → mandá el original (el server decide)
  }
  if (!blob) return file;
  if (blob.size > MAX_INLINE) throw new Error(TOO_BIG);
  return new File([blob], "flujograma.jpg", { type: "image/jpeg" });
}

export default function ImportFlow() {
  const [step, setStep] = useState("upload"); // upload | review | config
  const [file, setFile] = useState(null);
  const [project, setProject] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [specText, setSpecText] = useState("");
  const [specObj, setSpecObj] = useState(null);

  // validación del JSON en el paso "review"
  const { parsed, parseErr, compilable } = useMemo(() => {
    if (!specText.trim()) return { parsed: null, parseErr: null, compilable: [] };
    try {
      const p = JSON.parse(specText);
      const flows = p?.flows ? Object.keys(p.flows) : [];
      return { parsed: p, parseErr: null, compilable: flows.filter((f) => COMPILABLE_FLOWS.includes(f)) };
    } catch (e) {
      return { parsed: null, parseErr: e.message, compilable: [] };
    }
  }, [specText]);

  async function interpret() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const img = await prepareImage(file);
      const fd = new FormData();
      fd.append("image", img);
      fd.append("project", project || "cliente");
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await readJsonSafe(r);
      if (!r.ok) throw new Error(data?.error || `Error ${r.status} interpretando la imagen.`);
      setSpecObj(data.spec);
      setSpecText(JSON.stringify(data.spec, null, 2));
      setStep("review");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← Volver
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Subir flujograma</h1>

      {/* stepper */}
      <div className="mt-3 flex gap-2 text-xs">
        {["Imagen", "Revisar flow-spec", "Provisionar"].map((s, i) => {
          const active = ["upload", "review", "config"][i] === step;
          const done = ["upload", "review", "config"].indexOf(step) > i;
          return (
            <span key={s} className={`rounded-full px-2.5 py-1 ${active ? "bg-indigo-600 text-white" : done ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
              {i + 1}. {s}
            </span>
          );
        })}
      </div>

      {/* paso 1: upload */}
      {step === "upload" && (
        <div className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Nombre del cliente / proyecto</span>
            <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="acme" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Imagen del flujograma (PNG, JPG, WEBP o SVG)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:text-slate-200 hover:file:bg-slate-700"
            />
          </label>
          {file && <p className="text-xs text-slate-500">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            onClick={interpret}
            disabled={!file || loading}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {loading ? "Interpretando con Claude… (~30s)" : "Interpretar flujograma"}
          </button>
        </div>
      )}

      {/* paso 2: review */}
      {step === "review" && (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-slate-400">
            Claude interpretó el flujograma. <span className="text-slate-200">Revisalo y ajustá</span> stages, rutas y
            labels antes de provisionar (el paso humano del pipeline).
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {parsed?.flows &&
              Object.keys(parsed.flows).map((f) => (
                <span
                  key={f}
                  className={`rounded-full px-2.5 py-1 ${compilable.includes(f) ? "bg-emerald-900/50 text-emerald-300" : "bg-slate-800 text-slate-500"}`}
                >
                  {f} {compilable.includes(f) ? "✓" : "(sin compilador)"}
                </span>
              ))}
          </div>
          <textarea
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
            rows={22}
            spellCheck={false}
            className={inputCls + " font-mono text-xs leading-relaxed"}
          />
          {parseErr && <p className="text-sm text-rose-400">JSON inválido: {parseErr}</p>}
          {parsed && compilable.length === 0 && (
            <p className="text-sm text-amber-400">Ningún flow compilable. Esperados: {COMPILABLE_FLOWS.join(", ")}.</p>
          )}
          <div className="flex items-center gap-3">
            <button onClick={() => setStep("upload")} className="text-sm text-slate-400 hover:text-slate-200">
              ← Volver
            </button>
            <button
              onClick={() => {
                setSpecObj(parsed);
                setStep("config");
              }}
              disabled={!parsed || compilable.length === 0}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Continuar a la config →
            </button>
          </div>
        </div>
      )}

      {/* paso 3: config + provisión */}
      {step === "config" && specObj && (
        <div className="mt-8 space-y-4">
          <button onClick={() => setStep("review")} className="text-sm text-slate-400 hover:text-slate-200">
            ← Editar flow-spec
          </button>
          <ConfigProvision key={specText} spec={specObj} project={specObj.project || project || "cliente"} />
        </div>
      )}
    </main>
  );
}
