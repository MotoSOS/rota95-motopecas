import { sendJson, cleanText, supabaseRest, asaasEnvironment, addOrderHistory } from '../_lib.js';

function isPaid(status) {
  return ['CONFIRMED', 'RECEIVED'].includes(String(status || '').toUpperCase());
}

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
    const eventName = cleanText(event.event, 100);
    const payment = event.payment || {};
    const externalId = cleanText(payment.externalReference, 100);

    if (eventId) {
      await supabaseRest('/webhook_events?on_conflict=id', {
        method: 'POST',
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: { id: eventId, event: eventName, payload: event }
      });
    }

    if (externalId) {
      const currentRows = await supabaseRest(`/orders?external_id=eq.${encodeURIComponent(externalId)}&select=id,fulfillment_status,paid_at&limit=1`);
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      if (current) {
        const paid = isPaid(payment.status);
        const preserveAdvanced = ['PREPARING', 'READY_TO_SHIP', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'].includes(String(current.fulfillment_status || '').toUpperCase());
        const update = {
          payment_id: payment.id || undefined,
          status: payment.status || eventName || 'UPDATED',
          webhook_event: eventName,
          updated_at: new Date().toISOString()
        };
        if (paid) {
          update.paid_at = current.paid_at || new Date().toISOString();
          if (!preserveAdvanced) update.fulfillment_status = 'PAID_AWAITING_PROCESSING';
        }
        if (['OVERDUE', 'REFUNDED', 'DELETED'].includes(String(payment.status || '').toUpperCase()) && !preserveAdvanced) {
          update.fulfillment_status = String(payment.status || '').toUpperCase();
        }
        await supabaseRest(`/orders?id=eq.${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: update
        });
        await addOrderHistory(current.id, eventName || 'PAYMENT_UPDATED', payment.status || eventName || 'UPDATED', 'Atualização recebida pelo webhook do Asaas.', { paymentId: payment.id || '' }, 'Asaas');
      }
    }

    return sendJson(res, 200, { received: true });
  } catch (error) {
    console.error('[ROTA95 webhook]', error?.message || error);
    return sendJson(res, Number(error.status || 500), { error: 'webhook_error', message: error.message || 'Erro no webhook.' });
  }
}
