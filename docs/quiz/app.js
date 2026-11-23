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
        authority: ["A","B","C"].indexOf(q.source.authority) >= 0 ? q.source.authority : "C",
        title: String(q.source.title || "未注明来源"),
        url: String(q.source.url || ""),
        confirmedByUser: q.source.confirmedByUser === true,
        updatedAt: String(q.source.updatedAt || ""),
        page: Number.isFinite(Number(q.source.page)) ? Number(q.source.page) : null,
        quote: String(q.source.quote || "")
      } : { id: "", authority: "C", title: "未注明来源", url: "", updatedAt: "", page: null, quote: "" },
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
      var declaredAuthority = doc.declaredAuthority || source.authority || doc.authority || meta.authority || "C";
      var sourceConfirmed = doc.sourceConfirmedByUser === true ||
        source.confirmedByUser === true || meta.sourceConfirmedByUser === true;
      var validAuthority = ["A","B","C"].indexOf(declaredAuthority) >= 0 ? declaredAuthority : "C";
      return {
        id:String(doc.id || ("DOC-" + (index + 1))),
        title:String(source.title || doc.title || meta.name || "未命名资料"),
        sourceId:String(source.id || doc.sourceId || meta.sourceId || ""),
        authority:sourceConfirmed ? validAuthority : "C",
        declaredAuthority:validAuthority,
        sourceUrl:String(source.url || doc.sourceUrl || meta.sourceUrl || ""),
        sourceConfirmedByUser:sourceConfirmed,
        originalFile:String(doc.originalFile || meta.originalFile || ""),
        revision:String(source.updatedAt || doc.revision || meta.revision || ""),
        pages:(function () {
          var seenPages = new Set();
          return doc.pages.map(function (page, pageIndex) {
            if (!page || typeof page !== "object" || Array.isArray(page)) {
              throw new Error("第 " + (index + 1) + " 份资料存在无效页面记录");
            }
            var pageNumber = page.page == null ? pageIndex + 1 : Number(page.page);
            if (!Number.isInteger(pageNumber) || pageNumber < 1) {
              throw new Error("第 " + (index + 1) + " 份资料存在无效页码");
            }
            if (seenPages.has(pageNumber)) {
              throw new Error("第 " + (index + 1) + " 份资料存在重复页码 " + pageNumber);
            }
            seenPages.add(pageNumber);
            return { page:pageNumber, text:String(page.text || "") };
          }).filter(function (page) { return page.text.trim().length > 0; });
        })()
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

  async function persistWorkspaceData() {
    var payload = { questions:bank, documents:knowledgeDocs };
    if (window.quizMindDesktop && window.quizMindDesktop.saveWorkspaceData) {
      return window.quizMindDesktop.saveWorkspaceData(payload);
    }
    localStorage.setItem(STORAGE_KEY,JSON.stringify(payload));
    return {ok:true};
  }

  function setBank(questions) {
    bank = questions.map(validateQuestion);
    renderBankStatus();
  }

  async function loadBank() {
    try {
      var saved = null;
      if (window.quizMindDesktop && window.quizMindDesktop.loadWorkspaceData) {
        saved = await window.quizMindDesktop.loadWorkspaceData();
      } else {
        var savedText = localStorage.getItem(STORAGE_KEY);
        if (savedText) saved = JSON.parse(savedText);
      }
      if (saved) {
        if (Array.isArray(saved)) {
          setBank(saved);
          setKnowledgeDocs([]);
        } else {
          setBank(saved.questions || []);
          setKnowledgeDocs(saved.documents || [], saved.meta || {});
        }
        return;
      }
    } catch (error) {
      console.warn("本地工作区读取失败，将尝试加载内置题库。", error);
    }

    try {
      var payload;
      if (window.quizMindDesktop && window.quizMindDesktop.loadBuiltinQuestions) {
        payload = await window.quizMindDesktop.loadBuiltinQuestions();
      } else {
        var response = await fetch("./data/questions.json", { cache: "no-store" });
        if (!response.ok) throw new Error("题库文件读取失败");
        payload = await response.json();
      }
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
    if (/判断题|判断下列|正确或错误|对错判断/.test(stem) ||
        (!options.length && /[（(]\s*[√×对错]?\s*[）)]\s*$/.test(stem))) type = "judge";
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

  function renderMiss(parsed, index, reason, evidence, apiMessage) {
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
      box.appendChild(makeElement("strong", "", apiMessage ? "资料库找到相关片段，但 AI 推理未能完成。" : "原题未命中，资料库找到相关片段。"));
      box.appendChild(makeElement("p", "", apiMessage || "以下是检索线索；系统尚未完成逐项证据核验，因此不会把片段直接当作答案。"));
    } else {
      box.appendChild(makeElement("strong", "", reason || "当前审核题库和本地资料库都没有找到足够可靠的依据。"));
      box.appendChild(makeElement("p", "", apiMessage || "系统没有可核验的资料证据，因此不会猜测答案。请导入官方资料或经过审核的题库。"));
    }
    body.appendChild(box);

    evidence.forEach(function (item) {
      var details = makeElement("details", "evidence-details");
      details.appendChild(makeElement("summary", "", "[" + item.doc.authority + "] " + item.doc.title + " · 第 " + item.page + " 页 · 相关度 " + Math.round(item.score * 100) + "%"));
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

    if (apiMessage && /API Key|模型名称|模型 API/.test(apiMessage) && window.quizMindDesktop) {
      var settingsLink = makeElement("a", "evidence-settings-link", "打开 AI 设置");
      settingsLink.href = "./settings.html";
      body.appendChild(settingsLink);
    }

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
    source.appendChild(makeElement("span", "", "来源等级：" + q.source.authority));
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

  async function callAnswerAPI(parsed, evidence) {
    var options = parsed.options.length ? parsed.options :
      (parsed.type === "judge" ? [{key:"A",text:"正确"},{key:"B",text:"错误"}] : []);
    if (!options.length) return {status:"unavailable",message:"没有识别到选项，无法逐项核验。"};

    var isDesktop = !!(window.quizMindDesktop && window.quizMindDesktop.answerQuestion);
    var evidencePayload = (evidence || []).map(function (item,index) {
      return {
        id:"E" + (index + 1),
        title:item.doc.title,
        url:item.doc.sourceUrl,
        page:item.page,
        sourceId:item.doc.sourceId,
        authority:item.doc.authority,
        text:item.text
      };
    });

    try {
      var requestPayload = {
        question:parsed.stem,
        type:parsed.type,
        options:options
      };
      if (!isDesktop) requestPayload.evidence = evidencePayload;

      var data;
      if (isDesktop) {
        data = await window.quizMindDesktop.answerQuestion(requestPayload);
      } else {
        var response = await fetch("/api/answer",{
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify(requestPayload)
        });
        data = await response.json();
        if (!response.ok) {
          var message = data.message || data.error || "答题服务暂不可用。";
          if (response.status === 503 && data.error === "LLM_NOT_CONFIGURED") message = "服务端模型尚未配置。";
          if (response.status === 404) message = "AI 答题 API 尚未部署。";
          return {status:"unavailable",message:message,evidencePayload:evidencePayload};
        }
      }
      var returnedEvidence = isDesktop && Array.isArray(data.evidencePayload)
        ? data.evidencePayload
        : evidencePayload;
      return {
        status:data.status === "answered" ? "answered" : "uncertain",
        data:data,
        options:options,
        evidencePayload:returnedEvidence,
        message:data.explanation || "现有证据不足，系统拒绝输出答案。"
      };
    } catch (error) {
      return {
        status:"unavailable",
        message:error.message || "AI 服务暂不可用。",
        evidencePayload:evidencePayload
      };
    }
  }

  function renderAIResult(parsed,index,ai,evidence) {
    var data = ai.data;
    var options = ai.options;
    var answerKeys = Array.isArray(data.answerKeys) ? data.answerKeys : [];
    var selected = options.filter(function (option) { return answerKeys.indexOf(option.key) >= 0; });
    if (!selected.length) return renderMiss(parsed,index,"AI 推理结果未通过答案映射校验。",evidence,"服务端未返回可映射的答案选项。");

    var card = makeElement("article","result-card");
    var head = makeElement("div","result-card-head");
    head.appendChild(makeElement("strong","","第 " + (index + 1) + " 题 · AI 证据推理"));
    head.appendChild(makeElement("span","status-pill status-hit","逐项引用齐全 · 模型自评 " + (data.confidence || "low")));
    card.appendChild(head);

    var body = makeElement("div","result-body");
    body.appendChild(makeElement("p","result-question",parsed.raw));
    body.appendChild(makeElement("div","answer-label","基于导入资料的推理答案"));
    var answerLines = makeElement("div","answer-lines");
    selected.forEach(function (option) {
      var line = makeElement("div","answer-item");
      line.appendChild(makeElement("b","",option.key + "."));
      line.appendChild(document.createTextNode(option.text));
      answerLines.appendChild(line);
    });
    body.appendChild(answerLines);

    if (data.explanation) {
      var explanation = makeElement("div","explanation");
      explanation.appendChild(makeElement("strong","","解析"));
      explanation.appendChild(makeElement("p","",data.explanation));
      body.appendChild(explanation);
    }

    var evidenceMap = new Map(ai.evidencePayload.map(function (item) { return [item.id,item]; }));
    if (Array.isArray(data.optionAnalysis) && data.optionAnalysis.length) {
      var analysisDetails = makeElement("details","evidence-details");
      analysisDetails.appendChild(makeElement("summary","","展开逐项判断与对应证据"));
      data.optionAnalysis.forEach(function (item) {
        var verdict = item.verdict === "supported" ? "支持" : item.verdict === "refuted" ? "排除" : "证据不足";
        analysisDetails.appendChild(makeElement("p","",item.key + " · " + verdict + "：" + item.rationale));
        (Array.isArray(item.evidenceIds) ? item.evidenceIds : []).forEach(function (id) {
          var cited = evidenceMap.get(id);
          if (!cited) return;
          analysisDetails.appendChild(makeElement("small","option-evidence-ref",
            "对应证据：" + cited.title + " · 第 " + cited.page + " 页 · [" + cited.authority + "]"));
        });
      });
      body.appendChild(analysisDetails);
    }


    (data.evidenceIds || []).forEach(function (id) {
      var item = evidenceMap.get(id);
      if (!item) return;
      var details = makeElement("details","evidence-details");
      details.appendChild(makeElement("summary","", "[" + (item.authority || "C") + "] " + item.title + " · 第 " + item.page + " 页"));
      details.appendChild(makeElement("p","",item.text));
      if (item.url && /^https:\/\/[^ ]+$/i.test(item.url)) {
        var link = makeElement("a","","打开来源网页");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        details.appendChild(link);
      }
      body.appendChild(details);
    });

    if (Array.isArray(data.warnings) && data.warnings.length) {
      body.appendChild(makeElement("div","miss-box","提示：" + data.warnings.join("；")));
    }
    card.appendChild(body);
    return card;
  }

  async function answerQuestions(raw) {
    var blocks = splitQuestions(raw);
    results.replaceChildren();
    var bankHitCount = 0;
    var aiAnswerCount = 0;
    var missCount = 0;

    for (var index = 0; index < blocks.length; index++) {
      var parsed = parseQuestion(blocks[index]);
      if (!parsed.stem) {
        missCount++;
        results.appendChild(renderMiss(parsed,index,"未能识别题干，请检查粘贴内容。",[]));
        continue;
      }

      var ranked = rankMatches(parsed);
      var best = ranked[0];
      var second = ranked[1];
      var threshold = parsed.options.length ? 0.68 : 0.76;
      var ambiguous = !!(best && second && second.score >= threshold &&
        best.score - second.score < 0.045 && !best.exact);

      if (best && best.score >= threshold && !ambiguous) {
        bankHitCount++;
        results.appendChild(renderHit(best,parsed,index,false));
        continue;
      }

      var desktopMode = !!(window.quizMindDesktop && window.quizMindDesktop.answerQuestion);
      var evidence = desktopMode ? [] : retrieveEvidence(parsed);
      if (!desktopMode && !evidence.length) {
        missCount++;
        results.appendChild(renderMiss(parsed,index,ambiguous ? "发现多个相近题目，无法唯一匹配。" : null,[]));
        continue;
      }

      var ai = await callAnswerAPI(parsed,evidence);
      var usedEvidence = ai.evidencePayload || evidence;
      if (ai.status === "answered") {
        aiAnswerCount++;
        results.appendChild(renderAIResult(parsed,index,ai,usedEvidence));
      } else {
        missCount++;
        results.appendChild(renderMiss(parsed,index,null,usedEvidence,ai.message));
      }
    }

    resultSummary.textContent = blocks.length + " 道题 · 题库命中 " + bankHitCount +
      " · AI证据推理 " + aiAnswerCount + " · 待核对 " + missCount;
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
    window.setTimeout(async function () {
      try {
        await answerQuestions(raw);
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
    reader.onload = async function () {
      try {
        var payload = JSON.parse(String(reader.result || ""));
        var importedQuestions = Array.isArray(payload) ? payload : payload.questions;
        var importedDocuments = !Array.isArray(payload) && Array.isArray(payload.documents) ? payload.documents : null;
        if (!Array.isArray(importedQuestions) && !importedDocuments) {
          throw new Error("JSON 顶层必须包含 questions 或 documents 数组");
        }
        if (!Array.isArray(payload) && payload.questions != null && !Array.isArray(payload.questions)) {
          throw new Error("questions 字段必须是数组");
        }
        if (!Array.isArray(payload) && payload.documents != null && !Array.isArray(payload.documents)) {
          throw new Error("documents 字段必须是数组");
        }

        var validatedQuestions = Array.isArray(importedQuestions)
          ? importedQuestions.map(validateQuestion)
          : [];
        var validatedDocuments = importedDocuments
          ? validateKnowledgeDocs(importedDocuments,payload.meta || {})
          : [];
        var importedQuestionCount = validatedQuestions.length;
        var importedDocumentCount = validatedDocuments.length;

        var questionMap = new Map(bank.map(function (question) { return [question.id,question]; }));
        validatedQuestions.forEach(function (question) {
          questionMap.set(question.id,question);
        });
        var documentMap = new Map(knowledgeDocs.map(function (document) { return [document.id,document]; }));
        validatedDocuments.forEach(function (document) {
          documentMap.set(document.id,document);
        });

        var previousBank = bank;
        var previousDocuments = knowledgeDocs;
        bank = Array.from(questionMap.values());
        knowledgeDocs = Array.from(documentMap.values());
        try {
          await persistWorkspaceData();
        } catch (saveError) {
          bank = previousBank;
          knowledgeDocs = previousDocuments;
          throw saveError;
        }
        renderBankStatus();
        resultSummary.textContent = "数据合并成功";
        results.replaceChildren();
        var message = makeElement("div", "empty-state");
        message.appendChild(makeElement("strong", "", "数据合并成功"));
        var verifiedCount = bank.filter(function (q) { return q.reviewStatus === "verified"; }).length;
        var pageCount = knowledgeDocs.reduce(function (total, doc) { return total + doc.pages.length; }, 0);
        message.appendChild(makeElement("p", "", "本次合并题目 " + importedQuestionCount + " 道、资料 " + importedDocumentCount + " 份；当前共有 " + verifiedCount + " 道已审核题目和 " + pageCount + " 页资料。重复 ID 会更新对应记录，不会清空其他数据。"));
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