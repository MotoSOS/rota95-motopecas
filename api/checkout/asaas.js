import { randomUUID } from 'node:crypto';
import {
  sendJson, digits, cleanText, validEmail, validDocument, dueDate, moneyNumber,
  publicOrigin, clientIp, authenticatedUser, supabaseRest, storeValue, asaas, addOrderHistory, assignDisplayId
} from '../_lib.js';

function normalizeRequestId(value) {
  const cleaned = cleanText(value, 100).replace(/[^A-Za-z0-9-]/g, '');
  return cleaned.length >= 12 ? cleaned : `R95-${randomUUID().toUpperCase()}`;
}

function publicProductPrice(product) {
  const normal = Number(product?.preco || 0);
  const promo = Number(product?.precoPromocional || 0);
  return promo > 0 && promo < normal ? promo : normal;
}

async function catalogAndConfig() {
  const [catalogRaw, configRaw] = await Promise.all([
    storeValue('rota95_produtos'), storeValue('rota95_config_site')
  ]);
  let products = [], config = {};
  try { products = JSON.parse(catalogRaw || '[]'); } catch {}
  try { config = JSON.parse(configRaw || '{}'); } catch {}
  if (!Array.isArray(products) || !products.length) {
    throw Object.assign(new Error('Catálogo online não encontrado no Supabase.'), { status: 503 });
  }
  return { products, config };
}

function validateItems(clientItems, products) {
  if (!Array.isArray(clientItems) || !clientItems.length) throw new Error('Seu carrinho está vazio.');
  const map = new Map(products.filter(p => p && p.ativo !== false).map(p => [String(p.id), p]));
  return clientItems.map(raw => {
    const id = cleanText(raw?.id, 100);
    const product = map.get(id);
    if (!product) throw new Error(`O produto ${id || 'informado'} não está mais disponível.`);
    const quantity = Math.max(1, Math.min(50, Math.trunc(Number(raw?.quantity || 1))));
    const stock = Math.max(0, Math.trunc(Number(product.estoque || 0)));
    if (stock < quantity) throw new Error(`Estoque insuficiente para ${product.nome}. Disponível: ${stock}.`);
    const unitPrice = publicProductPrice(product);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error(`Preço inválido para ${product.nome}.`);
    return {
      product_id: id,
      product_name: cleanText(product.nome, 200),
      quantity,
      unit_price: moneyNumber(unitPrice)
    };
  });
}

