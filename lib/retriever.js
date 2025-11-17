const { init } = require('./pineconeClient');
const { embedText } = require('./utils');

function mapMatches(matches){
  return (matches||[]).map(m => ({
    id: m.id,
    score: m.score,
    text: m.metadata?.text || m.metadata?.excerpt || '',
    source: m.metadata?.source,
    page: m.metadata?.page
  }));
}

async function retrieveRelevantHybrid(query, opts = {}) {
  const index = await init();
  const vec = await embedText(query);
  const topK = opts.topK || 6;
  const pageUrl = opts.pageUrl || null;
  let pagePath = null;
  if (pageUrl) try { pagePath = new URL(pageUrl).pathname; } catch(e) { pagePath = pageUrl; }

  const globalQ = { vector: vec, topK: topK*2, includeMetadata: true };
  const gr = await index.query(globalQ);
  const globalMatches = mapMatches(gr.matches);

  let pageMatches = [];
  if (pagePath) {
    const pageQ = { vector: vec, topK: topK*2, includeMetadata: true, filter: { page: { $eq: pagePath } } };
    const pr = await index.query(pageQ);
    pageMatches = mapMatches(pr.matches);
  }

  const bestPageScore = pageMatches[0]?.score || 0;
  const bestGlobalScore = globalMatches[0]?.score || 0;
  if (bestGlobalScore > bestPageScore + 0.05) return globalMatches.slice(0, topK);
  if (pageMatches.length) return pageMatches.slice(0, topK);

  const seen = new Set(); const merged = [];
  for (const m of [...pageMatches, ...globalMatches]) {
    if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
  }
  return merged.slice(0, topK);
}

module.exports = { retrieveRelevantHybrid };

