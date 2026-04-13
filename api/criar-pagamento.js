// api/criar-pagamento.js
const mercadopago = require('mercadopago');

// Configurar apenas se tiver token
if (process.env.MP_ACCESS_TOKEN) {
    mercadopago.configure({
        access_token: process.env.MP_ACCESS_TOKEN
    });
    console.log('✅ Mercado Pago configurado');
} else {
    console.log('⚠️ MP_ACCESS_TOKEN não configurado');
}

module.exports = async (req, res) => {
    // Configurar CORS
    const origin = req.headers.origin;
    if (origin === 'https://karaokemultiplayer.com.br' || origin === 'https://www.karaokemultiplayer.com.br') {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Apenas POST
    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }
    
    try {
        const { plan, email, metodo, token } = req.body;
        
        console.log('📩 Dados:', { email, plan, metodo, hasToken: !!token });
        
        // Validar email
        if (!email) {
            return res.status(400).json({ sucesso: false, erro: 'E-mail não informado' });
        }
        
        // Valores dos planos
        const valores = {
            mensal: 5.00,
            trimestral: 49.90,
            semestral: 89.90,
            anual: 159.90
        };
        
        const valor = valores[plan] || 49.90;
        
        // ================= PIX =================
        if (metodo === 'pix') {
            console.log('💳 Gerando PIX para:', email);
            
            const response = await mercadopago.payment.create({
                transaction_amount: valor,
                description: `Plano ${plan} - Karaokê Multiplayer`,
                payment_method_id: 'pix',
                payer: { email: email },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook'
            });
            
            const payment = response.body;
            
            return res.status(200).json({
                sucesso: true,
                metodo: 'pix',
                id: payment.id,
                qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64
            });
        }
        
        // ================= CARTÃO =================
        if (metodo === 'card') {
            console.log('💳 Processando cartão para:', email);
            
            if (!token) {
                return res.status(400).json({ sucesso: false, erro: 'Token não enviado' });
            }
            
            const response = await mercadopago.payment.create({
                transaction_amount: valor,
                token: token,
                description: `Plano ${plan} - Karaokê Multiplayer`,
                installments: 1,
                payment_method_id: 'visa',
                payer: { email: email },
                notification_url: 'https://karaoke-api-backend3.vercel.app/api/webhook'
            });
            
            const payment = response.body;
            
            return res.status(200).json({
                sucesso: payment.status === 'approved',
                status: payment.status,
                id: payment.id
            });
        }
        
        return res.status(400).json({ sucesso: false, erro: 'Método inválido' });
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        
        return res.status(500).json({
            sucesso: false,
            erro: error.message
        });
    }
};
