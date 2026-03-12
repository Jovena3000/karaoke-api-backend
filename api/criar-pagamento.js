const mercadopago = require("mercadopago");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async function handler(req, res) {
  // ✅ CORS atualizado para aceitar múltiplos domínios
  const allowedOrigins = [
    "https://karaoke-multiplayer.pages.dev",
    "https://karaokemultiplayer.com.br",
    "https://www.karaokemultiplayer.com.br"
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // Fallback para o domínio principal
    res.setHeader("Access-Control-Allow-Origin", "https://karaokemultiplayer.com.br");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Responder ao preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  try {
    const { plan, email } = req.body;

    if (!plan || !email) {
      return res.status(400).json({ erro: "Plano e email obrigatórios" });
    }

    const prices = {
      mensal: 24.90,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const price = prices[plan] || 24.90;

    // Log para depuração
    console.log("📦 Criando preferência para:", { plan, email, price });

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
        email, 
        plan,
        timestamp: Date.now() 
      }),
      // ✅ URLs atualizadas para o novo domínio
      back_urls: {
        success: "https://karaokemultiplayer.com.br/pagamento-sucesso",
        failure: "https://karaokemultiplayer.com.br/pagamento-falha",
        pending: "https://karaokemultiplayer.com.br/pagamento-pendente"
      },
      auto_return: "approved",
      notification_url: "https://karaoke-api-backend3.vercel.app/api/webhook"
    };

    console.log("📦 Enviando preferência:", JSON.stringify(preference, null, 2));
    
    const response = await mercadopago.preferences.create(preference);
    
    console.log("✅ Preferência criada:", response.body.id);
    console.log("🔗 Link:", response.body.init_point);
    
    return res.status(200).json({
      sucesso: true,
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {
    console.error("❌ Erro detalhado:", error);
    return res.status(500).json({ 
      erro: "Erro interno",
      detalhe: error.message 
    });
  }
};
