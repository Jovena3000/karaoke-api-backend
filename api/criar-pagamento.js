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

    if (configurarCORS(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { plan, email, metodo } = req.body;

        console.log('📩 Dados recebidos:', { email, plan, metodo });

        // ===== PLANOS =====
        let valor = 0;
        let descricao = '';

        switch (plan) {
            case 'mensal':
                valor = 5.00;
                descricao = 'Plano Mensal';
                break;
            case 'trimestral':
                valor = 49.90;
                descricao = 'Plano Trimestral';
                break;
            case 'semestral':
                valor = 89.90;
                descricao = 'Plano Semestral';
                break;
            case 'anual':
                valor = 159.90;
                descricao = 'Plano Anual';
                break;
            default:
                throw new Error("Plano inválido");
        }

        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('💳 Criando PIX...');

            const payment = await mercadopago.payment.create({
                transaction_amount: valor,
                description: descricao,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: email.split('@')[0],
                    last_name: 'User'
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`, // ✅ FIX
                metadata: {
                    email,
                    plan
                }
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
            console.log('💳 Criando checkout cartão...');

            const preference = await mercadopago.preferences.create({
                items: [
                    {
                        title: descricao,
                        quantity: 1,
                        currency_id: 'BRL',
                        unit_price: valor
                    }
                ],
                payer: {
                    email: email
                },
                back_urls: {
                    success: 'https://karaokemultiplayer.com.br/sucesso.html',
                    failure: 'https://karaokemultiplayer.com.br/erro.html',
                    pending: 'https://karaokemultiplayer.com.br/pendente.html'
                },
                auto_return: 'approved',
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: `${email}|${plan}`, // ✅ FIX
                binary_mode: true // ⭐ ESSENCIAL PARA CARTÃO FUNCIONAR
            });

            return res.status(200).json({
                sucesso: true,
                metodo: 'card',
                init_point: preference.body.init_point
            });
        }

        return res.status(400).json({
            sucesso: false,
            erro: 'Método inválido'
        });

    } catch (error) {
        console.error('❌ ERRO:', error.message);

        return res.status(500).json({
            sucesso: false,
            erro: error.message
        });
    }
};
