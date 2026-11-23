(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var form = $("settingsForm");
  var saveBtn = $("saveBtn");
  var testBtn = $("testBtn");
  var message = $("settingsMessage");

  function setMessage(text, state) {
    message.textContent = text;
    message.dataset.state = state || "info";
  }

  async function loadSettings() {
    if (!window.quizMindDesktop) {
      setMessage("当前页面不在 QuizMind 桌面应用中运行。", "error");
      return;
    }
    try {
      var settings = await window.quizMindDesktop.getSettings();
      $("baseUrl").value = settings.baseUrl || "";
      $("model").value = settings.model || "";
      $("keyStatus").textContent = settings.apiKeyConfigured ? "API Key 已加密保存" : "尚未配置 API Key";
      if (!settings.encryptionAvailable) {
        setMessage("系统加密存储不可用。为保护密钥，当前不能保存 API Key。", "error");
      }
      var info = await window.quizMindDesktop.getAppInfo();
      $("appVersion").textContent = info.name + " · v" + info.version + " · " + info.platform;
    } catch (error) {
      setMessage(error.message || "读取设置失败。", "error");
    }
  }

  async function save() {
    saveBtn.disabled = true;
    try {
      var result = await window.quizMindDesktop.saveSettings({
        baseUrl: $("baseUrl").value.trim(),
        model: $("model").value.trim(),
        apiKey: $("apiKey").value,
        clearApiKey: $("clearApiKey").checked
      });
      $("apiKey").value = "";
      $("clearApiKey").checked = false;
      $("keyStatus").textContent = result.apiKeyConfigured ? "API Key 已加密保存" : "尚未配置 API Key";
      setMessage("设置已保存到本机。", "success");
      return true;
    } catch (error) {
      setMessage(error.message || "保存失败。", "error");
      throw error;
    } finally {
      saveBtn.disabled = false;
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    try { await save(); } catch (_) {}
  });

  testBtn.addEventListener("click", async function () {
    testBtn.disabled = true;
    setMessage("正在向模型发送最小连接测试请求……", "info");
    try {
      await save();
      var result = await window.quizMindDesktop.testConnection();
      setMessage("连接成功 · 模型 " + result.model + " · 返回：" + result.response, "success");
    } catch (error) {
      setMessage(error.message || "连接测试失败。", "error");
    } finally {
      testBtn.disabled = false;
    }
  });

  loadSettings();
})();