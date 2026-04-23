const { App } = require('@slack/bolt');
const { Client } = require('@notionhq/client');
const axios = require('axios');

// Configurações
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Database IDs
const DATABASES = {
  modalidades: '33cc257d3c0080308ba2d649c86ca296',
  planos: '33cc257d3c00802e985dc6c39ae1221c',
  espetaculos: '33cc257d3c008098a5cbe8210346cb30'
};

// Armazenar histórico de conversas (em memória)
const conversationHistory = new Map();

// Função para buscar todas as informações do Notion
async function buscarDadosNotion() {
  try {
    const dados = {
      modalidades: [],
      planos: [],
      espetaculos: []
    };

    // Buscar Modalidades de Dança
    const modalidadesResponse = await notion.databases.query({
      database_id: DATABASES.modalidades
    });

    for (const page of modalidadesResponse.results) {
      const props = page.properties;
      dados.modalidades.push({
        modalidade: props.Modalidade?.title?.[0]?.plain_text || '',
        nivel: props['Nível']?.select?.name || '',
        dias: props['Dias da Semana']?.rich_text?.[0]?.plain_text || '',
        horario: props['Horário']?.rich_text?.[0]?.plain_text || '',
        duracao: props['Duração (minutos)']?.number || '',
        professor: props['Professor(a)']?.rich_text?.[0]?.plain_text || '',
        observacoes: props['Observações']?.rich_text?.[0]?.plain_text || ''
      });
    }

    // Buscar Planos de Pagamento
    const planosResponse = await notion.databases.query({
      database_id: DATABASES.planos
    });

    for (const page of planosResponse.results) {
      const props = page.properties;
      dados.planos.push({
        plano: props.Plano?.title?.[0]?.plain_text || '',
        valorMensal: props['Valor Mensal (R$)']?.number || '',
        valorTotal: props['Valor Total (R$)']?.number || '',
        aulasPorSemana: props['Aulas por Semana']?.rich_text?.[0]?.plain_text || '',
        modalidades: props['Modalidades Incluídas']?.rich_text?.[0]?.plain_text || '',
        desconto: props['Desconto (%)']?.number || 0,
        beneficios: props['Benefícios Extras']?.rich_text?.[0]?.plain_text || ''
      });
    }

    // Buscar Próximos Espetáculos
    const espetaculosResponse = await notion.databases.query({
      database_id: DATABASES.espetaculos
    });

    for (const page of espetaculosResponse.results) {
      const props = page.properties;
      dados.espetaculos.push({
        nome: props['Nome do Espetáculo']?.title?.[0]?.plain_text || '',
        data: props.Data?.rich_text?.[0]?.plain_text || '',
        horario: props['Horário']?.rich_text?.[0]?.plain_text || '',
        local: props.Local?.rich_text?.[0]?.plain_text || '',
        modalidades: props['Modalidades Apresentadas']?.rich_text?.[0]?.plain_text || '',
        ingressoInteira: props['Ingresso Inteira (R$)']?.number || '',
        ingressoMeia: props['Ingresso Meia (R$)']?.number || '',
        ondeComprar: props['Onde Comprar']?.rich_text?.[0]?.plain_text || '',
        observacoes: props['Observações']?.rich_text?.[0]?.plain_text || ''
      });
    }

    return dados;
  } catch (error) {
    console.error('Erro ao buscar dados no Notion:', error);
    return null;
  }
}

