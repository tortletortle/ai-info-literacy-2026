const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const SYSTEM_PROMPT = [
  "你是 QuizMind 的证据约束型客观题答题引擎。",
  "只能使用用户提供的 evidence 数组作答，不得使用模型记忆补充事实，不得虚构来源、页码或引文。",
  "必须逐项分析每个选项，verdict 只能是 supported、refuted、insufficient。",
  "单选题必须恰好一个 supported，其他选项必须 refuted；只要存在 insufficient 就返回 uncertain。",
  "多选题必须完整判断所有选项；按请求给出的 multiAnswerMin / multiAnswerMax 约束正确项数量，未给出时范围为 1 到选项总数；任何选项 insufficient 都返回 uncertain。",
  "判断题必须恰好一个选项 supported，且两个选项都要有证据判断。",
  "证据不足、来源不相关、问题需要资料之外的实时事实时，返回 uncertain，不要猜测。",
  "只返回一个 JSON 对象，不要 Markdown，不要代码围栏。",
  "JSON 格式：",
  "{\"status\":\"answered|uncertain\",\"explanation\":\"简明中文解析\",\"confidence\":\"high|medium|low\",\"evidenceIds\":[\"E1\"],\"optionAnalysis\":[{\"key\":\"A\",\"verdict\":\"supported|refuted|insufficient\",\"rationale\":\"基于证据的理由\"}],\"warnings\":[]}"
].join("\n");

function uncertain(message, warnings) {
  return {
    status: "uncertain",
    answerKeys: [],
    explanation: message || "现有证据不足，暂不能可靠判定。",
    confidence: "low",
    evidenceIds: [],
    optionAnalysis: [],
    warnings: warnings || []
  };
}

function parseModelJson(raw) {
  const text = String(raw || "").trim()
    .replace(/^\x60{3}(?:json)?\s*/i, "")
    .replace(/\s*\x60{3}$/, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("模型没有返回有效 JSON");
  return JSON.parse(text.slice(first, last + 1));
}

function validateModelResult(result, type, options, evidence, multiMin, multiMax) {
  const validKeys = new Set(options.map((option) => option.key));
  const validEvidenceIds = new Set(evidence.map((item) => item.id));
  const analysis = Array.isArray(result.optionAnalysis) ? result.optionAnalysis : [];
  const byKey = new Map();
  for (const item of analysis) {
    if (!item || !validKeys.has(item.key)) continue;
    if (!["supported", "refuted", "insufficient"].includes(item.verdict)) continue;
    byKey.set(item.key, {
      key: item.key,
      verdict: item.verdict,
      rationale: String(item.rationale || "").slice(0, 1200)
    });
  }

  const evidenceIds = Array.isArray(result.evidenceIds)
    ? [...new Set(result.evidenceIds.filter((id) => validEvidenceIds.has(id)))]
    : [];
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.map((item) => String(item).slice(0, 300)).slice(0, 8)
    : [];

  const allOptionsAnalyzed = options.length > 0 &&
    options.every((option) => byKey.has(option.key) && byKey.get(option.key).rationale.length > 0);
  const noInsufficient = allOptionsAnalyzed &&
    options.every((option) => byKey.get(option.key).verdict !== "insufficient");
  const supported = options
    .filter((option) => byKey.has(option.key) && byKey.get(option.key).verdict === "supported")
    .map((option) => option.key);

  const requiredCountValid =
    (type === "single" && supported.length === 1) ||
    (type === "multi" && supported.length >= multiMin && supported.length <= multiMax) ||
    (type === "judge" && supported.length === 1);

  const confidence = ["high", "medium", "low"].includes(result.confidence)
    ? result.confidence
    : "low";

  if (
    result.status !== "answered" ||
    !evidenceIds.length ||
    !allOptionsAnalyzed ||
    !noInsufficient ||
    !requiredCountValid
  ) {
    return {
      status: "uncertain",
      answerKeys: [],
      explanation: String(result.explanation || "逐项证据核验未达到输出标准。").slice(0, 3000),
      confidence: "low",
      evidenceIds,
      optionAnalysis: options.map((option) => byKey.get(option.key) || {
        key: option.key,
        verdict: "insufficient",
        rationale: "模型未提供足够证据。"
      }),
      warnings: warnings.concat("系统验证未通过：不输出未经完整证据支持的答案。")
    };
  }

  return {
    status: "answered",
    answerKeys: supported,
    explanation: String(result.explanation || "").slice(0, 3000),
    confidence,
    evidenceIds,
    optionAnalysis: options.map((option) => byKey.get(option.key)),
    warnings
  };
}

export async function onRequestPost({ request, env }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 100000) return json({ error: "REQUEST_TOO_LARGE" }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const question = String(body.question || "").trim();
  const type = String(body.type || "unknown");
  const options = Array.isArray(body.options) ? body.options.slice(0, 8).map((item) => ({
    key: String(item.key || "").toUpperCase(),
    text: String(item.text || "").slice(0, 1000)
  })) : [];
  const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 6).map((item, index) => ({
    id: String(item.id || ("E" + (index + 1))),
    title: String(item.title || "未命名来源").slice(0, 300),
    url: String(item.url || "").slice(0, 1000),
    page: Number(item.page) || null,
    sourceId: String(item.sourceId || ""),
    text: String(item.text || "").slice(0, 5000)
  })) : [];

  if (!question || question.length > 3000) return json({ error: "INVALID_QUESTION" }, 400);
  if (!["single", "multi", "judge"].includes(type)) return json(uncertain("无法可靠识别题型。"), 200);
  if (!options.length || options.some((option) => !option.key || !option.text)) {
    return json(uncertain("题目选项不完整，无法逐项核验。"), 200);
  }
  if (!evidence.length || evidence.every((item) => !item.text.trim())) {
    return json(uncertain("没有检索到可供核验的资料证据。"), 200);
  }

  const baseUrl = String(env.LLM_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(env.LLM_API_KEY || "").trim();
  const model = String(env.LLM_MODEL || "").trim();
  if (!baseUrl || !apiKey || !model) {
    return json({ error: "LLM_NOT_CONFIGURED", message: "服务端模型配置尚未完成。" }, 503);
  }

  const endpoint = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : baseUrl + "/chat/completions";

  const multiMin = type === "multi" ? Math.max(1, Math.min(options.length, Number(body.multiAnswerMin) || 1)) : 1;
  const multiMax = type === "multi" ? Math.max(multiMin, Math.min(options.length, Number(body.multiAnswerMax) || options.length)) : 1;
  const userPayload = { question, type, options, evidence, multiAnswerMin:multiMin, multiAnswerMax:multiMax };

  let providerResponse;
  try {
    providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "authorization": "Bearer " + apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) }
        ]
      })
    });
  } catch {
    return json({ error: "MODEL_NETWORK_ERROR" }, 502);
  }

  if (!providerResponse.ok) {
    return json({
      error: "MODEL_PROVIDER_ERROR",
      providerStatus: providerResponse.status
    }, 502);
  }

  let providerData;
  try {
    providerData = await providerResponse.json();
  } catch {
    return json({ error: "MODEL_INVALID_RESPONSE" }, 502);
  }

  const raw = providerData && providerData.choices &&
    providerData.choices[0] && providerData.choices[0].message &&
    providerData.choices[0].message.content;

  let parsed;
  try {
    parsed = parseModelJson(raw);
  } catch {
    return json(uncertain("模型输出格式无法验证，系统拒绝生成答案。", ["MODEL_JSON_PARSE_FAILED"]), 200);
  }

  return json(validateModelResult(parsed, type, options, evidence, multiMin, multiMax));
}