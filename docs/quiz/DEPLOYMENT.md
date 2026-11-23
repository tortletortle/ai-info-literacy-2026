# QuizMind AI 部署说明（Cloudflare Pages）

## 目标部署结构

- 静态前端目录：docs/quiz
- Pages Functions 目录：仓库根目录 functions/
- API 路径：POST /api/answer
- 模型密钥只放在 Cloudflare Pages 的服务端环境变量中，不写进浏览器代码或 Git 仓库。

## 创建 Pages 项目

1. 在 Cloudflare Dashboard 中创建 Pages 项目，并连接本 GitHub 仓库。
2. 生产分支选择 main（合并本开发 PR 后使用）；预览阶段可选择 web-quiz-v0.1。
3. Build command 留空。
4. Build output directory 填写 docs/quiz。
5. 保留仓库根目录的 functions/ 文件夹，Cloudflare Pages 会据此构建 Functions。

## 配置服务端变量

在 Pages 项目设置的 Variables and Secrets 中添加：

| 变量 | 用途 |
|---|---|
| LLM_BASE_URL | OpenAI-compatible API 的基础地址，包含版本路径（例如 /v1） |
| LLM_API_KEY | 模型服务密钥，必须设为 Secret |
| LLM_MODEL | 服务商提供的模型名称 |

不要把密钥写入 docs/quiz/、app.js、HTML、README 或提交记录。

## 当前 API 行为

- 原题命中：前端本地审核题库优先返回。
- 原题未命中：前端从已导入的资料库检索证据片段，再调用 /api/answer。
- 服务端只把题目、选项和有限的证据片段发送给模型。
- 服务端逐项校验模型的选项判断、答案数量和证据 ID；只接受 A/B 级来源作为最终答案证据，C 级第三方资料不能单独支撑答案。
- 证据不全、选项未全部分析或模型配置缺失时，系统返回不确定，不会强行输出答案。
- 当前尚未实现服务端实时网页搜索；题目必须能从导入的资料库中找到证据，才能进入 AI 推理。

## 本地验证

静态页面可用：

~~~bash
python -m http.server 8000
~~~

浏览器打开 http://localhost:8000/docs/quiz/。

Cloudflare Pages Function 需要在 Pages 环境中测试；单纯 Python 静态服务器不会运行 /api/answer。