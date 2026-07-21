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

    await pullPublicState();
    installPublicStateSync();
    window.dispatchEvent(new CustomEvent('rota95:supabase-ready'));
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

  for (const row of data || []) {
    if (typeof row.value === 'string') localStorage.setItem(row.key, row.value);
  }
}

function installPublicStateSync() {
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (PUBLIC_KEYS.includes(key) && client) {
      client.from('store_state').upsert({ key, value: String(value), updated_at: new Date().toISOString() })
        .then(({ error }) => error && console.warn('[ROTA95] Falha ao sincronizar', key, error.message));
    }
  };
}

window.rota95EntrarComGoogle = async function () {
  if (!client) throw new Error('Supabase ainda não foi carregado.');
  const redirectTo = `${location.origin}/motopecas/inicio`;
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
};

initialize();
