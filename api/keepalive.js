import { timingSafeEqual } from "crypto";

// Supabase pausa los proyectos del plan Free tras 7 días sin actividad. Vercel
// Cron llama a este endpoint a diario (ver `crons` en vercel.json) y hace una
// consulta real a Postgres a través de PostgREST: con la anon key y sin sesión,
// RLS devuelve `[]`, pero la consulta se ejecuta y cuenta como actividad.
// Diario y no semanal a propósito: un intervalo de 7 días contra un umbral de
// 7 días deja el margen a merced de un retraso del cron.

function isAuthorized(req) {
  // Vercel manda `Authorization: Bearer $CRON_SECRET` si la variable existe.
  // Sin ella el endpoint queda abierto: solo lanza una lectura que cualquiera
  // puede hacer ya con la anon key pública, y es preferible a que el cron
  // falle en silencio y el proyecto se pause.
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const provided = Buffer.from(req.headers["authorization"] || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("keepalive: faltan SUPABASE_URL / SUPABASE_ANON_KEY");
    res.status(500).json({ ok: false, error: "Supabase no configurado" });
    return;
  }

  const inicio = Date.now();
  try {
    const resp = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000)
    });
    const ms = Date.now() - inicio;
    if (!resp.ok) {
      console.error(`keepalive: Supabase respondió ${resp.status}`);
      res.status(502).json({ ok: false, status: resp.status, ms });
      return;
    }
    console.log(`keepalive: ok en ${ms} ms`);
    res.status(200).json({ ok: true, ms });
  } catch (err) {
    console.error("keepalive: error de red", err);
    res.status(502).json({ ok: false, error: String(err?.message || err) });
  }
}