// Função para processar com Groq usando RAG + Memória
async function processarComGroqRAG(mensagemUsuario, userId) {
  try {
    // Buscar TODOS os dados do Notion
    const dadosNotion = await buscarDadosNotion();

    if (!dadosNotion) {
      return 'Desculpe, tive um problema ao acessar as informações. Tente novamente! 😊';
    }

    // Pegar histórico da conversa (últimas 10 mensagens)
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }
    const historico = conversationHistory.get(userId);

    // Formatar dados para o contexto
    let contexto = '# BASE DE CONHECIMENTO - STUDIO DE DANÇA ALINE LENCINI\n\n';

    // Modalidades
    contexto += '## MODALIDADES E HORÁRIOS:\n';
    dadosNotion.modalidades.forEach(m => {
      contexto += `- ${m.modalidade} (${m.nivel}): ${m.dias} às ${m.horario}, ${m.duracao} minutos, Prof. ${m.professor}`;
      if (m.observacoes) contexto += ` - ${m.observacoes}`;
      contexto += '\n';
    });

    // Planos
    contexto += '\n## PLANOS DE PAGAMENTO:\n';
    dadosNotion.planos.forEach(p => {
      contexto += `- ${p.plano}: R$${p.valorMensal}/mês`;
      if (p.valorTotal !== p.valorMensal) contexto += ` (Total: R$${p.valorTotal})`;
      contexto += `, ${p.aulasPorSemana} aulas/semana, ${p.modalidades}`;
      if (p.desconto > 0) contexto += `, ${p.desconto}% desconto`;
      if (p.beneficios) contexto += ` - Benefícios: ${p.beneficios}`;
      contexto += '\n';
    });

    // Espetáculos
    contexto += '\n## PRÓXIMOS ESPETÁCULOS:\n';
    dadosNotion.espetaculos.forEach(e => {
      contexto += `- ${e.nome}: ${e.data} às ${e.horario} no ${e.local}`;
      contexto += ` - Modalidades: ${e.modalidades}`;
      contexto += ` - Ingressos: R$${e.ingressoInteira} (inteira) / R$${e.ingressoMeia} (meia)`;
      contexto += ` - Comprar: ${e.ondeComprar}`;
      if (e.observacoes) contexto += ` - ${e.observacoes}`;
      contexto += '\n';
    });

    // System prompt com identidade e instruções
    const systemPrompt = `Você é a Clara, assistente virtual do Studio de Dança Aline Lencini. Você é amigável, entusiasmada com dança e sempre prestativa!

${contexto}

INSTRUÇÕES:
- Use APENAS as informações acima para responder
- Lembre-se do contexto da conversa anterior
- Seja natural, conversacional e use emojis quando apropriado 😊💃
- Quando mencionar horários, inclua professor e duração
- Quando mencionar preços, mencione benefícios se houver
- Se não souber algo específico, seja honesta e sugira entrar em contato
- Mantenha respostas objetivas (máximo 4 frases, exceto se precisar listar várias opções)
- Você trabalha no Studio de Dança ALINE LENCINI (não Clara Lencini)`;

    // Montar mensagens com histórico
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historico,
      { role: 'user', content: mensagemUsuario }
    ];

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const resposta = response.data.choices[0].message.content;

    // Adicionar ao histórico (manter últimas 10 interações = 20 mensagens)
    historico.push({ role: 'user', content: mensagemUsuario });
    historico.push({ role: 'assistant', content: resposta });
    
    // Limitar histórico a 20 mensagens (10 pares)
    if (historico.length > 20) {
      historico.splice(0, historico.length - 20);
    }

    return resposta;
  } catch (error) {
    console.error('Erro ao processar com Groq:', error);
    return 'Desculpe, tive um problema ao processar sua mensagem. Tente novamente! 😊';
  }
}

// Escutar mensagens diretas ao bot
slackApp.message(async ({ message, say }) => {
  try {
    // Ignorar mensagens de bots
    if (message.subtype && message.subtype === 'bot_message') return;
    
    const mensagemUsuario = message.text;
    const userId = message.user;
    
    console.log(`Mensagem recebida de ${userId}: ${mensagemUsuario}`);
    
    // Processar com RAG + Memória
    const resposta = await processarComGroqRAG(mensagemUsuario, userId);
    
    // Responder no Slack
    await say(resposta);
    
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    await say('Desculpe, ocorreu um erro. Tente novamente! 😊');
  }
});

// Escutar menções ao bot em canais
slackApp.event('app_mention', async ({ event, say }) => {
  try {
    // Remover a menção do bot da mensagem
    const mensagemUsuario = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    const userId = event.user;
    
    console.log(`Menção recebida de ${userId}: ${mensagemUsuario}`);
    
    // Processar com RAG + Memória
    const resposta = await processarComGroqRAG(mensagemUsuario, userId);
    
    // Responder no canal
    await say(resposta);
    
  } catch (error) {
    console.error('Erro ao processar menção:', error);
    await say('Desculpe, ocorreu um erro. Tente novamente! 😊');
  }
});

// Iniciar servidor
(async () => {
  await slackApp.start();
  console.log('⚡️ Clara está online no Studio de Dança Aline Lencini!');
})();
