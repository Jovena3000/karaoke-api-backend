import { MercadoPagoConfig, Preference } from "mercadopago";

// Configurar cliente
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const preferenceApi = new Preference(client);

export default async function handler(req, res) {

  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { title, price, plan, email } = req.body;

    if (!email || !plan) {
      return res.status(400).json({
        erro: 'Email e plano são obrigatórios'
      });
    }

    const preference = {
      items: [
        {
          title: title || 'Plano Karaokê Multiplayer',
          unit_price: parseFloat(price) || 24.90,
          quantity: 1,
          currency_id: 'BRL',
          description: plan
        }
      ],

      payer: {
        email: email
      },

      // 🔥 ESSENCIAL PARA WEBHOOK
      external_reference: JSON.stringify({
        email: email,
        plan: plan,
        created_at: Date.now()
      }),

      back_urls: {
        success: 'https://karaokemultiplayer.com.br/pagamento-sucesso.html',
        failure: 'https://karaokemultiplayer.com.br/erro.html',
        pending: 'https://karaokemultiplayer.com.br/pendente.html'
      },

      auto_return: 'approved',

      notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook'
    };

    const response = await preferenceApi.create({ body: preference });

    return res.status(200).json({
      sucesso: true,
      id: response.id,
      init_point: response.init_point
    });

  } catch (error) {

    console.error('Erro ao criar preferência:', error);

    return res.status(500).json({ 
      erro: 'Erro ao criar pagamento',
      detalhe: error.message 
    });
  }
}
