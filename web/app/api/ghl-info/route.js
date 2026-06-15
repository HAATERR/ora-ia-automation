// POST /api/ghl-info  — { pit, locationId } → { pipelines, customFields, customValues }
// Valida el PIT y trae los IDs reales de la subcuenta para poblar los dropdowns del form.
import { ghlInfo } from "../../../lib/engine/index.mjs";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body inválido (se esperaba JSON)." }, { status: 400 });
  }
  const { pit, locationId } = body || {};
  if (!pit || !locationId) {
    return Response.json({ error: "Faltan 'pit' y/o 'locationId'." }, { status: 400 });
  }
  try {
    const info = await ghlInfo({ pit, locationId });
    return Response.json(info);
  } catch (err) {
    // PIT inválido / sin acceso a la subcuenta → 400 para que la UI lo muestre.
    return Response.json({ error: err?.message || "No pude leer la subcuenta en GHL." }, { status: 400 });
  }
}
