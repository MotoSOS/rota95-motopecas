import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PUBLIC_KEYS = [
  'rota95_produtos',
  'rota95_categorias',
  'rota95_config_site',
  'rota95_whatsapp',
  'rota95_instagram',
  'rota95_journey_background',
  'rota95_journey_workshop'
];

let client = null;
let applyingRemoteState = false;

async function loadConfig() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configuração do Supabase indisponível.');
  return response.json();
}

async function initialize() {
  try {
    const { supabaseUrl, supabaseAnonKey } = await loadConfig();
    if (!supabaseUrl || !supabaseAnonKey) return;

    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    window.rota95Supabase = client;

    const changed = await pullPublicState();
    installPublicStateSync();
    window.dispatchEvent(new CustomEvent('rota95:supabase-ready'));

    // O HTML carrega os produtos do localStorage durante a inicialização.
    // Se o Supabase trouxe dados diferentes, uma única recarga faz o catálogo usar a base online.
    if (changed && sessionStorage.getItem('rota95_remote_state_reloaded') !== '1') {
      sessionStorage.setItem('rota95_remote_state_reloaded', '1');
      location.reload();
      return;
    }
    sessionStorage.removeItem('rota95_remote_state_reloaded');
  } catch (error) {
    console.warn('[ROTA95] Supabase não inicializado:', error.message);
  }
}

async function pullPublicState() {
  const { data, error } = await client
    .from('store_state')
    .select('key,value')
    .in('key', PUBLIC_KEYS);
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
  } finally {
    applyingRemoteState = false;
  }
  return changed;
}

function installPublicStateSync() {
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (!PUBLIC_KEYS.includes(key) || !client || applyingRemoteState) return;

    // A política RLS permite alteração apenas para o e-mail administrador autenticado.
    client.from('store_state')
      .upsert({ key, value: String(value), updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.warn('[ROTA95] Alteração salva somente neste navegador:', error.message);
      });
  };
}

window.rota95EntrarComGoogle = async function () {
  if (!client) throw new Error('Supabase ainda não foi carregado.');
  const redirectTo = `${location.origin}/motopecas/inicio`;
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
};

initialize();
