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

/* Traduce los mensajes de error al español */
function mensajeError(e) {
  const m = String(e?.message || e || '');
  if (/invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/banned/i.test(m)) return 'Tu cuenta está desactivada. Habla con el administrador.';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos.';
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  if (/password should be|weak/i.test(m)) return 'La contraseña es muy débil. Usa al menos 10 caracteres.';
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
