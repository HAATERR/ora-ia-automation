// POST /api/login — { password } → setea cookie httpOnly si matchea APP_PASSWORD.
// La cookie NO guarda la password: guarda sha256(APP_PASSWORD), que el middleware re-deriva
// y compara. Rotar APP_PASSWORD invalida todas las cookies.
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

export async function POST(request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return Response.json({ error: "El servidor no tiene APP_PASSWORD configurada." }, { status: 500 });
  }
  let password = "";
  try {
    ({ password = "" } = await request.json());
  } catch {
    return Response.json({ error: "Body inválido." }, { status: 400 });
  }

  const a = Buffer.from(String(password));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return Response.json({ error: "Contraseña incorrecta." }, { status: 401 });

  const token = createHash("sha256").update(expected).digest("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `ora_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
  return res;
}
