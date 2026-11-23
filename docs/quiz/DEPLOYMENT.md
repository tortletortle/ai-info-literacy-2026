# QuizMind AI 桌面端部署与构建说明

## 正式交付：Windows 桌面应用

当前主线为 Electron 桌面端，浏览器静态页面只作为次级预览。构建环境：

- Windows 10/11 x64
- Node.js 24.x
- npm

从仓库根目录运行：

~~~powershell
cd desktop
npm install
npm test
npm run dist:win
~~~

构建产物位于 desktop/dist/：

- QuizMind AI Setup 0.2.0.exe：NSIS 安装包，可选择安装目录并创建快捷方式。
- QuizMind AI 0.2.0.exe：便携版，无需安装。

GitHub Actions 会在桌面代码、资料页面或工作流变更时运行 Windows 构建，并上传两个 EXE 作为 workflow artifacts。

## 首次使用

1. 安装并启动 QuizMind AI。
2. 进入「AI 设置」，填写 OpenAI-compatible API Base URL、模型 ID 和 API Key。
3. 远程 API 必须使用 HTTPS；本地模型可使用 localhost HTTP。
4. API Key 通过系统安全存储加密；测试连接成功后再使用 AI 推理。
5. 进入「资料整理」，选择 PDF/TXT，核对来源等级和元数据。
6. 默认来源等级为 C；先选择文件，再核对来源信息、选择 A/B 并勾选确认，最后点击提取。更换文件或修改来源字段会清空旧的提取与审核状态，必须重新提取。
7. 点击「保存到本机工作区」。知识资料与人工核验题目将直接写入本机。
8. 回到答题台粘贴题目。没有充分证据时，系统应返回不确定。

## 数据位置与备份

用户数据保存在 Electron app.getPath("userData") 目录下的 workspace.json 与 settings.json。API Key 不以明文写入 settings 文件。

资料整理页支持「备份整个工作区」，导出包含已审核题目与所有知识资料页的 JSON。恢复时在答题台导入该备份，系统先完整校验，再按稳定 ID 合并记录；同 ID 记录会更新，其他本地记录保留。校验或写入失败不会留下部分合并状态。

## 次级浏览器预览

从仓库根目录运行：

~~~bash
python -m http.server 8000
~~~

浏览器访问 http://localhost:8000/docs/quiz/。静态预览不具备 Electron 主进程、系统密钥加密和本地 IPC 能力；AI API 路径依赖单独部署的服务端 Function。

## 安全与发布限制

- 当前 Windows 安装包未配置代码签名，Windows SmartScreen 可能显示未知发布者提示。
- 远程模型使用会产生服务商费用，请在供应商侧设置预算和用量告警。
- 本地 PDF/TXT 解析不会上传原始文件；仅在调用模型时发送检索出的证据片段。
- 不要导入包含密码、个人身份信息或其他敏感内容的文件。
- 物理 Windows 设备上的启动、PDF worker、模型连接和升级路径仍需手工验收。