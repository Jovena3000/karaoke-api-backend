// api/verificar-pagamento.js
const mercadopago = require('mercadopago');

mercadopago.configure({
    access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { id } = req.query;

        if (!id) {
            return res.status(400).json({ erro: 'ID do pagamento não fornecido' });
        }

        const payment = await mercadopago.payment.findById(id);
        
        return res.status(200).json({
            status: payment.body.status,
            id: payment.body.id
        });

    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);
        return res.status(500).json({ 
            status: 'unknown', 
            erro: error.message 
        });
    }
};
