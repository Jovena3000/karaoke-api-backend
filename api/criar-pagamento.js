// api/criar-pagamento.js
const { MercadoPagoConfig, Payment } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 }
});

const payment = new Payment(client);

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Meli-Session-Id, X-Idempotency-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    const {
      plan,
      email,
      metodo,
      token,
      payment_method_id,
      issuer_id,
      installments = 1,
      cpf,
      nome
    } = req.body;

    const deviceId = req.headers['x-meli-session-id'] || '';
    const idempotencyKey = req.headers['x-idempotency-key'] || require('crypto').randomUUID();

    const precos = {
      mensal: 21.90,
      trimestral: 59.90,
      semestral: 99.90,
      anual: 159.90
    };

    const valor = precos[plan] || 59.90;
    const descricao = `Plano ${plan} - Karaokê Multiplayer`;

    // PIX
    if (metodo === 'pix') {
      const result = await payment.create({
        body: {
          transaction_amount: valor,
          description: descricao,
          payment_method_id: 'pix',
          payer: { email },
          notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
          external_reference: `${email}|${plan}`,
          metadata: { email, plan }
        },
        requestOptions: { idempotencyKey }
      });

      const data = result;
      return res.status(200).json({
        sucesso: true,
        metodo: 'pix',
        id: data.id,
        qr_code: data.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
      });
    }

    // CARTÃO
    if (metodo === 'card') {
      if (!token) return res.status(400).json({ sucesso: false, erro: 'Token do cartão não enviado' });
      if (!payment_method_id) return res.status(400).json({ sucesso: false, erro: 'Método de pagamento não identificado' });

      const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;

      const paymentData = {
        transaction_amount: Number(valor),
        token,
        description: descricao,
        installments: Number(installments),
        payment_method_id,
        issuer_id: issuer_id ? Number(issuer_id) : undefined,
        payer: {
          email,
          first_name: nome ? nome.split(' ')[0] : undefined,
          last_name: nome ? nome.split(' ').slice(1).join(' ') : undefined,
          ...(cpfLimpo && cpfLimpo.length === 11 && {
            identification: { type: 'CPF', number: cpfLimpo }
          })
        },
        notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
        external_reference: `${email}|${plan}`,
        metadata: { email, plan }
      };

      // Remove chaves undefined para não enviar lixo à API
      Object.keys(paymentData.payer).forEach(
        (k) => paymentData.payer[k] === undefined && delete paymentData.payer[k]
      );

      const result = await payment.create({
        body: paymentData,
        requestOptions: {
          idempotencyKey,
          customHeaders: {
            'X-Meli-Session-Id': deviceId
          }
        }
      });

      const data = result;

      return res.status(200).json({
        sucesso: data.status === 'approved',
        status: data.status,
        status_detail: data.status_detail, // 🔑 essencial para o front mostrar o motivo real
        id: data.id
      });
    }

    return res.status(400).json({ sucesso: false, erro: 'Método de pagamento inválido' });

  } catch (error) {
    console.error('❌ ERRO:', error.message);
    if (error.response?.data) {
      console.error('📦 Detalhes:', JSON.stringify(error.response.data, null, 2));
    }
    return res.status(500).json({ sucesso: false, erro: error.message || 'Erro interno' });
  }
};
