const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== ROTA PRINCIPAL (RAIZ) - RESOLVE O ERRO 404! =====
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        message: '🎤 API Karaokê Multiplayer funcionando!',
        urls: {
            status: '/api/status',
            pagamento: '/api/criar-pagamento'
        },
        timestamp: new Date().toLocaleString('pt-BR')
    });
});

// ===== ROTA DE STATUS =====
app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        mensagem: 'API pronta para uso',
        hora: new Date().toLocaleString('pt-BR')
    });
});

// ===== ROTA DE PAGAMENTO =====
app.post('/api/criar-pagamento', (req, res) => {
    const { plano, email } = req.body;
    
    console.log('📩 Pagamento solicitado:', { plano, email });
    
    // Validação básica
    if (!plano || !email) {
        return res.status(400).json({ 
            erro: 'Plano e email são obrigatórios' 
        });
    }
    
    // Define valores
    let valor = plano === 'mensal' ? 11.90 : 24.90;
    let descricao = plano === 'mensal' ? 'Plano Mensal' : 'Plano Trimestral';
    
    res.json({
        sucesso: true,
        mensagem: '✅ Pagamento processado com sucesso!',
        dados_pedido: {
            plano: descricao,
            valor: `R$ ${valor.toFixed(2)}`,
            email: email,
            data: new Date().toLocaleString('pt-BR')
        }
    });
});

// ===== EXPORTAÇÃO PARA VERCEL =====
module.exports = app;