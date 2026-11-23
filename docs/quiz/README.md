# QuizMind AI · Web Quiz V0.1

## 当前状态

这是静态网页前端 + Cloudflare Pages Function 的第一版原型。前端目录为 docs/quiz，服务端 API 位于仓库根目录 functions/api/answer.js。

### 已实现

- 简洁中文答题台：粘贴一道或多道题，拆分题目并识别选项。
- 本地审核题库：JSON 导入、题干/选项相似匹配、选项乱序映射。
- 资料整理页：admin.html 在浏览器本地读取可选中文本的 PDF/TXT。
- 候选题抽取：识别官方命题文件中的样题、选项、答案、解析和页码。
- 全文知识库导出：按 PDF 页码导出原文片段，供后续 RAG 使用。
- 人工审核门槛：候选题默认 pending；选项或答案结构不完整时不能标记 verified。
- 本地证据检索：题库未命中时检索导入的资料页，显示来源、页码和相关片段。
- 服务端 AI 答题接口：基于导入证据逐项判断选项；验证答案数量、选项覆盖和证据 ID。
- 来源等级约束：A/B 级资料可支撑答案；C 级第三方资料只能作为线索，不能单独支撑答案。

### 尚未完成

- 内置审核题库仍为空，需要导入官方资料并逐题核验。
- Cloudflare Pages 尚未部署，服务端模型密钥尚未配置，因此在线 AI 答题尚未完成联调。
- 扫描版 PDF OCR。
- 任意网页/课件的通用自动采集。
- 实时网页搜索、数据库页面动态查证。
- 多用户云端题库同步。

未命中原题并不意味着一定能回答。只有在本地资料库找到相关证据、服务端模型配置有效且逐项核验通过时，AI 才会输出推理答案；否则返回不确定。

## 数据目录

- data/questions.json：正式审核题库，当前为空。
- data/modules.json：9 大类、50 个知识模块目录，仍待原始 PDF 复核。
- data/sources.json：官方平台、高校通知和第三方线索的来源登记及 A/B/C 权威等级。
- data/competition-format.json：特定高校通知所述校内选拔赛题型结构，不外推到其他赛段。
- api-contract.json：服务端答题 API 契约。
- ARCHITECTURE.md：证据优先答题流程与验收标准。
- DEPLOYMENT.md：Cloudflare Pages 部署说明。

## 题库 JSON 格式

~~~json
{
  "schemaVersion": 1,
  "questions": [
    {
      "id": "Q001",
      "stem": "题干文本",
      "type": "single",
      "options": [
        { "key": "A", "text": "选项 A" },
        { "key": "B", "text": "选项 B" }
      ],
      "answer": ["A"],
      "explanation": "答案解析",
      "module": { "id": 31, "name": "高级检索" },
      "source": {
        "id": "SRC-001",
        "authority": "A",
        "title": "官方资料名称",
        "url": "https://example.org/source",
        "updatedAt": "2026-11-23",
        "page": 12,
        "quote": "原文证据摘录"
      },
      "reviewStatus": "verified"
    }
  ]
}
~~~

规则：

- answer 引用的是题库原始选项 key；选项文本必须完整保留。
- 只有经过人工核验的题目才能设置 reviewStatus 为 verified。
- A = 主办方/官方平台；B = 高校官方通知及附件；C = 第三方线索。
- 正式答案必须能追溯到来源、版本、页码或段落证据。
- 不得虚构来源、页码、解析或答案。

## 本地运行

在仓库根目录执行：

~~~bash
python -m http.server 8000
~~~

浏览器打开：

~~~text
http://localhost:8000/docs/quiz/
~~~

静态服务器只能运行前端；/api/answer 需要 Cloudflare Pages Functions 环境。

## 部署

按照 DEPLOYMENT.md 配置 Cloudflare Pages，输出目录为 docs/quiz，保留根目录 functions/，并在服务端设置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL。密钥不能放入浏览器或 Git。

## 下一阶段

1. 获取并核验官方命题范围 PDF 的确切修订版本。
2. 导入 PDF，抽取候选题和全文资料，人工审核后形成首批正式题库。
3. 完成 Cloudflare Pages 部署与模型服务联调。
4. 建立留出测试集，测量原题、改写题、多选集合、选项乱序和拒答质量。
5. 再接入官方域名优先的实时网页查证。