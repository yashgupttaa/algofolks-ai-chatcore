require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { init } = require('../lib/pineconeClient');
const { SITE_BASE_URL } = require('../lib/config');
const pages = require('../page.js');
const { embedText } = require('../lib/utils');

function splitTextToChunksSmart(text, maxWords = 300, overlapWords = 50, minWords = 20) {
  if (!text || typeof text !== 'string') return [];
  text = text.replace(/\s+/g, ' ').trim();
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const sentWords = sentences.map(s => s.trim().split(/\s+/).filter(Boolean));
  const chunks = [];
  let currWords = [];
  for (let i = 0; i < sentWords.length; i++) {
    const sWords = sentWords[i];
    if (currWords.length + sWords.length > maxWords) {
      if (currWords.length >= minWords) chunks.push(currWords.join(' '));
      const startOverlap = Math.max(0, currWords.length - overlapWords);
      currWords = currWords.slice(startOverlap);
    }
    currWords = currWords.concat(sWords);
  }
  if (currWords.length >= minWords) chunks.push(currWords.join(' '));
  return chunks;
}

async function fetchPage(url) {
  try {
    const res = await axios.get(url, { headers: { 'User-Agent': 'AlgofolksIndexer/1.0' }, timeout: 15000 });
    const $ = cheerio.load(res.data);
    const selectors = ['main', 'article', '[role="main"]', '.post-content', '.page-content', 'body'];
    let rawText = '';
    for (const sel of selectors) {
      if ($(sel).length) {
        const clone = $(sel).first().clone();
        clone.find('nav, header, footer, .footer, .hero, script, style, noscript, iframe, svg, form').remove();
        const pieces = [];
        clone.find('h1,h2,h3,h4,p,li,blockquote,figcaption,td').each((i, el) => {
          const t = $(el).text();
          if (t && t.trim()) pieces.push(t.trim());
        });
        if (pieces.length) { rawText = pieces.join(' '); break; }
      }
    }
    if (!rawText.trim()) {
      $('nav, header, footer, script, style, noscript, iframe').remove();
      const fallback = [];
      $('h1,h2,h3,p,li,blockquote').each((i, el) => { const t = $(el).text(); if (t && t.trim()) fallback.push(t.trim()); });
      rawText = fallback.join(' ');
    }
    rawText = rawText.replace(/\s+/g, ' ').trim();
    const h1 = ($('h1').first().text() || '').trim();
    const titleTag = ($('title').text() || '').trim();
    const title = h1 || titleTag || '';
    const canonical = $('link[rel="canonical"]').attr('href') || url;
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    return { text: rawText, title, canonical, metaDesc, rawHtml: res.data };
  } catch (err) {
    console.error('fetch error', url, err.message);
    return { text: '', title: '', canonical: url, metaDesc: '', rawHtml: '' };
  }
}


function sanitizeMetadata(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/[\u{200B}-\u{200D}\uFEFF]/gu, '').replace(/[\uD800-\uDFFF]/g, '').trim();
}

function inferTypeFromPath(p) {
  const pathLower = p.toLowerCase();
  if (pathLower.startsWith('/services')) return 'service';
  if (pathLower.startsWith('/industry')) return 'industry';
  if (pathLower.startsWith('/projects')) return 'project';
  if (pathLower.startsWith('/blog')) return 'blog';
  if (['/about', '/contact', '/pricing', '/faq', '/terms', '/cookie-policy', '/payment', '/client', '/core-values', '/social-responsibilty', '/whychooseus'].includes(pathLower)) return 'info';
  return 'info';
}

async function upsertBatch(index, vectorsBatch) {
  
  try { await index.upsert({ vectors: vectorsBatch }); return; } catch (e) { }
  try { await index.upsert({ upsertRequest: { vectors: vectorsBatch } }); return; } catch (e) { }
  try { await index.upsert(vectorsBatch); return; } catch (e) { throw e; }
}

async function run() {
  const index = await init();
  const store = [];
  for (const p of pages) {
    const url = SITE_BASE_URL.replace(/\/+$/, '') + p;
    console.log('Fetching', url);
    const { text, title, canonical } = await fetchPage(url);
    if (!text) { console.log('No text for', url); continue; }
    const chunks = splitTextToChunksSmart(text, 300, 50);
    const pageType = inferTypeFromPath(p);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const emb = await embedText(chunk);
      const excerpt = sanitizeMetadata(chunk.slice(0, 800));
      const metaText = sanitizeMetadata(chunk).slice(0, 4000); 
      const metadata = { source: url, page: p, type: pageType, title: sanitizeMetadata(title || ''), canonical_url: canonical || url, chunk_index: i, excerpt, text: metaText };
      store.push({ id: `${p}::${i}`, values: emb, metadata });
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const batchSize = 80;
  for (let i = 0; i < store.length; i += batchSize) {
    const batch = store.slice(i, i + batchSize);
    for (const v of batch) {
      if (!Array.isArray(v.values)) throw new Error('Invalid embedding array for ' + v.id);
    }
    await upsertBatch(index, batch);
    console.log('Upserted batch', i, Math.min(i + batchSize, store.length));
  }

  fs.writeFileSync(path.join(__dirname, '..', 'vectors_with_meta.json'), JSON.stringify(store, null, 2));
}

if (require.main === module) run().catch(console.error);
module.exports = { run };
