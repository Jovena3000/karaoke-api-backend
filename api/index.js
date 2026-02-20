const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== ROTA PRINCIPAL =====
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: '🎤 API Karaokê funcionando!',
        timestamp: new Date().toISOString()
    });
});

// ===== ROTA DE STATUS =====
app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        ambiente: process.env.NODE_ENV || 'development',
        token_mp: process.env.MP_ACCESS_TOKEN ? '✅ presente' : '❌ ausente',
        timestamp: new Date().toISOString()
    });
});

// ===== ROTA DE PAGAMENTO (SIMPLIFICADA PARA TESTE) =====
app.post('/api/criar-pagamento', (req, res) => {
    const { plano, email } = req.body;
    
    if (!plano || !email) {
        return res.status(400).json({ erro: 'Plano e email obrigatórios' });
    }
    
    res.json({
        sucesso: true,
        mensagem: 'Modo teste - pagamento simulado',
        dados_recebidos: { plano, email }
    });
});

module.exports = app;