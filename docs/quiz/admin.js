(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var selectedFile = null;
  var candidates = [];
  var modules = [];
  var lastExtractedText = "";
  var lastPages = [];
  var pdfjsReady = (async function () {
    if (window.quizMindDesktop) {
      var localPdfjs = await import("./vendor/pdf.mjs");
      localPdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
      return localPdfjs;
    }
    var remotePdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.mjs");
    remotePdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.worker.mjs";
    return remotePdfjs;
  })();

  var sourceFile = $("sourceFile");
  var fileName = $("fileName");
  var extractBtn = $("extractBtn");
  var importStatus = $("importStatus");
  var candidateResults = $("candidateResults");
  var candidateCount = $("candidateCount");
  var downloadBtn = $("downloadBtn");
  var downloadKnowledgeBtn = $("downloadKnowledgeBtn");
  var saveLocalBtn = $("saveLocalBtn");
  var backupWorkspaceBtn = $("backupWorkspaceBtn");

  function cleanLine(value) {
    return String(value || "").replace(/\u3000/g, " ").trim();
  }

  function getPageNumber(line, currentPage) {
    var match = line.match(/<<<PAGE\s*:\s*(\d+)>>>/) || line.match(/^=+\s*PAGE\s+(\d+)\s*=+$/);
    return match ? Number(match[1]) : currentPage;
  }

  function isModuleHeading(line) {
    var match = line.match(/^\s*知识模块\s*0*(\d+)\s*[：:]\s*(.+)$/);
    if (!match) return null;
    if (/\.{3,}|…{2,}|-\s*\d+\s*-/.test(match[2])) return null;
    return { id:Number(match[1]), name:cleanLine(match[2]) };
  }

  function optionLine(line) {
    return line.match(/^\s*(?:[（(]\s*)?([A-H])(?:\s*[）)])?\s*[、.．:：]\s*(.*?)\s*$/);
  }

  function parseBlock(block, index) {
    var lines = block.lines.map(cleanLine).filter(function (line) {
      return line &&
        !/^<<<PAGE\s*:/.test(line) &&
        !/^=+\s*PAGE\s+\d+\s*=+$/.test(line) &&
        !/^\s*-\s*\d+\s*-\s*$/.test(line);
    });
    var answerIndex = lines.findIndex(function (line) { return /^正确答案\s*[：:]/.test(line); });
    var explanationIndex = lines.findIndex(function (line) { return /^答案解析\s*[：:]/.test(line); });
    var contentEnd = answerIndex >= 0 ? answerIndex : (explanationIndex >= 0 ? explanationIndex : lines.length);
    var stemLines = [];
    var options = [];
    var currentOption = null;
    var inlineOptionPattern = /(?:^|\s)([A-H])\s*[、.．:：]\s*/g;

    for (var i = 0; i < contentEnd; i++) {
      var line = lines[i];
      var matches = [];
      var match;
      inlineOptionPattern.lastIndex = 0;
      while ((match = inlineOptionPattern.exec(line)) !== null) {
        matches.push({key:match[1].toUpperCase(),start:match.index,end:inlineOptionPattern.lastIndex});
      }

      if (!matches.length) {
        if (currentOption) currentOption.text = (currentOption.text + " " + line).trim();
        else stemLines.push(line);
        continue;
      }

      var prefix = line.slice(0,matches[0].start).trim();
      if (prefix) {
        if (currentOption) currentOption.text = (currentOption.text + " " + prefix).trim();
        else stemLines.push(prefix);
      }

      for (var j = 0; j < matches.length; j++) {
        var optionTextStart = matches[j].end;
        var optionTextEnd = j + 1 < matches.length ? matches[j + 1].start : line.length;
        var optionText = line.slice(optionTextStart,optionTextEnd).trim();
        currentOption = {key:matches[j].key,text:optionText};
        options.push(currentOption);
      }
    }

    var stem = stemLines.join(" ").replace(/\s+/g," ").trim();
    var answerText = "";
    if (answerIndex >= 0) answerText = lines[answerIndex].replace(/^正确答案\s*[：:]\s*/,"").trim();
    var type = block.type === "单选题" ? "single" : block.type === "多选题" ? "multi" : "judge";
    var answer = [];
    if (type === "judge") {
      if (!options.length) options = [{key:"A",text:"正确"},{key:"B",text:"错误"}];
      var normalizedAnswer = answerText.replace(/\s/g,"");
      if (/错误|不正确|否|错/.test(normalizedAnswer)) answer = ["B"];
      else if (/正确|是|对/.test(normalizedAnswer)) answer = ["A"];
      else answer = (answerText.match(/[A-H]/gi) || []).map(function (key) { return key.toUpperCase(); });
    } else {
      answer = (answerText.match(/[A-H]/gi) || []).map(function (key) { return key.toUpperCase(); });
    }
    answer = Array.from(new Set(answer));
    var answerKeysAvailable = answer.every(function (key) {
      return options.some(function (option) { return option.key === key; });
    });
    if (!answerKeysAvailable) answer = [];

    var explanation = "";
    if (explanationIndex >= 0) {
      explanation = lines.slice(explanationIndex).join("\n").replace(/^答案解析\s*[：:]\s*/,"").trim();
    }
    if (!stem || stem.length < 8) return null;

    var module = modules.find(function (item) { return item.id === block.moduleId; });
    var sourceTitle = $("sourceTitle").value.trim();
    var sourceUrl = $("sourceUrl").value.trim();
    var sourceIdInput = $("sourceId").value.trim();
    var sourceId = sourceIdInput || "SRC-UNKNOWN";
    var revision = $("sourceRevision").value.trim();
    var authority = $("sourceAuthority").value || "C";
    var sourceConfirmed = $("sourceConfirmed").checked === true;
    var sourceUrlReady = !sourceUrl || /^https:\/\//i.test(sourceUrl);
    var quote = block.lines.join("\n").slice(0,1600);
    var optionKeys = options.map(function (option) { return option.key; });
    var uniqueOptions = new Set(optionKeys).size === optionKeys.length &&
      options.every(function (option) { return /^[A-H]$/.test(option.key) && option.text.trim().length > 0; });
    var answerShapeValid = type === "single" ? answer.length === 1 :
      type === "multi" ? answer.length >= 2 && answer.length <= options.length : answer.length === 1;
    var sourceReady = (authority === "A" || authority === "B") &&
      sourceTitle.length > 0 && sourceIdInput.length > 0 && sourceUrlReady &&
      sourceConfirmed && block.page > 0 && quote.trim().length >= 20;
    var canVerify = options.length >= 2 && options.length <= 8 &&
      uniqueOptions && answerShapeValid && sourceReady;
    var safeSourceId = sourceId.replace(/[^A-Za-z0-9_-]/g,"").slice(0,32) || "SRC";

    return {
      id:safeSourceId + "-M" + String(block.moduleId || 0).padStart(2,"0") + "-" + String(index).padStart(3,"0"),
      stem:stem,
      type:type,
      options:options,
      answer:answer,
      extractedAnswerText:answerText,
      explanation:explanation,
      module:module ? {id:module.id,category:module.category,name:module.name} : {id:block.moduleId || 0,name:"待归类"},
      source:{
        id:sourceId,
        authority:authority,
        title:sourceTitle || "未注明资料",
        url:sourceUrl,
        confirmedByUser:sourceConfirmed,
        updatedAt:revision,
        page:block.page,
        quote:quote
      },
      reviewStatus:"pending",
      canVerify:canVerify,
      extractionWarnings:[
        answer.length ? "" : "未识别到可用答案，需人工核对",
        options.length >= 2 ? "" : "未识别到完整选项，需人工核对",
        uniqueOptions ? "" : "选项编号重复、格式无效或选项内容为空",
        answerShapeValid ? "" : "答案数量与题型不匹配",
        sourceReady ? "" : "来源等级、资料名称、来源编号、HTTPS 来源链接、来源一致性确认、原文页码或原文摘录不足，不能核验",
        block.moduleId ? "" : "未识别到知识模块编号"
      ].filter(Boolean)
    };
  }
  function splitPages(text) {
    var pattern = /<<<PAGE\s*:\s*(\d+)>>>\s*([\s\S]*?)(?=<<<PAGE\s*:\s*\d+>>>|$)/g;
    var pages = [];
    var match;
    while ((match = pattern.exec(text)) !== null) {
      pages.push({page:Number(match[1]),text:match[2].trim()});
    }
    if (!pages.length && String(text || "").trim()) pages.push({page:1,text:String(text).trim()});
    return pages;
  }

  function parseDocumentText(text) {
    var lines = String(text || "").split(/\r?\n/);
    var active = null;
    var currentModuleId = null;
    var currentPage = 1;
    var counts = {};
    var found = [];

    function flush() {
      if (!active) return;
      var nextIndex = (counts[active.moduleId] || 0) + 1;
      counts[active.moduleId] = nextIndex;
      var candidate = parseBlock(active, nextIndex);
      if (candidate) found.push(candidate);
      active = null;
    }

    lines.forEach(function (line) {
      currentPage = getPageNumber(line, currentPage);
      var moduleHeading = isModuleHeading(line);
      if (moduleHeading) {
        flush();
        currentModuleId = moduleHeading.id;
        return;
      }
      var marker = line.match(/样题\s*[（(]\s*(单选题|多选题|判断题)\s*[）)]\s*[：:]?/);
      if (marker) {
        flush();
        active = {type:marker[1],moduleId:currentModuleId,page:currentPage,lines:[]};
        var remainder = line.slice(marker.index + marker[0].length).trim();
        if (remainder) active.lines.push(remainder);
        return;
      }
      if (active) active.lines.push(line);
    });
    flush();
    return found;
  }

  async function extractPdf(file) {
    var pdfjsLib;
    try {
      pdfjsLib = await pdfjsReady;
    } catch (error) {
      throw new Error("PDF 解析组件加载失败：" + error.message);
    }
    var buffer = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({data:buffer}).promise;
    var pages = [];
    for (var pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      var page = await pdf.getPage(pageNo);
      var content = await page.getTextContent();
      var pageText = "";
      content.items.forEach(function (item) {
        pageText += item.str || "";
        pageText += item.hasEOL ? "\n" : " ";
      });
      pages.push("<<<PAGE:" + pageNo + ">>>\n" + pageText);
    }
    return pages.join("\n");
  }

  function setStatus(message, kind) {
    importStatus.textContent = message;
    importStatus.className = "import-status" + (kind ? " " + kind : "");
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function updateActionButtons() {
    downloadBtn.disabled = !candidates.length;
    downloadKnowledgeBtn.disabled = !lastPages.length;
    saveLocalBtn.disabled = !(window.quizMindDesktop &&
      window.quizMindDesktop.saveWorkspaceData &&
      window.quizMindDesktop.loadWorkspaceData &&
      lastPages.length);
    backupWorkspaceBtn.disabled = !(window.quizMindDesktop && window.quizMindDesktop.loadWorkspaceData);
  }

  function invalidateExtraction(message) {
    if (!lastPages.length && !candidates.length) return;
    lastPages = [];
    lastExtractedText = "";
    candidates = [];
    renderCandidates();
    setStatus(message,"error");
  }

  function renderCandidates() {
    candidateResults.replaceChildren();
    if (!candidates.length) {
      var empty = make("div","empty-state");
      empty.appendChild(make("strong","","没有识别到候选题目"));
      empty.appendChild(make("p","","请确认资料包含“样题（单选题/多选题/判断题）”和“正确答案”等文本。扫描版 PDF 需要先 OCR。"));
      candidateResults.appendChild(empty);
      candidateCount.textContent = "0 道候选题";
      updateActionButtons();
      return;
    }

    candidates.forEach(function (question, index) {
      var card = make("article","candidate-card");
      var head = make("div","candidate-card-head");
      head.appendChild(make("strong","",question.id + " · " + (question.module ? question.module.name : "待归类")));
      head.appendChild(make("span","pending-label",question.reviewStatus === "verified" ? "已核验" : "待核验"));
      card.appendChild(head);

      var body = make("div","candidate-body");
      body.appendChild(make("p","candidate-stem",question.stem));
      var list = make("ul","candidate-options");
      question.options.forEach(function (option) {
        var li = make("li",question.answer.indexOf(option.key) >= 0 ? "correct" : "",option.key + ". " + option.text);
        list.appendChild(li);
      });
      body.appendChild(list);
      body.appendChild(make("div","candidate-explanation",question.explanation || "未抽取到解析"));
      var meta = make("div","candidate-meta");
      meta.appendChild(make("span","","类型：" + question.type));
      meta.appendChild(make("span","","原文页码：" + (question.source.page || "未知")));
      meta.appendChild(make("span","","来源等级：" + question.source.authority));
      meta.appendChild(make("span","","来源元数据：" + (question.source.confirmedByUser ? "已确认" : "未确认")));
      meta.appendChild(make("span","","候选答案：" + (question.answer.length ? question.answer.join("、") : "未识别")));
      body.appendChild(meta);

      if (question.source.quote) {
        var details = make("details","evidence-details");
        details.appendChild(make("summary","","展开原文摘录"));
        details.appendChild(make("p","",question.source.quote));
        body.appendChild(details);
      }

      var review = make("label","review-check");
      var checkbox = make("input","");
      checkbox.type = "checkbox";
      checkbox.checked = question.reviewStatus === "verified";
      checkbox.disabled = !question.canVerify;
      checkbox.addEventListener("change",function () {
        question.reviewStatus = checkbox.checked ? "verified" : "pending";
        head.lastChild.textContent = question.reviewStatus === "verified" ? "已核验" : "待核验";
        candidateCount.textContent = candidates.length + " 道候选题 · 已核验 " + candidates.filter(function (q) { return q.reviewStatus === "verified"; }).length;
        updateActionButtons();
      });
      review.appendChild(checkbox);
      review.appendChild(document.createTextNode(question.canVerify ?
        "我已对照原文核验题干、选项、正确答案和解析，允许加入正式题库" :
        "当前抽取结果缺少选项或答案结构不完整，不能直接标记为已核验"));
      body.appendChild(review);
      if (question.extractionWarnings && question.extractionWarnings.length) {
        body.appendChild(make("div","candidate-meta","抽取提示：" + question.extractionWarnings.join("；")));
      }
      card.appendChild(body);
      candidateResults.appendChild(card);
    });
    candidateCount.textContent = candidates.length + " 道候选题 · 已核验 " + candidates.filter(function (q) { return q.reviewStatus === "verified"; }).length;
    updateActionButtons();
  }

  sourceFile.addEventListener("change",function () {
    selectedFile = sourceFile.files && sourceFile.files[0] ? sourceFile.files[0] : null;
    $("sourceConfirmed").checked = false;
    fileName.textContent = selectedFile ? selectedFile.name : "选择 PDF 或 TXT 文件";
    extractBtn.disabled = !selectedFile;
    invalidateExtraction("文件已更换：上次抽取结果已清空。请核对新文件的来源信息、重新确认后再提取。");
  });

  ["sourceTitle","sourceUrl","sourceId","sourceRevision","sourceAuthority"].forEach(function (id) {
    var field = $(id);
    var eventName = field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(eventName,function () {
      $("sourceConfirmed").checked = false;
      invalidateExtraction("来源元数据已修改：上次抽取结果已清空。请重新核对来源、勾选确认并重新提取。");
    });
  });

  $("sourceConfirmed").addEventListener("change",function () {
    if (lastPages.length || candidates.length) {
      $("sourceConfirmed").checked = false;
      invalidateExtraction("来源确认状态已改变：为避免沿用旧审核结果，请重新勾选确认并重新提取文件。");
    }
  });

  extractBtn.addEventListener("click",async function () {
    if (!selectedFile) return;
    extractBtn.disabled = true;
    extractBtn.textContent = "正在解析…";
    setStatus("正在本地读取资料，请稍候。","");

    try {
      var text;
      if (/\.pdf$/i.test(selectedFile.name)) text = await extractPdf(selectedFile);
      else text = await selectedFile.text();

      if (!text || text.replace(/[\s\u3000]/g,"").length < 30) {
        throw new Error("没有提取到足够文本。文件可能是扫描版 PDF，需要 OCR 后再导入。");
      }
      await modulesReady;
      lastExtractedText = text;
      lastPages = splitPages(text);
      candidates = parseDocumentText(text);
      renderCandidates();
      setStatus("解析完成：提取到 " + candidates.length + " 道候选题。所有题目默认待核验；A/B 级资料、完整原文定位和逐题人工确认均为入库条件。","success");
    } catch (error) {
      setStatus("解析失败：" + error.message,"error");
      candidates = [];
      lastExtractedText = "";
      lastPages = [];
      updateActionButtons();
      renderCandidates();
    } finally {
      extractBtn.disabled = !selectedFile;
      extractBtn.innerHTML = "提取候选题目 <span class='button-arrow'>→</span>";
    }
  });

  function downloadJson(payload, filename) {
    var blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  downloadBtn.addEventListener("click",function () {
    if (!candidates.length) return;
    var payload = {
      schemaVersion:1,
      meta:{
        name:"QuizMind AI 候选题库",
        generatedAt:new Date().toISOString(),
        sourceId:$("sourceId").value.trim(),
        reviewPolicy:"仅人工勾选已核验的题目会以 verified 状态进入正式答题库。"
      },
      questions:candidates
    };
    downloadJson(payload,"quizmind-candidate-questions.json");
  });


  saveLocalBtn.addEventListener("click",async function () {
    if (!window.quizMindDesktop || !window.quizMindDesktop.saveWorkspaceData) {
      setStatus("本机工作区保存仅在桌面版中可用；浏览器预览请使用 JSON 导出。","error");
      return;
    }
    if (!lastPages.length) {
      setStatus("没有可保存的资料页，请先完成 PDF/TXT 解析。","error");
      return;
    }

    saveLocalBtn.disabled = true;
    saveLocalBtn.textContent = "正在保存到本机…";
    try {
      var verifiedQuestions = candidates.filter(function (question) {
        return question.reviewStatus === "verified" && question.canVerify;
      });
      var workspace = await window.quizMindDesktop.loadWorkspaceData() || {
        questions:[],
        documents:[]
      };
      var questionMap = new Map((Array.isArray(workspace.questions) ? workspace.questions : [])
        .filter(function (question) { return question && question.id; })
        .map(function (question) { return [String(question.id),question]; }));
      verifiedQuestions.forEach(function (question) {
        questionMap.set(question.id,question);
      });

      var sourceId = $("sourceId").value.trim() || "SRC-UNKNOWN";
      var revision = $("sourceRevision").value.trim();
      var safeRevision = revision.replace(/[^A-Za-z0-9_-]/g,"").slice(0,24) || "latest";
      var safeSourceId = sourceId.replace(/[^A-Za-z0-9_-]/g,"").slice(0,32) || "SRC";
      var documentId = safeSourceId + "-DOC-" + safeRevision;
      var sourceDocument = {
        id:documentId,
        title:$("sourceTitle").value.trim() || "未命名资料",
        sourceId:sourceId,
        authority:$("sourceAuthority").value || "C",
        sourceUrl:$("sourceUrl").value.trim(),
        sourceConfirmedByUser:$("sourceConfirmed").checked === true,
        revision:revision,
        pages:lastPages
      };
      var documents = (Array.isArray(workspace.documents) ? workspace.documents : [])
        .filter(function (document) { return document && document.id !== documentId; });
      documents.push(sourceDocument);

      var saved = await window.quizMindDesktop.saveWorkspaceData({
        questions:Array.from(questionMap.values()),
        documents:documents
      });
      renderCandidates();
      setStatus(
        "已保存到本机工作区：新增/更新 " + verifiedQuestions.length +
        " 道已人工核验题目，资料 " + lastPages.length + " 页；当前题库共 " +
        saved.questionCount + " 道、知识资料 " + saved.documentCount + " 份。",
        "success"
      );
    } catch (error) {
      setStatus("保存失败：" + (error.message || "本机工作区写入失败"),"error");
    } finally {
      saveLocalBtn.textContent = "保存到本机工作区";
      updateActionButtons();
    }
  });


  backupWorkspaceBtn.addEventListener("click",async function () {
    if (!window.quizMindDesktop || !window.quizMindDesktop.loadWorkspaceData) {
      setStatus("完整工作区备份仅在桌面版中可用。","error");
      return;
    }
    backupWorkspaceBtn.disabled = true;
    backupWorkspaceBtn.textContent = "正在整理备份…";
    try {
      var workspace = await window.quizMindDesktop.loadWorkspaceData() || {
        questions:[],
        documents:[]
      };
      var payload = {
        schemaVersion:1,
        exportedAt:new Date().toISOString(),
        questions:Array.isArray(workspace.questions) ? workspace.questions : [],
        documents:Array.isArray(workspace.documents) ? workspace.documents : []
      };
      var stamp = new Date().toISOString().replace(/[:.]/g,"-");
      downloadJson(payload,"quizmind-workspace-backup-" + stamp + ".json");
      setStatus(
        "完整工作区备份已导出：题目 " + payload.questions.length +
        " 道，知识资料 " + payload.documents.length + " 份。可在答题台通过导入数据合并恢复。",
        "success"
      );
    } catch (error) {
      setStatus("备份失败：" + (error.message || "无法读取本机工作区"),"error");
    } finally {
      backupWorkspaceBtn.textContent = "备份整个工作区";
      updateActionButtons();
    }
  });

  downloadKnowledgeBtn.addEventListener("click",function () {
    if (!lastPages.length) return;
    var payload = {
      schemaVersion:1,
      meta:{
        name:$("sourceTitle").value.trim() || "未命名资料",
        sourceId:$("sourceId").value.trim() || "SRC-UNKNOWN",
        authority:$("sourceAuthority").value || "C",
        sourceUrl:$("sourceUrl").value.trim(),
        sourceConfirmedByUser:$("sourceConfirmed").checked === true,
        revision:$("sourceRevision").value.trim(),
        originalFile:selectedFile ? selectedFile.name : "",
        extractedAt:new Date().toISOString(),
        pageCount:lastPages.length,
        note:"本文件由浏览器本地 PDF/TXT 文本抽取得到；原文页段未经语义清洗，使用前应检查页码和乱码。"
      },
      documents:[{
        id:($("sourceId").value.trim() || "SRC-UNKNOWN") + "-DOC-001",
        sourceConfirmedByUser:$("sourceConfirmed").checked === true,
        pages:lastPages
      }]
    };
    downloadJson(payload,"quizmind-knowledge-documents.json");
  });

  var modulesSource = window.quizMindDesktop && window.quizMindDesktop.loadModules
    ? window.quizMindDesktop.loadModules()
    : fetch("./data/modules.json").then(function (response) {
        if (!response.ok) throw new Error("模块目录加载失败");
        return response.json();
      });
  var modulesReady = Promise.resolve(modulesSource).then(function (payload) {
    modules = payload.modules || [];
  }).catch(function (error) {
    console.warn(error);
    return {modules:[]};
  });

  updateActionButtons();

  window.QuizMindImporter = {
    parseDocumentText:parseDocumentText,
    splitPages:splitPages,
    modulesReady:modulesReady
  };
})();