// api/criar-pagamento.js - INÍCIO DO ARQUIVO
const mercadopago = require('mercadopago');
const { processarPagamentoAprovado } = require('./webhook');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // 🔥 CORS - PERMITE TODAS AS ORIGENS (SOLUÇÃO DEFINITIVA)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    // Resposta imediata para preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log("🚀 CREATE PAYMENT");
    console.log("📩 Body:", req.body);

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

        // CARTÃO - NÃO É PREFERÊNCIA!
        if (metodo === 'card') {
            console.log('💳 Processando cartão...');

            if (!token) {
                return res.status(400).json({
                    sucesso: false,
                    erro: 'Token do cartão não enviado'
                });
            }

            // 🔥 ATENÇÃO: Isso é payment.create, NÃO preferences.create!
            const paymentData = {
                transaction_amount: Number(valor),
                token: token,
                description: descricao,
                installments: 1,
                payment_method_id: 'master',
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

            if (payment.status === 'approved') {
                console.log('✅ Pagamento aprovado! Processando...');
                await processarPagamentoAprovado(email, plan, payment.id);
            }

            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                id: payment.id,
                mensagem: payment.status === 'approved' ? 'Pagamento aprovado!' : 'Pagamento pendente'
            });
        }

        return res.status(400).json({
            sucesso: false,
            erro: 'Método de pagamento inválido'
        });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        if (error.response?.data) {
            console.error('📦 Detalhes:', JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({
            sucesso: false,
            erro: error.message
        });
    }
};
