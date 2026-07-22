import {
  sendJson,
  cleanText,
  requireAdmin,
  supabaseRest,
  addOrderHistory
} from '../_lib.js';

const ALLOWED_FULFILLMENT = new Set([
  'AWAITING_PAYMENT',
  'PAYMENT_ERROR',
  'PAID_AWAITING_PROCESSING',
  'PREPARING',
  'READY_TO_SHIP',
  'READY_FOR_PICKUP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'OVERDUE',
  'REFUNDED',
  'DELETED'
]);

function orderSelect() {
  return [
    'id',
    'external_id',
    'display_id',
    'order_number',
    'user_id',
    'payment_id',
    'status',
    'fulfillment_status',
    'total',
    'payment_method',
    'invoice_url',
    'payment_data',
    'asaas_customer_id',
    'webhook_event',
    'customer',
    'delivery',
    'tracking_code',
    'carrier',
    'tracking_url',
    'admin_notes',
    'paid_at',
    'shipped_at',
    'delivered_at',
    'cancelled_at',
    'stock_deducted_at',
    'stock_restored_at',
    'stock_issue',
    'stock_restore_issue',
    'created_at',
    'updated_at',
    'order_items(id,product_id,product_name,quantity,unit_price)',
    'order_history(id,event,status,note,metadata,created_by,created_at)'
  ].join(',');
}

function actionUpdate(action, body) {
  const now = new Date().toISOString();
  const update = { updated_at: now };
  let event = 'ORDER_UPDATED';
  const note = cleanText(body.adminNotes, 500);

  switch (action) {
    case 'preparing':
      update.fulfillment_status = 'PREPARING';
      event = 'PREPARING';
      break;

    case 'ready':
      update.fulfillment_status = body.pickup
        ? 'READY_FOR_PICKUP'
        : 'READY_TO_SHIP';
      event = update.fulfillment_status;
      break;

    case 'ship':
      update.fulfillment_status = 'SHIPPED';
      update.shipped_at = now;
      event = 'SHIPPED';
      break;

    case 'deliver':
      update.fulfillment_status = 'DELIVERED';
      update.delivered_at = now;
      event = 'DELIVERED';
      break;

    case 'cancel':
      update.fulfillment_status = 'CANCELLED';
      update.cancelled_at = now;
      event = 'CANCELLED';
      break;

    case 'save':
    default: {
      const requested = cleanText(
        body.fulfillmentStatus,
        50
      ).toUpperCase();

      if (requested && ALLOWED_FULFILLMENT.has(requested)) {
        update.fulfillment_status = requested;
      }

      if (['CANCELLED', 'REFUNDED', 'DELETED'].includes(requested)) {
        update.cancelled_at = now;
      }

      event = 'ORDER_UPDATED';
    }
  }

  const carrier = cleanText(body.carrier, 80);
  const trackingCode = cleanText(body.trackingCode, 100);
  const trackingUrl = cleanText(body.trackingUrl, 500);

  if (carrier || body.carrier === '') {
    update.carrier = carrier;
  }

  if (trackingCode || body.trackingCode === '') {
    update.tracking_code = trackingCode;
  }

  if (trackingUrl || body.trackingUrl === '') {
    update.tracking_url = trackingUrl;
  }

  if (body.adminNotes !== undefined) {
    update.admin_notes = note;
  }

  return { update, event, note };
}

async function restoreOrderStock(orderId) {
  const result = await supabaseRest('/rpc/restore_rota95_order_stock', {
    method: 'POST',
    body: { p_order_id: orderId }
  });

  return Array.isArray(result) ? (result[0] || {}) : (result || {});
}

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);

    if (req.method === 'GET') {
      const limit = Math.max(
        1,
        Math.min(200, Number(req.query?.limit || 100))
      );

      const rows = await supabaseRest(
        `/orders?select=${encodeURIComponent(orderSelect())}&order=created_at.desc&limit=${limit}`
      );

      return sendJson(res, 200, {
        orders: Array.isArray(rows) ? rows : [],
        admin: admin.email
      });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const externalId = cleanText(body.orderId, 100).replace(
        /[^A-Za-z0-9-]/g,
        ''
      );

      if (!externalId) {
        return sendJson(res, 400, {
          error: 'missing_order',
          message: 'Informe o pedido.'
        });
      }

      const rows = await supabaseRest(
        `/orders?external_id=eq.${encodeURIComponent(externalId)}&select=id,external_id,fulfillment_status,delivery,customer&limit=1`
      );
      const order = Array.isArray(rows) ? rows[0] : null;

      if (!order) {
        return sendJson(res, 404, {
          error: 'not_found',
          message: 'Pedido não encontrado.'
        });
      }

      const action = cleanText(
        body.action || 'save',
        30
      ).toLowerCase();

      const { update, event, note } = actionUpdate(action, body);

      if (
        action === 'ship' &&
        order.delivery?.type !== 'pickup' &&
        !cleanText(body.trackingCode, 100)
      ) {
        return sendJson(res, 400, {
          error: 'tracking_required',
          message: 'Informe o código de rastreio antes de confirmar o envio.'
        });
      }

      const updated = await supabaseRest(
        `/orders?id=eq.${encodeURIComponent(order.id)}`,
        {
          method: 'PATCH',
          body: update
        }
      );

      const finalStatus = String(
        update.fulfillment_status ||
        order.fulfillment_status ||
        ''
      ).toUpperCase();

      let stockResult = null;

      if (['CANCELLED', 'REFUNDED', 'DELETED'].includes(finalStatus)) {
        stockResult = await restoreOrderStock(order.id);
      }

      await addOrderHistory(
        order.id,
        event,
        finalStatus || 'UPDATED',
        note ||
          (
            stockResult
              ? 'Pedido cancelado e estoque devolvido automaticamente.'
              : ''
          ),
        {
          carrier: update.carrier || '',
          trackingCode: update.tracking_code || '',
          trackingUrl: update.tracking_url || '',
          stock: stockResult
        },
        admin.email
      );

      const refreshed = await supabaseRest(
        `/orders?id=eq.${encodeURIComponent(order.id)}&select=${encodeURIComponent(orderSelect())}&limit=1`
      );

      return sendJson(res, 200, {
        order: Array.isArray(refreshed)
          ? refreshed[0]
          : updated?.[0] || null
      });
    }

    return sendJson(res, 405, {
      error: 'method_not_allowed',
      message: 'Método não permitido.'
    });
  } catch (error) {
    return sendJson(res, Number(error.status || 400), {
      error: 'admin_orders_error',
      message: error.message || 'Erro ao gerenciar pedidos.'
    });
  }
}
