require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PINECONE_API_KEY: process.env.PINECONE_API_KEY,
  PINECONE_ENVIRONMENT: process.env.PINECONE_ENVIRONMENT,
  PINECONE_INDEX: process.env.PINECONE_INDEX || 'algofolks-chatcore',
  REDIS_URL: process.env.REDIS_URL,
  CALENDLY_LINK: process.env.CALENDLY_LINK,
  SITE_BASE_URL: process.env.SITE_BASE_URL || 'https://algofolks.com'
};
