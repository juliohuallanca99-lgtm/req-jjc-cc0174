import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      // Crear nuevo requerimiento
      const body = req.body;
      const id = 'REQ-' + Date.now();
      const requerimiento = {
        id,
        ...body,
        estado: 'Pendiente',
        creadoEn: new Date().toISOString()
      };
      await kv.hset('requerimientos', { [id]: JSON.stringify(requerimiento) });
      // Guardar lista de IDs ordenada
      await kv.lpush('req:lista', id);
      return res.status(200).json({ ok: true, id });
    }

    if (req.method === 'GET') {
      // Listar todos los requerimientos
      const lista = await kv.lrange('req:lista', 0, -1);
      if (!lista || lista.length === 0) return res.status(200).json([]);
      const todos = await kv.hmget('requerimientos', ...lista);
      const result = todos
        .filter(Boolean)
        .map(r => typeof r === 'string' ? JSON.parse(r) : r)
        .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
      return res.status(200).json(result);
    }

    if (req.method === 'PUT') {
      // Actualizar estado
      const { id, estado, observacion } = req.body;
      const raw = await kv.hget('requerimientos', id);
      if (!raw) return res.status(404).json({ error: 'No encontrado' });
      const req_ = typeof raw === 'string' ? JSON.parse(raw) : raw;
      req_.estado = estado;
      if (observacion !== undefined) req_.observacion_gestion = observacion;
      req_.actualizadoEn = new Date().toISOString();
      await kv.hset('requerimientos', { [id]: JSON.stringify(req_) });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
