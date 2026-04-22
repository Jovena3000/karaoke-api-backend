// api/criar-pagamento.js - CHECKOUT TRANSPARENTE (sem redirecionamento)

// 🔥 SDK NOVA (IMPORTANTE)
const { MercadoPagoConfig, Payment } = require('mercadopago');

// 🔥 NOVA FORMA DE CONFIGURAR
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentClient = new Payment(client);

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

        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('📱 Criando PIX...');

            const response = await paymentClient.create({
                body: {
                    transaction_amount: valor,
                    description: descricao,
                    payment_method_id: 'pix',
                    payer: { email },
                    notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                    external_reference: `${email}|${plan}`,
                    metadata: { email, plan }
                }
            });

            return res.status(200).json({
                sucesso: true,
                metodo: 'pix',
                id: response.id,
                qr_code: response.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: response.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }

        // ================= CARTÃO =================
        if (metodo === 'card') {
            console.log('💳 Processando cartão transparente...');

            if (!token) {
                return res.status(400).json({
                    sucesso: false,
                    erro: 'Token do cartão não enviado'
                });
            }

            const response = await paymentClient.create({
                body: {
                    transaction_amount: Number(valor),
                    token: token,
                    description: descricao,
                    installments: 1,
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
                }
            });

            console.log('💳 Status do pagamento:', response.status);
            console.log('💳 Detalhe:', response.status_detail);
            console.log('💳 ID:', response.id);

            // Se aprovado
            if (response.status === 'approved') {
                console.log('✅ Pagamento aprovado!');
                try {
                    const { processarPagamentoAprovado } = require('./webhook');
                    await processarPagamentoAprovado(email, plan, response.id);
                } catch (err) {
                    console.log('⚠️ Webhook não disponível:', err.message);
                }
            }

            return res.status(200).json({
                sucesso: response.status === 'approved',
                status: response.status,
                status_detail: response.status_detail,
                id: response.id,
                mensagem: response.status === 'approved' 
                    ? 'Pagamento aprovado com sucesso!' 
                    : response.status === 'pending' 
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

        if (error.cause) {
            console.error('📦 Detalhes MP:', JSON.stringify(error.cause, null, 2));
        }

        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro interno do servidor'
        });
    }
};
