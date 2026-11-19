// api/auth.js - login com verificação de plano e sessão de no máximo 30 dias
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
    supabase,
    aplicarCors,
    planoAtivo,
    segundosDeSessao
} = require('./_lib/validarSessao');

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async (req, res) => {
    if (aplicarCors(req, res, 'POST, OPTIONS')) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    if (!JWT_SECRET) {
        console.error('JWT_SECRET não configurado');
        return res.status(500).json({ erro: 'Erro interno no servidor' });
    }

    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const senha = String(req.body?.senha || '');

        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
        }

        const { data: user, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            console.error('Erro ao buscar usuário:', error.message);
            return res.status(500).json({ erro: 'Erro interno no servidor' });
        }

        if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        // Plano precisa estar ativo E dentro da validade (antes só o status era conferido)
        if (!planoAtivo(user)) {
            return res.status(403).json({
                erro: 'Seu plano venceu ou o pagamento está pendente. Renove para acessar.',
                codigo: 'PLANO_VENCIDO'
            });
        }

        // Sessão: no máximo 30 dias, e nunca além do vencimento do plano
        const segundos = segundosDeSessao(user);
        const token = jwt.sign(
            { userId: user.id, email: user.email, plano: user.plano },
            JWT_SECRET,
            { algorithm: 'HS256', expiresIn: segundos }
        );

        return res.json({
            sucesso: true,
            token,
            sessao_expira_em: new Date(Date.now() + segundos * 1000).toISOString(),
            usuario: {
                nome: user.nome,
                email: user.email,
                plano: user.plano
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        return res.status(500).json({ erro: 'Erro interno no servidor' });
    }
};
