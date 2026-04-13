// api/criar-pagamento-cartao.js
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

function configurarCORS(req, res) {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'http://localhost:3000'
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

module.exports = async (req, res) => {
    console.log("🚀 CREATE PAYMENT CARD");

    if (configurarCORS(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { token, email, plan, valor } = req.body;

        console.log('📩 Dados recebidos:', { email, plan, valor, token: token ? 'SIM' : 'NÃO' });

        if (!token) {
            return res.status(400).json({ 
                sucesso: false, 
                erro: 'Token do cartão não enviado' 
            });
        }

        if (!email) {
            return res.status(400).json({ 
                sucesso: false, 
                erro: 'Email não enviado' 
            });
        }

        // Definir valor do plano
        const valores = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };
        
        const valorFinal = valor || valores[plan] || 49.90;
        const descricao = `Plano ${plan} - Karaokê Multiplayer`;

        const paymentData = {
            transaction_amount: valorFinal,
            token: token,
            description: descricao,
            installments: 1,
            payment_method_id: 'visa',
            payer: {
                email: email
            },
            notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
            external_reference: JSON.stringify({ email, plan })
        };

        console.log('💳 Enviando para Mercado Pago...');
        const response = await mercadopago.payment.create(paymentData);
        const payment = response.body;

        console.log('💳 STATUS:', payment.status);
        console.log('💳 DETALHE:', payment.status_detail);

        if (payment.status === 'approved') {
            return res.status(200).json({
                sucesso: true,
                status: payment.status,
                id: payment.id
            });
        } else {
            return res.status(200).json({
                sucesso: false,
                status: payment.status,
                detalhe: payment.status_detail,
                erro: 'Pagamento não aprovado'
            });
        }

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        console.error('📦 Detalhes:', error.response?.data || error);

        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro interno do servidor'
        });
    }
};
