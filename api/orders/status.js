import { sendJson, cleanText, supabaseRest } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  try {
    const order = cleanText(req.query?.order, 100).replace(/[^A-Za-z0-9-]/g, '');
    if (!order) return sendJson(res, 400, { error: 'missing_order', message: 'Pedido não informado.' });
    const rows = await supabaseRest(`/orders?external_id=eq.${encodeURIComponent(order)}&select=external_id,status,payment_id,total,invoice_url,tracking_code,updated_at&limit=1`);
    if (!Array.isArray(rows) || !rows[0]) return sendJson(res, 404, { error: 'not_found', message: 'Pedido não encontrado.' });
    return sendJson(res, 200, rows[0]);
  } catch (error) {
    return sendJson(res, Number(error.status || 400), { error: 'status_error', message: error.message || 'Erro ao consultar pedido.' });
  }
}
