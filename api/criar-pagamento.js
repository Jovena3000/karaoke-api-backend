// api/criar-pagamento.js
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { metodo, email, plan } = req.body;

        console.log('📦 Dados recebidos:', { metodo, email, plan });

        const PLANOS = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };

        const valor = PLANOS[plan];

        if (metodo === 'pix') {
            console.log('📱 Gerando PIX...');
            
            // ✅ CORRETO - Sem o wrapper "body"
            const payment = await mercadopago.payment.create({
                transaction_amount: valor,
                description: `Plano ${plan} - Karaokê Multiplayer`,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: email.split('@')[0]
                }
            });

            console.log('✅ PIX criado:', payment.body.id);

            return res.status(200).json({
                sucesso: true,
                id: payment.body.id,
                qr_code: payment.body.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: payment.body.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }
        
        else if (metodo === 'card') {
            const { token, payment_method_id, installments, issuer_id, cpf } = req.body;
            
            // ✅ CORRETO para cartão
            const payment = await mercadopago.payment.create({
                transaction_amount: valor,
                token: token,
                description: `Plano ${plan} - Karaokê Multiplayer`,
                payment_method_id: payment_method_id,
                installments: Number(installments),
                payer: {
                    email: email,
                    identification: {
                        type: 'CPF',
                        number: cpf
                    }
                }
            });

            if (issuer_id) {
                payment.issuer_id = issuer_id;
            }

            console.log('✅ Pagamento cartão:', payment.body.status);

            return res.status(200).json({
                sucesso: payment.body.status === 'approved',
                status: payment.body.status,
                pagamento_id: payment.body.id
            });
        }

        return res.status(400).json({ erro: 'Método não suportado' });

    } catch (error) {
        console.error('❌ Erro no pagamento:', error);
        
        return res.status(500).json({ 
            sucesso: false,
            erro: error.message,
            detalhes: error.cause || 'Sem detalhes'
        });
    }
};
