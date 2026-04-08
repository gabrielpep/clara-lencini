const { App } = require('@slack/bolt');
const { Client } = require('@notionhq/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurações
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Função para buscar no Notion
async function buscarNoNotion(palavraChave) {
  try {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      filter: {
        property: 'Ativo',
        checkbox: {
          equals: true
        }
      }
    });

    // Procurar em todas as entradas
    for (const page of response.results) {
      const categoria = page.properties.Categoria?.title[0]?.plain_text || '';
      const palavrasChave = page.properties['Palavras-chave']?.rich_text[0]?.plain_text || '';
      const resposta = page.properties.Resposta?.rich_text[0]?.plain_text || '';

      // Verificar se a palavra-chave do usuário está nas palavras-chave da entrada
      const palavrasArray = palavrasChave.toLowerCase().split(',').map(p => p.trim());
      const palavraUsuario = palavraChave.toLowerCase();

      if (palavrasArray.some(palavra => palavraUsuario.includes(palavra) || palavra.includes(palavraUsuario))) {
        return { categoria, resposta };
      }
    }

    return null;
  } catch (error) {
    console.error('Erro ao buscar no Notion:', error);
    return null;
  }
}

// Função para processar com Gemini
async function processarComGemini(mensagemUsuario, contextoNotion) {
  try {
    let prompt = '';
    
    if (contextoNotion) {
      prompt = `Você é um assistente prestativo de uma escola de dança. Use esta informação para responder a pergunta do usuário de forma natural e amigável:

Categoria: ${contextoNotion.categoria}
Informação: ${contextoNotion.resposta}

Pergunta do usuário: ${mensagemUsuario}

Baseie sua resposta na informação fornecida, mas seja conversacional e amigável. Mantenha a resposta curta (máximo 3 frases).`;
    } else {
      prompt = `Você é um assistente prestativo de uma escola de dança. Responda de forma educada e objetiva à seguinte pergunta:

${mensagemUsuario}

Se você não tiver informações específicas sobre a escola, seja honesto e sugira que a pessoa entre em contato conosco. Mantenha a resposta curta (máximo 3 frases).`;
    }

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return text;
  } catch (error) {
    console.error('Erro ao processar com Gemini:', error);
    return 'Desculpe, tive um problema ao processar sua mensagem. Tente novamente! 😊';
  }
}

// Escutar mensagens diretas ao bot
slackApp.message(async ({ message, say }) => {
  try {
    // Ignorar mensagens de bots
    if (message.subtype && message.subtype === 'bot_message') return;
    
    const mensagemUsuario = message.text;
    
    console.log(`Mensagem recebida: ${mensagemUsuario}`);
    
    // 1. Buscar no Notion
    const contextoNotion = await buscarNoNotion(mensagemUsuario);
    
    // 2. Processar com Gemini
    const resposta = await processarComGemini(mensagemUsuario, contextoNotion);
    
    // 3. Responder no Slack
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
    
    console.log(`Menção recebida: ${mensagemUsuario}`);
    
    // 1. Buscar no Notion
    const contextoNotion = await buscarNoNotion(mensagemUsuario);
    
    // 2. Processar com Gemini
    const resposta = await processarComGemini(mensagemUsuario, contextoNotion);
    
    // 3. Responder no canal
    await say(resposta);
    
  } catch (error) {
    console.error('Erro ao processar menção:', error);
    await say('Desculpe, ocorreu um erro. Tente novamente! 😊');
  }
});

// Iniciar servidor
(async () => {
  await slackApp.start();
  console.log('⚡️ Bot está rodando com Google Gemini!');
})();
