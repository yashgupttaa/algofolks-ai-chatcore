const { createClient } = require('redis');
const { REDIS_URL } = require('./config');

const redis = createClient({ url: REDIS_URL });

redis.on('error', (err) => console.error('Redis error', err));

async function connect() {
  if (!redis.isOpen) await redis.connect();
}

async function saveMessage(sessionId, role, text) {
  await connect();
  const key = `session:${sessionId}:convo`;
  const payload = JSON.stringify({ role, text, ts: Date.now() });
  await redis.rPush(key, payload);
  await redis.expire(key, 6 * 3600);
}

async function getRecentMessages(sessionId, limit = 6) {
  await connect();
  const key = `session:${sessionId}:convo`;
  const items = await redis.lRange(key, -limit, -1);
  return items.map(i => JSON.parse(i));
}

module.exports = { saveMessage, getRecentMessages, redis };
