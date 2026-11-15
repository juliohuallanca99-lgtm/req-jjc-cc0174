import { createClient } from '@vercel/kv';

// Acepta las variables con cualquiera de los prefijos que crea Vercel
const kv = createClient({
  url:   process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const HASH  = 'requerimientos';      // id -> JSON del RQ (sin el PDF)
const LISTA = 'req:lista';           // ids en orden de creación
const PDF   = id => `req:pdf:${id}`; // PDF escaneado, guardado aparte

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

async function siguienteNumero() {
  const y = new Date().getFullYear();
  const n = await kv.incr(`req:seq:${y}`);
  return `RQ-0154-${y}-${String(n).padStart(3, '0')}`;
}

async function leer(id) {
  const raw = await kv.hget(HASH, id);
  return raw ? parse(raw) : null;
}

async function guardar(rq) {
  await kv.hset(HASH, { [rq.id]: JSON.stringify(rq) });
}


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── LEER ──────────────────────────────────────────────
    if (req.method === 'GET') {
      // Un PDF puntual: /api/requerimientos?pdf=<id>
      if (req.query.pdf) {
        const data = await kv.get(PDF(req.query.pdf));
        if (!data) return res.status(404).json({ error: 'Sin archivo adjunto' });
        return res.status(200).json({ pdfData: data });
      }
      // Todos los RQ
      const lista = await kv.lrange(LISTA, 0, -1);
      if (!lista || lista.length === 0) return res.status(200).json([]);
      const todos = await kv.hmget(HASH, ...lista);
      const result = Object.values(todos || {})
        .filter(Boolean)
        .map(parse)
        .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
      return res.status(200).json(result);
    }

    // ── CREAR ─────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      const id = body.id || 'REQ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      if (await leer(id)) return res.status(409).json({ error: 'Ese RQ ya existe' });

      let rqNum;
      if (body.importar && body.rqNum) {
        // RQ que venía guardado solo en un navegador: se respeta su número
        rqNum = body.rqNum;
        const y = rqNum.split('-')[2];
        const n = parseInt(rqNum.split('-').pop(), 10) || 0;
        const actual = parseInt(await kv.get(`req:seq:${y}`), 10) || 0;
        if (n > actual) await kv.set(`req:seq:${y}`, n);
      } else {
        rqNum = await siguienteNumero();
      }

      const { pdfData, importar, ...resto } = body;
      const rq = {
        firmas: {},
        estado: 'revision',
        ...resto,
        id,
        rqNum,
        creadoEn: resto.creadoEn || new Date().toISOString(),
      };
      if (pdfData) await kv.set(PDF(id), pdfData);
      await guardar(rq);
      await kv.lpush(LISTA, id);
      return res.status(200).json({ ok: true, rq });
    }

    // ── ACTUALIZAR (solo los campos enviados) ─────────────
    if (req.method === 'PUT') {
      const { id, pdfData, observacion, ...cambios } = req.body || {};
      const rq = await leer(id);
      if (!rq) return res.status(404).json({ error: 'No encontrado' });

      if (pdfData !== undefined) {
        if (pdfData) await kv.set(PDF(id), pdfData);
        else await kv.del(PDF(id));
      }
      if (observacion !== undefined) rq.observacion_gestion = observacion;
      Object.assign(rq, cambios, { actualizadoEn: new Date().toISOString() });
      await guardar(rq);
      return res.status(200).json({ ok: true, rq });
    }

    // ── ELIMINAR ──────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Falta id' });
      await kv.hdel(HASH, id);
      await kv.lrem(LISTA, 0, id);
      await kv.del(PDF(id));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
