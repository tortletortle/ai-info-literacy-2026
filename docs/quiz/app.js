(function () {
  "use strict";

  var STORAGE_KEY = "quizmind.local-question-bank.v1";
  var bank = [];
  var knowledgeDocs = [];
  var $ = function (id) { return document.getElementById(id); };

  var form = $("answerForm");
  var input = $("questionInput");
  var results = $("results");
  var answerBtn = $("answerBtn");
  var bankCount = $("bankCount");
  var charCount = $("charCount");
  var resultSummary = $("resultSummary");
  var importBtn = $("importBtn");
  var bankFile = $("bankFile");

  function cleanText(value) {
    return String(value || "").toLowerCase()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[，。！？；：、“”‘’（）()【】\[\]{}<>《》·…—\-_,.!?;:'"]/g, "");
  }

  function grams(value) {
    var text = Array.from(cleanText(value));
    var set = new Set();
    if (text.length < 2) {
      if (text.length) set.add(text[0]);
      return set;
    }
    for (var i = 0; i < text.length - 1; i++) set.add(text[i] + text[i + 1]);
    return set;
  }

  function similarity(a, b) {
    var aa = grams(a);
    var bb = grams(b);
    if (!aa.size || !bb.size) return 0;
    var intersection = 0;
    aa.forEach(function (item) { if (bb.has(item)) intersection++; });
    return intersection / (aa.size + bb.size - intersection);
  }

  function validateQuestion(q, index) {
    if (!q || typeof q !== "object") throw new Error("第 " + (index + 1) + " 条不是有效对象");
    if (!q.id || !q.stem || !Array.isArray(q.options) || !Array.isArray(q.answer)) {
      throw new Error("第 " + (index + 1) + " 条缺少 id、stem、options 或 answer 字段");
    }
    var keys = new Set();
    q.options.forEach(function (option) {
      if (!option || !option.key || !option.text) throw new Error("题目 " + q.id + " 的选项格式不正确");
      keys.add(String(option.key).toUpperCase());
    });
    q.answer.forEach(function (key) {
      if (!keys.has(String(key).toUpperCase())) throw new Error("题目 " + q.id + " 的答案引用了不存在的选项");
    });
    return {
      id: String(q.id),
      stem: String(q.stem),
      type: ["single", "multi", "judge"].indexOf(q.type) >= 0 ? q.type : "single",
      options: q.options.map(function (option) {
        return { key: String(option.key).toUpperCase(), text: String(option.text) };
      }),
      answer: q.answer.map(function (key) { return String(key).toUpperCase(); }),
      explanation: String(q.explanation || ""),
      source: q.source && typeof q.source === "object" ? {
        id: String(q.source.id || ""),
        title: String(q.source.title || "未注明来源"),
        url: String(q.source.url || ""),
        updatedAt: String(q.source.updatedAt || ""),
        page: Number.isFinite(Number(q.source.page)) ? Number(q.source.page) : null,
        quote: String(q.source.quote || "")
      } : { id: "", title: "未注明来源", url: "", updatedAt: "", page: null, quote: "" },
      module: q.module && typeof q.module === "object" ? {
        id: Number(q.module.id) || 0,
        category: String(q.module.category || ""),
        name: String(q.module.name || "")
      } : null,
      reviewStatus: q.reviewStatus === "verified" ? "verified" : "pending"
    };
  }

  function validateKnowledgeDocs(docs, meta) {
    if (!Array.isArray(docs)) throw new Error("知识库 JSON 缺少 documents 数组");
    meta = meta && typeof meta === "object" ? meta : {};
    return docs.map(function (doc, index) {
      if (!doc || !Array.isArray(doc.pages)) throw new Error("第 " + (index + 1) + " 份资料缺少 pages 数组");
      var source = doc.source && typeof doc.source === "object" ? doc.source : {};
      return {
        id:String(doc.id || ("DOC-" + (index + 1))),
        title:String(source.title || meta.name || "未命名资料"),
        sourceId:String(source.id || meta.sourceId || ""),
        sourceUrl:String(source.url || meta.sourceUrl || ""),
        revision:String(source.updatedAt || meta.revision || ""),
        pages:doc.pages.map(function (page, pageIndex) {
          return {
            page:Number(page.page) || (pageIndex + 1),
            text:String(page.text || "")
          };
        }).filter(function (page) { return page.text.trim().length > 0; })
      };
    });
  }

  function renderBankStatus() {
    var verified = bank.filter(function (q) { return q.reviewStatus === "verified"; }).length;
    var pageCount = knowledgeDocs.reduce(function (total, doc) { return total + doc.pages.length; }, 0);
    bankCount.textContent = "审核题目 " + verified + " 道 · 资料页 " + pageCount + " 页";
  }

  function setKnowledgeDocs(docs, meta) {
    knowledgeDocs = validateKnowledgeDocs(docs || [], meta || {});
    renderBankStatus();
  }

  function setBank(questions) {
    bank = questions.map(validateQuestion);
    renderBankStatus();
  }

  async function loadBank() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsedSaved = JSON.parse(saved);
        if (Array.isArray(parsedSaved)) {
          setBank(parsedSaved);
          setKnowledgeDocs([]);
        } else {
          setBank(parsedSaved.questions || []);
          setKnowledgeDocs(parsedSaved.documents || [], parsedSaved.meta || {});
        }
        return;
      }
    } catch (error) {
      console.warn("本地题库读取失败，将尝试加载内置题库。", error);
    }

    try {
      var response = await fetch("./data/questions.json", { cache: "no-store" });
      if (!response.ok) throw new Error("题库文件读取失败");
      var payload = await response.json();
      setBank(Array.isArray(payload) ? payload : payload.questions || []);
      if (!Array.isArray(payload)) setKnowledgeDocs(payload.documents || [], payload.meta || {});
    } catch (error) {
      bank = [];
      knowledgeDocs = [];
      bankCount.textContent = "题库暂不可用";
      console.error(error);
    }
  }

  function splitQuestions(raw) {
    var lines = raw.split(/\r?\n/);
    var starts = [];
    lines.forEach(function (line, index) {
      if (/^\s*(?:第\s*)?\d{1,3}\s*[、.．)）]\s*\S/.test(line) &&
          !/^\s*[A-H]\s*[、.．:：)]/.test(line)) starts.push(index);
    });
    if (starts.length > 1) {
      var numbered = [];
      for (var i = 0; i < starts.length; i++) {
        var end = i + 1 < starts.length ? starts[i + 1] : lines.length;
        var block = lines.slice(starts[i], end).join("\n").trim();
        if (block) numbered.push(block);
      }
      return numbered;
    }
    var paragraphs = raw.trim().split(/\n\s*\n/).map(function (part) { return part.trim(); }).filter(Boolean);
    if (paragraphs.length > 1 && paragraphs.every(function (part) { return part.length > 12; })) return paragraphs;
    return [raw.trim()];
  }

  function parseQuestion(raw) {
    var optionPattern = /^\s*(?:[（(]\s*)?([A-H])(?:\s*[）)])?\s*(?:[.、．:：]|\s{1,})\s*(.+?)\s*$/gm;
    var options = [];
    var match;
    while ((match = optionPattern.exec(raw)) !== null) {
      options.push({ key: match[1].toUpperCase(), text: match[2].trim() });
    }
    var stem = raw.replace(optionPattern, "").replace(/^\s*(?:第\s*)?\d{1,3}\s*[、.．)）]\s*/, "").trim();
    stem = stem.replace(/\n+/g, " ").replace(/\s+/g, " ");
    var type = "single";
    if (/判断题|判断下列|正确或错误|对错判断/.test(stem)) type = "judge";
    else if (/多选|多项选择|哪些|哪几项|所有正确/.test(stem)) type = "multi";
    return { raw: raw, stem: stem, options: options, type: type };
  }

  function optionSimilarity(queryOptions, bankOptions) {
    if (!queryOptions.length || !bankOptions.length) return 0.5;
    var total = 0;
    queryOptions.forEach(function (option) {
      var best = 0;
      bankOptions.forEach(function (candidate) {
        best = Math.max(best, similarity(option.text, candidate.text));
      });
      total += best;
    });
    return total / queryOptions.length;
  }

  function rankMatches(parsed) {
    return bank.filter(function (q) { return q.reviewStatus === "verified"; }).map(function (q) {
      var stemScore = similarity(parsed.stem, q.stem);
      var optionScore = optionSimilarity(parsed.options, q.options);
      var exact = cleanText(parsed.stem) === cleanText(q.stem);
      var contains = cleanText(parsed.stem).length >= 10 &&
        (cleanText(parsed.stem).indexOf(cleanText(q.stem)) >= 0 || cleanText(q.stem).indexOf(cleanText(parsed.stem)) >= 0);
      var score = exact ? 1 : Math.min(1, stemScore * 0.82 + optionScore * 0.18);
      if (contains) score = Math.max(score, 0.96);
      return { question: q, score: score, stemScore: stemScore, optionScore: optionScore, exact: exact || contains };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function mapAnswerToInputOptions(question, parsed) {
    var answerOptions = question.options.filter(function (option) { return question.answer.indexOf(option.key) >= 0; });
    if (!parsed.options.length) {
      return {
        items: answerOptions.map(function (option) { return { key: option.key, text: option.text }; }),
        aligned: true
      };
    }
    var mapped = [];
    var allAligned = true;
    answerOptions.forEach(function (answerOption) {
      var best = { score: 0, option: null };
      parsed.options.forEach(function (inputOption) {
        var score = similarity(answerOption.text, inputOption.text);
        if (score > best.score) best = { score: score, option: inputOption };
      });
      if (best.option && best.score >= 0.72) {
        mapped.push({ key: best.option.key, text: best.option.text });
      } else {
        allAligned = false;
        mapped.push({ key: "", text: answerOption.text });
      }
    });
    return { items: mapped, aligned: allAligned };
  }

  function makeElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function queryCoverage(query, text) {
    var queryGrams = grams(query);
    var textGrams = grams(text);
    if (!queryGrams.size || !textGrams.size) return 0;
    var overlap = 0;
    queryGrams.forEach(function (gram) { if (textGrams.has(gram)) overlap++; });
    return overlap / queryGrams.size;
  }

  function retrieveEvidence(parsed) {
    if (!knowledgeDocs.length) return [];
    var query = parsed.stem + " " + parsed.options.map(function (option) { return option.text; }).join(" ");
    var evidence = [];
    knowledgeDocs.forEach(function (doc) {
      doc.pages.forEach(function (page) {
        var text = page.text.replace(/\s+/g," ").trim();
        var windowSize = 520;
        var step = 360;
        if (text.length <= windowSize) {
          var score = queryCoverage(query,text);
          if (score >= 0.12) evidence.push({doc:doc,page:page.page,text:text,score:score});
          return;
        }
        for (var offset = 0; offset < text.length; offset += step) {
          var chunk = text.slice(offset,offset + windowSize);
          var chunkScore = queryCoverage(query,chunk);
          if (chunkScore >= 0.12) evidence.push({doc:doc,page:page.page,text:chunk,score:chunkScore});
        }
      });
    });
    evidence.sort(function (a,b) { return b.score-a.score; });
    var unique = [];
    var seen = new Set();
    evidence.forEach(function (item) {
      var key = item.doc.id + ":" + item.page;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    });
    return unique.slice(0,3);
  }

  function renderMiss(parsed, index, reason, evidence) {
    evidence = evidence || [];
    var card = makeElement("article", "result-card");
    var head = makeElement("div", "result-card-head");
    head.appendChild(makeElement("strong", "", "第 " + (index + 1) + " 题"));
    head.appendChild(makeElement("span", "status-pill status-miss", "原题未命中"));
    card.appendChild(head);
    var body = makeElement("div", "result-body");
    body.appendChild(makeElement("p", "result-question", parsed.raw));
    var box = makeElement("div", "miss-box");
    if (evidence.length) {
      box.appendChild(makeElement("strong", "", "原题未命中，但资料库找到相关片段。"));
      box.appendChild(makeElement("p", "", "以下内容是检索线索，不是自动判定的标准答案；当前版本尚未连接 AI 推理服务，请按原文核对各个选项。"));
    } else {
      box.appendChild(makeElement("strong", "", reason || "当前审核题库中没有足够可靠的匹配结果。"));
      box.appendChild(makeElement("p", "", "本版本尚未连接 AI 知识检索服务，因此不会猜测答案。请核对题干，或导入经过审核的题库与资料库。"));
    }
    body.appendChild(box);

    evidence.forEach(function (item) {
      var details = makeElement("details", "evidence-details");
      details.appendChild(makeElement("summary", "", item.doc.title + " · 第 " + item.page + " 页 · 相关度 " + Math.round(item.score * 100) + "%"));
      details.appendChild(makeElement("p", "", item.text));
      if (item.doc.sourceUrl && /^https:\/\/[^ ]+$/i.test(item.doc.sourceUrl)) {
        var link = makeElement("a", "", "打开来源网页");
        link.href = item.doc.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        details.appendChild(link);
      }
      body.appendChild(details);
    });

    card.appendChild(body);
    return card;
  }
  function renderHit(match, parsed, index, ambiguous) {
    var q = match.question;
    var mapped = mapAnswerToInputOptions(q, parsed);
    var card = makeElement("article", "result-card");
    var head = makeElement("div", "result-card-head");
    head.appendChild(makeElement("strong", "", "第 " + (index + 1) + " 题 · " + q.id));
    head.appendChild(makeElement("span", "status-pill status-hit", (match.exact ? "题干匹配" : "相似匹配") + " " + Math.round(match.score * 100) + "%"));
    card.appendChild(head);

    var body = makeElement("div", "result-body");
    body.appendChild(makeElement("p", "result-question", parsed.raw));
    body.appendChild(makeElement("div", "answer-label", "匹配到的标准答案"));
    var answerLines = makeElement("div", "answer-lines");
    mapped.items.forEach(function (item) {
      var line = makeElement("div", "answer-item");
      if (item.key) line.appendChild(makeElement("b", "", item.key + "."));
      line.appendChild(document.createTextNode(item.text));
      answerLines.appendChild(line);
    });
    body.appendChild(answerLines);

    if (ambiguous) {
      var warning = makeElement("div", "miss-box");
      warning.appendChild(makeElement("strong", "", "存在相近题目，当前匹配不唯一。"));
      warning.appendChild(makeElement("p", "", "请核对题干和选项，不要直接把该结果当作确定答案。"));
      body.appendChild(warning);
    } else if (!mapped.aligned) {
      var note = makeElement("div", "miss-box");
      note.appendChild(makeElement("strong", "", "选项内容未能完全对齐。"));
      note.appendChild(makeElement("p", "", "上方显示的是题库中的正确选项内容，请按内容核对，不要仅依据选项字母作答。"));
      body.appendChild(note);
    }

    if (q.explanation) {
      var explanation = makeElement("div", "explanation");
      explanation.appendChild(makeElement("strong", "", "解析"));
      explanation.appendChild(makeElement("p", "", q.explanation));
      body.appendChild(explanation);
    }

    var source = makeElement("div", "source-line");
    source.appendChild(makeElement("span", "", "来源：" + q.source.title));
    if (q.module && q.module.name) source.appendChild(makeElement("span", "", "模块：" + q.module.name));
    if (q.source.page) source.appendChild(makeElement("span", "", "原文页码：" + q.source.page));
    if (q.source.updatedAt) source.appendChild(makeElement("span", "", "资料版本：" + q.source.updatedAt));
    if (/^https:\/\/[^ ]+$/i.test(q.source.url)) {
      var link = makeElement("a", "", "查看来源");
      link.href = q.source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      source.appendChild(link);
    }
    body.appendChild(source);
    if (q.source.quote) {
      var evidence = makeElement("details", "evidence-details");
      evidence.appendChild(makeElement("summary", "", "查看原文证据"));
      evidence.appendChild(makeElement("p", "", q.source.quote));
      body.appendChild(evidence);
    }
    card.appendChild(body);
    return card;
  }

  function answerQuestions(raw) {
    var blocks = splitQuestions(raw);
    results.replaceChildren();
    var hitCount = 0;
    var missCount = 0;

    blocks.forEach(function (block, index) {
      var parsed = parseQuestion(block);
      if (!parsed.stem) {
        missCount++;
        results.appendChild(renderMiss(parsed, index, "未能识别题干，请检查粘贴内容。", []));
        return;
      }
      var ranked = rankMatches(parsed);
      var best = ranked[0];
      var second = ranked[1];
      var threshold = parsed.options.length ? 0.68 : 0.76;
      if (!best || best.score < threshold) {
        missCount++;
        results.appendChild(renderMiss(parsed, index, null, retrieveEvidence(parsed)));
        return;
      }
      var ambiguous = !!(second && second.score >= threshold && best.score - second.score < 0.045 && !best.exact);
      if (ambiguous) {
        missCount++;
      } else {
        hitCount++;
      }
      results.appendChild(renderHit(best, parsed, index, ambiguous));
    });

    resultSummary.textContent = blocks.length + " 道题 · 命中 " + hitCount + " · 待核对 " + missCount;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var raw = input.value.trim();
    if (!raw) {
      input.focus();
      return;
    }
    answerBtn.disabled = true;
    answerBtn.querySelector("span").textContent = "检索中…";
    window.setTimeout(function () {
      try {
        answerQuestions(raw);
      } finally {
        answerBtn.disabled = false;
        answerBtn.querySelector("span").textContent = "开始答题";
      }
    }, 30);
  });

  input.addEventListener("input", function () {
    charCount.textContent = Array.from(input.value).length + " 字";
  });

  importBtn.addEventListener("click", function () { bankFile.click(); });
  bankFile.addEventListener("change", function () {
    var file = bankFile.files && bankFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var payload = JSON.parse(String(reader.result || ""));
        var importedQuestions = Array.isArray(payload) ? payload : payload.questions;
        var importedDocuments = !Array.isArray(payload) && Array.isArray(payload.documents) ? payload.documents : null;
        if (!Array.isArray(importedQuestions) && !importedDocuments) {
          throw new Error("JSON 顶层必须包含 questions 或 documents 数组");
        }
        if (Array.isArray(importedQuestions)) bank = importedQuestions.map(validateQuestion);
        if (importedDocuments) knowledgeDocs = validateKnowledgeDocs(importedDocuments,payload.meta || {});
        localStorage.setItem(STORAGE_KEY,JSON.stringify({questions:bank,documents:knowledgeDocs}));
        renderBankStatus();
        resultSummary.textContent = "数据导入成功";
        results.replaceChildren();
        var message = makeElement("div", "empty-state");
        message.appendChild(makeElement("strong", "", "数据导入成功"));
        var verifiedCount = bank.filter(function (q) { return q.reviewStatus === "verified"; }).length;
        var pageCount = knowledgeDocs.reduce(function (total, doc) { return total + doc.pages.length; }, 0);
        message.appendChild(makeElement("p", "", "当前浏览器已载入 " + verifiedCount + " 道已审核题目和 " + pageCount + " 页资料。未审核题目不会作为标准答案。"));
        results.appendChild(message);
      } catch (error) {
        window.alert("数据导入失败：" + error.message);
      }
      bankFile.value = "";
    };
    reader.readAsText(file, "utf-8");
  });

  loadBank();
})();