/* ════════════════════════════════════════════════════════════════
   Sistema de Requerimientos JJC — conexión y sesión (Supabase)
   La clave de abajo es pública por diseño: la seguridad la ponen
   las reglas de la base de datos (cada usuario solo puede hacer lo
   que su rol permite).
   ════════════════════════════════════════════════════════════════ */
const SUPABASE_URL = 'https://wcsljjqropqmgyxjgssf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indjc2xqanFyb3BxbWd5eGpnc3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3MjgwNTQsImV4cCI6MjExMDMwNDA1NH0.oBNmLmmvIHsSAQECbxBh41YCw4mum7RiOhX8naLV58I';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'req-jjc-sesion' }
});

const ROLES = {
  solicitante:       'Solicitante',
  administracion:    'Administración',
  costos:            'Costos',
  gerencia_jjc:      'Gerencia JJC',
  gerencia_marcobre: 'Gerencia de Construcción Marcobre',
  almacen:           'Almacén'
};

const $ = id => document.getElementById(id);
const correoDe = usuario => String(usuario || '').trim().toLowerCase() + '@req-jjc.local';
const esCorreoInterno = c => /@req-jjc\.local$/i.test(String(c || ''));

/* Lo que la persona escribe (usuario o correo) → correo de su cuenta */
async function correoParaIngreso(dato) {
  const { data, error } = await sb.rpc('correo_ingreso', { p_dato: String(dato || '').trim() });
  if (error) throw error;
  return data;
}

/* Traduce los mensajes de error al español */
function mensajeError(e) {
  const m = String(e?.message || e || '');
  if (/invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/banned/i.test(m)) return 'Tu cuenta está desactivada. Habla con el administrador.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos.';
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  if (/password should be|weak/i.test(m)) return 'La contraseña es muy débil. Usa al menos 10 caracteres.';
  if (/same.*password|different from the old/i.test(m)) return 'La contraseña nueva debe ser distinta de la anterior.';
  if (/email.*not.*confirmed/i.test(m)) return 'El correo de la cuenta no está confirmado. Habla con el administrador.';
  return m || 'Ocurrió un error inesperado.';
}

/* Perfil del usuario con sesión, o null */
async function perfilActual() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !data || !data.activo) return null;
  return data;
}

/* Para páginas internas: si no hay sesión, manda a la pantalla de ingreso */
async function exigirSesion({ soloAdmin = false } = {}) {
  const p = await perfilActual();
  if (!p) {
    await sb.auth.signOut().catch(() => {});
    location.replace('/?volver=' + encodeURIComponent(location.pathname + location.search));
    return new Promise(() => {});
  }
  if (soloAdmin && !p.es_admin) {
    location.replace('/');
    return new Promise(() => {});
  }
  return p;
}

async function salir() {
  await sb.auth.signOut().catch(() => {});
  location.replace('/');
}

function aviso(texto, tipo = 'ok') {
  let caja = $('avisos');
  if (!caja) { caja = document.createElement('div'); caja.id = 'avisos'; document.body.appendChild(caja); }
  const t = document.createElement('div');
  t.className = 'aviso ' + tipo;
  t.textContent = texto;
  caja.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ════ Catálogo SAP guardado en el equipo (búsqueda instantánea) ════
   Se descarga una vez y se vuelve a bajar solo cuando Almacén carga una matriz nueva. */
let _catalogo = null;
function _bd() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('req-jjc', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function _bdLeer(k) {
  try { const db = await _bd(); return await new Promise(ok => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); }
  catch { return null; }
}
async function _bdGuardar(k, v) {
  try { const db = await _bd(); await new Promise(ok => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; }); }
  catch { /* sin almacenamiento local: se usa solo en memoria */ }
}
const normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function catalogoLocal() {
  if (_catalogo) return _catalogo;
  _catalogo = (async () => {
    const { data: ver, error } = await sb.rpc('catalogo_version');
    if (error) throw error;
    let g = await _bdLeer('catalogo');
    if (!g || g.ver !== ver) {
      const { data: txt, error: e2 } = await sb.rpc('catalogo_compacto');
      if (e2) throw e2;
      g = { ver, txt: txt || '' };
      _bdGuardar('catalogo', g);
    }
    return (g.txt ? g.txt.split('\n') : []).map(l => {
      const [codigo, descripcion, unidad] = l.split('\t');
      return { codigo, descripcion, unidad, n: normTxt(descripcion) };
    });
  })();
  _catalogo.catch(() => { _catalogo = null; });
  return _catalogo;
}
/* Busca por inicio de código o por palabras (en cualquier orden; acepta * como comodín) */
function buscarEnCatalogo(lista, texto, max = 40) {
  const t = normTxt(texto).replace(/[*%]/g, ' ').trim();
  if (!t) return { res: [], total: 0 };
  if (/^\d+$/.test(t)) { const r = lista.filter(x => x.codigo.startsWith(t)); return { res: r.slice(0, max), total: r.length }; }
  const pal = t.split(/\s+/).filter(Boolean);
  const r = lista.filter(x => pal.every(p => x.n.includes(p)));
  const p0 = pal[0];
  r.sort((a, b) => (b.n.startsWith(p0) - a.n.startsWith(p0)) || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
  return { res: r.slice(0, max), total: r.length };
}
