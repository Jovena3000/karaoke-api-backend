const express = require('express');
const authMiddleware = require('../src/middlewares/authMiddleware');

const router = express.Router();

// Todas as rotas aqui exigem autenticação
router.use(authMiddleware);

// Rota para criar sala (apenas usuários autenticados)
router.post('/sala', (req, res) => {
    res.json({ 
        sucesso: true,
        mensagem: 'Sala criada com sucesso',
        usuario: req.user.email
    });
});

// Rota para carregar vídeo
router.post('/video', (req, res) => {
    res.json({ 
        sucesso: true,
        mensagem: 'Vídeo carregado com sucesso'
    });
});

// Rota para obter fila de músicas
router.get('/fila', (req, res) => {
    res.json({ 
        sucesso: true,
        fila: [] // Buscar do banco de dados
    });
});

module.exports = router;
