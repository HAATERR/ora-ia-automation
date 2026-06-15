// Gate de acceso para los devs de Ora IA: una password compartida en APP_PASSWORD (env var),
// sin sistema de usuarios. Corre en el Edge runtime. Si APP_PASSWORD no está seteada, NO hay
// gate (cómodo para dev local; en Vercel siempre seteala).
import { NextResponse } from "next/server";

async function sha256Hex(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req) {
  const pwd = process.env.APP_PASSWORD;
  if (!pwd) return NextResponse.next(); // sin password configurada → sin gate

  const cookie = req.cookies.get("ora_auth")?.value;
  if (cookie && cookie === (await sha256Hex(pwd))) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado. Iniciá sesión." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

// Todo queda gateado menos /login, /api/login y los assets estáticos.
export const config = {
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
