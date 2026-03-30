import mercadopago from 'mercadopago';

// Configurar Mercado Pago
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

export default async (req, res) => {
    // Configurar CORS
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
        const { title, price, plan, email } = req.body;

        const prices = {
            mensal: 5.00,
            trimestral: 24.90,
            semestral: 49.90,
            anual: 89.90
        };

        const valor = price || prices[plan] || 24.90;
        const titulo = title || `Plano ${plan} - Karaokê Multiplayer`;

        const preference = {
            items: [{
                title: titulo,
                unit_price: parseFloat(valor),
                quantity: 1,
                currency_id: 'BRL',
                description: `Plano ${plan}`
            }],
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
            external_reference: JSON.stringify({ email, plan })
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
