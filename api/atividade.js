// api/atividade.js - registra atividade do usuário (só para planos ativos)
const { supabase, aplicarCors, validarSessao } = require('./_lib/validarSessao');

// Origens extras permitidas só para desenvolvimento local
const ORIGENS_DEV = ['http://localhost:3000', 'http://localhost:8080'];

module.exports = async (req, res) => {
  if (aplicarCors(req, res, 'POST, OPTIONS', ORIGENS_DEV)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  try {
    // Token válido + usuário existente + plano ativo e dentro da validade
    const s = await validarSessao(req);
    if (!s.ok) {
      return res.status(s.status).json({ erro: s.erro, codigo: s.codigo });
    }

    const { error } = await supabase
      .from('usuarios')
      .update({ ultimo_acesso: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }) })
      .eq('id', s.usuario.id);

    if (error) {
      console.error('❌ Erro ao registrar atividade:', error.message);
    }

    return res.json({ sucesso: true, mensagem: 'Atividade registrada' });

  } catch (erro) {
    console.error('❌ Erro:', erro.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
