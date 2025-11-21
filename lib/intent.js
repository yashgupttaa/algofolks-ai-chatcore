// lib/intent.js
const { OpenAI } = require('openai');
const { OPENAI_API_KEY } = require('./config');
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const fewShotExamples = [
  {
    role: "system",
    content: `Example:
Message: "Yes, contact me. I'm Rahul from Alpha Solutions. rahul@alpha.com, +91 9876543210"
JSON:
{"intent":"connect","confidence":0.98,"entities":{"name":"Rahul","email":"rahul@alpha.com","phone":"+919876543210","company":"Alpha Solutions","brief":""},"clarifying_question":""}`
  },
  {
    role: "system",
    content: `Example:
Message: "Can you share pricing for mobile app?"
JSON:
{"intent":"pricing","confidence":0.95,"entities":{},"clarifying_question":""}`
  },
  {
    role: "system",
    content: `Example:
Message: "I want to schedule a demo next week"
JSON:
{"intent":"schedule","confidence":0.93,"entities":{"brief":""},"clarifying_question":"Which date/time works best for you?"}`
  }
];

async function detectIntentAndEntities(text, recentMessages = []) {
  const systemInstruction = {
    role: "system",
    content: `You classify user messages into intents. Return ONLY valid JSON.

intents = ["question","connect","schedule","pricing","other"].
Fields:
{
 "intent": "",
 "confidence": number (0–1),
 "entities": {
   "name":"",
   "email":"",
   "phone":"",
   "company":"",
   "brief":""
 },
 "clarifying_question":""
}

If message is ambiguous (like just "yes"), use conversation history to understand.

If still unclear → set confidence low & ask a clarifying question.`
  };

  const recent = (recentMessages || [])
    .slice(-6)
    .map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.text
    }));

  const messages = [
    systemInstruction,
    ...fewShotExamples,
    ...recent,
    { role: "user", content: text }
  ];

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.0,
    max_tokens: 300
  });

  const raw = resp?.choices?.[0]?.message?.content || "";
  try {
    const jsonStart = raw.indexOf("{");
    const parsed = JSON.parse(raw.slice(jsonStart));
    return parsed;
  } catch (e) {
    console.error("Intent JSON parse error:", raw);
    return { intent: "other", confidence: 0.0, entities: {}, clarifying_question: "" };
  }
}

module.exports = { detectIntentAndEntities };
