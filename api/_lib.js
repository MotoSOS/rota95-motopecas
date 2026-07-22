const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ASAAS_ENV = process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox';
const ASAAS_BASE_URL = ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'motopecas.rota95@gmail.com').trim().toLowerCase();

export function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function digits(value) { return String(value || '').replace(/\D/g, ''); }
export function cleanText(value, max = 200) { return String(value || '').trim().slice(0, max); }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')); }
export function validDocument(value) { const n = digits(value); return n.length === 11 || n.length === 14; }
export function dueDate(days = 1) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
export function moneyNumber(value) { return Number(Number(value || 0).toFixed(2)); }

export function publicOrigin(req) {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

export function clientIp(req) {
  const raw = String(
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    ''
  ).split(',')[0].trim();
  return raw.replace(/^::ffff:/, '') || '127.0.0.1';
}

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Supabase do servidor não configurado. Cadastre SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY na Vercel.');
    error.status = 503;
    throw error;
  }
}

export async function authenticatedUser(req) {
  requireSupabase();
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const error = new Error('Sua sessão expirou. Entre novamente com o Google.');
    error.status = 401;
    throw error;
  }
  return response.json();
}

export async function requireAdmin(req) {
  const user = await authenticatedUser(req);
  const email = String(user?.email || '').trim().toLowerCase();
  if (!user || email !== ADMIN_EMAIL) {
    const error = new Error('Acesso restrito ao administrador da ROTA 95. Entre com a conta administrativa do Google.');
    error.status = 403;
    throw error;
  }
  return user;
}

export async function supabaseRest(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  requireSupabase();
  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || `Erro Supabase (${response.status}).`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function storeValue(key) {
  const rows = await supabaseRest(`/store_state?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  if (!Array.isArray(rows) || !rows[0]) return null;
  return rows[0].value;
}

export async function assignDisplayId(orderId) {
  if (!orderId) return '';
  const result = await supabaseRest('/rpc/assign_rota95_order_number', {
    method: 'POST',
    body: { p_order_id: orderId }
  });
  if (Array.isArray(result)) return String(result[0]?.public_id || '');
  if (result && typeof result === 'object') return String(result.public_id || '');
  return typeof result === 'string' ? result : '';
}

export async function addOrderHistory(orderId, event, status, note = '', metadata = {}, createdBy = '') {
  if (!orderId) return;
  await supabaseRest('/order_history', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      order_id: orderId,
      event: cleanText(event, 80),
      status: cleanText(status, 80),
      note: cleanText(note, 500),
      metadata: metadata || {},
      created_by: cleanText(createdBy, 160)
    }
  });
}

export async function asaas(path, { method = 'GET', body } = {}) {
  if (!ASAAS_API_KEY || ASAAS_API_KEY.includes('COLOQUE_')) {
    const error = new Error('ASAAS_API_KEY não configurada na Vercel.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: ASAAS_API_KEY,
      'User-Agent': `ROTA95/3.0 (${ASAAS_ENV})`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.errors?.map(item => item.description).filter(Boolean).join(' ') || data?.message || `Erro Asaas (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export function asaasEnvironment() { return ASAAS_ENV; }
