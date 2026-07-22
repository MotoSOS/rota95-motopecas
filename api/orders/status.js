import { sendJson, cleanText, authenticatedUser, supabaseRest } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
  try {
    const raw = cleanText(req.query?.order, 120).replace(/[^A-Za-z0-9_#-]/g, '');
    if (!raw) return sendJson(res, 400, { error: 'missing_order', message: 'Pedido não informado.' });

    const user = await authenticatedUser(req);
    const isPublicNumber = raw.startsWith('#ROTA95_');
    if (isPublicNumber && !user) {
      return sendJson(res, 401, { error: 'login_required', message: 'Entre na sua conta para consultar este pedido.' });
    }

    const field = isPublicNumber ? 'display_id' : 'external_id';
    const userFilter = user?.id ? `&user_id=eq.${encodeURIComponent(user.id)}` : '';
    const select = [
      'external_id','display_id','order_number','status','fulfillment_status','payment_id',
      'payment_method','total','invoice_url','payment_data','tracking_code','carrier',
      'tracking_url','paid_at','shipped_at','delivered_at','created_at','updated_at',
      'order_items(product_id,product_name,quantity,unit_price)',
      'order_history(event,status,note,metadata,created_by,created_at)'
    ].join(',');

    const rows = await supabaseRest(
      `/orders?${field}=eq.${encodeURIComponent(raw)}${userFilter}&select=${encodeURIComponent(select)}&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) {
      return sendJson(res, 404, { error: 'not_found', message: 'Pedido não encontrado.' });
    }
    return sendJson(res, 200, rows[0]);
  } catch (error) {
    return sendJson(res, Number(error.status || 400), {
      error: 'status_error',
      message: error.message || 'Erro ao consultar pedido.'
    });
  }
}
