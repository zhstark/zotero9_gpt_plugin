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

function loadBootstrap(overrides = {}) {
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
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

function createPanelWindow() {
  const document = new FakeDocument();
  const panelWindow = { document };
  document.defaultView = panelWindow;
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
  return panelWindow;
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

test("markdown answer area explicitly allows text selection", () => {
  const bootstrap = loadBootstrap();
  const document = new FakeDocument();
  const markdown = bootstrap.createMarkdownResultView(document);

  assert.match(markdown.getAttribute("style"), /user-select:\s*text/);
  assert.match(markdown.getAttribute("style"), /background:\s*#f8fafc/);
});

test("conversation messages render as a readable chat surface", () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  const markdown = panelWindow.document.getElementById("paper-translation-popup-markdown-result");

  bootstrap.renderConversationMessages(panelWindow, [
    { role: "user", content: "总结这篇论文" },
    { role: "assistant", content: "## 结论\n\n- 第一条" },
  ]);

  assert.equal(markdown.className, "scholarmate-chat-surface");
  assert.equal(markdown.childNodes.length, 2);
  assert.equal(markdown.childNodes[0].className, "scholarmate-message scholarmate-message-user");
  assert.equal(markdown.childNodes[0].childNodes[0].className, "scholarmate-bubble scholarmate-bubble-user");
  assert.equal(markdown.childNodes[0].childNodes[0].childNodes[1].className, "scholarmate-body");
  assert.equal(markdown.childNodes[1].className, "scholarmate-message scholarmate-message-assistant");
  assert.equal(markdown.childNodes[1].childNodes[0].className, "scholarmate-bubble scholarmate-bubble-assistant");
});

test("assistant markdown renders inline and display latex formula nodes", () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  const markdown = panelWindow.document.getElementById("paper-translation-popup-markdown-result");

  bootstrap.renderConversationMessages(panelWindow, [
    { role: "assistant", content: "预测器 \\(h\\)\n\n\\[\nS_t = |Y_t - \\hat Y_t|\n\\]" },
  ]);

  const bubble = markdown.childNodes[0].childNodes[0];
  const body = bubble.childNodes[1];
  assert.equal(body.childNodes[0].childNodes[1].className, "scholarmate-math scholarmate-math-inline");
  assert.equal(body.childNodes[1].className, "scholarmate-math scholarmate-math-display");
  assert.match(body.childNodes[1].textContent, /\\hat Y_t/);
});

test("loads katex through the Zotero subscript loader fallback", () => {
  let loadedUrl = "";
  const bootstrap = loadBootstrap({
    Components: {
      classes: {
        "@mozilla.org/moz/jssubscript-loader;1": {
          getService() {
            return {
              loadSubScript(url, target) {
                loadedUrl = url;
                target.katex = {
                  render(formula, node) {
                    node.textContent = "rendered:" + formula;
                  },
                };
              },
            };
          },
        },
      },
      interfaces: { mozIJSSubScriptLoader: function MozSubScriptLoader() {} },
    },
  });
  bootstrap.rootURI = "file:///plugin/";
  const panelWindow = createPanelWindow();

  bootstrap.ensureKatexLoaded(panelWindow);

  assert.equal(loadedUrl, "file:///plugin/content/vendor/katex/katex.min.js");
  assert.equal(typeof panelWindow.katex.render, "function");
});

test("renders latex with katex loaded by the fallback loader", () => {
  const bootstrap = loadBootstrap({
    Components: {
      classes: {
        "@mozilla.org/moz/jssubscript-loader;1": {
          getService() {
            return {
              loadSubScript(_url, target) {
                target.katex = {
                  render(formula, node) {
                    node.textContent = "katex:" + formula;
                  },
                };
              },
            };
          },
        },
      },
      interfaces: { mozIJSSubScriptLoader: function MozSubScriptLoader() {} },
    },
  });
  bootstrap.rootURI = "file:///plugin/";
  const panelWindow = createPanelWindow();
  const markdown = panelWindow.document.getElementById("paper-translation-popup-markdown-result");

  bootstrap.renderConversationMessages(panelWindow, [
    { role: "assistant", content: "设预测模型为 \\(h\\)，预测输出为 \\(\\hat Y\\)。" },
  ]);

  const body = markdown.childNodes[0].childNodes[0].childNodes[1];
  const paragraph = body.childNodes[0];
  assert.equal(paragraph.childNodes[1].textContent, "katex:h");
  assert.equal(paragraph.childNodes[3].textContent, "katex:\\hat Y");
});

test("paper context reads all pages from PDF.js document when DOM pages are virtualized", async () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  panelWindow.PDFViewerApplication = {
    pdfDocument: {
      numPages: 3,
      async getPage(pageNumber) {
        const pageWords = ["alpha method", "beta results", "gamma conclusion"];
        return {
          async getTextContent() {
            return {
              items: [
                { str: "Section " + pageWords[pageNumber - 1], transform: [1, 0, 0, 1, 10, 800] },
                { str: "Complete extracted " + pageWords[pageNumber - 1], transform: [1, 0, 0, 1, 10, 780] },
              ],
            };
          },
        };
      },
    },
  };

  const context = await bootstrap.readPaperContext(panelWindow);

  assert.equal(context.pageCount, 3);
  assert.equal(context.extractionSource, "pdfjs");
  assert.equal(context.pdfExpectedPageCount, 3);
  assert.equal(context.extractedPageCount, 3);
  assert.match(context.text, /\[\[page 1\]\]/);
  assert.match(context.text, /Complete extracted gamma conclusion/);
});

