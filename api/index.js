// index.js - VERSÃO CORRIGIDA
// ⚠️ Este arquivo NÃO deve ter rota /criar-pagamento nem /webhook
// Essas rotas ficam em api/criar-pagamento.js e api/webhook.js (Vercel Functions)
// Este arquivo cuida apenas de: auth, status e utilitários

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();
app.use(express.json());

// ================= CORS =================
app.use((req, res, next) => {
    const allowedOrigins = [
        'https://karaokemultiplayer.com.br',
        'https://www.karaokemultiplayer.com.br',
        'https://karaoke-multiplayer.pages.dev',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:8080'
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// ================= ENV =================
const JWT_SECRET         = process.env.JWT_SECRET;
const RESEND_API_KEY     = process.env.RESEND_API_KEY;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!JWT_SECRET)          console.error('❌ JWT_SECRET não configurada!');
if (!SUPABASE_URL)        console.error('❌ SUPABASE_URL não configurada!');
if (!SUPABASE_SERVICE_KEY) console.error('❌ SUPABASE_SERVICE_KEY não configurada!');

// ================= SERVIÇOS =================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const resend   = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ================= STATUS =================
app.get('/api/status', (req, res) => {
    res.json({
        servidor:  '🟢 Online',
        versao:    '3.0.0',
        timestamp: new Date().toISOString()
    });
});

// ================= LOGIN =================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha obrigatórios' });
        }

        const { data: user } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email.trim().toLowerCase())
            .single();

        if (!user) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        const senhaValida = await bcrypt.compare(senha, user.senha_hash);
        if (!senhaValida) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        if (user.status !== 'ativo') {
            return res.status(403).json({ erro: 'Acesso pendente. Verifique seu pagamento.' });
        }

        // Verifica expiração do plano
        if (user.data_expiracao) {
            const expiracao = new Date(user.data_expiracao);
            if (expiracao < new Date()) {
                return res.status(403).json({ erro: 'Plano expirado. Renove seu acesso.' });
            }
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            sucesso: true,
            token,
            usuario: {
                email:          user.email,
                nome:           user.nome,
                plano:          user.plano,
                data_expiracao: user.data_expiracao
            }
        });

    } catch (error) {
        console.error('❌ Erro no login:', error);
        res.status(500).json({ erro: 'Erro interno' });
    }
});

// ================= REGISTER =================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, senha, nome, plano } = req.body;

        if (!email || !senha || !nome || !plano) {
            return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
        }

        // Verifica se já existe
        const { data: existente } = await supabase
            .from('usuarios')
            .select('id')
            .eq('email', email.trim().toLowerCase())
            .maybeSingle();

        if (existente) {
            return res.status(409).json({ erro: 'E-mail já cadastrado' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        await supabase.from('usuarios').insert([{
            email:      email.trim().toLowerCase(),
            senha_hash: senhaHash,
            nome,
            plano,
            status:     'inativo',
            created_at: new Date().toISOString()
        }]);

        res.json({ sucesso: true });

    } catch (error) {
        console.error('❌ Erro no registro:', error);
        res.status(500).json({ erro: 'Erro interno' });
    }
});

// ================= VERIFICAR TOKEN =================
app.get('/api/auth/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ erro: 'Token não fornecido' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { data: user } = await supabase
            .from('usuarios')
            .select('email, nome, plano, status, data_expiracao')
            .eq('id', decoded.userId)
            .single();

        if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });

        res.json({ sucesso: true, usuario: user });

    } catch (error) {
        res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
});

// ================= VERIFICAR PAGAMENTO PIX =================
// ✅ Esta rota é chamada pelo checkout-bricks.html para checar se o PIX foi pago
app.get('/api/verificar-pagamento', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ erro: 'ID não informado' });

        const mercadopago = require('mercadopago');
        mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });

        const response = await mercadopago.payment.findById(id);
        const payment  = response.body;

        res.json({
            id:     payment.id,
            status: payment.status
        });
    } catch (error) {
        console.error('❌ Erro ao verificar pagamento:', error);
        res.status(500).json({ erro: 'Erro ao verificar pagamento' });
    }
});

// ================= ROOT =================
app.get('/', (req, res) => {
    res.json({
        status:  'ok',
        message: 'Karaokê Multiplayer API v3.0.0',
        rotas: [
            'GET  /api/status',
            'POST /api/auth/login',
            'POST /api/auth/register',
            'GET  /api/auth/me',
            'GET  /api/verificar-pagamento?id=XXX',
            'POST /api/criar-pagamento  → api/criar-pagamento.js',
            'POST /api/webhook          → api/webhook.js'
        ]
    });
});

module.exports = app;
