// api/criar-pagamento.js
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    // Configurar CORS manualmente
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
    
    // Responder OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Apenas POST
    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }
    
    try {
        const { plan, email, metodo, token, valor } = req.body;
        
        console.log('📩 Criar pagamento:', { email, plan, metodo });
        
        // Validar email
        if (!email || !email.includes('@')) {
            return res.status(400).json({ sucesso: false, erro: 'E-mail inválido' });
        }
        
        // Definir valor do plano
        const valores = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };
        
        const valorFinal = valor || valores[plan] || 49.90;
        const descricao = `Plano ${plan} - Karaokê Multiplayer`;
        
        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('💳 Gerando PIX...');
            
            const payment = await mercadopago.payment.create({
                transaction_amount: valorFinal,
                description: descricao,
                payment_method_id: 'pix',
                payer: {
                    email: email,
                    first_name: email.split('@')[0],
                    last_name: 'Cliente'
                },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook',
                external_reference: JSON.stringify({ email, plan })
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
            console.log('💳 Status:', paymentData.status);
            
            if (paymentData.status === 'approved') {
                return res.status(200).json({
                    sucesso: true,
                    status: 'approved',
                    id: paymentData.id
                });
            } else {
                return res.status(200).json({
                    sucesso: false,
                    status: paymentData.status,
                    detalhe: paymentData.status_detail
                });
            }
        }
        
        return res.status(400).json({ sucesso: false, erro: 'Método inválido' });
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        console.error('Detalhe:', error.response?.data || error);
        
        return res.status(500).json({
            sucesso: false,
            erro: error.message || 'Erro interno'
        });
    }
};
