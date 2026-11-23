"use strict";

const MAX_WORKSPACE_BYTES = 50 * 1024 * 1024;
const MAX_QUESTIONS = 50000;
const MAX_DOCUMENTS = 1000;
const MAX_PAGES_PER_DOCUMENT = 50000;
const MAX_PAGE_TEXT_LENGTH = 250000;

function assertHttpsOrEmpty(value, label) {
  const text = String(value || "").trim();
  if (!text) return;
  let parsed;
  try { parsed = new URL(text); }
  catch (_) { throw new Error(label + "不是有效 URL。"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(label + "必须是无凭据的 HTTPS 地址。");
  }
}

function validateQuestion(question, index) {
  const prefix = "第 " + (index + 1) + " 道题";
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new Error(prefix + "不是有效对象。");
  }
  if (!String(question.id || "").trim() || !String(question.stem || "").trim()) {
    throw new Error(prefix + "缺少题目 ID 或题干。");
  }
  if (!["single", "multi", "judge"].includes(question.type)) {
    throw new Error(prefix + "题型无效。");
  }
  if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 8) {
    throw new Error(prefix + "选项数量必须在 2 至 8 个之间。");
  }
  const keys = question.options.map((option) => String(option && option.key || "").trim().toUpperCase());
  if (keys.some((key) => !/^[A-H]$/.test(key)) || new Set(keys).size !== keys.length ||
      question.options.some((option) => !String(option && option.text || "").trim())) {
    throw new Error(prefix + "存在重复、无效或空白选项。");
  }
  if (!Array.isArray(question.answer)) throw new Error(prefix + "答案必须是数组。");
  const answers = question.answer.map((key) => String(key).trim().toUpperCase());
  if (new Set(answers).size !== answers.length || answers.some((key) => !keys.includes(key))) {
    throw new Error(prefix + "答案引用了不存在或重复的选项。");
  }

  const reviewStatus = question.reviewStatus === "verified" ? "verified" : "pending";
  if (reviewStatus === "verified") {
    const answerCountValid = question.type === "multi"
      ? answers.length >= 2 && answers.length <= keys.length
      : answers.length === 1;
    const source = question.source && typeof question.source === "object" ? question.source : {};
    if (!answerCountValid) throw new Error(prefix + "的已核验答案数量与题型不匹配。");
    if (!["A", "B"].includes(source.authority)) {
      throw new Error(prefix + "不能将 C 级或未知来源标记为正式已核验题目。");
    }
    if (source.confirmedByUser !== true) {
      throw new Error(prefix + "尚未由用户确认文件与来源元数据一致。");
    }
    if (!String(source.id || "").trim() || !String(source.title || "").trim() ||
        !Number.isInteger(Number(source.page)) || Number(source.page) < 1 ||
        String(source.quote || "").trim().length < 20) {
      throw new Error(prefix + "缺少来源编号、资料名称、原文页码或足够的原文摘录。");
    }
    assertHttpsOrEmpty(source.url, prefix + "来源链接");
  }
  return question;
}

function validateDocument(document, index) {
  const prefix = "第 " + (index + 1) + " 份资料";
  if (!document || typeof document !== "object" || Array.isArray(document) ||
      !String(document.id || "").trim()) {
    throw new Error(prefix + "缺少有效资料 ID。");
  }
  if (!Array.isArray(document.pages) || document.pages.length > MAX_PAGES_PER_DOCUMENT) {
    throw new Error(prefix + "页数组无效或超过数量限制。");
  }
  const authority = ["A", "B", "C"].includes(document.authority) ? document.authority : "C";
  assertHttpsOrEmpty(document.sourceUrl, prefix + "来源链接");
  const seenPages = new Set();
  const pages = document.pages.map((page, pageIndex) => {
    const number = Number(page && page.page) || (pageIndex + 1);
    const text = String(page && page.text || "");
    if (!Number.isInteger(number) || number < 1) throw new Error(prefix + "存在无效页码。");
    if (text.length > MAX_PAGE_TEXT_LENGTH) throw new Error(prefix + "单页文本超过长度限制。");
    if (seenPages.has(number)) throw new Error(prefix + "存在重复页码 " + number + "。");
    seenPages.add(number);
    return { ...page, page: number, text };
  });
  return { ...document, authority, pages };
}

function normalizeWorkspace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("工作区数据必须是对象。");
  }
  const questions = value.questions == null ? [] : value.questions;
  const documents = value.documents == null ? [] : value.documents;
  if (!Array.isArray(questions) || questions.length > MAX_QUESTIONS) {
    throw new Error("题库数组无效或超过数量限制。");
  }
  if (!Array.isArray(documents) || documents.length > MAX_DOCUMENTS) {
    throw new Error("知识资料数组无效或超过数量限制。");
  }
  const questionIds = new Set();
  const normalizedQuestions = questions.map((question, index) => {
    const validated = validateQuestion(question, index);
    const id = String(validated.id);
    if (questionIds.has(id)) throw new Error("题库中存在重复题目 ID：" + id);
    questionIds.add(id);
    return validated;
  });
  const documentIds = new Set();
  const normalizedDocuments = documents.map((document, index) => {
    const validated = validateDocument(document, index);
    const id = String(validated.id);
    if (documentIds.has(id)) throw new Error("知识库中存在重复资料 ID：" + id);
    documentIds.add(id);
    return validated;
  });
  const normalized = {
    schemaVersion: 1,
    questions: normalizedQuestions,
    documents: normalizedDocuments,
    savedAt: new Date().toISOString()
  };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_WORKSPACE_BYTES) {
    throw new Error("本地工作区超过 50 MB，请拆分资料后导入。");
  }
  return normalized;
}

module.exports = { normalizeWorkspace, validateQuestion, validateDocument, MAX_WORKSPACE_BYTES };
