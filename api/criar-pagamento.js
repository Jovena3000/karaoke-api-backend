const mercadopago = require("mercadopago");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async function handler(req, res) {

  // 🌐 Domínios permitidos
  const allowedOrigins = [
    "https://karaoke-multiplayer.pages.dev",
    "https://karaokemultiplayer.com.br",
    "https://www.karaokemultiplayer.com.br"
  ];

  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://karaokemultiplayer.com.br");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // 🔵 Resposta para preflight CORS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  try {

    const { plan, email } = req.body || {};

    if (!plan || !email) {
      return res.status(400).json({
        erro: "Plano e email obrigatórios"
      });
    }

    // 💰 Tabela de preços
    const prices = {
      mensal: 24.90,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    if (!prices[plan]) {
      return res.status(400).json({
        erro: "Plano inválido"
      });
    }

    const price = prices[plan];

    console.log("📦 Criando pagamento:", { email, plan, price });

    const preference = {
      items: [
        {
          title: `Plano Karaokê ${plan}`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: price
        }
      ],

      payer: {
        email: email
      },

      external_reference: JSON.stringify({
        email: email,
        plan: plan,
        created_at: Date.now()
      }),

      back_urls: {
        success: "https://karaokemultiplayer.com.br/pagamento-sucesso",
        failure: "https://karaokemultiplayer.com.br/pagamento-falha",
        pending: "https://karaokemultiplayer.com.br/pagamento-pendente"
      },

      auto_return: "approved",

      notification_url:
        "https://karaoke-api-backend3.vercel.app/api/webhook"
    };

    console.log("📤 Enviando preferência para Mercado Pago");

    const response = await mercadopago.preferences.create(preference);

    console.log("✅ Preferência criada:", response.body.id);

    return res.status(200).json({
      sucesso: true,
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {

    console.error("❌ Erro ao criar pagamento:", error);

    return res.status(500).json({
      erro: "Erro interno ao criar pagamento",
      detalhe: error.message
    });

  }
};
