const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const { title, price, quantity, plan, email } = req.body;

        const preference = {
            items: [
                {
                    title: title || 'Plano Karaokê Multiplayer',
                    unit_price: parseFloat(price) || 24.90,
                    quantity: parseInt(quantity) || 1,
                    currency_id: 'BRL',
                    description: plan || 'Plano Trimestral'
                }
            ],
            payer: {
                email: email || ''
            },
            back_urls: {
                success: 'https://karaoke-multiplayer.pages.dev/pagamento-sucesso.html',
                failure: 'https://karaoke-multiplayer.pages.dev/erro.html',
                pending: 'https://karaoke-multiplayer.pages.dev/pendente.html'
            },
            auto_return: 'approved',
            notification_url: 'https://karaoke-api-backend2-omega.vercel.app/api/webhook',
            payment_methods: {
                excluded_payment_methods: [],
                installments: 1
            },
            external_reference: `pedido_${Date.now()}`
        };

        const response = await mercadopago.preferences.create(preference);

        res.status(200).json({
            sucesso: true,
            id: response.body.id,
            init_point: response.body.init_point
        });

    } catch (error) {
        console.error('Erro ao criar preferência:', error);
        res.status(500).json({ 
            erro: 'Erro ao criar preferência de pagamento',
            detalhe: error.message 
        });
    }
};