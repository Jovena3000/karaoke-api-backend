// api/criar-pagamento.js
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { processarPagamentoAprovado } = require('./webhook');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
  // ✅ CORS CORRIGIDO (anti-bug Vercel)
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  console.log("🚀 CREATE PAYMENT");
  console.log("📩 Body:", req.body);

  try {
    const { plan, email, metodo, token } = req.body;

    const precos = {
      mensal: 5.00,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const valor = precos[plan];
    if (!valor) {
      return res.status(400).json({ sucesso: false, erro: 'Plano inválido' });
    }

    const descricao = `Plano ${plan} - Karaokê Multiplayer`;

    const paymentClient = new Payment(client);

    // ================= PIX =================
    if (metodo === 'pix') {
      console.log('📱 Criando PIX...');

      const payment = await paymentClient.create({
        body: {
          transaction_amount: valor,
          description: descricao,
          payment_method_id: 'pix',
          payer: { email },
          notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
          external_reference: `${email}|${plan}`,
          metadata: { email, plan }
        }
      });

      return res.status(200).json({
        sucesso: true,
        metodo: 'pix',
        id: payment.id,
        qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64
      });
    }

    // ================= CARTÃO =================
    if (metodo === 'card') {
      console.log('💳 Processando cartão...');

      if (!token) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Token do cartão não enviado'
        });
      }

      const payment = await paymentClient.create({
        body: {
          transaction_amount: Number(valor),
          token: token,
          description: descricao,
          installments: 1,
          payment_method_id: 'visa', // pode melhorar depois
          payer: {
            email: email,
            identification: {
              type: 'CPF',
              number: '19119119100'
            }
          },
          notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
          external_reference: `${email}|${plan}`,
          metadata: { email, plan }
        }
      });

      console.log('💳 Status:', payment.status);
      console.log('💳 ID:', payment.id);

      // 🔥 Se aprovou, ativa usuário
      if (payment.status === 'approved') {
        console.log('✅ Pagamento aprovado!');
        await processarPagamentoAprovado(email, plan, payment.id);
      }

      return res.status(200).json({
        sucesso: payment.status === 'approved',
        status: payment.status,
        id: payment.id,
        mensagem:
          payment.status === 'approved'
            ? 'Pagamento aprovado!'
            : 'Pagamento pendente'
      });
    }

    return res.status(400).json({
      sucesso: false,
      erro: 'Método de pagamento inválido'
    });

  } catch (error) {
    console.error('❌ ERRO:', error);

    return res.status(500).json({
      sucesso: false,
      erro: error.message || 'Erro interno'
    });
  }
};
