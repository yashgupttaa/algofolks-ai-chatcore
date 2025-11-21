require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const { retrieveRelevantHybrid } = require('../lib/retriever');
const { saveMessage, getRecentMessages, saveLeadToDb } = require('../lib/memory');
const { buildMessages } = require('../lib/utils');
const { OPENAI_API_KEY, PORT } = require('../lib/config');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const { detectIntentAndEntities } = require('../lib/intent');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

async function saveLeadToFile(lead) {
  try {
    const outFile = path.join(__dirname, 'leads.json');
    let arr = [];
    if (fs.existsSync(outFile)) {
      const raw = fs.readFileSync(outFile, 'utf-8') || '[]';
      arr = JSON.parse(raw);
    }
    arr.push({ ...lead, createdAt: new Date().toISOString() });
    fs.writeFileSync(outFile, JSON.stringify(arr, null, 2), 'utf-8');


    return true;
  } catch (err) {
    console.error('saveLeadToFile error', err);
    return false;
  }
}


io.on('connection', (socket) => {
  socket.session = { id: socket.handshake?.auth?.sessionKey };

  socket.on('user_message', async (data) => {
    try {
      const text = (data.text || '').trim();
      if (!text) return;

      await saveMessage(socket.session.id, 'user', text);

      const classifier = await detectIntentAndEntities(text, await getRecentMessages(socket.session.id, 6));

      if (socket.session.expecting) {
        socket.session.lead = socket.session.lead || {};
        const step = socket.session.expecting;
        // NAME / COMPANY combined step
        if (step === 'name_company') {
          socket.session.lead.name_company = text;
          socket.session.expecting = 'email';
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Thanks — please share your email address.' });
          return;
        }
        if (step === 'email') {
          const email = text.trim();
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Please provide a valid email (e.g. you@company.com).' });
            return;
          }
          socket.session.lead.email = email;
          socket.session.expecting = 'phone';
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Great — could you share your phone number (with country code if possible)?' });
          return;
        }
        if (step === 'phone') {
          const phone = text.replace(/[^\d+]/g, '');
          if (phone.length < 7) {
            socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Phone number looks too short — please re-enter.' });
            return;
          }
          socket.session.lead.phone = phone;
          socket.session.expecting = 'brief';
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Optional: would you like to share a short project brief?' });
          return;
        }
        if (step === 'brief') {
          const brief = (text.toLowerCase() === 'no' || text.toLowerCase() === 'n') ? '' : text;
          socket.session.lead.brief = brief;
          const lead = {
            sessionId: socket.session.id,
            ...socket.session.lead,
            pageUrl: data.pageUrl || null,
            source: 'chatbot'
          };
          const saved = await saveLeadToDb(lead);
          socket.session.expecting = null;
          socket.session.lead = null;
          if (saved) {
            socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Thank you! Your details have been saved. Our sales team will contact you shortly.' });
          } else {
            socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'There was an issue saving your details — please try again.' });
          }
          return;
        }
        socket.session.expecting = null;
      }

      if (classifier.intent === 'connect') {
        socket.session.lead = socket.session.lead || {};
        Object.assign(socket.session.lead, classifier.entities || {});
        if (!socket.session.lead.name_company && (classifier.entities.name || classifier.entities.company)) {
          socket.session.lead.name_company = `${classifier.entities.name || ''} ${classifier.entities.company || ''}`.trim();
        }
        console.log('session.lead after merge', socket.session.lead);
  
        if (!socket.session.lead.email) {
          socket.session.expecting = 'email';
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Please share your email address.' });
          return;
        }
        if (!socket.session.lead.phone) {
          socket.session.expecting = 'phone';
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Could you also share your phone number?' });
          return;
        }
        if (!socket.session.lead.brief) {
          socket.session.expecting = 'brief';
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Would you like to share a short project brief? (optional)' });
          return;
        }
  
        const lead = {
          sessionId: socket.session.id,
          ...socket.session.lead,
          pageUrl: data.pageUrl || null,
          source: 'chatbot'
        };
        const saved = await saveLeadToDb(lead);
        socket.session.expecting = null;
        socket.session.lead = null;
        if (saved) {
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'Thank you! Your details have been saved. Our sales team will contact you shortly.' });
        } else {
          socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: 'There was an issue saving your details — please try again.' });
        }
        return;
      }

      const threshold = 0.75;
      if ((classifier.confidence || 0) < threshold && classifier.clarifying_question) {
        socket.session.lastClarify = classifier.clarifying_question;
        socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: classifier.clarifying_question });
        return;
      }

      let pagePath = null;
      try {
        if (data.pageUrl) pagePath = new URL(data.pageUrl).pathname;
      } catch (e) { pagePath = data.pageUrl; }

      const retrieved = await retrieveRelevantHybrid(text, { topK: 8, pageUrl: pagePath });
      const recent = await getRecentMessages(socket.session.id, 6);

      if (!retrieved || retrieved.length === 0) {
        const fallbackText = "I can't find the exact information on this page. Should I search the entire site or would you like to speak to the team?";
        await saveMessage(socket.session.id, 'assistant', fallbackText);
        socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: fallbackText, sources: [] });
        return;
      }

      const systemPrompt = `You are *Algofolks Sales & Solutions Assistant* on the website.
Your job is to understand the visitor’s needs, guide them using ONLY the provided website context (the “SOURCE” blocks), and gently move them toward starting a conversation or project with the Algofolks team.

*Data & Safety Rules*

1. Use ONLY the information from the SOURCE blocks.
2. Do NOT hallucinate or guess details that are not clearly present in the SOURCE.
3. If the information needed is not in the context, respond with exactly:
   *"I don't have exact info on that — shall I connect you to our team?"*
4. Do not mention “RAG”, “SOURCE blocks”, “context window”, or any internal technical details to the user.

*Conversation Style*

5. Be warm, professional, and concise. Use short paragraphs and bullets where helpful.
6. Avoid long monologues. Prefer a short answer + 1–2 follow-up questions to understand the user better.
7. Never ask more than *3 questions* in a single message.

*Discovery (Ask Questions First)*

8. Before proposing solutions, ask *1–3 short questions* to understand:

   * Who they are (role / business type),
   * What they’re trying to achieve, or
   * Which service / problem area they’re interested in (based only on what exists in SOURCE).

   Example styles (adapt to context in SOURCE, don’t invent services):

   * “Are you mainly looking for help with [service A] or [service B]?”
   * “What’s the main outcome you’re hoping to achieve with this?"

*Using the SOURCE Knowledge*

9. When answering, always prefer:

   * Services and capabilities described in SOURCE
   * Case studies, processes, tech stack, and workflows mentioned in SOURCE
10. If multiple SOURCE items apply, choose the ones most relevant to the user’s last message and their goals.
11. If something is partly available, say what you do know from SOURCE and then, if needed, use the fallback line above.

*Sales / Deal-Closing Behaviour*

12. Act like a consultative pre-sales assistant:

    * Clarify their problem
    * Map it to Algofolks capabilities from SOURCE
    * Suggest practical next steps

13. Whenever it feels natural (not in every single message, but regularly), gently nudge toward a next step such as:

    * Sharing brief project requirements
    * Booking a call / demo (only if such an option is mentioned in SOURCE)
    * Filling a contact form or sharing email/WhatsApp (only if mentioned in SOURCE)
    * Starting with a small trial, PoC, or MVP (if this exists in SOURCE)

    Example styles:

    * “If you’d like, I can help you outline a quick plan that our team can review.”
    * “This sounds like a good fit for our [service from SOURCE]. Would you like me to connect you to our team to discuss timelines and pricing?”

14. Focus on outcomes that match the SOURCE (e.g., more leads, automation, faster delivery, better UX). Do not invent benefits that are not implied or supported by the SOURCE.

*Answer Format*

15. Keep answers:

    * Clear and specific
    * Grounded in SOURCE
    * 2–6 short sentences, unless the user explicitly asks for more detail.

16. End most replies with:

    * Either a clarifying question, *or*
    * A soft call-to-action (e.g., offering to connect them to the team, help scope their project, or suggest next steps).

Remember: If at any point you don’t find the needed information in the SOURCE, say:
*"I don't have exact info on that — shall I connect you to our team?"*`;

      const messages = buildMessages({
        systemPrompt,
        recentMessages: recent,
        retrievedChunks: retrieved,
        userQuestion: text,
        maxChunkChars: 1200
      });

      let completion;
      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages,
            temperature: 0.0,
            max_tokens: 600
          });
          break;
        } catch (err) {
          console.warn('OpenAI call error, attempt', attempt, err?.message || err);
          if (attempt === maxRetries) throw err;
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
      }

      let answer = (completion?.choices?.[0]?.message?.content || '').trim();

      if (answer.length < 4 || /i don't have exact info/i.test(answer)) {
        // pass through as-is (we want the exact phrase or fallback above already handled)
      }

      const sources = Array.from(new Set(retrieved.map(r => r.source).filter(Boolean)));

      await saveMessage(socket.session.id, 'assistant', answer);

      socket.emit('bot_message', {
        _id: `bot-${Date.now()}`,
        text: answer,
        sources,
        retrieved: retrieved.slice(0, 3).map(r => ({ source: r.source, score: r.score }))
      });

    } catch (err) {
      console.error('server error', err);
      socket.emit('bot_message', { _id: `bot-${Date.now()}`, text: "Sorry, Please try again later." });
    }
  });

  socket.on('disconnect', () => {
    console.log('client disconnected', socket.id);
  });
});

server.listen(PORT, () => console.log('Server listening on', PORT));
