const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Importar as rotas de outros arquivos
const authRoutes = require('./auth');
const karaokeRoutes = require('./karaoke');
// const webhookRoutes = require('./webhook'); // Webhooks geralmente são rotas separadas

// Montar as rotas
app.use('/api/auth', authRoutes);
app.use('/api/karaoke', karaokeRoutes);

// Sua rota de status existente
app.get('/api/status', (req, res) => {
    res.json({ servidor: '🟢 Online' });
});

// Rota raiz (opcional)
app.get('/', (req, res) => {
    res.json({ message: 'API Karaokê' });
});

// Exportar para o Vercel
module.exports = app;