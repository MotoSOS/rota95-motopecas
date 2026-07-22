import { sendJson, cleanText, supabaseRest, asaasEnvironment } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  try {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN || '';
    const received = String(req.headers['asaas-access-token'] || '');
    if ((expected || asaasEnvironment() === 'production') && (!expected || received !== expected)) {
      return sendJson(res, 401, { error: 'unauthorized', message: 'Webhook não autorizado.' });
    }

    const event = req.body || {};
    const eventId = cleanText(event.id, 160);
    const payment = event.payment || {};
    const externalId = cleanText(payment.externalReference, 100);

    if (eventId) {
      await supabaseRest('/webhook_events?on_conflict=id', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
        body: { id: eventId, event: cleanText(event.event, 100), payload: event }
      });
    }

    if (externalId) {
      await supabaseRest(`/orders?external_id=eq.${encodeURIComponent(externalId)}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: {
          payment_id: payment.id || undefined,
          status: payment.status || event.event || 'UPDATED',
          webhook_event: cleanText(event.event, 100),
          updated_at: new Date().toISOString()
        }
      });
    }

    return sendJson(res, 200, { received: true });
  } catch (error) {
    console.error('[ROTA95 webhook]', error);
    // Retorna erro para o Asaas repetir a entrega quando o processamento realmente falhou.
    return sendJson(res, Number(error.status || 500), { error: 'webhook_error', message: error.message || 'Erro no webhook.' });
  }
}
