"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { answerWithEvidence, resolveEndpoint } = require("../answer-engine.cjs");

const settings = {
  baseUrl: "https://api.example.test/v1",
  apiKey: "test-key",
  model: "test-model"
};

function mockFetch(content) {
  return async (url, options) => {
    assert.equal(url, "https://api.example.test/v1/chat/completions");
    assert.equal(options.headers.authorization, "Bearer test-key");
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(content) } }]
      })
    };
  };
}

function answerPayload(overrides) {
  return {
    question: "Which are boolean operators?",
    type: "multi",
    multiAnswerMin: 2,
    multiAnswerMax: 2,
    options: [
      { key: "A", text: "AND" },
      { key: "B", text: "OR" },
      { key: "C", text: "Excel" }
    ],
    evidence: [{
      id: "E1",
      authority: "A",
      title: "Official guide",
      page: 3,
      text: "AND and OR are Boolean operators. Excel is a spreadsheet application."
    }],
    ...(overrides || {})
  };
}

test("only accepts complete multi-select reasoning supported by official evidence", async () => {
  const content = {
    status: "answered",
    explanation: "官方资料明确列出 AND 与 OR。",
    confidence: "high",
    evidenceIds: ["E1"],
    optionAnalysis: [
      { key: "A", verdict: "supported", rationale: "资料明确列出 AND。", evidenceIds: ["E1"] },
      { key: "B", verdict: "supported", rationale: "资料明确列出 OR。", evidenceIds: ["E1"] },
      { key: "C", verdict: "refuted", rationale: "资料说明 Excel 是电子表格软件。", evidenceIds: ["E1"] }
    ],
    warnings: []
  };
  const result = await answerWithEvidence({
    payload: answerPayload(),
    settings,
    fetchImpl: mockFetch(content)
  });
  assert.equal(result.status, "answered");
  assert.deepEqual(result.answerKeys, ["A", "B"]);
});

test("rejects third-party-only evidence before calling the model", async () => {
  let called = false;
  const payload = answerPayload({
    evidence: [{ id: "E1", authority: "C", text: "third-party note" }]
  });
  const result = await answerWithEvidence({
    payload,
    settings,
    fetchImpl: async () => { called = true; throw new Error("should not call"); }
  });
  assert.equal(result.status, "uncertain");
  assert.equal(called, false);
});

test("rejects incomplete option analysis", async () => {
  const content = {
    status: "answered",
    explanation: "Incomplete.",
    confidence: "high",
    evidenceIds: ["E1"],
    optionAnalysis: [
      { key: "A", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "B", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] }
    ],
    warnings: []
  };
  const result = await answerWithEvidence({
    payload: answerPayload(),
    settings,
    fetchImpl: mockFetch(content)
  });
  assert.equal(result.status, "uncertain");
  assert.deepEqual(result.answerKeys, []);
});

test("rejects unsupported answer cardinality for multi-select", async () => {
  const content = {
    status: "answered",
    explanation: "Only one selected.",
    confidence: "high",
    evidenceIds: ["E1"],
    optionAnalysis: [
      { key: "A", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "B", verdict: "refuted", rationale: "refuted", evidenceIds: ["E1"] },
      { key: "C", verdict: "refuted", rationale: "refuted", evidenceIds: ["E1"] }
    ],
    warnings: []
  };
  const result = await answerWithEvidence({
    payload: answerPayload(),
    settings,
    fetchImpl: mockFetch(content)
  });
  assert.equal(result.status, "uncertain");
});

test("requires HTTPS for remote model endpoints", () => {
  assert.equal(resolveEndpoint("https://api.example.test/v1"), "https://api.example.test/v1/chat/completions");
  assert.equal(resolveEndpoint("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1/chat/completions");
  assert.throws(() => resolveEndpoint("http://api.example.test/v1"), /HTTPS/);
});

test("rejects a result when one option has no direct evidence citation", async () => {
  const content = {
    status: "answered",
    explanation: "Missing per-option citation.",
    confidence: "high",
    evidenceIds: ["E1"],
    optionAnalysis: [
      { key: "A", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "B", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "C", verdict: "refuted", rationale: "refuted", evidenceIds: [] }
    ],
    warnings: []
  };
  const result = await answerWithEvidence({
    payload: answerPayload(),
    settings,
    fetchImpl: mockFetch(content)
  });
  assert.equal(result.status, "uncertain");
  assert.deepEqual(result.answerKeys, []);
});

test("rejects citations that do not exist in the supplied evidence", async () => {
  const content = {
    status: "answered",
    explanation: "Unknown evidence reference.",
    confidence: "high",
    evidenceIds: ["E1"],
    optionAnalysis: [
      { key: "A", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "B", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "C", verdict: "refuted", rationale: "refuted", evidenceIds: ["E404"] }
    ],
    warnings: []
  };
  const result = await answerWithEvidence({
    payload: answerPayload(),
    settings,
    fetchImpl: mockFetch(content)
  });
  assert.equal(result.status, "uncertain");
});

test("defaults multi-select questions to at least two correct options", async () => {
  const content = {
    status: "answered",
    explanation: "Only one answer was returned.",
    confidence: "high",
    evidenceIds: ["E1"],
    optionAnalysis: [
      { key: "A", verdict: "supported", rationale: "supported", evidenceIds: ["E1"] },
      { key: "B", verdict: "refuted", rationale: "refuted", evidenceIds: ["E1"] },
      { key: "C", verdict: "refuted", rationale: "refuted", evidenceIds: ["E1"] }
    ],
    warnings: []
  };
  const payload = answerPayload();
  delete payload.multiAnswerMin;
  delete payload.multiAnswerMax;
  const result = await answerWithEvidence({
    payload,
    settings,
    fetchImpl: mockFetch(content)
  });
  assert.equal(result.status, "uncertain");
});

test("rejects duplicate option keys before calling the model", async () => {
  let called = false;
  const payload = answerPayload({
    options: [{key:"A",text:"AND"},{key:"A",text:"OR"}]
  });
  const result = await answerWithEvidence({
    payload,
    settings,
    fetchImpl: async () => { called = true; throw new Error("unexpected"); }
  });
  assert.equal(result.status, "uncertain");
  assert.equal(called, false);
});

test("redacts the API key from provider error details", async () => {
  const result = await answerWithEvidence({
    payload: answerPayload(),
    settings,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid credential test-key"
    })
  });
  assert.equal(result.status, "uncertain");
  assert.equal(result.explanation.includes("test-key"), false);
});
