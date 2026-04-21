// api/verificar-token.js
const mercadopago = require('mercadopago');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // 🔥 PEGAR A TOKEN DO AMBIENTE
    const token = process.env.MP_ACCESS_TOKEN;
    
    if (!token) {
        return res.json({
            sucesso: false,
            erro: 'MP_ACCESS_TOKEN não configurada no ambiente',
            solucao: 'Adicione a variável de ambiente no Vercel'
        });
    }
    
    console.log('🔑 Token encontrada:', token.substring(0, 15) + '...');
    console.log('🔑 Tamanho:', token.length);
    console.log('🔑 Começa com APP_USR:', token.startsWith('APP_USR'));
    
    try {
        mercadopago.configure({ access_token: token });
        
        // Teste com uma requisição simples
        const test = await mercadopago.payment.create({
            transaction_amount: 1,
            description: 'Teste de conexão',
            payment_method_id: 'pix',
            payer: { email: 'teste@mercadopago.com' }
        });
        
        return res.json({
            sucesso: true,
            mensagem: 'Token VÁLIDA!',
            status: test.body.status
        });
        
    } catch (error) {
        console.error('Erro:', error.message);
        return res.json({
            sucesso: false,
            erro: error.message,
            detalhe: error.cause,
            token_usada: token.substring(0, 10) + '...'
        });
    }
};
