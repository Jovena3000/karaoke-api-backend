// api/health.js
const mercadopago = require('mercadopago');

module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    try {
        mercadopago.configure({
            access_token: process.env.MP_ACCESS_TOKEN || 'teste'
        });
        
        res.json({ 
            sucesso: true, 
            mensagem: 'SDK Mercado Pago funcionando!',
            versao: '2.12.0',
            token_configurada: !!process.env.MP_ACCESS_TOKEN
        });
    } catch (error) {
        res.json({ 
            sucesso: false, 
            erro: error.message 
        });
    }
};
