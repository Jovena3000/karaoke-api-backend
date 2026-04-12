// api/criar-pagamento.js
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

// ===== FUNÇÃO PARA CONFIGURAR CORS =====
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
    
    // Se for OPTIONS, responde e retorna true
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

module.exports = async (req, res) => {
    console.log("🚀 CREATE PAYMENT INICIADO");
    console.log("📝 Method:", req.method);
    console.log("📝 Origin:", req.headers.origin);

    // Configurar CORS (se for OPTIONS, já responde)
    if (configurarCORS(req, res)) {
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo } = req.body;

        console.log('📩 Criar pagamento iniciado');
        console.log('💰 Dados:', { email, plan, metodo });

        // Definir valor do plano
        let valor = 0;
        let descricao = '';

        switch (plan) {
            case 'mensal':
                valor = 5.00;
                descricao = 'Plano Mensal - Karaokê Multiplayer';
                break;
            case 'trimestral':
                valor = 49.90;
                descricao = 'Plano Trimestral - Karaokê Multiplayer';
                break;
            case 'semestral':
                valor = 89.90;
                descricao = 'Plano Semestral - Karaokê Multiplayer';
                break;
            case 'anual':
                valor = 159.90;
                descricao = 'Plano Anual - Karaokê Multiplayer';
                break;
            default:
                valor = 49.90;
                descricao = 'Plano Trimestral - Karaokê Multiplayer';
        }

        // ================= CONFIGURAÇÃO PARA PIX =================
        if (metodo === 'pix') {
            console.log('💳 Gerando pagamento PIX...');

            const paymentData = {
                transaction_amount: valor,
                description: descricao,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: email.split('@')[0],
                    last_name: 'Usuário'
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`
                metadata: {
                    email: email,
                    plan: plan
                }
            };

            console.log('📤 Enviando para Mercado Pago:', JSON.stringify(paymentData));

            const response = await mercadopago.payment.create(paymentData);
            const payment = response.body;

            console.log('✅ Pagamento PIX criado. ID:', payment.id);
            console.log('📱 Status:', payment.status);
            console.log('📱 QR Code gerado:', payment.point_of_interaction?.transaction_data?.qr_code_base64 ? 'SIM' : 'NÃO');

            // Extrair dados do PIX
            const qrCodeBase64 = payment.point_of_interaction?.transaction_data?.qr_code_base64 || null;
            const qrCodeText = payment.point_of_interaction?.transaction_data?.qr_code || null;

            if (!qrCodeBase64) {
                console.error('❌ ERRO: QR Code não veio na resposta do Mercado Pago');
                console.log('📱 Resposta completa:', JSON.stringify(payment, null, 2));
            }

            return res.status(200).json({
                sucesso: true,
                id: payment.id,
                metodo: 'pix',
                qr_code_base64: qrCodeBase64,
                qr_code: qrCodeText,
                status: payment.status
            });
        }

        // ================= CONFIGURAÇÃO PARA CARTÃO DE CRÉDITO =================
        if (metodo === 'card') {
            console.log('💳 Gerando preferência para cartão...');

            const preference = {
                items: [
                    {
                        title: descricao,
                        quantity: 1,
                        currency_id: 'BRL',
                        unit_price: valor
                    }
                ],
                payer: {
                    email: email,
                    name: email.split('@')[0],
                    surname: 'Usuário'
                },
                back_urls: {
    success: 'https://karaokemultiplayer.com.br/sucesso.html',
    failure: 'https://karaokemultiplayer.com.br/erro.html',
    pending: 'https://karaokemultiplayer.com.br/pendente.html'
},
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`
                auto_return: 'approved'
            };

            const response = await mercadopago.preferences.create(preference);
            const preferenceId = response.body.id;

            console.log('✅ Preferência criada:', preferenceId);

            return res.status(200).json({
                sucesso: true,
                metodo: 'card',
                init_point: response.body.init_point,
                preference_id: preferenceId
            });
        }

        return res.status(400).json({ sucesso: false, erro: 'Método de pagamento inválido' });

    } catch (error) {
        console.error('❌ Erro ao criar pagamento:', error);
        console.error('Detalhes:', error.response?.data || error.message);
        
        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro ao processar pagamento',
            detalhes: error.response?.data
        });
    }
};
