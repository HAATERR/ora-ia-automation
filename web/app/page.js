import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-12">
        <div className="flex items-center gap-2 text-sm font-medium text-indigo-400">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-400" />
          ORA IA
        </div>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">
          Generador de cableados
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-400">
          Del <span className="text-slate-200">flujograma</span> del cliente a los{" "}
          <span className="text-slate-200">workflows en n8n</span>, automático. Empezá
          subiendo el flujograma o dibujándolo acá.
        </p>
      </header>

      <div className="grid gap-5 sm:grid-cols-2">
        <Link
          href="/importar"
          className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-indigo-500/60 hover:bg-slate-900"
        >
          <div className="text-3xl">📤</div>
          <h2 className="mt-4 text-xl font-semibold">Subir flujograma</h2>
          <p className="mt-2 text-sm text-slate-400">
            Imagen del board de Miro/Figma (PNG, JPG o SVG). Claude la interpreta y
            arma el flow-spec.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-indigo-400 transition group-hover:translate-x-0.5">
            Subir imagen →
          </span>
        </Link>

        <Link
          href="/dibujar"
          className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-emerald-500/60 hover:bg-slate-900"
        >
          <div className="text-3xl">✏️</div>
          <h2 className="mt-4 text-xl font-semibold">Dibujar flujograma</h2>
          <p className="mt-2 text-sm text-slate-400">
            Armá el cableado acá mismo arrastrando cajas y flechas. Sin imagen, directo
            al workflow.
          </p>
          <span className="mt-4 inline-block text-sm font-medium text-emerald-400 transition group-hover:translate-x-0.5">
            Abrir editor →
          </span>
        </Link>
      </div>

      <p className="mt-10 text-sm text-slate-500">
        Después de armar el flujo: revisás, completás los datos de la subcuenta (con los
        IDs cargados solos desde GHL) y le das{" "}
        <span className="text-slate-300">Provisionar</span> → los workflows aparecen en n8n.
      </p>
    </main>
  );
}
