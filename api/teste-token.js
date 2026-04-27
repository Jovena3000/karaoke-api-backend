const mercadopago = require('mercadopago');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const token = process.env.MP_ACCESS_TOKEN;
    
    if (!token) {
        return res.json({ erro: 'Token não configurada' });
    }
    
    mercadopago.configure({ access_token: token });
    
    try {
        const result = await mercadopago.payment.create({
            transaction_amount: 1,
            description: 'Teste',
            payment_method_id: 'pix',
            payer: { email: 'teste@teste.com' }
        });
        
        res.json({ sucesso: true });
    } catch (error) {
        res.json({ sucesso: false, erro: error.message });
    }
};
