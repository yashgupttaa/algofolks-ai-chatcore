const { OpenAI } = require('openai');
const { OPENAI_API_KEY } = require('./config');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function detectLanguage(text) {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: `Detect language code for this text (en/hi/hi-latn). Answer with code only: ${text}` }],
    max_tokens: 5
  });
  return resp.choices[0].message.content.trim();
}

function buildMessages({ systemPrompt, recentMessages, retrievedChunks, userQuestion, maxChunkChars = 1200 }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  for (const m of recentMessages) {
    messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
  }

  retrievedChunks.slice(0, 6).forEach((r, i) => {
    const c = (r.text || '').slice(0, maxChunkChars).replace(/\s+/g, ' ').trim();
    messages.push({
      role: 'assistant',
      content: `SOURCE ${i + 1}: ${r.source || r.page || ''}\n\n${c}`
    });
  });

  messages.push({ role: 'user', content: `Question: ${userQuestion}\n\nAnswer concisely (3-6 sentences). If the answer is NOT contained in the provided sources, reply exactly: "I don't have exact info on that — shall I connect you to our team?"` });
  return messages;
}

async function embedText(text) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  const emb = resp?.data?.[0]?.embedding;
  if (!emb || !Array.isArray(emb)) {
    console.error('embedText: embedding not array. resp.data[0] =', resp?.data?.[0]);
    throw new Error('Invalid embedding shape');
  }
  return emb;
}

module.exports = { detectLanguage, buildMessages, embedText };
