const User = require('../src/models/User');

module.exports = async (req, res) => {
    try {
        // Apenas POST é aceito
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        console.log('📩 Webhook recebido:', req.body);

        const { type, data } = req.body;

        // Processar apenas pagamentos aprovados
        if (type === 'payment' && data) {
            const paymentId = data.id;
            
            // Aqui você consulta o Mercado Pago para obter detalhes do pagamento
            // usando o access_token que você já tem configurado
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
                }
            });

            const payment = await response.json();

            // Se o pagamento foi aprovado
            if (payment.status === 'approved') {
                const email = payment.payer.email;
                const plano = payment.external_reference?.split('_')[0] || 'mensal';

                // Ativar o usuário no banco
                await User.activateUser(email, plano);

                console.log(`✅ Usuário ${email} ativado com plano ${plano}`);
            }
        }

        // Sempre retornar 200 para o Mercado Pago
        res.status(200).json({ received: true });

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
