import {
  sendJson,
  cleanText,
  supabaseRest,
  asaasEnvironment,
  addOrderHistory,
  assignDisplayId
} from '../_lib.js';

function isPaid(status) {
  return ['CONFIRMED', 'RECEIVED'].includes(
    String(status || '').toUpperCase()
  );
}

function reversalStatus(eventName, paymentStatus) {
  const event = String(eventName || '').toUpperCase();
  const status = String(paymentStatus || '').toUpperCase();

  if (event === 'PAYMENT_REFUNDED' || status === 'REFUNDED') {
    return 'REFUNDED';
  }

  if (
    event === 'PAYMENT_DELETED' ||
    status === 'DELETED' ||
    status === 'CANCELLED'
  ) {
    return 'DELETED';
  }

  if (event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') {
    return 'CANCELLED';
  }

  return '';
}

async function deductOrderStock(orderId) {
  const result = await supabaseRest('/rpc/deduct_rota95_order_stock', {
    method: 'POST',
    body: { p_order_id: orderId }
  });

  return Array.isArray(result) ? (result[0] || {}) : (result || {});
}

async function restoreOrderStock(orderId) {
  const result = await supabaseRest('/rpc/restore_rota95_order_stock', {
    method: 'POST',
    body: { p_order_id: orderId }
  });

  return Array.isArray(result) ? (result[0] || {}) : (result || {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  try {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN || '';
    const received = String(req.headers['asaas-access-token'] || '');

    if (
      (expected || asaasEnvironment() === 'production') &&
      (!expected || received !== expected)
    ) {
      return sendJson(res, 401, {
        error: 'unauthorized',
        message: 'Webhook não autorizado.'
      });
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
        body: {
          id: eventId,
          event: eventName,
          payload: event
        }
      });
    }

    if (externalId) {
      const currentRows = await supabaseRest(
        `/orders?external_id=eq.${encodeURIComponent(externalId)}&select=id,fulfillment_status,paid_at&limit=1`
      );
      const current = Array.isArray(currentRows) ? currentRows[0] : null;

      if (current) {
        const paid = isPaid(payment.status);
        const reversal = reversalStatus(eventName, payment.status);

        const preserveAdvanced = [
          'PREPARING',
          'READY_TO_SHIP',
          'READY_FOR_PICKUP',
          'SHIPPED',
          'DELIVERED'
        ].includes(
          String(current.fulfillment_status || '').toUpperCase()
        );

        const update = {
          payment_id: payment.id || undefined,
          status: payment.status || reversal || eventName || 'UPDATED',
          webhook_event: eventName,
          updated_at: new Date().toISOString()
        };

        if (reversal) {
          update.fulfillment_status = reversal;
          update.cancelled_at = new Date().toISOString();
        } else if (paid) {
          update.paid_at = current.paid_at || new Date().toISOString();

          if (!preserveAdvanced) {
            update.fulfillment_status = 'PAID_AWAITING_PROCESSING';
          }
        } else if (
          String(payment.status || '').toUpperCase() === 'OVERDUE' &&
          !preserveAdvanced
        ) {
          update.fulfillment_status = 'OVERDUE';
        }

        await supabaseRest(`/orders?id=eq.${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: update
        });

        let stockResult = null;
        let historyNote = 'Atualização recebida pelo webhook do Asaas.';

        if (reversal) {
          stockResult = await restoreOrderStock(current.id);
          historyNote =
            reversal === 'REFUNDED'
              ? 'Pagamento estornado e produtos devolvidos automaticamente ao estoque.'
              : 'Pedido cancelado e produtos devolvidos automaticamente ao estoque.';
        } else if (paid) {
          stockResult = await deductOrderStock(current.id);
          historyNote =
            'Pagamento confirmado e estoque atualizado automaticamente.';
        }

        const displayId = paid
          ? await assignDisplayId(current.id)
          : '';

        await addOrderHistory(
          current.id,
          eventName || 'PAYMENT_UPDATED',
          reversal || payment.status || eventName || 'UPDATED',
          historyNote,
          {
            paymentId: payment.id || '',
            displayId,
            stock: stockResult
          },
          'Asaas'
        );
      }
    }

    return sendJson(res, 200, { received: true });
  } catch (error) {
    console.error('[ROTA95 webhook]', error?.message || error);

    return sendJson(res, Number(error.status || 500), {
      error: 'webhook_error',
      message: error.message || 'Erro no webhook.'
    });
  }
}
