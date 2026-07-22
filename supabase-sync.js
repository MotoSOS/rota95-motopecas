import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PUBLIC_KEYS = [
  'rota95_produtos','rota95_categorias','rota95_config_site','rota95_whatsapp',
  'rota95_instagram','rota95_journey_background','rota95_journey_workshop'
];

let client = null;
let applyingRemoteState = false;

async function loadConfig() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configuração do Supabase indisponível.');
  return response.json();
}

function dispatchAuth(event, session) {
  window.rota95SupabaseSession = session || null;
  window.dispatchEvent(new CustomEvent('rota95:auth-changed', {
    detail: { event, session: session || null, user: session?.user || null }
  }));
}

async function initialize() {
  try {
    const { supabaseUrl, supabaseAnonKey } = await loadConfig();
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('SUPABASE_URL ou SUPABASE_ANON_KEY não configurada na Vercel.');

    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    window.rota95Supabase = client;

    const { data: { session } } = await client.auth.getSession();
    dispatchAuth('INITIAL_SESSION', session);
    client.auth.onAuthStateChange((event, nextSession) => {
      setTimeout(() => dispatchAuth(event, nextSession), 0);
    });

    const changed = await pullPublicState();
    installPublicStateSync();
    window.dispatchEvent(new CustomEvent('rota95:supabase-ready'));

    if (changed && sessionStorage.getItem('rota95_remote_state_reloaded') !== '1') {
      sessionStorage.setItem('rota95_remote_state_reloaded', '1');
      location.reload();
      return;
    }
    sessionStorage.removeItem('rota95_remote_state_reloaded');
  } catch (error) {
    console.warn('[ROTA95] Supabase não inicializado:', error.message);
    window.dispatchEvent(new CustomEvent('rota95:supabase-error', { detail: { message: error.message } }));
  }
}

async function pullPublicState() {
  const { data, error } = await client.from('store_state').select('key,value').in('key', PUBLIC_KEYS);
  if (error) throw error;
  let changed = false;
  applyingRemoteState = true;
  try {
    for (const row of data || []) {
      if (typeof row.value !== 'string') continue;
      if (localStorage.getItem(row.key) !== row.value) {
        localStorage.setItem(row.key, row.value);
        changed = true;
      }
    }
  } finally { applyingRemoteState = false; }
  return changed;
}

function installPublicStateSync() {
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (!PUBLIC_KEYS.includes(key) || !client || applyingRemoteState) return;
    client.from('store_state')
      .upsert({ key, value: String(value), updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.warn('[ROTA95] Alteração salva somente neste navegador:', error.message); });
  };
}

function ensureClient() {
  if (!client) throw new Error('Supabase ainda não foi carregado. Aguarde alguns segundos.');
  return client;
}

window.rota95EntrarComGoogle = async function () {
  const supabase = ensureClient();
  const redirectTo = `${location.origin}/motopecas/inicio?auth=google`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) throw error;
};

window.rota95EntrarEmail = async function ({ email, password }) {
  const supabase = ensureClient();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!normalizedEmail || cleanPassword.length < 6) throw new Error('Informe e-mail e senha com pelo menos 6 caracteres.');
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: cleanPassword });
  if (error) throw new Error('E-mail ou senha incorretos.');
  return { session: data?.session || null, user: data?.user || null, created: false };
};

window.rota95CadastrarEmail = async function ({ email, password, name }) {
  const supabase = ensureClient();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!normalizedEmail || cleanPassword.length < 6) throw new Error('Informe e-mail e senha com pelo menos 6 caracteres.');
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: cleanPassword,
    options: {
      data: { full_name: String(name || '').trim() },
      emailRedirectTo: `${location.origin}/motopecas/inicio?auth=email`
    }
  });
  if (error) throw error;
  return { session: data?.session || null, user: data?.user || null, created: true, confirmationRequired: !data?.session };
};

window.rota95CadastrarOuEntrarEmail = async function ({ email, password, name }) {
  const supabase = ensureClient();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!normalizedEmail || cleanPassword.length < 6) throw new Error('Informe e-mail e senha com pelo menos 6 caracteres.');

  const login = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: cleanPassword });
  if (!login.error && login.data?.session) return { session: login.data.session, user: login.data.user, created: false };

  const signup = await supabase.auth.signUp({
    email: normalizedEmail,
    password: cleanPassword,
    options: {
      data: { full_name: String(name || '').trim() },
      emailRedirectTo: `${location.origin}/motopecas/inicio?auth=email`
    }
  });
  if (signup.error) throw signup.error;
  return {
    session: signup.data?.session || null,
    user: signup.data?.user || null,
    created: true,
    confirmationRequired: !signup.data?.session
  };
};

window.rota95ObterSessao = async function () {
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data?.session || null;
};

window.rota95ObterUsuario = async function () {
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data?.user || null;
};


window.rota95ObterPerfil = async function () {
  const supabase = ensureClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,phone,cpf_cnpj,postal_code,state,city,province,address,address_number,complement,updated_at')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

window.rota95SalvarPerfil = async function (profile = {}) {
  const supabase = ensureClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) throw new Error('Entre na conta para salvar seus dados.');
  const body = {
    id: userData.user.id,
    full_name: String(profile.full_name || profile.name || '').trim(),
    phone: String(profile.phone || '').replace(/\D/g, ''),
    cpf_cnpj: String(profile.cpf_cnpj || profile.cpfCnpj || '').replace(/\D/g, ''),
    postal_code: String(profile.postal_code || profile.postalCode || '').replace(/\D/g, ''),
    state: String(profile.state || '').trim().toUpperCase().slice(0, 2),
    city: String(profile.city || '').trim(),
    province: String(profile.province || '').trim(),
    address: String(profile.address || '').trim(),
    address_number: String(profile.address_number || profile.addressNumber || '').trim(),
    complement: String(profile.complement || '').trim(),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('profiles').upsert(body).select().single();
  if (error) throw error;
  return data;
};

window.rota95ListarMeusPedidos = async function () {
  const supabase = ensureClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return [];
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,external_id,display_id,order_number,status,fulfillment_status,total,payment_method,
      invoice_url,payment_data,tracking_code,carrier,tracking_url,paid_at,shipped_at,
      delivered_at,created_at,updated_at,
      order_items(product_id,product_name,quantity,unit_price),
      order_history(event,status,note,metadata,created_by,created_at)
    `)
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

window.rota95Sair = async function () {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
};

initialize();
