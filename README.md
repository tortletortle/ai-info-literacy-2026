# QuizMind AI · Desktop Edition

桌面端是当前主线（开发分支：desktop-app-v0.1）。请从仓库根目录进入 desktop，按 desktop/README.md 安装依赖、运行测试和构建 Windows 程序。

## 当前产品形态

- Windows 桌面应用（Electron）。
- 复用 docs/quiz 中的答题台和资料整理逻辑。
- 本地持久化题库与知识库。
- 主进程负责模型 API 调用和密钥加密存储。
- Windows NSIS 安装包与便携版 EXE 由 GitHub Actions 构建。

## 仍保留的浏览器原型

docs/quiz 可以在本地静态服务器中预览，但它不再是正式交付目标。桌面端的 PDF.js 使用本地打包模块；浏览器预览模式使用 CDN 备用加载。

## 事实边界

内置已审核题库目前为空；50 个知识模块仍待与官方原始 PDF 修订版逐项复核。桌面端现已支持将人工核验后的 A/B 级题目与 PDF/TXT 全文直接保存到本机工作区，并要求 AI 对每个选项单独引用证据。AI 推理只有在找到 A/B 级官方证据且逐项验证通过时才输出答案。实时网页搜索、扫描版 OCR 尚未接入。
