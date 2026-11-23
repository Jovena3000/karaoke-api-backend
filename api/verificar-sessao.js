// api/verificar-sessao.js
// O app chama esta rota ao abrir e a cada poucos minutos.
// 200 = sessão válida e plano ativo | 401/403 = o app deve apagar o login salvo.
const { aplicarCors, validarSessao } = require('./_lib/validarSessao');

module.exports = async (req, res) => {
    if (aplicarCors(req, res, 'GET, POST, OPTIONS')) return;

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ erro: 'Método não permitido' });
    }

    res.setHeader('Cache-Control', 'no-store');

    const s = await validarSessao(req);
    if (!s.ok) {
        return res.status(s.status).json({ sucesso: false, erro: s.erro, codigo: s.codigo });
    }

    return res.status(200).json({
        sucesso: true,
        usuario: { nome: s.usuario.nome, email: s.usuario.email, plano: s.usuario.plano },
        plano_expira_em: s.usuario.data_expiracao
    });
};
