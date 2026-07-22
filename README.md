# ROTA 95 — Checkout interno + Gestão completa de pedidos

Esta versão mantém o cliente dentro do site durante o pagamento e adiciona uma área completa de pedidos ao painel administrativo.

## O que foi incluído

### Pagamento dentro do site

- **Pix:** cria a cobrança no Asaas e exibe o QR Code e o Pix Copia e Cola dentro do checkout.
- **Cartão de crédito:** coleta os dados no checkout HTTPS, envia diretamente ao servidor e processa a cobrança no Asaas. Número completo e CVV não são gravados no banco nem no localStorage.
- **Boleto:** exibe a linha digitável dentro do checkout e oferece o botão para visualizar o boleto.
- A tela acompanha o status do pagamento automaticamente.
- O webhook do Asaas atualiza o pedido no Supabase.

> Cartão de débito não é processado diretamente pela API do Asaas. Esta versão oferece Pix, crédito e boleto.

### Painel administrativo de pedidos

Nova aba **Pedidos** com:

- pedidos novos e pagos;
- pedidos em separação;
- prontos para envio ou retirada;
- enviados e entregues;
- problemas de pagamento, cancelamentos e estornos;
- dados do cliente e endereço;
- produtos e quantidades;
- valor e forma de pagamento;
- código e link de rastreio;
- transportadora;
- observações internas;
- histórico completo de cada alteração;
- impressão da ficha de separação;
- mensagem pronta pelo WhatsApp.

## 1. Supabase

No **SQL Editor**, execute:

```text
supabase/checkout-interno-pedidos-admin.sql
```

Execute apenas uma vez. O script usa `IF NOT EXISTS` e também atualiza projetos anteriores.

## 2. GitHub

Envie todos os arquivos deste pacote para a raiz do repositório, substituindo os arquivos existentes.

Estrutura principal:

```text
index.html
supabase-sync.js
initial-state.js
package.json
vercel.json
api/
  _lib.js
  config.js
  checkout/asaas.js
  orders/status.js
  webhooks/asaas.js
  admin/orders.js
supabase/
  checkout-interno-pedidos-admin.sql
```

## 3. Variáveis da Vercel

Confirme estas variáveis em **Settings → Environment Variables**:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAIL=motopecas.rota95@gmail.com
ASAAS_ENV=sandbox
ASAAS_API_KEY
ASAAS_WEBHOOK_TOKEN
PUBLIC_URL=https://rota95-motopecas.vercel.app
```

Depois faça um **Redeploy sem cache**.

## 4. Webhook Asaas

URL:

```text
https://rota95-motopecas.vercel.app/api/webhooks/asaas
```

O token do webhook deve ser exatamente o mesmo valor de `ASAAS_WEBHOOK_TOKEN` na Vercel.

Eventos recomendados:

```text
PAYMENT_CREATED
PAYMENT_UPDATED
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_OVERDUE
PAYMENT_REFUNDED
PAYMENT_DELETED
```

## 5. Como usar o painel

1. Entre no site com o Google usando `motopecas.rota95@gmail.com`.
2. Abra a **Área interna**.
3. Entre na aba **Pedidos**.
4. Abra um pedido.
5. Use o fluxo:

```text
Pago — aguardando separação
→ Iniciar separação
→ Marcar como pronto
→ Informar transportadora e código de rastreio
→ Confirmar envio
→ Confirmar entrega
```

## Segurança

- Nunca coloque `ASAAS_API_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` no HTML ou GitHub.
- O site já usa HTTPS pela Vercel.
- Dados completos do cartão e CVV não são armazenados.
- Para produção, revise requisitos de segurança e conformidade do checkout transparente com o Asaas.
