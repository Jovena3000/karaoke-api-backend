const mercadopago = require("mercadopago");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://karaoke-multiplayer.pages.dev"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  try {

    const { plan, email } = req.body;

    if (!plan || !email) {
      return res.status(400).json({
        erro: "Plano e email são obrigatórios"
      });
    }

    console.log("📦 Criando pagamento:", { plan, email });

    const prices = {
      mensal: 19.90,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const price = prices[plan] || 19.90;

    const preference = {
      statement_descriptor: "KARAOKE MULTIPLAYER",

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

      back_urls: {
        success: "https://karaoke-multiplayer.pages.dev/pagamento-sucesso.html",
        failure: "https://karaoke-multiplayer.pages.dev/erro.html",
        pending: "https://karaoke-multiplayer.pages.dev/pendente.html"
      },

      auto_return: "approved",

      notification_url: "https://karaoke-api-backend2-omega.vercel.app/api/webhook",

      external_reference: JSON.stringify({
        email,
        plan,
        created_at: Date.now()
      })
    };

    const response = await mercadopago.preferences.create(preference);

    console.log("✅ Pagamento criado:", response.body.id);

    res.status(200).json({
      sucesso: true,
      id: response.body.id,
      init_point: response.body.init_point
    });

  } catch (error) {

    console.error("❌ Erro pagamento:", error);

    res.status(500).json({
      erro: "Erro ao criar pagamento",
      detalhe: error.message
    });

  }
};
