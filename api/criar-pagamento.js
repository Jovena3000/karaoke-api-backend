// api/criar-pagamento.js
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

// ===== CORS =====
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
    console.log("🚀 CREATE PAYMENT");
    
    // Aplica CORS e trata OPTIONS
    if (configurarCORS(req, res)) return;

    // Permite apenas POST
    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo, token, valor } = req.body;
        console.log('📩 Dados recebidos:', { email, plan, metodo });

        // ===== PLANOS =====
        let valorFinal = 0;
        let descricao = '';

        switch (plan) {
            case 'mensal':
                valorFinal = 5.00;
                descricao = 'Plano Mensal - Karaokê Multiplayer';
                break;
            case 'trimestral':
                valorFinal = 49.90;
                descricao = 'Plano Trimestral - Karaokê Multiplayer';
                break;
            case 'semestral':
                valorFinal = 89.90;
                descricao = 'Plano Semestral - Karaokê Multiplayer';
                break;
            case 'anual':
                valorFinal = 159.90;
                descricao = 'Plano Anual - Karaokê Multiplayer';
                break;
            default:
                throw new Error("Plano inválido");
        }

        // Usa o valor enviado pelo frontend se existir
        if (valor) valorFinal = valor;

        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('💳 Criando PIX...');

            const payment = await mercadopago.payment.create({
                transaction_amount: valorFinal,
                description: descricao,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: email.split('@')[0],
                    last_name: 'User'
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: JSON.stringify({ email, plan })
            });

            const data = payment.body;
            console.log('✅ PIX criado. ID:', data.id);

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
                return res.status(400).json({ sucesso: false, erro: 'Token do cartão não enviado' });
            }

            const payment = await mercadopago.payment.create({
                transaction_amount: valorFinal,
                token: token,
                description: descricao,
                installments: 1,
                payment_method_id: 'visa',
                payer: { email: email },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: JSON.stringify({ email, plan })
            });

            const paymentData = payment.body;
            console.log('💳 STATUS DO CARTÃO:', paymentData.status);

            if (paymentData.status === 'approved') {
                return res.status(200).json({ sucesso: true, status: 'approved', id: paymentData.id });
            } else {
                return res.status(200).json({ sucesso: false, status: paymentData.status, detalhe: paymentData.status_detail });
            }
        }

        return res.status(400).json({ sucesso: false, erro: 'Método de pagamento inválido' });

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        console.error('📦 Detalhes:', error.response?.data || error);
        return res.status(500).json({ sucesso: false, erro: 'Erro interno no servidor', detalhe: error.message });
    }
};
