require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { ToastContainer, toast } = require('react-toastify');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middlewares
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

app.set('view engine', 'ejs');
app.set('views', './views');

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Função para criar um delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Configuração WhatsApp Web
const whatsapp = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox'],
    }
});

// Variável para controlar o estado da conexão
let isWhatsAppConnected = false;

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Cliente conectado ao Socket.IO');
    
    // Se o WhatsApp já estiver conectado, emite o evento 'ready'
    if (isWhatsAppConnected) {
        socket.emit('ready');
    }
});

// Eventos do WhatsApp
whatsapp.on('qr', async (qr) => {
    if (!isWhatsAppConnected) {
        try {
            const qrImage = await qrcode.toDataURL(qr);
            io.emit('qr', `<img src="${qrImage}" alt="QR Code" />`);
        } catch (err) {
            console.error('Erro ao gerar QR Code:', err);
        }
    }
});

whatsapp.on('ready', () => {
    console.log('Cliente WhatsApp está pronto!');
    isWhatsAppConnected = true;
    io.emit('ready');
    toast.success('WhatsApp conectado com sucesso!');
});

whatsapp.on('authenticated', () => {
    console.log('WhatsApp autenticado!');
    isWhatsAppConnected = true;
    io.emit('authenticated');
    toast.success('WhatsApp autenticado com sucesso!');
});

whatsapp.on('auth_failure', () => {
    console.error('Falha na autenticação do WhatsApp');
    isWhatsAppConnected = false;
    toast.error('Falha na autenticação do WhatsApp');
});

whatsapp.on('disconnected', () => {
    console.log('WhatsApp desconectado');
    isWhatsAppConnected = false;
    toast.warn('WhatsApp desconectado');
});

whatsapp.initialize();

// Função para enviar mensagem WhatsApp
async function enviarMensagemWhatsApp(telefone, nome) {
    try {
        const numeroWhatsApp = `${telefone}@c.us`;
        const mensagem = `Olá ${nome}! Seja bem-vindo(a) à nossa igreja! Estamos muito felizes em ter você conosco. 🙏`;
        
        await delay(2000);
        
        await whatsapp.sendMessage(numeroWhatsApp, mensagem);
        toast.success(`Mensagem enviada com sucesso para ${nome}`);
        return true;
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        toast.error(`Erro ao enviar mensagem para ${nome}: ${error.message}`);
        return false;
    }
}

// Função para validar telefone
function validarTelefone(telefone) {
    const telefoneNormalizado = telefone.replace(/\D/g, '');
    if (telefoneNormalizado.length < 10 || telefoneNormalizado.length > 11) {
        return false;
    }
    return true;
}

// Suas rotas existentes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/membros', async (req, res) => {
    try {
        console.log('Buscando membros do Supabase...');
        
        const { data: membros, error } = await supabase
            .from('membros')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Erro do Supabase:', error);
            throw error;
        }

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

        const mensagemEnviada = await enviarMensagemWhatsApp(telefoneCompleto, nome);

        res.json({
            success: true,
            redirectUrl: '/membros',
            message: 'Cadastro realizado com sucesso!',
            whatsappEnviado: mensagemEnviada,
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
    toast.error('Erro interno do servidor');
    res.status(500).json({
        message: 'Erro interno do servidor',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;

// Use server.listen em vez de app.listen
server.listen(PORT, HOST, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});