// api/criar-pagamento.js - CHECKOUT TRANSPARENTE (sem redirecionamento)
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
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

        // ================= PIX (sem redirecionamento) =================
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

        // ================= CARTÃO (Checkout Transparente - SEM REDIRECIONAMENTO) =================
        if (metodo === 'card') {
            console.log('💳 Processando cartão transparente...');

            if (!token) {
                return res.status(400).json({
                    sucesso: false,
                    erro: 'Token do cartão não enviado'
                });
            }

            // 🔥 IMPORTANTE: payment.create() - NÃO preferences.create()!
            const response = await mercadopago.payment.create({
                transaction_amount: Number(valor),
                token: token,
                description: descricao,
                installments: 1,
                payment_method_id: 'master',
                payer: { 
                    email: email,
                    identification: {
                        type: 'CPF',
                        number: '19119119100'  // CPF padrão, pode vir do frontend
                    }
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`,
                metadata: { email, plan }
            });

            const payment = response.body;

            console.log('💳 Status do pagamento:', payment.status);
            console.log('💳 Detalhe:', payment.status_detail);
            console.log('💳 ID:', payment.id);

            // Se o pagamento foi aprovado, processa imediatamente
            if (payment.status === 'approved') {
                console.log('✅ Pagamento aprovado!');
                // Chama a função de processamento se existir
                try {
                    const { processarPagamentoAprovado } = require('./webhook');
                    await processarPagamentoAprovado(email, plan, payment.id);
                } catch (err) {
                    console.log('Webhook não disponível, processamento será feito depois');
                }
            }

            // 🔥 Retorna o status - NÃO tem init_point!
            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                status_detail: payment.status_detail,
                id: payment.id,
                mensagem: payment.status === 'approved' 
                    ? 'Pagamento aprovado com sucesso!' 
                    : payment.status === 'pending' 
                        ? 'Pagamento pendente. Aguarde confirmação.'
                        : 'Pagamento recusado. Tente outro cartão.'
            });
        }

        return res.status(400).json({
            sucesso: false,
            erro: 'Método de pagamento inválido'
        });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        if (error.response?.data) {
            console.error('📦 Detalhes do erro MP:', JSON.stringify(error.response.data, null, 2));
        }
        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro interno do servidor'
        });
    }
};
