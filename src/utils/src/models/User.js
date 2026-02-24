const supabase = require('../utils/supabase');
const bcrypt = require('bcryptjs');

class User {
    // Buscar usuário por email
    static async findByEmail(email) {
        const { data, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .single();
        
        if (error) return null;
        return data;
    }

    // Criar novo usuário
    static async create(userData) {
        const { data, error } = await supabase
            .from('usuarios')
            .insert([{
                email: userData.email,
                senha_hash: await bcrypt.hash(userData.senha, 10),
                nome: userData.nome,
                plano: userData.plano,
                status: 'inativo', // Começa inativo, será ativado pelo webhook
                data_expiracao: userData.data_expiracao
            }])
            .select()
            .single();
        
        if (error) throw error;
        return data;
    }

    // Ativar usuário (após pagamento confirmado)
    static async activateUser(email, plano) {
        const expiracao = new Date();
        expiracao.setMonth(expiracao.getMonth() + (plano === 'mensal' ? 1 : 3));

        const { data, error } = await supabase
            .from('usuarios')
            .update({ 
                status: 'ativo',
                data_expiracao: expiracao,
                plano: plano,
                updated_at: new Date()
            })
            .eq('email', email)
            .select()
            .single();
        
        if (error) throw error;
        return data;
    }
}

module.exports = User;
