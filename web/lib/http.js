// Lee la respuesta de un fetch como JSON de forma tolerante: si el body NO es JSON
// (p.ej. un 504 de gateway de Vercel con HTML/texto cuando una función excede su límite),
// devuelve { error: <texto recortado> } en vez de tirar un SyntaxError opaco.
export async function readJsonSafe(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text ? text.slice(0, 300) : null };
  }
}
