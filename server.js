require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middlewares
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

// Set EJS as templating engine
const path = require('path');
app.set('views', path.join(__dirname, 'views'));

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// Função para simular envio de mensagem (salva no Supabase para processamento posterior)
async function enviarMensagemWhatsApp(telefone, nome) {
    try {
        const { data, error } = await supabase
            .from('mensagens_pendentes')
            .insert([
                {
                    telefone,
                    nome,
                    mensagem: `Olá ${nome}! Seja bem-vindo(a) à nossa igreja! Estamos muito felizes em ter você conosco. 🙏`,
                    status: 'pendente'
                }
            ]);

        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Erro ao agendar mensagem:', error);
        return false;
    }
}

// Função para validar telefone
function validarTelefone(telefone) {
    const telefoneNormalizado = telefone.replace(/\D/g, '');
    return telefoneNormalizado.length >= 10 && telefoneNormalizado.length <= 11;
}

// Rota principal - formulário de cadastro
app.get('/', (req, res) => {
    res.render('index');
});

// Rota para listar membros
app.get('/membros', async (req, res) => {
    try {
        console.log('Iniciando busca de membros...');
        
        const { data: membros, error } = await supabase
            .from('membros')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Erro ao buscar membros:', error);
            throw error;
        }

        console.log('Membros encontrados:', membros);

        // Formatando os dados
        const membrosFormatados = membros.map(membro => ({
            ...membro,
            telefone_formatado: membro.telefone.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4'),
            data_cadastro: new Date(membro.created_at).toLocaleDateString('pt-BR')
        }));

        res.render('membros', { 
            membros: membrosFormatados,
            error: null
        });
    } catch (error) {
        console.error('Erro ao buscar membros:', error);
        res.render('membros', { 
            membros: [], 
            error: 'Erro ao carregar lista de membros: ' + error.message
        });
    }
});

// Rota para cadastro
app.post('/api/cadastro', async (req, res) => {
    try {
        const { nome, telefone, igrejaOrigem } = req.body;

        if (!nome || !telefone || !igrejaOrigem) {
            return res.status(400).json({
                message: 'Todos os campos são obrigatórios'
            });
        }

        if (!validarTelefone(telefone)) {
            return res.status(400).json({
                message: 'Número de telefone inválido'
            });
        }

        const telefoneNormalizado = telefone.replace(/\D/g, '');
        const telefoneCompleto = telefoneNormalizado.startsWith('55') 
            ? telefoneNormalizado 
            : `55${telefoneNormalizado}`;

        const { data: existente } = await supabase
            .from('membros')
            .select('telefone')
            .eq('telefone', telefoneCompleto)
            .single();

        if (existente) {
            return res.status(400).json({
                message: 'Este número de telefone já está cadastrado'
            });
        }

        const { data, error } = await supabase
            .from('membros')
            .insert([
                {
                    nome,
                    telefone: telefoneCompleto,
                    igreja_origem: igrejaOrigem
                }
            ]);

        if (error) throw error;

        // Agenda a mensagem para envio posterior
        const mensagemAgendada = await enviarMensagemWhatsApp(telefoneCompleto, nome);

        res.json({
            success: true,
            redirectUrl: '/membros',
            message: 'Cadastro realizado com sucesso!',
            whatsappEnviado: mensagemAgendada,
            data
        });

    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({
            message: 'Erro ao processar cadastro',
            error: error.message
        });
    }
});

// Middleware de erro
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        message: 'Erro interno do servidor',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

module.exports = app; // Importante para a Vercel