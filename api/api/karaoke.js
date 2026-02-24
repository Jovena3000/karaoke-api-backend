const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Importar rotas
const authRoutes = require('./auth');
const karaokeRoutes = require('./karaoke');

// ===== ROTAS PÚBLICAS =====
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: '🎤 API Karaokê funcionando!',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        ambiente: process.env.NODE_ENV || 'development'
    });
});

// Montar rotas
app.use('/api/auth', authRoutes);
app.use('/api/karaoke', karaokeRoutes);

// Webhook (rota separada)
app.use('/api/webhook', require('./webhook'));

// ===== EXPORTAÇÃO =====
module.exports = app;
