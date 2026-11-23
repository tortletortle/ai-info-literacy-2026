"use strict";

const WINDOW_SIZE = 640;
const WINDOW_STEP = 480;
const MAX_CHUNKS = 40000;
const MAX_RESULTS = 3;
const MIN_SCORE = 0.08;
const K1 = 1.2;
const B = 0.75;

function tokenize(value) {
  const parts = String(value || "").toLowerCase().match(/[\u3400-\u9fff]+|[a-z0-9]+/g) || [];
  const terms = [];
  parts.forEach((part) => {
    if (/^[\u3400-\u9fff]+$/.test(part)) {
      if (part.length === 1) {
        terms.push(part);
      } else {
        for (let index = 0; index < part.length - 1; index++) {
          terms.push(part.slice(index, index + 2));
        }
      }
    } else {
      terms.push(part);
    }
  });
  return terms;
}

function frequencies(terms) {
  const counts = new Map();
  terms.forEach((term) => counts.set(term, (counts.get(term) || 0) + 1));
  return counts;
}

function buildQueryWeights(payload) {
  const weights = new Map();
  tokenize(payload.question).forEach((term) => {
    weights.set(term, Math.max(weights.get(term) || 0, 2));
  });
  (Array.isArray(payload.options) ? payload.options : []).forEach((option) => {
    tokenize(option && option.text).forEach((term) => {
      weights.set(term, Math.max(weights.get(term) || 0, 0.75));
    });
  });
  return weights;
}

function splitIntoChunks(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= WINDOW_SIZE) return [normalized];
  const chunks = [];
  for (let offset = 0; offset < normalized.length; offset += WINDOW_STEP) {
    const chunk = normalized.slice(offset, offset + WINDOW_SIZE).trim();
    if (chunk) chunks.push(chunk);
    if (offset + WINDOW_SIZE >= normalized.length) break;
  }
  return chunks;
}

function retrieveEvidence(documents, payload) {
  if (!Array.isArray(documents) || !documents.length) return [];
  const queryWeights = buildQueryWeights(payload || {});
  if (!queryWeights.size) return [];

  const chunks = [];
  for (const doc of documents) {
    if (!doc || !Array.isArray(doc.pages)) continue;
    for (const page of doc.pages) {
      for (const text of splitIntoChunks(page && page.text)) {
        const terms = tokenize(text);
        if (!terms.length) continue;
        chunks.push({
          doc,
          page: Number(page.page) || null,
          text,
          frequencies: frequencies(terms),
          length: terms.length,
          titleTerms: new Set(tokenize(doc.title))
        });
        if (chunks.length >= MAX_CHUNKS) break;
      }
      if (chunks.length >= MAX_CHUNKS) break;
    }
    if (chunks.length >= MAX_CHUNKS) break;
  }
  if (!chunks.length) return [];

  const documentFrequency = new Map();
  chunks.forEach((chunk) => {
    chunk.frequencies.forEach((_count, term) => {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    });
  });

  const averageLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0) / chunks.length || 1;
  const normalizedQuestion = String(payload.question || "").toLowerCase().replace(/\s+/g, "");
  const scored = chunks.map((chunk) => {
    let score = 0;
    queryWeights.forEach((weight, term) => {
      const termFrequency = chunk.frequencies.get(term) || 0;
      if (!termFrequency) return;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      const denominator = termFrequency + K1 * (1 - B + B * chunk.length / averageLength);
      score += weight * idf * (termFrequency * (K1 + 1)) / denominator;
      if (chunk.titleTerms.has(term)) score += weight * 0.035;
    });

    if (normalizedQuestion.length >= 5 &&
        chunk.text.toLowerCase().replace(/\s+/g, "").includes(normalizedQuestion)) {
      score += 0.35;
    }
    if (chunk.doc.authority === "A") score *= 1.12;
    else if (chunk.doc.authority === "B") score *= 1.06;

    return {
      id: "",
      title: String(chunk.doc.title || "未命名来源"),
      url: String(chunk.doc.sourceUrl || ""),
      page: chunk.page,
      sourceId: String(chunk.doc.sourceId || ""),
      authority: ["A", "B", "C"].includes(chunk.doc.authority) ? chunk.doc.authority : "C",
      text: chunk.text,
      score
    };
  }).filter((item) => item.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score);

  const results = [];
  const seenPages = new Set();
  for (const item of scored) {
    const key = item.sourceId + ":" + item.title + ":" + item.page;
    if (seenPages.has(key)) continue;
    seenPages.add(key);
    item.id = "E" + (results.length + 1);
    results.push(item);
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

module.exports = { retrieveEvidence, tokenize, splitIntoChunks };
