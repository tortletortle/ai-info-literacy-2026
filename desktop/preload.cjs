"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quizMindDesktop", Object.freeze({
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  testConnection: () => ipcRenderer.invoke("settings:test"),
  answerQuestion: (payload) => ipcRenderer.invoke("answer:run", payload),
  loadWorkspaceData: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspaceData: (value) => ipcRenderer.invoke("workspace:save", value),
  loadBuiltinQuestions: () => ipcRenderer.invoke("data:questions"),
  loadModules: () => ipcRenderer.invoke("data:modules"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url)
}));