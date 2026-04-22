// api/criar-pagamento.js
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { processarPagamentoAprovado } = require('./webhook');

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentClient = new Payment(client);

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log("🚀 CREATE PAYMENT");

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo, token } = req.body;

        console.log('📩 Dados:', { email, plan, metodo, token: token ? '✅' : '❌' });

        const precos = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };

        const valor = precos[plan] || 49.90;
        const descricao = `Plano ${plan} - Karaokê Multiplayer`;

        // PIX
        if (metodo === 'pix') {
            console.log('📱 Criando PIX...');

            const payment = await paymentClient.create({
                body: {
                    transaction_amount: valor,
                    description: descricao,
                    payment_method_id: 'pix',
                    payer: { email: email },
                    notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                    external_reference: `${email}|${plan}`,
                    metadata: { email, plan }
                }
            });

            return res.status(200).json({
                sucesso: true,
                metodo: 'pix',
                id: payment.id,
                qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }

        // CARTÃO
        if (metodo === 'card') {
            console.log('💳 Processando cartão...');

            if (!token) {
                return res.status(400).json({ sucesso: false, erro: 'Token do cartão não enviado' });
            }

            const payment = await paymentClient.create({
                body: {
                    transaction_amount: Number(valor),
                    token: token,
                    description: descricao,
                    installments: 1,
                    payment_method_id: 'master',
                    payer: { email: email },
                    notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                    external_reference: `${email}|${plan}`,
                    metadata: { email, plan }
                }
            });

            console.log('💳 Status:', payment.status);

            if (payment.status === 'approved') {
                await processarPagamentoAprovado(email, plan, payment.id);
            }

            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                id: payment.id
            });
        }

        return res.status(400).json({ sucesso: false, erro: 'Método inválido' });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        return res.status(500).json({ sucesso: false, erro: error.message });
    }
};
