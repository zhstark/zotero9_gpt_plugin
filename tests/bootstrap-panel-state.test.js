const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.style = {};
    this.attributes = new Map();
    this.childNodes = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "style") {
      this.style.cssText = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
    }
    return node;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }
}

class FakeDocument {
  constructor() {
    this.title = "paper.pdf";
    this.elements = new Map();
    this.documentElement = new FakeElement("root");
  }

  add(id) {
    const element = new FakeElement(id);
    this.elements.set(id, element);
    return element;
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  querySelectorAll() {
    return [];
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    const node = new FakeElement("#text");
    node.textContent = String(text);
    return node;
  }
}

function loadBootstrap() {
  const code = fs.readFileSync("bootstrap.js", "utf8");
  const context = {
    console,
    Zotero: {
      Prefs: {
        get() {
          return "";
        },
        set() {},
      },
      isMac: true,
      debug() {},
    },
    Components: { classes: {}, interfaces: {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

function createPanelWindow() {
  const document = new FakeDocument();
  const panel = document.add("paper-translation-popup-panel");
  panel.setAttribute("data-assistant-mode", "translate");
  document.add("paper-translation-popup-question-section");
  document.add("paper-translation-popup-question");
  document.add("paper-translation-popup-toolbar");
  document.add("paper-translation-popup-action");
  document.add("paper-translation-popup-ask-action");
  document.add("paper-translation-popup-ask-status-row");
  document.add("paper-translation-popup-ask-status");
  document.add("paper-translation-popup-result-label");
  document.add("paper-translation-popup-clear-chat");
  document.add("paper-translation-popup-result");
  document.add("paper-translation-popup-markdown-result");
  document.add("paper-translation-popup-status");
  return { document };
}

test("panel results stay isolated when switching assistant modes", () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  const result = panelWindow.document.getElementById("paper-translation-popup-result");
  const markdown = panelWindow.document.getElementById("paper-translation-popup-markdown-result");

  bootstrap.updateAssistantMode(panelWindow, "ask-pdf");
  const askPdfSession = bootstrap.getPaperChatSession(panelWindow, "ask-pdf");
  askPdfSession.messages.push({ role: "user", content: "总结这篇论文" });
  askPdfSession.messages.push({ role: "assistant", content: "问全文回答" });
  bootstrap.setPanelValue(panelWindow, "paper-translation-popup-result", bootstrap.formatConversationTranscript(askPdfSession.messages));
  bootstrap.renderConversationMessages(panelWindow, askPdfSession.messages);

  bootstrap.updateAssistantMode(panelWindow, "translate");
  assert.equal(result.value, "");
  assert.equal(markdown.childNodes.length, 0);

  bootstrap.updateAssistantMode(panelWindow, "ask-select");
  assert.equal(result.value, "");
  assert.equal(markdown.childNodes.length, 0);
});

test("status hint follows the active action button", () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  const toolbar = panelWindow.document.getElementById("paper-translation-popup-toolbar");
  const askStatusRow = panelWindow.document.getElementById("paper-translation-popup-ask-status-row");
  const toolbarStatus = panelWindow.document.getElementById("paper-translation-popup-status");
  const askStatus = panelWindow.document.getElementById("paper-translation-popup-ask-status");

  bootstrap.updateAssistantMode(panelWindow, "ask-pdf");
  assert.equal(toolbar.style.display, "none");
  assert.equal(askStatusRow.style.display, "flex");
  assert.equal(toolbarStatus.textContent, "");
  assert.equal(askStatus.textContent, "输入问题后提问，将读取当前 PDF 全文。");

  bootstrap.updateAssistantMode(panelWindow, "translate");
  assert.equal(toolbar.style.display, "flex");
  assert.equal(askStatusRow.style.display, "none");
  assert.equal(toolbarStatus.textContent, "请在论文中划取文字后点击翻译。");
  assert.equal(askStatus.textContent, "");
});
