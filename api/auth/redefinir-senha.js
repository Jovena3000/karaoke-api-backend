// api/auth/redefinir-senha.js
import bcrypt from 'bcryptjs';
import { findResetToken, updatePassword, deleteResetToken } from '../../lib/db.js';

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', 'https://karaokemultiplayer.com.br');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            sucesso: false, 
            mensagem: 'Método não permitido' 
        });
    }
    
    try {
        const { token, novaSenha, email } = req.body;
        
        if (!token || !novaSenha || !email) {
            return res.status(400).json({ 
                sucesso: false, 
                mensagem: 'Dados incompletos' 
            });
        }
        
        if (novaSenha.length < 6) {
            return res.status(400).json({ 
                sucesso: false, 
                mensagem: 'A senha deve ter no mínimo 6 caracteres' 
            });
        }
        
        // 1. Verificar se o token é válido e não expirou
        const resetRequest = await findResetToken(token, email);
        
        if (!resetRequest) {
            return res.status(400).json({ 
                sucesso: false, 
                mensagem: 'Link inválido. Solicite uma nova recuperação.' 
            });
        }
        
        if (new Date(resetRequest.expires) < new Date()) {
            return res.status(400).json({ 
                sucesso: false, 
                mensagem: 'Link expirado. Solicite uma nova recuperação.' 
            });
        }
        
        // 2. Criptografar a nova senha
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(novaSenha, salt);
        
        // 3. Atualizar a senha no banco
        await updatePassword(email, senhaHash);
        
        // 4. Remover token usado
        await deleteResetToken(token);
        
        return res.status(200).json({ 
            sucesso: true, 
            mensagem: 'Senha redefinida com sucesso!' 
        });
        
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        return res.status(500).json({ 
            sucesso: false, 
            mensagem: 'Erro ao redefinir senha. Tente novamente.' 
        });
    }
}
