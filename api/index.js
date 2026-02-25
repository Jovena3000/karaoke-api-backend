const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== IMPORTAR AS ROTAS DOS ARQUIVOS =====
const authRoutes = require('./auth');
const karaokeRoutes = require('./karaoke');
// const webhookRoutes = require('./webhook'); // Webhooks geralmente são rotas separadas

// ===== MONTAR AS ROTAS =====
app.use('/api/auth', authRoutes);
app.use('/api/karaoke', karaokeRoutes);

// ===== ROTAS PÚBLICAS =====
app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'API Karaokê' });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        ambiente: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// ===== EXPORTAÇÃO =====
module.exports = app;