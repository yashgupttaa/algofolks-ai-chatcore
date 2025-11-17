const { Pinecone } = require('@pinecone-database/pinecone');
const { PINECONE_API_KEY, PINECONE_INDEX } = require('./config');

let pinecone;

async function init() {
  if (!pinecone) {
    pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  }
  return pinecone.index(PINECONE_INDEX);
}

module.exports = { init };
