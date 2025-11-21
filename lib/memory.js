const { MongoClient } = require("mongodb");
const { MONGO_URL } = require("./config");

let client;
let db;
let messages;
let leads;
async function connect() {
  if (!client) {
    client = new MongoClient(MONGO_URL, {});

    await client.connect();

    db = client.db("algochat");
    messages = db.collection("messages");
    leads = db.collection("leads");
    await messages.createIndex({ sessionId: 1, ts: 1 });
    await leads.createIndex({ sessionId: 1, ts: 1 });
  }
}

async function saveMessage(sessionId, role, text) {
  await connect();

  const doc = {
    sessionId,
    role,
    text,
    ts: Date.now()
  };

  await messages.insertOne(doc);
}

async function saveLeadToDb(lead) {
  console.log("lead", lead);
  await connect();

  await leads.insertOne({
    ...lead,
    ts: Date.now()
  });
  return true;
}

async function getRecentMessages(sessionId, limit = 6) {
  await connect();

  const docs = await messages
    .find({ sessionId })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();

  return docs.reverse();
}

module.exports = { saveMessage, getRecentMessages, saveLeadToDb };
