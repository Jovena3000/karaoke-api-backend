// api/criar-pagamento.js - VERSÃO 1.5.15
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log("🚀 CREATE PAYMENT v1.5.15");

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo, token, payment_method_id, cpf } = req.body;

        console.log('📩 Dados:', { email, plan, metodo, token: token ? '✅' : '❌', payment_method_id });

        // Validação básica
        if (!email || !email.includes('@')) {
            return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });
        }
        if (!plan) {
            return res.status(400).json({ sucesso: false, erro: 'Plano não informado' });
        }

        const precos = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };

        const valor = precos[plan];
        if (!valor) {
            return res.status(400).json({ sucesso: false, erro: 'Plano inválido' });
        }

        const descricao = `Plano ${plan} - Karaokê Multiplayer`;

        // ================= PIX =================
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

            console.log('✅ PIX criado! ID:', data.id);

            return res.status(200).json({
                sucesso: true,
                metodo: 'pix',
                id: data.id,
                qr_code: data.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }

        // ================= CARTÃO =================
        if (metodo === 'card') {
            console.log('💳 Processando cartão...');

            if (!token) {
                return res.status(400).json({
                    sucesso: false,
                    erro: 'Token do cartão não enviado'
                });
            }

            // ✅ CORRIGIDO: usa o payment_method_id real vindo do frontend
            if (!payment_method_id) {
                console.warn('⚠️ payment_method_id não enviado pelo frontend!');
            }

            const paymentData = {
                transaction_amount: Number(valor),
                token: token,
                description: descricao,
                installments: 1,
                payment_method_id: payment_method_id || 'master', // usa o real, fallback para master
                payer: {
                    email: email,
                    identification: {
                        type: 'CPF',
                        // ✅ CORRIGIDO: usa o CPF do cliente se enviado, senão usa fallback
                        number: cpf || '19119119100'
                    }
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`,
                metadata: { email, plan }
            };

            console.log('📤 Enviando pagamento para MP...');
            console.log('💳 Método:', paymentData.payment_method_id);

            const response = await mercadopago.payment.create(paymentData);
            const payment = response.body;

            console.log('💳 Status:', payment.status);
            console.log('💳 ID:', payment.id);

            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                id: payment.id,
                mensagem: payment.status === 'approved' ? 'Pagamento aprovado!' : 'Pagamento pendente'
            });
        }

        return res.status(400).json({
            sucesso: false,
            erro: 'Método de pagamento inválido. Use "pix" ou "card".'
        });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        if (error.response?.data) {
            console.error('📦 Detalhes MP:', JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro interno do servidor'
        });
    }
};
