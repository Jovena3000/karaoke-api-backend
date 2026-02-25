const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ===== CONFIGURAÇÕES =====
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET;

// ===== ROTAS PÚBLICAS =====
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

// ===== ROTAS DE AUTENTICAÇÃO =====
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, senha, nome, plano } = req.body;
        
        const { data: existingUser } = await supabase
            .from('usuarios')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({ erro: 'Email já cadastrado' });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        
        const { data: newUser, error } = await supabase
            .from('usuarios')
            .insert([{
                email,
                senha_hash: senhaHash,
                nome,
                plano,
                status: 'inativo'
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ 
            sucesso: true, 
            mensagem: 'Usuário criado. Aguarde confirmação do pagamento.' 
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ erro: 'Erro interno' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        const { data: user, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .single();

        if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        if (user.status !== 'ativo') {
            return res.status(403).json({ erro: 'Acesso não autorizado. Pagamento pendente.' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, plano: user.plano },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ sucesso: true, token, usuario: { nome: user.nome, email: user.email, plano: user.plano } });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ erro: 'Erro interno' });
    }
});

// ===== ROTA DE PAGAMENTO (exemplo) =====
app.post('/api/criar-pagamento', (req, res) => {
    res.json({ sucesso: true, mensagem: 'Pagamento simulado' });
});

// ===== EXPORTAÇÃO =====
module.exports = app;