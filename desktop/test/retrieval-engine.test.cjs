"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { retrieveEvidence, tokenize, splitIntoChunks } = require("../retrieval-engine.cjs");

const question = {
  question: "Wiley 高级检索字段有哪些？",
  type: "single",
  options: [
    { key: "A", text: "出版日期" },
    { key: "B", text: "校园卡" }
  ]
};

test("tokenizes Chinese bigrams and English words", () => {
  const tokens = tokenize("Wiley 高级检索");
  assert.ok(tokens.includes("wiley"));
  assert.ok(tokens.includes("高级"));
  assert.ok(tokens.includes("级检"));
  assert.ok(tokens.includes("检索"));
});

test("ranks the directly relevant official page above unrelated content", () => {
  const results = retrieveEvidence([
    {
      id: "DOC-1",
      title: "Wiley 官方检索指南",
      sourceId: "SRC-1",
      authority: "A",
      sourceUrl: "https://example.org/wiley",
      pages: [
        { page: 7, text: "Wiley Online Library 高级检索字段包括主题、作者、出版日期和文献类型。" }
      ]
    },
    {
      id: "DOC-2",
      title: "校园服务",
      sourceId: "SRC-2",
      authority: "B",
      pages: [
        { page: 2, text: "校园卡充值、宿舍报修和图书馆开放时间。" }
      ]
    }
  ], question);
  assert.equal(results[0].sourceId, "SRC-1");
  assert.equal(results[0].page, 7);
  assert.equal(results[0].authority, "A");
  assert.equal(results[0].id, "E1");
});

test("weights question stem more strongly than distractor option text", () => {
  const results = retrieveEvidence([
    {
      id: "DOC-DISTRACTOR",
      title: "校园卡",
      sourceId: "SRC-D",
      authority: "A",
      pages: [{ page: 1, text: "校园卡 校园卡 校园卡 校园卡 校园卡。" }]
    },
    {
      id: "DOC-STEM",
      title: "Wiley 检索指南",
      sourceId: "SRC-S",
      authority: "B",
      pages: [{ page: 3, text: "Wiley 高级检索字段包括出版日期、作者和主题。" }]
    }
  ], question);
  assert.equal(results[0].sourceId, "SRC-S");
});

test("returns at most one best chunk per source page", () => {
  const repeated = ("Wiley 高级检索字段包括主题、作者和出版日期。").repeat(150);
  const results = retrieveEvidence([{
    id: "DOC-1",
    title: "Wiley",
    sourceId: "SRC-1",
    authority: "A",
    pages: [{ page: 9, text: repeated }]
  }], question);
  assert.equal(results.length, 1);
  assert.equal(results[0].page, 9);
});

test("returns source IDs, page numbers, authority and excerpts for citation", () => {
  const results = retrieveEvidence([{
    id: "DOC-C",
    title: "第三方线索",
    sourceId: "SRC-C",
    authority: "C",
    sourceUrl: "https://example.org/clue",
    pages: [{ page: 4, text: "Wiley 高级检索可以按主题和作者筛选。" }]
  }], question);
  assert.equal(results[0].authority, "C");
  assert.equal(results[0].sourceId, "SRC-C");
  assert.equal(results[0].page, 4);
  assert.ok(results[0].text.includes("Wiley"));
});

test("splits long pages into overlapping windows", () => {
  const chunks = splitIntoChunks("a".repeat(1500));
  assert.ok(chunks.length >= 3);
  assert.ok(chunks[0].length <= 640);
});
