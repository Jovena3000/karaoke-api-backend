// api/_lib/validarSessao.js
// Funções compartilhadas de sessão. Use em QUALQUER rota que entregue o produto:
//
//   const { aplicarCors, validarSessao } = require('./_lib/validarSessao');
//   const s = await validarSessao(req);
//   if (!s.ok) return res.status(s.status).json({ erro: s.erro, codigo: s.codigo });
//   // s.usuario = { id, email, nome, plano, status, data_expiracao }
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Força um novo login pelo menos a cada 30 dias
const MAX_SESSAO_SEGUNDOS = 30 * 24 * 60 * 60;

const ALLOWED_ORIGINS = [
    'https://karaokemultiplayer.com.br',
    'https://www.karaokemultiplayer.com.br',
    'https://karaoke-multiplayer.pages.dev'
];

function aplicarCors(req, res, metodos = 'GET, POST, OPTIONS') {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', metodos);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

// O plano vale até o FIM do dia de data_expiracao (horário de Brasília)
function fimDoPlano(user) {
    if (!user || !user.data_expiracao) return null;
    const dia = String(user.data_expiracao).slice(0, 10);
    const fim = new Date(`${dia}T23:59:59-03:00`);
    return isNaN(fim.getTime()) ? null : fim;
}

function planoAtivo(user, agora = new Date()) {
    if (!user || user.status !== 'ativo') return false;
    const fim = fimDoPlano(user);
    return !!fim && fim >= agora;
}

// A sessão dura no máximo 30 dias e nunca passa do vencimento do plano
function segundosDeSessao(user, agora = new Date()) {
    const fim = fimDoPlano(user);
    if (!fim) return 0;
    const restante = Math.floor((fim.getTime() - agora.getTime()) / 1000);
    return Math.max(0, Math.min(MAX_SESSAO_SEGUNDOS, restante));
}

async function validarSessao(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) {
        return { ok: false, status: 401, codigo: 'SEM_TOKEN', erro: 'Faça login para continuar.' };
    }

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
        return { ok: false, status: 401, codigo: 'SESSAO_EXPIRADA', erro: 'Sessão expirada. Faça login novamente.' };
    }

    // Consulta o banco a cada validação: é isso que derruba quem deixou de pagar,
    // mesmo com o token antigo ainda "dentro do prazo".
    const { data: user, error } = await supabase
        .from('usuarios')
        .select('id, email, nome, plano, status, data_expiracao')
        .eq('id', payload.userId)
        .maybeSingle();

    if (error) {
        console.error('Erro ao validar sessão:', error.message);
        return { ok: false, status: 500, codigo: 'ERRO_INTERNO', erro: 'Erro ao validar sessão.' };
    }
    if (!user) {
        return { ok: false, status: 401, codigo: 'USUARIO_INEXISTENTE', erro: 'Conta não encontrada. Faça login novamente.' };
    }
    if (!planoAtivo(user)) {
        return { ok: false, status: 403, codigo: 'PLANO_VENCIDO', erro: 'Seu plano venceu. Renove para continuar usando.' };
    }

    return { ok: true, usuario: user };
}

module.exports = {
    supabase,
    aplicarCors,
    fimDoPlano,
    planoAtivo,
    segundosDeSessao,
    validarSessao,
    MAX_SESSAO_SEGUNDOS
};
