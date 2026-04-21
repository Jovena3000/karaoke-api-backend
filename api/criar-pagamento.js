// api/criar-pagamento.js - VERSÃO FINAL CORRIGIDA
const mercadopago = require('mercadopago');
const { processarPagamentoAprovado } = require('./webhook');

// Configuração do Mercado Pago
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

    console.log("🚀 CREATE PAYMENT");
    console.log("📩 Método:", req.method);
    console.log("📩 Body:", req.body);

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo, token, payment_method_id } = req.body;

        console.log('📩 Dados recebidos:', { email, plan, metodo, token: token ? '✅' : '❌' });

        // Validação básica
        if (!email || !plan || !metodo) {
            return res.status(400).json({
                sucesso: false,
                erro: 'Dados incompletos: email, plan e metodo são obrigatórios'
            });
        }

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
            console.log('📱 Criando PIX para:', email);
            console.log('💰 Valor:', valor);

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

            console.log('✅ PIX criado com sucesso. ID:', data.id);

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
            console.log('💳 Processando cartão para:', email);
            console.log('💰 Valor:', valor);

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
                payment_method_id: payment_method_id || 'master',
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

            console.log('📤 Enviando para o Mercado Pago...');

            const response = await mercadopago.payment.create(paymentData);
            const payment = response.body;

            console.log('💳 Status do pagamento:', payment.status);
            console.log('💳 ID do pagamento:', payment.id);

            // 🔥 SE O PAGAMENTO JÁ FOI APROVADO, PROCESSAR IMEDIATAMENTE
            if (payment.status === 'approved') {
                console.log('✅ Pagamento aprovado! Processando...');
                
                try {
                    // Chamar diretamente a função de processamento do webhook
                    await processarPagamentoAprovado(email, plan, payment.id);
                    console.log('✅ Usuário ativado e e-mail enviado com sucesso!');
                } catch (processError) {
                    console.error('❌ Erro ao processar pagamento aprovado:', processError);
                    // Não falhar a requisição mesmo se o processamento falhar
                    // O webhook vai tentar novamente depois
                }
            }

            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                id: payment.id,
                mensagem: payment.status === 'approved' 
                    ? 'Pagamento aprovado! Você receberá um e-mail em instantes.' 
                    : 'Pagamento pendente. Aguarde a confirmação.'
            });
        }

        // ================= MÉTODO INVÁLIDO =================
        return res.status(400).json({
            sucesso: false,
            erro: 'Método de pagamento inválido. Use "pix" ou "card"'
        });

    } catch (error) {
        console.error('❌ ERRO no criar-pagamento:', error.message);
        
        // Log detalhado do erro do Mercado Pago
        if (error.response?.data) {
            console.error('📦 Detalhes do erro MP:', JSON.stringify(error.response.data, null, 2));
        }
        
        // Mensagem amigável para o usuário
        let mensagemErro = 'Erro interno do servidor. Tente novamente.';
        
        if (error.message.includes('invalid') || error.message.includes('credentials')) {
            mensagemErro = 'Erro de autenticação. Tente novamente mais tarde.';
        } else if (error.message.includes('card')) {
            mensagemErro = 'Erro ao processar cartão. Verifique os dados e tente novamente.';
        }

        return res.status(500).json({
            sucesso: false,
            erro: mensagemErro,
            detalhe: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