test("paper context logs extraction diagnostics", async () => {
  const logs = [];
  const bootstrap = loadBootstrap();
  bootstrap.Zotero.debug = (message) => logs.push(message);
  const panelWindow = createPanelWindow();
  panelWindow.PDFViewerApplication = {
    pdfDocument: {
      numPages: 2,
      async getPage(pageNumber) {
        return {
          async getTextContent() {
            return {
              items: [
                { str: "diagnostic page " + pageNumber, transform: [1, 0, 0, 1, 10, 700] },
              ],
            };
          },
        };
      },
    },
  };

  const context = await bootstrap.readPaperContext(panelWindow);

  assert.equal(context.pageCount, 2);
  assert.match(logs.join("\n"), /\[ScholarMate\] PDF extraction started/);
  assert.match(logs.join("\n"), /PDF\.js candidate #1: numPages=2, extractedPages=2/);
  assert.match(logs.join("\n"), /PDF extraction finished: source=pdfjs, extractedPages=2, expectedPages=2/);
});

test("paper context reads PDF.js document exposed through wrappedJSObject", async () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  panelWindow.wrappedJSObject = {
    PDFViewerApplication: {
      pdfDocument: {
        numPages: 2,
        async getPage(pageNumber) {
          return {
            async getTextContent() {
              return {
                items: [
                  { str: pageNumber === 1 ? "wrapped first page" : "wrapped second page", transform: [1, 0, 0, 1, 10, 700] },
                ],
              };
            },
          };
        },
      },
    },
  };

  const context = await bootstrap.readPaperContext(panelWindow);

  assert.equal(context.pageCount, 2);
  assert.match(context.text, /wrapped second page/);
});

test("paper context discovers PDF.js document from Zotero reader registry", async () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  const pdfWindow = createPanelWindow();
  pdfWindow.wrappedJSObject = {
    PDFViewerApplication: {
      pdfDocument: {
        numPages: 2,
        async getPage(pageNumber) {
          return {
            async getTextContent() {
              return {
                items: [
                  { str: pageNumber === 1 ? "registry first page" : "registry second page", transform: [1, 0, 0, 1, 10, 700] },
                ],
              };
            },
          };
        },
      },
    },
  };
  bootstrap.Zotero.Reader = {
    _readers: [
      {
        _iframeWindow: createPanelWindow(),
        _internalReader: {
          _primaryView: { _iframeWindow: pdfWindow },
        },
      },
    ],
  };

  const context = await bootstrap.readPaperContext(panelWindow);

  assert.equal(context.pageCount, 2);
  assert.match(context.text, /registry second page/);
});

test("paper context prefers the selected Zotero reader tab over older open readers", async () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  const oldPdfWindow = createPanelWindow();
  const currentPdfWindow = createPanelWindow();
  oldPdfWindow.PDFViewerApplication = {
    pdfDocument: {
      numPages: 3,
      async getPage(pageNumber) {
        return {
          async getTextContent() {
            return {
              items: [
                { str: "old tab page " + pageNumber, transform: [1, 0, 0, 1, 10, 700] },
              ],
            };
          },
        };
      },
    },
  };
  currentPdfWindow.PDFViewerApplication = {
    pdfDocument: {
      numPages: 1,
      async getPage() {
        return {
          async getTextContent() {
            return {
              items: [
                { str: "current selected tab content", transform: [1, 0, 0, 1, 10, 700] },
              ],
            };
          },
        };
      },
    },
  };
  bootstrap.Zotero_Tabs = { selectedID: "reader-current" };
  bootstrap.Zotero.Reader = {
    _readers: [
      {
        tabID: "reader-old",
        _internalReader: {
          _primaryView: { _iframeWindow: oldPdfWindow },
        },
      },
      {
        tabID: "reader-current",
        _internalReader: {
          _primaryView: { _iframeWindow: currentPdfWindow },
        },
      },
    ],
  };

  const context = await bootstrap.readPaperContext(panelWindow);

  assert.equal(context.pageCount, 1);
  assert.match(context.text, /current selected tab content/);
  assert.doesNotMatch(context.text, /old tab/);
});

test("paper chat session key follows the selected Zotero reader tab", () => {
  const bootstrap = loadBootstrap();
  const panelWindow = createPanelWindow();
  bootstrap.Zotero_Tabs = { selectedID: "reader-one" };
  bootstrap.Zotero.Reader = {
    _readers: [
      { tabID: "reader-one" },
      { tabID: "reader-two" },
    ],
  };

  const firstSession = bootstrap.getPaperChatSession(panelWindow, "ask-pdf");
  firstSession.paperContext = { text: "first paper", pageCount: 1 };
  bootstrap.Zotero_Tabs.selectedID = "reader-two";
  const secondSession = bootstrap.getPaperChatSession(panelWindow, "ask-pdf");

  assert.notEqual(firstSession, secondSession);
  assert.equal(secondSession.paperContext, null);
});
