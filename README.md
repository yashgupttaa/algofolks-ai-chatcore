# Algofolks AI Chatcore

LangChain-powered conversational assistant for Algofolks.

An AI-powered RAG chatbot backend built for the **Algofolks** website.  
This system combines **OpenAI**, **Pinecone**, **Node.js**, and **Socket.IO** to deliver real-time, source-accurate website assistance with page-aware retrieval.

---

## Overview

Algofolks Chatcore is the backend engine behind the website’s AI chatbot.  
It:

✔ Scrapes website pages  
✔ Splits content into semantic chunks  
✔ Generates embeddings using OpenAI  
✔ Stores vectors + metadata into Pinecone  
✔ Performs page-aware + global fallback retrieval  
✔ Uses OpenAI LLM to answer user questions  
✔ Provides real-time chat using Socket.IO  
✔ Supports conversation history & source attribution  

This system is designed to be scalable, modular, and maintainable.

---

## Tech Stack

| Component | Technology |
|----------|------------|
| Runtime | Node.js 20+ |
| LLM | OpenAI `gpt-4o` |
| Embeddings | OpenAI `text-embedding-3-small` |
| Vector DB | Pinecone |
| Scraping | Axios + Cheerio |
| Real-Time | Socket.IO |
| Storage (optional) | Redis |
| Local backup | JSON (`vectors_with_meta.json`) |

---

## Project Structure

```bash
algofolks-ai-chatcore/
│
├── indexer/
│   ├── pinecone_indexer.js        # Scraper + embedder + upserter
│   ├── pages_list.js              # List of pages to index
│
├── lib/
│   ├── pineconeClient.js          # Pinecone initialization
│   ├── retriever.js               # Hybrid retrieval logic
│
├── server.js                      # Chat server (Socket.IO)
├── vectors_with_meta.json         # Local backup of vectors
├── package.json
├── .env
└── README.md
