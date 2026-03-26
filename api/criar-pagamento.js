import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const preferenceApi = new Preference(client);
const paymentApi = new Payment(client);

export default async function handler(req, res) {

  // ===== CORS =====
  res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  try {
    const { plan, email, metodo } = req.body;

    const prices = {
      mensal: 5.00,
      trimestral: 49.90,
      semestral: 89.90,
      anual: 159.90
    };

    const price = prices[plan];

    if (!price) {
      return res.status(400).json({ erro: 'Plano inválido' });
    }

    console.log("📦 Criando pagamento:", { plan, email, metodo });

    // ================= PIX =================
    if (metodo === 'pix') {

      const payment = await paymentApi.create({
        body: {
          transaction_amount: price,
          description: `Plano ${plan}`,
          payment_method_id: "pix",
          payer: { email },

          // 🔥 ESSENCIAL (para webhook funcionar)
          external_reference: JSON.stringify({
            email,
            plan
          })
        }
      });

      const data = payment;

      return res.status(200).json({
        sucesso: true,
        id: data.id,
        qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64,
        qr_code: data.point_of_interaction.transaction_data.qr_code
      });
    }

    // ================= CARTÃO =================
    const preference = await preferenceApi.create({
      body: {
        items: [
          {
            title: `Plano ${plan}`,
            quantity: 1,
            currency_id: "BRL",
            unit_price: price
          }
        ],
        payer: { email },

        external_reference: JSON.stringify({
          email,
          plan
        }),

        notification_url: "https://karaoke-api-backend3.vercel.app/api/webhook",

        back_urls: {
          success: "https://karaokemultiplayer.com.br/sucesso.html",
          failure: "https://karaokemultiplayer.com.br/erro.html",
          pending: "https://karaokemultiplayer.com.br/pendente.html"
        },

        auto_return: "approved"
      }
    });

    return res.status(200).json({
      sucesso: true,
      id: preference.id,
      init_point: preference.init_point
    });

  } catch (error) {
    console.error("❌ Erro:", error);
    return res.status(500).json({
      erro: "Erro interno",
      detalhe: error.message
    });
  }
}
