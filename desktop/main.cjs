"use strict";

const { app, BrowserWindow, ipcMain, shell, safeStorage, protocol, net } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { normalizeWorkspace } = require("./workspace-schema.cjs");
const { answerWithEvidence, testProvider, resolveEndpoint } = require("./answer-engine.cjs");

const APP_ID = "com.quizmind.ai";
let mainWindow = null;

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

function getQuizDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "quiz")
    : path.join(__dirname, "..", "docs", "quiz");
}

function getUserFile(name) {
  return path.join(app.getPath("userData"), name);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
}

function validateBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/+$/, "");
  if (!baseUrl) return "";
  resolveEndpoint(baseUrl);
  return baseUrl;
}

async function readRawSettings() {
  return readJson(getUserFile("settings.json"), {
    baseUrl: "",
    model: "",
    apiKeyEncrypted: ""
  });
}

async function getDecryptedSettings() {
  const stored = await readRawSettings();
  let apiKey = "";
  if (stored.apiKeyEncrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储暂不可用，无法读取已保存的 API Key。");
    }
    apiKey = safeStorage.decryptString(Buffer.from(stored.apiKeyEncrypted, "base64"));
  }
  return {
    baseUrl: stored.baseUrl || "",
    model: stored.model || "",
    apiKey
  };
}

async function getPublicSettings() {
  const stored = await readRawSettings();
  return {
    baseUrl: stored.baseUrl || "",
    model: stored.model || "",
    apiKeyConfigured: Boolean(stored.apiKeyEncrypted),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

async function saveSettings(input) {
  const stored = await readRawSettings();
  const baseUrl = validateBaseUrl(input && input.baseUrl);
  const model = String(input && input.model || "").trim().slice(0, 200);

  if (input && input.clearApiKey) stored.apiKeyEncrypted = "";
  const apiKey = String(input && input.apiKey || "").trim();
  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统加密存储不可用，拒绝以明文保存 API Key。");
    }
    stored.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString("base64");
  }

  stored.baseUrl = baseUrl;
  stored.model = model;
  await writeJsonAtomic(getUserFile("settings.json"), stored);
  return getPublicSettings();
}

async function loadWorkspace() {
  return readJson(getUserFile("workspace.json"), null);
}

async function saveWorkspace(value) {
  const normalized = normalizeWorkspace(value);
  await writeJsonAtomic(getUserFile("workspace.json"), normalized);
  return {
    ok: true,
    questionCount: normalized.questions.length,
    documentCount: normalized.documents.length
  };
}

async function readQuizData(fileName) {
  const allowed = new Set(["questions.json", "modules.json"]);
  if (!allowed.has(fileName)) throw new Error("不允许读取该资料文件。");
  return readJson(path.join(getQuizDirectory(), "data", fileName), {});
}

function openSafeExternal(urlValue) {
  const url = new URL(String(urlValue || ""));
  if (url.protocol !== "https:") throw new Error("只允许打开 HTTPS 外部链接。");
  return shell.openExternal(url.toString());
}

function registerIpcHandlers() {
  ipcMain.handle("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle("settings:get", () => getPublicSettings());
  ipcMain.handle("settings:save", (_event, input) => saveSettings(input || {}));
  ipcMain.handle("settings:test", async () => {
    const settings = await getDecryptedSettings();
    return testProvider(settings);
  });

  ipcMain.handle("answer:run", async (_event, payload) => {
    const settings = await getDecryptedSettings();
    return answerWithEvidence({ payload: payload || {}, settings });
  });

  ipcMain.handle("workspace:load", () => loadWorkspace());
  ipcMain.handle("workspace:save", (_event, value) => saveWorkspace(value));
  ipcMain.handle("data:questions", () => readQuizData("questions.json"));
  ipcMain.handle("data:modules", () => readQuizData("modules.json"));
  ipcMain.handle("app:openExternal", (_event, url) => openSafeExternal(url));
}

function registerAppProtocol() {
  const quizDirectory = getQuizDirectory();
  protocol.handle("app", (request) => {
    try {
      const targetUrl = new URL(request.url);
      if (targetUrl.host !== "quizmind" || request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Not found", { status: 404 });
      }
      const requestedPath = decodeURIComponent(targetUrl.pathname === "/" ? "/index.html" : targetUrl.pathname);
      const targetPath = path.resolve(quizDirectory, "." + requestedPath);
      const relative = path.relative(quizDirectory, targetPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(targetPath).toString());
    } catch (_) {
      return new Response("Not found", { status: 404 });
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: "#f6f7f5",
    title: "QuizMind AI",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:") shell.openExternal(target.toString());
    } catch (_) {}
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      if (target.protocol !== "app:" || target.host !== "quizmind") event.preventDefault();
    } catch (_) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL("app://quizmind/index.html");
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    registerAppProtocol();
    registerIpcHandlers();
    createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
