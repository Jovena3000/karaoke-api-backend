const { MercadoPagoConfig, Preference } = require("mercadopago");

// Configurar o cliente com o token
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

// Criar uma instância da API de preferências
const preferenceApi = new Preference(client);

module.exports = async (req, res) => {
    // Configurar CORS
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

        // Criar a preferência de pagamento usando a nova sintaxe
        const preference = {
            items: [
                {
                    title: title || 'Plano Karaokê Multiplayer',
                    unit_price: parseFloat(price) || 24.90,
                    quantity: 1,
                    currency_id: 'BRL',
                    description: plan || 'Plano Trimestral'
                }
            ],
            payer: {
                email: email || ''
            },
            back_urls: {
                success: 'https://karaokemultiplayer.com.br/pagamento-sucesso.html',
                failure: 'https://karaokemultiplayer.com.br/erro.html',
                pending: 'https://karaokemultiplayer.com.br/pendente.html'
            },
            auto_return: 'approved',
            notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
            external_reference: `pedido_${Date.now()}`
        };

        // Criar a preferência usando o método create da API
        const response = await preferenceApi.create({ body: preference });

        res.status(200).json({
            sucesso: true,
            id: response.id,
            init_point: response.init_point
        });

    } catch (error) {
        console.error('Erro ao criar preferência:', error);
        res.status(500).json({ 
            erro: 'Erro ao criar preferência de pagamento',
            detalhe: error.message 
        });
    }
};
