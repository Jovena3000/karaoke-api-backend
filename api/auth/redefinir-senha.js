// api/auth/redefinir-senha.js
module.exports = async function handler(req, res) {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'https://karaoke-multiplayer.pages.dev',
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
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ sucesso: false, mensagem: 'Método não permitido' });
    }
    
    try {
        const { token, novaSenha, email } = req.body;
        
        if (!token || !novaSenha || !email) {
            return res.status(400).json({ sucesso: false, mensagem: 'Dados incompletos' });
        }
        
        if (novaSenha.length < 6) {
            return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter no mínimo 6 caracteres' });
        }
        
        console.log(`🔐 Redefinindo senha para: ${email}`);
        console.log(`🔑 Token: ${token}`);
        
        // TODO: Implementar verificação do token no banco de dados
        // TODO: Atualizar a senha do usuário
        
        return res.status(200).json({ 
            sucesso: true, 
            mensagem: 'Senha redefinida com sucesso!' 
        });
        
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        return res.status(500).json({ 
            sucesso: false, 
            mensagem: 'Erro ao redefinir senha' 
        });
    }
};
