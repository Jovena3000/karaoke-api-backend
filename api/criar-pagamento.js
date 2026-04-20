// api/criar-pagamento.js - VERSÃO COMPLETA CORRIGIDA
const mercadopago = require('mercadopago');

// 🔥 COLOQUE SUA ACCESS TOKEN REAL AQUI (TEMPORÁRIO PARA TESTE)
const MP_ACCESS_TOKEN = 'APP_USR-4680c685-8a93-4f07-8d1d-d35e1e27b6b2';
//                         ↑↑↑↑ SUBSTITUA PELA SUA TOKEN REAL ↑↑↑↑

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // 🔥 CORS SIMPLIFICADO (funciona para todos)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Resposta imediata para OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log("🚀 CREATE PAYMENT");
    console.log("📩 Método:", req.method);
    console.log("📩 Body:", req.body);

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo, token } = req.body;

        console.log('📩 Dados:', { email, plan, metodo, token: token ? '✅' : '❌' });

        // Preços dos planos
        const precos = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };

        const valor = precos[plan] || 49.90;
        const descricao = `Plano ${plan} - Karaokê Multiplayer`;

        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('💳 Criando PIX...');

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

        // ================= CARTÃO =================
        if (metodo === 'card') {
            console.log('💳 Processando cartão...');

            if (!token) {
                return res.status(400).json({
                    sucesso: false,
                    erro: 'Token do cartão não enviado'
                });
            }

            const paymentData = {
                transaction_amount: Number(valor),
                token: token,
                description: descricao,
                installments: 1,
                payment_method_id: 'master',
                payer: { email: email },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: JSON.stringify({ email, plan }),
                metadata: { email, plan }
            };

            console.log('📤 Enviando para MP...');

            const response = await mercadopago.payment.create(paymentData);
            const payment = response.body;

            console.log('💳 Status:', payment.status);

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
        console.error('📦 Detalhes:', error.response?.data || error);

        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro interno do servidor'
        });
    }
};
