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
      { key: "A", verdict: "supported", rationale: "资料明确列出 AND。" },
      { key: "B", verdict: "supported", rationale: "资料明确列出 OR。" },
      { key: "C", verdict: "refuted", rationale: "资料说明 Excel 是电子表格软件。" }
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
      { key: "A", verdict: "supported", rationale: "supported" },
      { key: "B", verdict: "supported", rationale: "supported" }
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
      { key: "A", verdict: "supported", rationale: "supported" },
      { key: "B", verdict: "refuted", rationale: "refuted" },
      { key: "C", verdict: "refuted", rationale: "refuted" }
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