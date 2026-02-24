const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./src/models/User');

const router = express.Router();

// Rota de login
router.post('/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha obrigatórios' });
        }

        // Buscar usuário
        const user = await User.findByEmail(email);
        
        if (!user) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        // Verificar senha
        const senhaValida = await bcrypt.compare(senha, user.senha_hash);
        
        if (!senhaValida) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        // Verificar se o usuário está ativo
        if (user.status !== 'ativo') {
            return res.status(403).json({ erro: 'Acesso não autorizado. Pagamento pendente.' });
        }

        // Gerar JWT
        const token = jwt.sign(
            { 
                userId: user.id,
                email: user.email,
                plano: user.plano,
                expiracao: user.data_expiracao
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            sucesso: true,
            token,
            usuario: {
                nome: user.nome,
                email: user.email,
                plano: user.plano,
                expiracao: user.data_expiracao
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ erro: 'Erro interno no servidor' });
    }
});

// Rota de registro (para criar usuário antes do pagamento)
router.post('/register', async (req, res) => {
    try {
        const { email, senha, nome, plano } = req.body;

        if (!email || !senha || !nome || !plano) {
            return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
        }

        // Verificar se usuário já existe
        const existente = await User.findByEmail(email);
        if (existente) {
            return res.status(400).json({ erro: 'Email já cadastrado' });
        }

        // Criar usuário (começa inativo)
        const user = await User.create({
            email,
            senha,
            nome,
            plano
        });

        res.status(201).json({
            sucesso: true,
            mensagem: 'Usuário criado. Aguarde confirmação do pagamento.',
            usuario: {
                email: user.email,
                nome: user.nome
            }
        });

    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ erro: 'Erro interno no servidor' });
    }
});

module.exports = router;
