"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeWorkspace } = require("../workspace-schema.cjs");

function verifiedQuestion(overrides) {
  return {
    id: "SRC-1-M01-001",
    stem: "下列哪项属于布尔逻辑运算符？",
    type: "single",
    options: [{ key: "A", text: "AND" }, { key: "B", text: "Excel" }],
    answer: ["A"],
    source: {
      id: "SRC-1", authority: "A", title: "官方资料",
      url: "https://example.org/guide.pdf", confirmedByUser: true, page: 8,
      quote: "官方原文：AND 是布尔逻辑运算符，Excel 是电子表格软件。"
    },
    reviewStatus: "verified",
    ...(overrides || {})
  };
}

test("accepts a structurally valid verified question and local knowledge pages", () => {
  const result = normalizeWorkspace({
    questions: [verifiedQuestion()],
    documents: [{
      id: "SRC-1-DOC-latest", title: "官方资料", sourceId: "SRC-1",
      authority: "A", sourceUrl: "https://example.org/guide.pdf",
      pages: [{ page: 8, text: "官方原文内容。" }]
    }]
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.questions.length, 1);
  assert.equal(result.documents[0].pages[0].page, 8);
});

test("rejects a verified question promoted from third-party evidence", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion({ source: { ...verifiedQuestion().source, authority: "C" } })],
    documents: []
  }), /不能将 C 级/);
});

test("rejects verified questions without a page-level source quote", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion({ source: { ...verifiedQuestion().source, quote: "" } })],
    documents: []
  }), /原文摘录/);
});

test("rejects duplicate option keys and answer references", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion({
      options: [{ key: "A", text: "AND" }, { key: "A", text: "OR" }]
    })],
    documents: []
  }), /重复/);
});

test("rejects invalid multi-select answer cardinality", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion({ type: "multi", answer: ["A"] })],
    documents: []
  }), /数量与题型/);
});

test("rejects non-HTTPS source URLs", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion({ source: { ...verifiedQuestion().source, url: "http://example.org/guide.pdf" } })],
    documents: []
  }), /HTTPS/);
});

test("rejects duplicate question IDs and duplicate page numbers", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion(), verifiedQuestion()], documents: []
  }), /重复题目 ID/);
  assert.throws(() => normalizeWorkspace({
    questions: [],
    documents: [{ id: "DOC-1", pages: [{ page: 1, text: "a" }, { page: 1, text: "b" }] }]
  }), /重复页码/);
});

test("allows pending extraction candidates without a verified answer", () => {
  const result = normalizeWorkspace({
    questions: [verifiedQuestion({
      answer: [], reviewStatus: "pending",
      source: { id: "", authority: "C", title: "", page: null, quote: "" }
    })],
    documents: []
  });
  assert.equal(result.questions[0].reviewStatus, "pending");
});


test("rejects verified questions when source metadata was not explicitly confirmed", () => {
  assert.throws(() => normalizeWorkspace({
    questions: [verifiedQuestion({
      source: { ...verifiedQuestion().source, confirmedByUser: false }
    })],
    documents: []
  }), /尚未由用户确认/);
});