async function findOrCreateAsaasCustomer(customer, userId, address) {
  const cpfCnpj = digits(customer.cpfCnpj);
  const found = await asaas(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=1`);
  if (Array.isArray(found?.data) && found.data[0]) return found.data[0];
  return asaas('/customers', {
    method: 'POST',
    body: {
      name: cleanText(customer.name, 120),
      cpfCnpj,
      email: cleanText(customer.email, 160),
      mobilePhone: digits(customer.phone),
      postalCode: digits(address?.postalCode),
      address: cleanText(address?.address, 160),
      addressNumber: cleanText(address?.addressNumber, 20),
      complement: cleanText(address?.complement, 80),
      province: cleanText(address?.province, 100),
      externalReference: userId || cleanText(customer.email, 160),
      notificationDisabled: false
    }
  });
}

function normalizeCard(card = {}) {
  const number = digits(card.number);
  const expiryMonth = digits(card.expiryMonth).padStart(2, '0');
  let expiryYear = digits(card.expiryYear);
  if (expiryYear.length === 2) expiryYear = `20${expiryYear}`;
  const ccv = digits(card.ccv);
  const holderName = cleanText(card.holderName, 100);
  const postalCode = digits(card.postalCode);
  const addressNumber = cleanText(card.addressNumber, 20);
  if (holderName.length < 3 || number.length < 13 || number.length > 19) throw new Error('Confira o nome e o número do cartão.');
  if (Number(expiryMonth) < 1 || Number(expiryMonth) > 12 || expiryYear.length !== 4) throw new Error('Validade do cartão inválida.');
  if (ccv.length < 3 || ccv.length > 4) throw new Error('Código de segurança inválido.');
  if (postalCode.length !== 8 || !addressNumber) throw new Error('Informe o CEP e o número do endereço do titular do cartão.');
  return { holderName, number, expiryMonth, expiryYear, ccv, postalCode, addressNumber };
}

function basePaymentBody({ customerId, externalId, method, installments, total, origin }) {
  const billing = { pix: 'PIX', credit: 'CREDIT_CARD', boleto: 'BOLETO' }[method];
  if (!billing) throw new Error('Forma de pagamento não suportada. Use Pix, crédito ou boleto.');
  const body = {
    customer: customerId,
    billingType: billing,
    dueDate: dueDate(method === 'boleto' ? 2 : 1),
    description: `Pedido ${externalId} - ROTA 95 Motopeças`,
    externalReference: externalId,
    callback: {
      successUrl: `${origin}/motopecas/pedido-sucesso?order=${encodeURIComponent(externalId)}`,
      autoRedirect: false
    }
  };
  const count = method === 'credit' ? Math.max(1, Math.min(12, Math.trunc(Number(installments || 1)))) : 1;
  if (count > 1) {
    body.installmentCount = count;
    body.totalValue = total;
  } else {
    body.value = total;
  }
  if (method === 'boleto') body.daysAfterDueDateToRegistrationCancellation = 2;
  return body;
}

function cardPaymentBody(base, card, customer, req) {
  return {
    ...base,
    creditCard: {
      holderName: card.holderName,
      number: card.number,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      ccv: card.ccv
    },
    creditCardHolderInfo: {
      name: cleanText(customer.name, 120),
      email: cleanText(customer.email, 160).toLowerCase(),
      cpfCnpj: digits(customer.cpfCnpj),
      postalCode: card.postalCode,
      addressNumber: card.addressNumber,
      addressComplement: cleanText(customer.complement, 80) || null,
      phone: digits(customer.phone),
      mobilePhone: digits(customer.phone)
    },
    remoteIp: clientIp(req)
  };
}

async function paymentPresentation(method, charge) {
  if (method === 'pix') {
    const pix = await asaas(`/payments/${encodeURIComponent(charge.id)}/pixQrCode`);
    return {
      type: 'pix',
      encodedImage: pix.encodedImage || '',
      payload: pix.payload || '',
      expirationDate: pix.expirationDate || ''
    };
  }
  if (method === 'boleto') {
    const field = await asaas(`/payments/${encodeURIComponent(charge.id)}/identificationField`);
    return {
      type: 'boleto',
      identificationField: field.identificationField || '',
      barCode: field.barCode || '',
      nossoNumero: field.nossoNumero || '',
      bankSlipUrl: charge.bankSlipUrl || charge.invoiceUrl || ''
    };
  }
  return {
    type: 'credit',
    approved: ['CONFIRMED', 'RECEIVED'].includes(String(charge.status || '').toUpperCase()),
    brand: charge.creditCard?.creditCardBrand || charge.creditCardBrand || '',
    last4: charge.creditCard?.creditCardNumber || charge.creditCardNumber || ''
  };
}

function initialFulfillment(paymentStatus) {
  return ['CONFIRMED', 'RECEIVED'].includes(String(paymentStatus || '').toUpperCase())
    ? 'PAID_AWAITING_PROCESSING'
    : 'AWAITING_PAYMENT';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed', message: 'Método não permitido.' });
  let orderDbId = null;
  let externalId = '';
  try {
    const payload = req.body || {};
    const { customer = {}, delivery = {}, payment = {}, items = [], acceptedTerms } = payload;
    if (!acceptedTerms) throw new Error('É necessário aceitar os termos para finalizar.');
    if (cleanText(customer.name, 120).length < 3 || !validEmail(customer.email) || !validDocument(customer.cpfCnpj) || digits(customer.phone).length < 10) {
      throw new Error('Dados cadastrais incompletos ou inválidos.');
    }
    if (delivery.type === 'delivery') {
      const a = delivery.address || {};
      if (digits(a.postalCode).length !== 8 || !a.address || !a.addressNumber || !a.province || !a.city || !a.state) {
        throw new Error('Endereço de entrega incompleto.');
      }
    }
    if (!['pix', 'credit', 'boleto'].includes(payment.method)) throw new Error('Forma de pagamento inválida.');
    const normalizedCard = payment.method === 'credit' ? normalizeCard(payment.card || {}) : null;

    const user = await authenticatedUser(req);
    const { products, config } = await catalogAndConfig();
    const normalizedItems = validateItems(items, products);
    const subtotal = moneyNumber(normalizedItems.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0));
    const fee = Math.max(0, Number(config?.taxaEntrega || 0));
    const freeAbove = Math.max(0, Number(config?.freteGratisAcima || 0));
    const shipping = delivery.type === 'pickup' ? 0 : (freeAbove > 0 && subtotal >= freeAbove ? 0 : fee);
    const total = moneyNumber(subtotal + shipping);
    externalId = normalizeRequestId(payload.requestId);

    const existing = await supabaseRest(`/orders?external_id=eq.${encodeURIComponent(externalId)}&select=id,external_id,display_id,payment_id,status,total,invoice_url,payment_data,fulfillment_status&limit=1`);
    if (Array.isArray(existing) && existing[0]?.payment_id) {
      return sendJson(res, 200, {
        orderId: existing[0].display_id || existing[0].external_id,
        displayId: existing[0].display_id || '',
        technicalOrderId: existing[0].external_id,
        paymentId: existing[0].payment_id,
        status: existing[0].status,
        fulfillmentStatus: existing[0].fulfillment_status,
        total: Number(existing[0].total),
        invoiceUrl: existing[0].invoice_url,
        paymentUi: existing[0].payment_data || null,
        reused: true
      });
    }

    if (user?.id) {
      await supabaseRest('/profiles?on_conflict=id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          id: user.id,
          full_name: cleanText(customer.name, 120),
          phone: digits(customer.phone),
          cpf_cnpj: digits(customer.cpfCnpj),
          postal_code: digits(customer.postalCode || delivery.address?.postalCode),
          state: cleanText(customer.state || delivery.address?.state, 2).toUpperCase(),
          city: cleanText(customer.city || delivery.address?.city, 100),
          province: cleanText(customer.province || delivery.address?.province, 100),
          address: cleanText(customer.address || delivery.address?.address, 160),
          address_number: cleanText(customer.addressNumber || delivery.address?.addressNumber, 20),
          complement: cleanText(customer.complement || delivery.address?.complement, 80),
          updated_at: new Date().toISOString()
        }
      });
    }

    const inserted = await supabaseRest('/orders', {
      method: 'POST',
      body: {
        user_id: user?.id || null,
        external_id: externalId,
        status: 'CREATED',
        fulfillment_status: 'AWAITING_PAYMENT',
        total,
        payment_method: payment.method,
        customer: {
          name: cleanText(customer.name, 120),
          email: cleanText(customer.email, 160).toLowerCase(),
          cpfCnpj: digits(customer.cpfCnpj),
          phone: digits(customer.phone)
        },
        delivery,
        updated_at: new Date().toISOString()
      }
    });
    orderDbId = inserted?.[0]?.id;
    if (!orderDbId) throw new Error('Não foi possível registrar o pedido no Supabase.');

    await supabaseRest('/order_items', {
      method: 'POST',
      prefer: 'return=minimal',
      body: normalizedItems.map(item => ({ order_id: orderDbId, ...item }))
    });
    await addOrderHistory(orderDbId, 'ORDER_CREATED', 'CREATED', 'Pedido criado pelo checkout.', { paymentMethod: payment.method }, user?.email || customer.email);

    const customerAddress = delivery.address || customer;
    const asaasCustomer = await findOrCreateAsaasCustomer(customer, user?.id, customerAddress);
    let chargeBody = basePaymentBody({
      customerId: asaasCustomer.id,
      externalId,
      method: payment.method,
      installments: payment.installments,
      total,
      origin: publicOrigin(req)
    });
    if (payment.method === 'credit') chargeBody = cardPaymentBody(chargeBody, normalizedCard, customer, req);

    const charge = await asaas('/payments', { method: 'POST', body: chargeBody });
    const paymentUi = await paymentPresentation(payment.method, charge);
    const fulfillmentStatus = initialFulfillment(charge.status);
    const paidAt = fulfillmentStatus === 'PAID_AWAITING_PROCESSING' ? new Date().toISOString() : null;

    await supabaseRest(`/orders?id=eq.${encodeURIComponent(orderDbId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        payment_id: charge.id,
        status: charge.status || 'PENDING',
        fulfillment_status: fulfillmentStatus,
        invoice_url: charge.invoiceUrl || charge.bankSlipUrl || '',
        payment_data: paymentUi,
        asaas_customer_id: asaasCustomer.id,
        paid_at: paidAt,
        updated_at: new Date().toISOString()
      }
    });
    await addOrderHistory(orderDbId, 'PAYMENT_CREATED', charge.status || 'PENDING', 'Cobrança criada no Asaas.', { paymentId: charge.id, method: payment.method }, 'Asaas');

    const displayId = fulfillmentStatus === 'PAID_AWAITING_PROCESSING'
      ? await assignDisplayId(orderDbId)
      : '';

    return sendJson(res, 201, {
      orderId: displayId || externalId,
      displayId,
      technicalOrderId: externalId,
      paymentId: charge.id,
      status: charge.status || 'PENDING',
      fulfillmentStatus,
      invoiceUrl: charge.invoiceUrl || charge.bankSlipUrl || '',
      paymentUi,
      total
    });
  } catch (error) {
    console.error('[ROTA95 checkout]', error?.message || error);
    if (orderDbId) {
      try {
        await supabaseRest(`/orders?id=eq.${encodeURIComponent(orderDbId)}`, {
          method: 'PATCH',
          prefer: 'return=minimal',
          body: { status: 'PAYMENT_ERROR', fulfillment_status: 'PAYMENT_ERROR', updated_at: new Date().toISOString() }
        });
        await addOrderHistory(orderDbId, 'PAYMENT_ERROR', 'PAYMENT_ERROR', error.message || 'Erro ao criar cobrança.', {}, 'Sistema');
      } catch {}
    }
    return sendJson(res, Number(error.status || 400), { error: 'checkout_error', message: error.message || 'Erro inesperado ao criar a cobrança.' });
  }
}
