const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', 'https://karaoke-multiplayer.pages.dev');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
        }

        const { data: user, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .single();

        if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        if (user.status !== 'ativo') {
            return res.status(403).json({ erro: 'Acesso não autorizado. Pagamento pendente.' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, plano: user.plano },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            sucesso: true,
            token,
            usuario: {
                nome: user.nome,
                email: user.email,
                plano: user.plano
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ erro: 'Erro interno no servidor' });
    }
};