const express = require('express');
const cors = require('cors');
const authHandler = require('./auth');
const criarPagamento = require('./criar-pagamento');

const app = express();

// CORS
app.use(cors({
    origin: 'https://karaoke-multiplayer.pages.dev',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// OPTIONS
app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://karaoke-multiplayer.pages.dev');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
});

// Rotas públicas
app.get('/', (req, res) => {
    res.json({ status: 'online', message: '🎤 API Karaokê' });
});

app.get('/api/status', (req, res) => {
    res.json({ 
        servidor: '🟢 Online',
        ambiente: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// Rotas de outros arquivos
app.post('/api/auth/login', authHandler);
app.post('/api/criar-pagamento', criarPagamento);

module.exports = app;