// api/criar-pagamento.js
const mercadopago = require('mercadopago');

const MINHA_TOKEN = 'APP_USR-2385096665734797-021814-9a11c38f6752e996371ba1955701fee7-9710270';

mercadopago.configure({
    access_token: MINHA_TOKEN  // ← Use a token fixa
});

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log("🚀 CREATE PAYMENT");

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo, token, payment_method_id, installments = 1 } = req.body;

        console.log('📩 Dados:', { email, plan, metodo, token: token ? '✅' : '❌', payment_method_id });

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
            const payment = await mercadopago.payment.create({
                transaction_amount: valor,
                description: descricao,
                payment_method_id: 'pix',
                payer: { email: email },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`,
                metadata: { email, plan }
            });
            const data = payment.body;
            return res.status(200).json({
                sucesso: true,
                metodo: 'pix',
                id: data.id,
                qr_code: data.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }

        // CARTÃO
        if (metodo === 'card') {
            console.log('💳 Processando cartão...');

            if (!token) {
                return res.status(400).json({ sucesso: false, erro: 'Token do cartão não enviado' });
            }

            if (!payment_method_id) {
                console.error("⚠️ payment_method_id não enviado pelo frontend!");
                return res.status(400).json({ sucesso: false, erro: 'Método de pagamento não identificado' });
            }

            const paymentData = {
                transaction_amount: Number(valor),
                token: token,
                description: descricao,
                installments: Number(installments),
                payment_method_id: payment_method_id,
                payer: { 
                    email: email,
                    identification: {
                        type: 'CPF',
                        number: '19119119100'
                    }
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`,
                metadata: { email, plan }
            };

            console.log('📤 Enviando pagamento para MP...');
            const response = await mercadopago.payment.create(paymentData);
            const payment = response.body;

            console.log('💳 Status:', payment.status);
            console.log('💳 ID:', payment.id);

            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                id: payment.id
            });
        }

        return res.status(400).json({ sucesso: false, erro: 'Método de pagamento inválido' });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        if (error.response?.data) {
            console.error('📦 Detalhes:', JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({ sucesso: false, erro: error.message || 'Erro interno' });
    }
};
