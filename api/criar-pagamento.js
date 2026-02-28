const mercadopago = require('mercadopago');

// Configuração correta para a versão 1.5.14
mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

const PLANOS = {
    mensal: { preco: 29.90, dias: 30 },
    trimestral: { preco: 79.90, dias: 90 }
};

module.exports = async (req, res) => {
    // Configuração CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Lidar com requisições OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Verificar método HTTP
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    try {
        const { title, price, quantity, plan, email, usuarioId } = req.body;

        // Validar campos obrigatórios
        if (!plan) {
            return res.status(400).json({ erro: 'Plano não especificado' });
        }

        // Definir valores padrão baseados no plano
        const planoInfo = PLANOS[plan] || PLANOS.trimestral;
        const preco = price ? parseFloat(price) : planoInfo.preco;
        const quantidade = parseInt(quantity) || 1;
        const titulo = title || `Plano ${plan} - Karaokê Multiplayer`;

        // Criar preferência de pagamento
        const preference = {
            items: [
                {
                    title: titulo,
                    unit_price: preco,
                    quantity: quantidade,
                    currency_id: 'BRL',
                    description: `Plano ${plan} - ${planoInfo.dias} dias de acesso`
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
            notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
            payment_methods: {
                excluded_payment_methods: [],
                installments: 1
            },
            external_reference: JSON.stringify({
                pedidoId: `pedido_${Date.now()}`,
                usuarioId: usuarioId || null,
                plano: plan
            })
        };

        const response = await mercadopago.preferences.create(preference);

        return res.status(200).json({
            sucesso: true,
            id: response.body.id,
            init_point: response.body.init_point,
            plano: plan,
            preco: preco
        });

    } catch (error) {
        console.error('Erro ao criar preferência:', error);
        
        return res.status(500).json({ 
            erro: 'Erro ao criar preferência de pagamento',
            detalhe: error.message 
        });
    }
};
