const mercadopago = require('mercadopago');

// Configurar Mercado Pago com variável de ambiente
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Lidar com preflight request (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Aceitar apenas POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        // Dados do produto/plano enviados do frontend
        const { title, price, quantity, plan, email } = req.body;

        // Criar preferência de pagamento
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
                email: email || 'cliente@email.com'
            },
            back_urls: {
                success: 'https://karaoke-multiplayer.pages.dev/pagamento-sucesso.html',
                failure: 'https://karaoke-multiplayer.pages.dev/erro.html',
                pending: 'https://karaoke-multiplayer.pages.dev/pendente.html'
            },
            auto_return: 'approved',
            external_reference: `pedido_${Date.now()}`,
            payment_methods: {
                excluded_payment_methods: [],
                installments: 1
            }
        };

        // Criar a preferência no Mercado Pago
        const response = await mercadopago.preferences.create(preference);

        // Retornar o ID da preferência e o link de pagamento
        res.status(200).json({
            id: response.body.id,
            init_point: response.body.init_point
        });

    } catch (error) {
        console.error('Erro ao criar preferência:', error);
        res.status(500).json({ 
            error: 'Erro ao criar preferência de pagamento',
            detalhe: error.message 
        });
    }
};
