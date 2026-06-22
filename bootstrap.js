var Services;
try {
  ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (_error) {
  try {
    ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
  } catch (_ignored) {
    Services = null;
  }
}

const PLUGIN_ID = "paper-translation-popup@lobster.local";
const PREF_TOKEN = "extensions.paperTranslationPopup.openaiToken";
const PREF_MODEL = "extensions.paperTranslationPopup.openaiModel";
const PREF_PANEL_WIDTH = "extensions.paperTranslationPopup.panelWidth";
const DEFAULT_MODEL = "gpt-4o-mini";
const CONTEXT_WINDOW = 600;
const DEFAULT_PAPER_CONTEXT_MAX_CHARS = 180000;
const DEFAULT_PANEL_WIDTH = 390;
const MIN_PANEL_WIDTH = 320;
const PANEL_VIEWPORT_MARGIN = 24;
const HTML_NS = "http://www.w3.org/1999/xhtml";

var rootURI;
var chromeHandle;
var translatorAPI;
var pluginWindows = new Set();
var paperChatSessions = new WeakMap();
var panelTranslationValues = new WeakMap();

function install() {}

function uninstall() {}

async function startup(data) {
  rootURI = normalizeRootURI(data);
  registerChrome();
  loadTranslator();
  setDefaultPreferences();
  try {
    registerPreferencePane();
  } catch (error) {
    logError("Preference pane registration failed", error);
  }

  const mainWindow = getMainWindow();
  if (mainWindow) {
    onMainWindowLoad({ window: mainWindow });
  }
}

function normalizeRootURI(data) {
  if (data && typeof data.rootURI === "string") {
    return data.rootURI;
  }
  if (data && data.rootURI && data.rootURI.spec) {
    return data.rootURI.spec;
  }
  if (data && data.resourceURI && data.resourceURI.spec) {
    return data.resourceURI.spec;
  }
  return "";
}

function shutdown() {
  for (const win of pluginWindows) {
    removeFromWindow(win);
  }
  pluginWindows.clear();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function onMainWindowLoad({ window }) {
  addToWindow(window);
}

function onMainWindowUnload({ window }) {
  removeFromWindow(window);
}

function setDefaultPreferences() {
  const currentModel = Zotero.Prefs.get(PREF_MODEL);
  if (typeof currentModel !== "string" || currentModel === "undefined" || !currentModel) {
    Zotero.Prefs.set(PREF_MODEL, DEFAULT_MODEL);
  }
}

function registerPreferencePane() {
  if (!Zotero.PreferencePanes || !Zotero.PreferencePanes.register) {
    return;
  }

  Zotero.PreferencePanes.register({
    pluginID: PLUGIN_ID,
    src: rootURI + "content/preferences.xhtml",
    scripts: [rootURI + "content/preferences.js"],
    stylesheets: [rootURI + "content/styles.css"],
    label: "ScholarMate",
    defaultXUL: true,
  });
}

function registerChrome() {
  if (!rootURI || chromeHandle) {
    return;
  }

  try {
    const addonStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
      .getService(Components.interfaces.amIAddonManagerStartup);
    const manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = addonStartup.registerChrome(manifestURI, [
      ["content", "paper-translation-popup", rootURI + "content/"],
    ]);
  } catch (error) {
    logError("Chrome registration failed", error);
    chromeHandle = null;
  }
}

function contentURL(path) {
  if (chromeHandle) {
    return "chrome://paper-translation-popup/content/" + path;
  }
  return rootURI + "content/" + path;
}

function getMainWindow() {
  if (typeof Zotero.getMainWindow === "function") {
    return Zotero.getMainWindow();
  }
  if (!Services) {
    return null;
  }
  return Services.wm.getMostRecentWindow("navigator:browser");
}

function addToWindow(window) {
  if (!window || !window.document || window.document.getElementById("paper-translation-popup-menuitem")) {
    return;
  }

  const doc = window.document;
  const menuPopup = doc.getElementById("menu_ToolsPopup");
  const keySet = getOrCreateKeySet(doc);

  const key = doc.createXULElement("key");
  key.id = "paper-translation-popup-key";
  key.setAttribute("key", "t");
  key.setAttribute("modifiers", "accel,shift");
  key.addEventListener("command", () => togglePanel(window));
  keySet.appendChild(key);

  if (menuPopup) {
    const menuItem = doc.createXULElement("menuitem");
    menuItem.id = "paper-translation-popup-menuitem";
    menuItem.setAttribute("label", "翻译划取内容");
    menuItem.setAttribute("key", "paper-translation-popup-key");
    menuItem.addEventListener("command", () => togglePanel(window));
    menuPopup.appendChild(menuItem);
  }

  installShortcutListeners(window);
  window.setTimeout(() => installShortcutListeners(window), 1000);
  window.setTimeout(() => installShortcutListeners(window), 3000);
  pluginWindows.add(window);
}

function removeFromWindow(window) {
  if (!window || !window.document) {
    return;
  }

  const doc = window.document;
  removeShortcutListeners(window);
  for (const id of ["paper-translation-popup-menuitem", "paper-translation-popup-key", "paper-translation-popup-panel"]) {
    const node = doc.getElementById(id);
    if (node) {
      node.remove();
    }
  }
  pluginWindows.delete(window);
}

function getOrCreateKeySet(doc) {
  let keySet = doc.getElementById("paper-translation-popup-keyset");
  if (keySet) {
    return keySet;
  }

  keySet = doc.createXULElement("keyset");
  keySet.id = "paper-translation-popup-keyset";
  doc.documentElement.appendChild(keySet);
  return keySet;
}

function installShortcutListeners(rootWindow) {
  const installed = rootWindow.__paperTranslationPopupShortcutListeners || [];
  rootWindow.__paperTranslationPopupShortcutListeners = installed;

  for (const targetWindow of getNestedWindows(rootWindow)) {
    if (installed.some((entry) => entry.window === targetWindow)) {
      continue;
    }
    const handler = (event) => {
      if (!isPanelShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      togglePanel(rootWindow);
    };
    targetWindow.addEventListener("keydown", handler, true);
    installed.push({ window: targetWindow, handler });
  }
}

function removeShortcutListeners(rootWindow) {
  const installed = rootWindow.__paperTranslationPopupShortcutListeners || [];
  for (const { window: targetWindow, handler } of installed) {
    try {
      targetWindow.removeEventListener("keydown", handler, true);
    } catch (_error) {
      // Ignore detached reader frames.
    }
  }
  rootWindow.__paperTranslationPopupShortcutListeners = [];
}

function isPanelShortcut(event) {
  const key = String(event.key || "").toLowerCase();
  const accelPressed = Zotero.isMac ? event.metaKey : event.ctrlKey;
  return key === "t" && accelPressed && event.shiftKey && !event.altKey;
}

function getNestedWindows(rootWindow) {
  const windows = [];
  collectNestedWindows(rootWindow, windows, 0);
  return windows;
}

function collectNestedWindows(candidateWindow, windows, depth) {
  if (!candidateWindow || windows.indexOf(candidateWindow) !== -1 || depth > 4) {
    return;
  }
  windows.push(candidateWindow);

  try {
    for (let index = 0; index < candidateWindow.frames.length; index++) {
      collectNestedWindows(candidateWindow.frames[index], windows, depth + 1);
    }
  } catch (_error) {
    // Ignore inaccessible frames.
  }

  try {
    const embedded = candidateWindow.document.querySelectorAll("browser, iframe");
    for (const element of embedded) {
      collectNestedWindows(element.contentWindow, windows, depth + 1);
    }
  } catch (_error) {
    // Ignore inaccessible embedded documents.
  }
}

function loadTranslator() {
  if (translatorAPI) {
    return;
  }
  translatorAPI = {
    translate: translateWithOpenAI,
    askPaper: askPaperWithOpenAI,
  };
}

function togglePanel(window) {
  const panel = getOrCreatePanel(window);
  const isHidden = isPanelHidden(panel);
  if (isHidden) {
    showPanel(panel);
  } else {
    hidePanel(panel);
  }
  if (isHidden) {
    installShortcutListeners(window);
  }
}

function isPanelHidden(panel) {
  return panel.hasAttribute("hidden") || panel.style.display === "none";
}

function showPanel(panel) {
  panel.removeAttribute("hidden");
  panel.style.display = "flex";
}

function hidePanel(panel) {
  panel.setAttribute("hidden", "hidden");
  panel.style.display = "none";
}

function getOrCreatePanel(window) {
  const doc = window.document;
  let panel = doc.getElementById("paper-translation-popup-panel");
  if (panel) {
    return panel;
  }

  installAssistantStyles(doc);

  panel = doc.createElementNS(HTML_NS, "div");
  panel.id = "paper-translation-popup-panel";
  panel.setAttribute("hidden", "hidden");
  panel.setAttribute("style", [
    "position: fixed",
    "right: 0",
    "top: 48px",
    "bottom: 0",
    "width: " + readPanelWidthPreference(window) + "px",
    "min-width: " + MIN_PANEL_WIDTH + "px",
    "max-width: calc(100vw - " + PANEL_VIEWPORT_MARGIN + "px)",
    "z-index: 2147483647",
    "box-sizing: border-box",
    "display: none",
    "flex-direction: column",
    "border-left: 1px solid #cbd5e1",
    "background: #f8fafc",
    "box-shadow: -14px 0 34px rgba(15, 23, 42, 0.18)",
    "font: menu",
    "color: #0f172a",
  ].join(";"));
  panel.setAttribute("data-assistant-mode", "translate");

  panel.appendChild(createPanelResizeHandle(doc, window));
  panel.appendChild(createAssistantHeader(doc));
  panel.appendChild(createAssistantTabs(doc, window));

  const body = doc.createElementNS(HTML_NS, "div");
  body.setAttribute("style", [
    "display: flex",
    "flex: 1",
    "min-height: 0",
    "flex-direction: column",
    "gap: 12px",
    "padding: 14px",
    "overflow: hidden",
  ].join(";"));

  const toolbar = doc.createElementNS(HTML_NS, "div");
  toolbar.id = "paper-translation-popup-toolbar";
  toolbar.setAttribute("style", "display: flex; align-items: center; gap: 10px;");

  const actionButton = createPrimaryActionButton(doc);
  actionButton.id = "paper-translation-popup-action";
  actionButton.textContent = "翻译";
  actionButton.addEventListener("click", () => runAssistantAction(window));
  toolbar.appendChild(actionButton);
  toolbar.appendChild(createPanelStatus(doc, "paper-translation-popup-status", "请在论文中划取文字后点击翻译。"));
  body.appendChild(toolbar);

  const questionSection = createAssistantSection(doc);
  questionSection.id = "paper-translation-popup-question-section";
  questionSection.setAttribute("style", [
    questionSection.getAttribute("style"),
    "display: none",
    "flex-direction: column",
    "gap: 8px",
  ].join(";"));
  questionSection.appendChild(createPanelLabel(doc, "问题"));
  const questionInput = createPanelTextarea(doc, "paper-translation-popup-question", false, "82px");
  questionInput.setAttribute("placeholder", "总结这篇论文");
  questionInput.addEventListener("keydown", (event) => handleQuestionKeydown(window, event));
  questionSection.appendChild(questionInput);
  const askActionRow = doc.createElementNS(HTML_NS, "div");
  askActionRow.id = "paper-translation-popup-ask-status-row";
  askActionRow.setAttribute("style", [
    "display: none",
    "align-items: center",
    "gap: 10px",
  ].join(";"));
  const askButton = createPrimaryActionButton(doc);
  askButton.id = "paper-translation-popup-ask-action";
  askButton.textContent = "提问";
  askButton.addEventListener("click", () => runAssistantAction(window));
  askActionRow.appendChild(askButton);
  askActionRow.appendChild(createPanelStatus(doc, "paper-translation-popup-ask-status", ""));
  questionSection.appendChild(askActionRow);
  body.appendChild(questionSection);

  const resultSection = createAssistantSection(doc);
  resultSection.setAttribute("style", [
    resultSection.getAttribute("style"),
    "display: flex",
    "flex: 1",
    "min-height: 0",
    "flex-direction: column",
  ].join(";"));
  const resultHeader = doc.createElementNS(HTML_NS, "div");
  resultHeader.setAttribute("style", "display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px;");
  const resultLabel = createPanelLabel(doc, "翻译结果");
  resultLabel.id = "paper-translation-popup-result-label";
  resultHeader.appendChild(resultLabel);
  const resultActions = doc.createElementNS(HTML_NS, "div");
  resultActions.setAttribute("style", "display: flex; align-items: center; gap: 6px;");
  resultActions.appendChild(createClearChatButton(doc, window));
  resultActions.appendChild(createCopyButton(doc, window));
  resultHeader.appendChild(resultActions);
  resultSection.appendChild(resultHeader);
  resultSection.appendChild(createPanelTextarea(doc, "paper-translation-popup-result", true, "240px"));
  resultSection.appendChild(createMarkdownResultView(doc));
  body.appendChild(resultSection);

  panel.appendChild(body);

  doc.documentElement.appendChild(panel);
  updateAssistantMode(window, "translate");
  return panel;
}

function createPrimaryActionButton(doc) {
  const button = doc.createElementNS(HTML_NS, "button");
  button.type = "button";
  button.setAttribute("style", [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "min-width: 72px",
    "height: 34px",
    "padding: 0 14px",
    "border: 1px solid #1d4ed8",
    "border-radius: 7px",
    "background: #1d4ed8",
    "color: #ffffff",
    "font-weight: 600",
    "line-height: 1.2",
    "cursor: pointer",
  ].join(";"));
  return button;
}

function createPanelResizeHandle(doc, window) {
  const handle = doc.createElementNS(HTML_NS, "div");
  handle.id = "paper-translation-popup-resize-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("title", "拖拽调整宽度");
  handle.setAttribute("style", [
    "position: absolute",
    "left: -4px",
    "top: 0",
    "bottom: 0",
    "width: 8px",
    "z-index: 1",
    "cursor: ew-resize",
    "touch-action: none",
  ].join(";"));
  handle.addEventListener("mousedown", (event) => startPanelResize(window, event));
  return handle;
}

function startPanelResize(window, event) {
  if (event.button !== 0) {
    return;
  }
  const panel = window.document.getElementById("paper-translation-popup-panel");
  if (!panel) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const startWidth = panel.getBoundingClientRect().width || readPanelWidthPreference(window);
  const startClientX = getResizeEventX(event);
  const targets = getNestedWindows(window);
  const root = window.document.documentElement;
  const previousCursor = root.style.cursor;
  const previousUserSelect = root.style.userSelect;
  root.style.cursor = "ew-resize";
  root.style.userSelect = "none";

  const onMouseMove = (moveEvent) => {
    moveEvent.preventDefault();
    const nextWidth = calculatePanelDragWidth({
      startWidth,
      startClientX,
      currentClientX: getResizeEventX(moveEvent),
      viewportWidth: getViewportWidth(window),
    });
    applyPanelWidth(panel, nextWidth);
  };
  const finishResize = (finishEvent) => {
    if (finishEvent) {
      finishEvent.preventDefault();
    }
    for (const targetWindow of targets) {
      try {
        targetWindow.removeEventListener("mousemove", onMouseMove, true);
        targetWindow.removeEventListener("mouseup", finishResize, true);
      } catch (_error) {
        // Ignore inaccessible frames during cleanup.
      }
    }
    root.style.cursor = previousCursor;
    root.style.userSelect = previousUserSelect;
    persistPanelWidth(panel.getBoundingClientRect().width || readPanelWidthPreference(window));
  };

  for (const targetWindow of targets) {
    try {
      targetWindow.addEventListener("mousemove", onMouseMove, true);
      targetWindow.addEventListener("mouseup", finishResize, true);
    } catch (_error) {
      // Ignore inaccessible frames.
    }
  }
}

function getResizeEventX(event) {
  return Number.isFinite(event.screenX) ? event.screenX : event.clientX;
}

function applyPanelWidth(panel, width) {
  panel.style.width = Math.round(width) + "px";
}

function readPanelWidthPreference(window) {
  const value = Number(Zotero.Prefs.get(PREF_PANEL_WIDTH));
  return calculatePanelDragWidth({
    startWidth: value || DEFAULT_PANEL_WIDTH,
    startClientX: 0,
    currentClientX: 0,
    viewportWidth: getViewportWidth(window),
  });
}

function persistPanelWidth(width) {
  Zotero.Prefs.set(PREF_PANEL_WIDTH, Math.round(width));
}

function calculatePanelDragWidth(options) {
  const source = options || {};
  const startWidth = Number(source.startWidth) || DEFAULT_PANEL_WIDTH;
  const startClientX = Number(source.startClientX) || 0;
  const currentClientX = Number(source.currentClientX) || 0;
  const viewportWidth = Number(source.viewportWidth) || 0;
  const maxWidth = viewportWidth > 0
    ? Math.max(MIN_PANEL_WIDTH, viewportWidth - PANEL_VIEWPORT_MARGIN)
    : Number.POSITIVE_INFINITY;
  const nextWidth = startWidth + startClientX - currentClientX;
  return Math.round(Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, nextWidth)));
}

function getViewportWidth(window) {
  return window.innerWidth || window.document.documentElement.clientWidth || 0;
}

function installAssistantStyles(doc) {
  if (doc.getElementById("paper-translation-popup-styles")) {
    return;
  }
  const style = doc.createElementNS(HTML_NS, "style");
  style.id = "paper-translation-popup-styles";
  style.textContent = [
    "#paper-translation-popup-markdown-result h1,",
    "#paper-translation-popup-markdown-result h2,",
    "#paper-translation-popup-markdown-result h3,",
    "#paper-translation-popup-markdown-result h4 { margin: 0 0 10px; color: #0f172a; line-height: 1.25; }",
    "#paper-translation-popup-markdown-result p { margin: 0 0 12px; }",
    "#paper-translation-popup-markdown-result ul,",
    "#paper-translation-popup-markdown-result ol { margin: 0 0 12px 20px; padding: 0; }",
    "#paper-translation-popup-markdown-result li { margin: 4px 0; }",
    "#paper-translation-popup-markdown-result code { border-radius: 5px; padding: 1px 4px; background: #f1f5f9; color: #0f172a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }",
    "#paper-translation-popup-markdown-result pre { overflow: auto; margin: 0 0 12px; border-radius: 8px; padding: 12px; background: #0f172a; }",
    "#paper-translation-popup-markdown-result pre code { padding: 0; color: #e2e8f0; background: transparent; }",
    "#paper-translation-popup-markdown-result .scholarmate-message { margin: 0 0 16px; }",
    "#paper-translation-popup-markdown-result .scholarmate-speaker { margin: 0 0 6px; font-weight: 700; color: #334155; }",
    "#paper-translation-popup-markdown-result .scholarmate-message-user .scholarmate-body { white-space: pre-wrap; color: #334155; }",
    "#paper-translation-popup-markdown-result .scholarmate-message-assistant .scholarmate-body { color: #0f172a; }",
    "#paper-translation-popup-markdown-result hr { margin: 14px 0; border: 0; border-top: 1px solid #e2e8f0; }",
  ].join("\n");
  const head = doc.querySelector("head");
  if (head) {
    head.appendChild(style);
  } else {
    doc.documentElement.appendChild(style);
  }
}

function createPanelLabel(doc, value) {
  const label = doc.createElementNS(HTML_NS, "div");
  label.textContent = value;
  label.setAttribute("style", "font-weight: 700; color: #0f172a;");
  return label;
}

function createPanelTextarea(doc, id, readonly, minHeight) {
  const textarea = doc.createElementNS(HTML_NS, "textarea");
  textarea.id = id;
  textarea.readOnly = readonly;
  textarea.setAttribute("style", [
    "width: 100%",
    "min-height: " + minHeight,
    "flex: 1",
    "box-sizing: border-box",
    "border: 1px solid #cbd5e1",
    "border-radius: 8px",
    "padding: 10px",
    "background: #fff",
    "color: #111827",
    "resize: vertical",
    "line-height: 1.55",
    "font: menu",
  ].join(";"));
  return textarea;
}

function createMarkdownResultView(doc) {
  const view = doc.createElementNS(HTML_NS, "div");
  view.id = "paper-translation-popup-markdown-result";
  view.setAttribute("style", [
    "display: none",
    "flex: 1",
    "min-height: 320px",
    "box-sizing: border-box",
    "overflow: auto",
    "border: 1px solid #cbd5e1",
    "border-radius: 8px",
    "padding: 14px",
    "background: #ffffff",
    "color: #111827",
    "line-height: 1.62",
    "font: menu",
  ].join(";"));
  return view;
}

function createPanelStatus(doc, id, value) {
  const status = doc.createElementNS(HTML_NS, "span");
  status.id = id;
  status.textContent = value;
  status.setAttribute("style", "flex: 1; min-width: 0; color: #475569; line-height: 1.4;");
  return status;
}

function createAssistantHeader(doc) {
  const header = doc.createElementNS(HTML_NS, "div");
  header.setAttribute("style", [
    "display: flex",
    "align-items: center",
    "justify-content: space-between",
    "gap: 10px",
    "padding: 14px",
    "border-bottom: 1px solid #e2e8f0",
    "background: #ffffff",
  ].join(";"));

  const titleWrap = doc.createElementNS(HTML_NS, "div");
  const title = doc.createElementNS(HTML_NS, "div");
  title.textContent = "ScholarMate";
  title.setAttribute("style", "font-size: 14px; font-weight: 700; color: #0f172a;");
  const subtitle = doc.createElementNS(HTML_NS, "div");
  subtitle.textContent = "阅读助手";
  subtitle.setAttribute("style", "margin-top: 2px; font-size: 12px; color: #64748b;");
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);

  const closeButton = doc.createElementNS(HTML_NS, "button");
  closeButton.type = "button";
  closeButton.textContent = "x";
  closeButton.setAttribute("aria-label", "关闭 ScholarMate");
  closeButton.setAttribute("style", [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "width: 28px",
    "height: 28px",
    "padding: 0",
    "border: 1px solid #cbd5e1",
    "border-radius: 7px",
    "background: #f8fafc",
    "color: #334155",
    "font-weight: 700",
    "line-height: 1",
    "cursor: pointer",
  ].join(";"));
  closeButton.addEventListener("click", () => {
    const panel = doc.getElementById("paper-translation-popup-panel");
    if (panel) {
      hidePanel(panel);
    }
  });

  header.appendChild(titleWrap);
  header.appendChild(closeButton);
  return header;
}

function createAssistantTabs(doc, window) {
  const tabs = doc.createElementNS(HTML_NS, "div");
  tabs.setAttribute("style", [
    "display: grid",
    "grid-template-columns: repeat(3, minmax(0, 1fr))",
    "gap: 6px",
    "padding: 10px 14px",
    "border-bottom: 1px solid #e2e8f0",
    "background: #f8fafc",
  ].join(";"));

  tabs.appendChild(createAssistantTab(doc, window, "translate", "翻译", true));
  tabs.appendChild(createAssistantTab(doc, window, "ask-pdf", "问全文", false));
  tabs.appendChild(createAssistantTab(doc, window, "ask-select", "问选区", false));
  return tabs;
}

function createAssistantTab(doc, window, mode, value, active) {
  const tab = doc.createElementNS(HTML_NS, "button");
  tab.type = "button";
  tab.textContent = value;
  tab.setAttribute("data-assistant-tab", mode);
  tab.addEventListener("click", () => updateAssistantMode(window, mode));
  setAssistantTabStyle(tab, active);
  return tab;
}

function setAssistantTabStyle(tab, active) {
  tab.setAttribute("style", [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "box-sizing: border-box",
    "height: 30px",
    "padding: 0 8px",
    "border: 1px solid " + (active ? "#1d4ed8" : "#cbd5e1"),
    "border-radius: 7px",
    "background: " + (active ? "#dbeafe" : "#ffffff"),
    "color: " + (active ? "#1e3a8a" : "#64748b"),
    "font-weight: 600",
    "line-height: 1.2",
    "cursor: pointer",
  ].join(";"));
}

function updateAssistantMode(window, mode) {
  const doc = window.document;
  const panel = doc.getElementById("paper-translation-popup-panel");
  if (!panel) {
    return;
  }
  const nextMode = mode === "ask-pdf" || mode === "ask-select" ? mode : "translate";
  panel.setAttribute("data-assistant-mode", nextMode);

  for (const tab of doc.querySelectorAll("[data-assistant-tab]")) {
    setAssistantTabStyle(tab, tab.getAttribute("data-assistant-tab") === nextMode);
  }

  const toolbar = doc.getElementById("paper-translation-popup-toolbar");
  if (toolbar) {
    toolbar.style.display = nextMode === "translate" ? "flex" : "none";
  }

  const questionSection = doc.getElementById("paper-translation-popup-question-section");
  if (questionSection) {
    questionSection.style.display = nextMode === "translate" ? "none" : "flex";
  }

  const question = doc.getElementById("paper-translation-popup-question");
  if (question) {
    question.placeholder = nextMode === "ask-select"
      ? "这里提到的概念是什么意思？"
      : "总结这篇论文";
  }

  const actionButton = doc.getElementById("paper-translation-popup-action");
  if (actionButton) {
    actionButton.textContent = "翻译";
    actionButton.style.display = nextMode === "translate" ? "inline-flex" : "none";
  }

  const askButton = doc.getElementById("paper-translation-popup-ask-action");
  if (askButton) {
    askButton.style.display = nextMode === "translate" ? "none" : "inline-flex";
  }

  const askStatusRow = doc.getElementById("paper-translation-popup-ask-status-row");
  if (askStatusRow) {
    askStatusRow.style.display = nextMode === "translate" ? "none" : "flex";
  }

  const resultLabel = doc.getElementById("paper-translation-popup-result-label");
  if (resultLabel) {
    resultLabel.textContent = nextMode === "translate" ? "翻译结果" : "对话";
  }

  const clearButton = doc.getElementById("paper-translation-popup-clear-chat");
  if (clearButton) {
    clearButton.style.display = nextMode === "translate" ? "none" : "inline-flex";
  }

  const resultTextarea = doc.getElementById("paper-translation-popup-result");
  if (resultTextarea) {
    resultTextarea.style.display = nextMode === "translate" ? "block" : "none";
  }
  const markdownResult = doc.getElementById("paper-translation-popup-markdown-result");
  if (markdownResult) {
    markdownResult.style.display = nextMode === "translate" ? "none" : "block";
  }

  renderCurrentModeResult(window);
  setPanelText(window, "paper-translation-popup-status", getInitialModeStatus(nextMode), false);
}

function getAssistantMode(window) {
  const panel = window.document.getElementById("paper-translation-popup-panel");
  const mode = panel && panel.getAttribute("data-assistant-mode");
  return mode === "ask-pdf" || mode === "ask-select" ? mode : "translate";
}

function handleQuestionKeydown(window, event) {
  if (!shouldSubmitQuestionKey({
    mode: getAssistantMode(window),
    key: event.key,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    isComposing: event.isComposing,
  })) {
    return;
  }
  event.preventDefault();
  runAssistantAction(window);
}

function shouldSubmitQuestionKey(event) {
  const source = event || {};
  const mode = source.mode === "ask-pdf" || source.mode === "ask-select" ? source.mode : "translate";
  return mode !== "translate"
    && source.key === "Enter"
    && !source.shiftKey
    && !source.ctrlKey
    && !source.metaKey
    && !source.altKey
    && !source.isComposing;
}

function getInitialModeStatus(mode) {
  if (mode === "ask-pdf") {
    return "输入问题后提问，将读取当前 PDF 全文。";
  }
  if (mode === "ask-select") {
    return "划取论文片段并输入问题，将结合 PDF 全文回答。";
  }
  return "请在论文中划取文字后点击翻译。";
}

function createAssistantSection(doc) {
  const section = doc.createElementNS(HTML_NS, "div");
  section.setAttribute("style", [
    "box-sizing: border-box",
    "border: 1px solid #e2e8f0",
    "border-radius: 8px",
    "background: #ffffff",
    "padding: 12px",
  ].join(";"));
  return section;
}

function createCopyButton(doc, window) {
  const button = doc.createElementNS(HTML_NS, "button");
  button.type = "button";
  button.textContent = "复制";
  button.setAttribute("style", [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "min-height: 28px",
    "padding: 0 10px",
    "border: 1px solid #cbd5e1",
    "border-radius: 7px",
    "background: #f8fafc",
    "color: #334155",
    "font-weight: 600",
    "line-height: 1.2",
    "cursor: pointer",
  ].join(";"));
  button.addEventListener("click", () => copyTranslationResult(window));
  return button;
}

function createClearChatButton(doc, window) {
  const button = doc.createElementNS(HTML_NS, "button");
  button.id = "paper-translation-popup-clear-chat";
  button.type = "button";
  button.textContent = "清空";
  button.setAttribute("style", [
    "display: none",
    "align-items: center",
    "justify-content: center",
    "min-height: 28px",
    "padding: 0 10px",
    "border: 1px solid #cbd5e1",
    "border-radius: 7px",
    "background: #ffffff",
    "color: #334155",
    "font-weight: 600",
    "line-height: 1.2",
    "cursor: pointer",
  ].join(";"));
  button.addEventListener("click", () => clearPaperChatSession(window));
  return button;
}

function runAssistantAction(window) {
  const mode = getAssistantMode(window);
  if (mode === "ask-pdf" || mode === "ask-select") {
    askPaperQuestion(window, mode);
    return;
  }
  translateSelection(window);
}

async function translateSelection(window) {
  const data = readSelectionData(window);
  setTranslationResult(window, "");

  if (!translatorAPI) {
    setPanelText(window, "paper-translation-popup-status", "翻译模块未加载，请重启 Zotero 后重试。", true);
    return;
  }

  const token = String(Zotero.Prefs.get(PREF_TOKEN) || "").trim();
  const model = String(Zotero.Prefs.get(PREF_MODEL) || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (!token) {
    setPanelText(window, "paper-translation-popup-status", "请先在 Zotero 设置中配置 OpenAI access token。", true);
    return;
  }
  if (!data.selectedText) {
    setPanelText(window, "paper-translation-popup-status", "请先在论文阅读器中划取要翻译的文本。", true);
    return;
  }

  setAssistantActionDisabled(window, true);
  setPanelText(window, "paper-translation-popup-status", formatRequestWordCountStatus(data), false);

  try {
    const translation = await translatorAPI.translate({
      fetchImpl: createFetchImpl(),
      token,
      model,
      selectedText: data.selectedText,
      context: data.context,
    });
    setTranslationResult(window, translation);
    setPanelText(window, "paper-translation-popup-status", "翻译完成。", false);
  } catch (error) {
    logError("Translation failed", error);
    setPanelText(window, "paper-translation-popup-status", "翻译失败：" + formatUserFacingError(error), true);
  } finally {
    setAssistantActionDisabled(window, false);
  }
}

async function askPaperQuestion(window, mode) {
  let failureStage = "准备问答";
  if (!translatorAPI) {
    setPanelText(window, "paper-translation-popup-status", "问答模块未加载，请重启 Zotero 后重试。", true);
    return;
  }

  const token = String(Zotero.Prefs.get(PREF_TOKEN) || "").trim();
  const model = String(Zotero.Prefs.get(PREF_MODEL) || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (!token) {
    setPanelText(window, "paper-translation-popup-status", "请先在 Zotero 设置中配置 OpenAI access token。", true);
    return;
  }

  const question = readQuestion(window, mode);
  const session = getPaperChatSession(window, mode);
  const selectionData = mode === "ask-select" ? readSelectionData(window) : { selectedText: "" };
  if (mode === "ask-select" && !selectionData.selectedText && session.messages.length === 0) {
    setPanelText(window, "paper-translation-popup-status", "请先在论文阅读器中划取要提问的片段。", true);
    return;
  }

  setAssistantActionDisabled(window, true);
  setPanelText(window, "paper-translation-popup-status", session.paperContext ? "正在请求 API，沿用已提取的 PDF 全文。" : "正在提取 PDF 全文...", false);

  try {
    if (!session.paperContext) {
      failureStage = "提取 PDF 全文";
      session.paperContext = readPaperContext(window);
    }
    if (!session.paperContext.text) {
      setPanelText(window, "paper-translation-popup-status", "未能读取当前 PDF 正文，请确认已打开论文阅读器。", true);
      return;
    }

    setPanelText(window, "paper-translation-popup-status", formatPaperContextStatus(session.paperContext, session.messages.length > 0), false);
    failureStage = "发送问答请求";
    const answer = await translatorAPI.askPaper({
      fetchImpl: createFetchImpl(),
      token,
      model,
      mode,
      question,
      paperContext: session.paperContext,
      selectedText: selectionData.selectedText,
      conversationMessages: session.messages,
    });
    failureStage = "渲染回答";
    session.messages.push({
      role: "user",
      content: formatConversationUserMessage(question, selectionData.selectedText),
    });
    session.messages.push({ role: "assistant", content: sanitizeTransportText(answer).trim() });
    renderCurrentModeResult(window);
    clearQuestion(window);
    setPanelText(window, "paper-translation-popup-status", "回答完成。", false);
  } catch (error) {
    logError("Paper question failed", error);
    setPanelText(window, "paper-translation-popup-status", "问答失败（" + failureStage + "）：" + formatUserFacingError(error), true);
  } finally {
    setAssistantActionDisabled(window, false);
  }
}

function setAssistantActionDisabled(window, disabled) {
  for (const id of ["paper-translation-popup-action", "paper-translation-popup-ask-action"]) {
    const button = window.document.getElementById(id);
    if (button) {
      button.disabled = disabled;
    }
  }
}

function getPaperChatSession(window, mode) {
  const key = readPaperSessionKey(window);
  const sessionMode = mode === "ask-select" ? "ask-select" : "ask-pdf";
  let state = paperChatSessions.get(window);
  if (!state || state.key !== key) {
    state = { key, sessions: {} };
    paperChatSessions.set(window, state);
  }
  if (!state.sessions[sessionMode]) {
    state.sessions[sessionMode] = { key, mode: sessionMode, paperContext: null, messages: [] };
  }
  return state.sessions[sessionMode];
}

function readPaperSessionKey(window) {
  return String(window.document && window.document.title ? window.document.title : "active-pdf");
}

function clearPaperChatSession(window) {
  const mode = getAssistantMode(window);
  const session = getPaperChatSession(window, mode);
  session.paperContext = null;
  session.messages = [];
  renderCurrentModeResult(window);
  setPanelText(window, "paper-translation-popup-status", getInitialModeStatus(getAssistantMode(window)), false);
}

function formatConversationUserMessage(question, selectedText) {
  const normalizedQuestion = normalizeText(question);
  const normalizedSelection = normalizeText(selectedText);
  if (!normalizedSelection) {
    return normalizedQuestion;
  }
  return normalizedQuestion + "\n\n选区：" + normalizedSelection;
}

function formatConversationTranscript(messages) {
  return messages
    .map((message) => {
      const speaker = message.role === "assistant" ? "ScholarMate" : "你";
      return speaker + "：\n" + message.content;
    })
    .join("\n\n");
}

function clearQuestion(window) {
  const node = window.document.getElementById("paper-translation-popup-question");
  if (node) {
    node.value = "";
  }
}

function readQuestion(window, mode) {
  const node = window.document.getElementById("paper-translation-popup-question");
  const question = node && node.value ? node.value.trim() : "";
  if (question) {
    return question;
  }
  return mode === "ask-select" ? "请解释划取片段在论文中的含义。" : "请总结这篇论文。";
}

function setPanelValue(window, id, value) {
  const node = window.document.getElementById(id);
  const nextValue = value || "";
  if (node) {
    node.value = nextValue;
  }
  if (id === "paper-translation-popup-result") {
    if (getAssistantMode(window) === "translate" || !nextValue) {
      renderResultMarkdown(window, nextValue);
    }
  }
}

function setTranslationResult(window, value) {
  const nextValue = value || "";
  panelTranslationValues.set(window, nextValue);
  if (getAssistantMode(window) === "translate") {
    setPanelValue(window, "paper-translation-popup-result", nextValue);
  }
}

function renderCurrentModeResult(window) {
  const mode = getAssistantMode(window);
  const resultNode = window.document.getElementById("paper-translation-popup-result");
  if (mode === "translate") {
    const value = panelTranslationValues.get(window) || "";
    if (resultNode) {
      resultNode.value = value;
    }
    renderResultMarkdown(window, "");
    return;
  }

  if (resultNode) {
    resultNode.value = "";
  }
  renderConversationMessages(window, getPaperChatSession(window, mode).messages);
}

function renderResultMarkdown(window, markdown) {
  const node = window.document.getElementById("paper-translation-popup-markdown-result");
  if (!node) {
    return;
  }
  try {
    renderMarkdownIntoNode(window.document, node, markdown);
  } catch (error) {
    logError("Markdown render failed", error);
    node.textContent = sanitizeTransportText(markdown);
  }
}

function renderConversationMessages(window, messages) {
  const node = window.document.getElementById("paper-translation-popup-markdown-result");
  if (!node) {
    return;
  }
  clearNode(node);
  for (const message of messages) {
    const role = message && message.role === "assistant" ? "assistant" : "user";
    const container = window.document.createElementNS(HTML_NS, "div");
    container.className = "scholarmate-message scholarmate-message-" + role;

    const speaker = window.document.createElementNS(HTML_NS, "div");
    speaker.className = "scholarmate-speaker";
    speaker.textContent = role === "assistant" ? "ScholarMate" : "你";
    container.appendChild(speaker);

    const body = window.document.createElementNS(HTML_NS, "div");
    body.className = "scholarmate-body";
    if (role === "assistant") {
      appendMarkdownBlocks(window.document, body, message.content || "");
    } else {
      body.textContent = sanitizeTransportText(message.content || "");
    }
    container.appendChild(body);
    node.appendChild(container);
  }
}

function renderMarkdownIntoNode(doc, node, markdown) {
  clearNode(node);
  appendMarkdownBlocks(doc, node, markdown);
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function setPanelText(window, id, value, isError) {
  const node = getPanelTextNode(window, id);
  if (!node) {
    return;
  }
  node.textContent = value || "";
  node.style.color = isError ? "#b91c1c" : "#475569";
}

function getPanelTextNode(window, id) {
  if (id !== "paper-translation-popup-status") {
    return window.document.getElementById(id);
  }
  const mode = getAssistantMode(window);
  const activeId = mode === "translate" ? "paper-translation-popup-status" : "paper-translation-popup-ask-status";
  const inactiveId = mode === "translate" ? "paper-translation-popup-ask-status" : "paper-translation-popup-status";
  const inactive = window.document.getElementById(inactiveId);
  if (inactive) {
    inactive.textContent = "";
    inactive.style.color = "#475569";
  }
  return window.document.getElementById(activeId);
}

async function copyTranslationResult(window) {
  const node = window.document.getElementById("paper-translation-popup-result");
  const mode = getAssistantMode(window);
  const value = mode === "translate"
    ? panelTranslationValues.get(window) || (node && node.value ? node.value : "")
    : formatConversationTranscript(getPaperChatSession(window, mode).messages);
  if (!value) {
    setPanelText(window, "paper-translation-popup-status", getAssistantMode(window) === "translate" ? "暂无可复制的译文。" : "暂无可复制的对话。", true);
    return;
  }

  try {
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      await window.navigator.clipboard.writeText(value);
    } else {
      node.focus();
      node.select();
      window.document.execCommand("copy");
    }
    setPanelText(window, "paper-translation-popup-status", getAssistantMode(window) === "translate" ? "译文已复制。" : "对话已复制。", false);
  } catch (error) {
    logError("Copy failed", error);
    setPanelText(window, "paper-translation-popup-status", "复制失败，请手动选中内容复制。", true);
  }
}

function renderMarkdown(markdown) {
  const normalized = normalizeMarkdownForRendering(markdown);
  const blocks = normalized.split(/\n{2,}/g);
  const html = [];

  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }

    if (/^```/.test(block.trim())) {
      html.push(renderCodeBlock(block));
      continue;
    }

    if (/^-{3,}$/.test(block.trim())) {
      html.push("<hr>");
      continue;
    }

    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      html.push("<ul>" + lines.map((line) => "<li>" + renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, "")) + "</li>").join("") + "</ul>");
      continue;
    }

    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      html.push("<ol>" + lines.map((line) => "<li>" + renderInlineMarkdown(line.replace(/^\s*\d+\.\s+/, "")) + "</li>").join("") + "</ol>");
      continue;
    }

    if (/^#{1,4}\s+/.test(lines[0] || "")) {
      const headingLine = lines[0];
      const level = Math.min(4, headingLine.match(/^#+/)[0].length);
      html.push("<h" + level + ">" + renderInlineMarkdown(headingLine.replace(/^#{1,4}\s+/, "")) + "</h" + level + ">");
      if (lines.length > 1) {
        html.push(renderMarkdown(lines.slice(1).join("\n")));
      }
      continue;
    }

    html.push("<p>" + renderInlineMarkdown(block).replace(/\n/g, "<br>") + "</p>");
  }

  return html.join("");
}

function appendMarkdownBlocks(doc, root, markdown) {
  const normalized = normalizeMarkdownForRendering(markdown);
  const blocks = normalized.split(/\n{2,}/g);
  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }

    if (/^```/.test(block.trim())) {
      root.appendChild(createCodeBlockNode(doc, block));
      continue;
    }

    if (/^-{3,}$/.test(block.trim())) {
      root.appendChild(doc.createElementNS(HTML_NS, "hr"));
      continue;
    }

    const lines = block.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const list = doc.createElementNS(HTML_NS, "ul");
      for (const line of lines) {
        const item = doc.createElementNS(HTML_NS, "li");
        appendInlineMarkdown(doc, item, line.replace(/^\s*[-*]\s+/, ""));
        list.appendChild(item);
      }
      root.appendChild(list);
      continue;
    }

    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      const list = doc.createElementNS(HTML_NS, "ol");
      for (const line of lines) {
        const item = doc.createElementNS(HTML_NS, "li");
        appendInlineMarkdown(doc, item, line.replace(/^\s*\d+\.\s+/, ""));
        list.appendChild(item);
      }
      root.appendChild(list);
      continue;
    }

    if (/^#{1,4}\s+/.test(lines[0] || "")) {
      const headingLine = lines[0];
      const level = Math.min(4, headingLine.match(/^#+/)[0].length);
      const heading = doc.createElementNS(HTML_NS, "h" + level);
      appendInlineMarkdown(doc, heading, headingLine.replace(/^#{1,4}\s+/, ""));
      root.appendChild(heading);
      if (lines.length > 1) {
        appendMarkdownBlocks(doc, root, lines.slice(1).join("\n"));
      }
      continue;
    }

    const paragraph = doc.createElementNS(HTML_NS, "p");
    appendParagraphLines(doc, paragraph, block);
    root.appendChild(paragraph);
  }
}

function appendParagraphLines(doc, node, block) {
  const lines = block.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) {
      node.appendChild(doc.createElementNS(HTML_NS, "br"));
    }
    appendInlineMarkdown(doc, node, line);
  });
}

function appendInlineMarkdown(doc, node, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  const source = sanitizeTransportText(text);
  let match = pattern.exec(source);
  while (match) {
    if (match.index > cursor) {
      node.appendChild(doc.createTextNode(source.slice(cursor, match.index)));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      const code = doc.createElementNS(HTML_NS, "code");
      code.textContent = token.slice(1, -1);
      node.appendChild(code);
    } else if (token.startsWith("**")) {
      const strong = doc.createElementNS(HTML_NS, "strong");
      strong.textContent = token.slice(2, -2);
      node.appendChild(strong);
    } else {
      const emphasis = doc.createElementNS(HTML_NS, "em");
      emphasis.textContent = token.slice(1, -1);
      node.appendChild(emphasis);
    }
    cursor = match.index + token.length;
    match = pattern.exec(source);
  }
  if (cursor < source.length) {
    node.appendChild(doc.createTextNode(source.slice(cursor)));
  }
}

function createCodeBlockNode(doc, block) {
  const lines = block.split("\n");
  const firstLine = lines[0] || "";
  const lastLine = lines[lines.length - 1] || "";
  const hasClosingFence = /^```/.test(lastLine.trim()) && lines.length > 1;
  const codeLines = lines.slice(1, hasClosingFence ? -1 : undefined);
  const language = firstLine.replace(/^```/, "").trim();
  const pre = doc.createElementNS(HTML_NS, "pre");
  const code = doc.createElementNS(HTML_NS, "code");
  if (language) {
    code.className = "language-" + sanitizeTransportText(language);
  }
  code.textContent = sanitizeTransportText(codeLines.join("\n"));
  pre.appendChild(code);
  return pre;
}

function normalizeMarkdownForRendering(markdown) {
  return sanitizeTransportText(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+-{3,}[ \t]+/g, "\n\n---\n\n")
    .replace(/[ \t]+(#{1,4}\s+)/g, "\n\n$1")
    .replace(/[ \t]+([-*]\s+)/g, "\n$1");
}

function renderCodeBlock(block) {
  const lines = block.split("\n");
  const firstLine = lines[0] || "";
  const lastLine = lines[lines.length - 1] || "";
  const hasClosingFence = /^```/.test(lastLine.trim()) && lines.length > 1;
  const codeLines = lines.slice(1, hasClosingFence ? -1 : undefined);
  const language = firstLine.replace(/^```/, "").trim();
  const languageClass = language ? " class=\"language-" + escapeHtml(language) + "\"" : "";
  return "<pre><code" + languageClass + ">" + escapeHtml(codeLines.join("\n")) + "</code></pre>";
}

function renderInlineMarkdown(text) {
  const codeSpans = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
    const token = "\u0000CODE" + codeSpans.length + "\u0000";
    codeSpans.push("<code>" + code + "</code>");
    return token;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)] || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUserFacingError(error) {
  const rawMessage = error && error.message ? error.message : String(error || "");
  const message = rawMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .trim();
  return message || "请检查网络、模型名或 OpenAI access token。";
}

function formatRequestWordCountStatus(selectionData) {
  return "正在请求 API，已传输 " + countExtractedWords(selectionData) + " 个单词。";
}

function formatPaperContextStatus(paperContext, reusedContext) {
  const parts = reusedContext
    ? ["正在请求 API，沿用已提取的 " + paperContext.pageCount + " 页 PDF 全文"]
    : [
      "正在请求 API，已提取 " + paperContext.pageCount + " 页",
      "移除 " + paperContext.removedMarginLineCount + " 条重复页眉/页脚",
    ];
  if (paperContext.truncated) {
    parts.push("因篇幅较长已截断");
  }
  return parts.join("，") + "。";
}

function readPaperContext(window) {
  let bestPages = [];
  for (const candidateWindow of getCandidateWindows(window)) {
    const pages = extractPaperPagesFromWindow(candidateWindow);
    if (countPageTextChars(pages) > countPageTextChars(bestPages)) {
      bestPages = pages;
    }
  }
  return buildPaperContext(bestPages, { maxChars: DEFAULT_PAPER_CONTEXT_MAX_CHARS });
}

function countPageTextChars(pages) {
  return pages.reduce((total, page) => total + String(page.text || "").length, 0);
}

function extractPaperPagesFromWindow(candidateWindow) {
  try {
    if (!candidateWindow || !candidateWindow.document || !candidateWindow.document.querySelectorAll) {
      return [];
    }
    const doc = candidateWindow.document;
    const rawNodes = Array.from(doc.querySelectorAll(".page, [data-page-number]"));
    const pageNodes = rawNodes
      .filter((node) => isTopLevelPageNode(node, rawNodes))
      .map((node, index) => ({
        node,
        pageNumber: readPageNumber(node, index),
      }))
      .sort((left, right) => left.pageNumber - right.pageNumber);

    return pageNodes
      .map(({ node, pageNumber }) => ({
        pageNumber,
        text: serializePageText(node),
      }))
      .filter((page) => normalizeText(page.text));
  } catch (error) {
    logError("PDF page extraction failed", error);
    return [];
  }
}

function isTopLevelPageNode(node, allNodes) {
  if (!normalizeText(node.textContent || "")) {
    return false;
  }
  return !allNodes.some((other) => other !== node && other.contains(node) && readPageNumber(other, 0) === readPageNumber(node, 0));
}

function readPageNumber(node, fallbackIndex) {
  const raw = node.getAttribute("data-page-number")
    || node.getAttribute("data-page")
    || node.getAttribute("aria-label")
    || "";
  const match = String(raw).match(/\d+/);
  return match ? Number(match[0]) : fallbackIndex + 1;
}

function serializePageText(pageNode) {
  const textLayer = pageNode.querySelector(".textLayer") || pageNode;
  const spanItems = Array.from(textLayer.querySelectorAll("span"))
    .map(readTextLayerItem)
    .filter((item) => item.text);
  if (spanItems.length) {
    return groupTextLayerItems(spanItems).join("\n");
  }

  const text = textLayer.innerText || textLayer.textContent || "";
  return String(text)
    .split(/\r?\n/g)
    .map(normalizeLine)
    .filter(Boolean)
    .join("\n");
}

function readTextLayerItem(element) {
  const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
  return {
    text: normalizeLine(element.textContent || ""),
    top: rect ? rect.top : 0,
    left: rect ? rect.left : 0,
  };
}

function groupTextLayerItems(items) {
  const sorted = items.slice().sort((left, right) => {
    if (Math.abs(left.top - right.top) > 3) {
      return left.top - right.top;
    }
    return left.left - right.left;
  });
  const lines = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.top - item.top) > 3) {
      lines.push({ top: item.top, parts: [item.text] });
    } else {
      last.parts.push(item.text);
    }
  }
  return lines
    .map((line) => normalizeLine(line.parts.join(" ")))
    .filter(Boolean);
}

function buildPaperContext(pages, options) {
  const sourcePages = Array.isArray(pages) ? pages : [];
  const maxChars = Number(options && options.maxChars) > 0
    ? Number(options.maxChars)
    : DEFAULT_PAPER_CONTEXT_MAX_CHARS;
  const normalizedPages = sourcePages
    .map((page, index) => normalizePaperPage(page, index))
    .filter((page) => page.lines.length > 0);
  const repeatedMarginSignatures = detectRepeatedMarginSignatures(normalizedPages);
  let removedMarginLineCount = 0;

  const text = normalizedPages
    .map((page) => {
      const keptLines = page.lines.filter((line, index) => {
        const isMargin = index < 3 || index >= page.lines.length - 3;
        const signature = normalizeMarginSignature(line);
        const shouldRemove = isMargin && (isPageNumberLine(line) || repeatedMarginSignatures.has(signature));
        if (shouldRemove) {
          removedMarginLineCount += 1;
        }
        return !shouldRemove;
      });
      return "[[page " + page.pageNumber + "]]\n" + keptLines.join("\n");
    })
    .join("\n\n")
    .trim();
  const originalCharCount = text.length;
  const truncated = originalCharCount > maxChars;

  return {
    text: truncated ? sanitizeTransportText(text.slice(0, maxChars)) : sanitizeTransportText(text),
    pageCount: normalizedPages.length,
    removedMarginLineCount,
    originalCharCount,
    truncated,
  };
}

function normalizePaperPage(page, index) {
  const source = page || {};
  const pageNumber = Number(source.pageNumber) > 0 ? Number(source.pageNumber) : index + 1;
  const rawLines = Array.isArray(source.lines) ? source.lines : String(source.text || "").split(/\r?\n/g);
  const lines = rawLines.map(normalizeLine).filter(Boolean);
  return { pageNumber, lines };
}

function detectRepeatedMarginSignatures(pages) {
  const counts = new Map();
  for (const page of pages) {
    const seenOnPage = new Set();
    const candidates = page.lines.slice(0, 3).concat(page.lines.slice(Math.max(0, page.lines.length - 3)));
    for (const line of candidates) {
      const signature = normalizeMarginSignature(line);
      if (!signature || signature.length < 3 || isPageNumberLine(line) || seenOnPage.has(signature)) {
        continue;
      }
      seenOnPage.add(signature);
      counts.set(signature, (counts.get(signature) || 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.35));
  const repeated = new Set();
  for (const [signature, count] of counts) {
    if (count >= threshold) {
      repeated.add(signature);
    }
  }
  return repeated;
}

function normalizeMarginSignature(line) {
  return String(line || "")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLine(line) {
  return sanitizeTransportText(line)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isPageNumberLine(line) {
  return /^\s*(?:page\s*)?\d+\s*$/i.test(String(line || ""));
}

function countExtractedWords({ selectedText, context }) {
  const selected = normalizeText(selectedText);
  const expandedContext = normalizeText(context);
  if (!expandedContext) {
    return countWords(selected);
  }
  if (!selected || expandedContext.indexOf(selected) !== -1) {
    return countWords(expandedContext);
  }
  return countWords(selected) + countWords(expandedContext);
}

function countWords(text) {
  const matches = String(text || "").match(/[A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)*/g);
  return matches ? matches.length : 0;
}

function readSelectionData(window) {
  installShortcutListeners(window);

  for (const candidateWindow of getCandidateWindows(window)) {
    const data = readSelectionFromWindow(candidateWindow);
    if (data.selectedText) {
      return data;
    }
  }
  return { selectedText: "", context: "", hasContext: false };
}

function getCandidateWindows(window) {
  const candidates = [];
  addCandidate(candidates, window);
  addCandidate(candidates, window.document.commandDispatcher && window.document.commandDispatcher.focusedWindow);
  addCandidate(candidates, window.document.activeElement && window.document.activeElement.contentWindow);

  const browsers = window.document.querySelectorAll("browser");
  for (const browser of browsers) {
    addCandidate(candidates, browser.contentWindow);
  }

  for (const nestedWindow of getNestedWindows(window)) {
    addCandidate(candidates, nestedWindow);
  }

  return candidates;
}

function addCandidate(candidates, candidate) {
  if (candidate && candidates.indexOf(candidate) === -1) {
    candidates.push(candidate);
  }
}

function readSelectionFromWindow(candidateWindow) {
  try {
    if (!candidateWindow || typeof candidateWindow.getSelection !== "function") {
      return { selectedText: "", context: "", hasContext: false };
    }

    const selection = candidateWindow.getSelection();
    const fallbackText = normalizeText(selection ? selection.toString() : "");
    const copiedText = readSelectedTextByCopy(candidateWindow, selection);
    const selectedText = copiedText || fallbackText;
    if (!selectedText) {
      return { selectedText: "", context: "", hasContext: false };
    }

    const context = readContextFromSelection(selection, selectedText) || readContextFromSelection(selection, fallbackText);
    return { selectedText, context, hasContext: Boolean(context) };
  } catch (error) {
    logError("Selection read failed", error);
    return { selectedText: "", context: "", hasContext: false };
  }
}

function readContextFromSelection(selection, selectedText) {
  if (!selection || !selection.rangeCount) {
    return "";
  }

  const range = selection.getRangeAt(0);
  const node = getContextContainerNode(range.commonAncestorContainer);
  const rangeContext = readContextFromRange(node, range);
  if (rangeContext) {
    return rangeContext;
  }

  const containerText = normalizeText(node && node.textContent ? node.textContent : "");
  if (!containerText) {
    return "";
  }

  const index = containerText.indexOf(selectedText);
  if (index === -1) {
    return "";
  }

  const start = Math.max(0, index - CONTEXT_WINDOW);
  const end = Math.min(containerText.length, index + selectedText.length + CONTEXT_WINDOW);
  const context = containerText.slice(start, end).trim();
  return context === selectedText ? "" : context;
}

function readContextFromRange(containerNode, selectionRange) {
  if (!containerNode || !selectionRange || !containerNode.ownerDocument) {
    return "";
  }

  try {
    const doc = containerNode.ownerDocument;
    const beforeRange = doc.createRange();
    beforeRange.selectNodeContents(containerNode);
    beforeRange.setEnd(selectionRange.startContainer, selectionRange.startOffset);

    const afterRange = doc.createRange();
    afterRange.selectNodeContents(containerNode);
    afterRange.setStart(selectionRange.endContainer, selectionRange.endOffset);

    const beforeText = beforeRange.toString();
    const selectedText = selectionRange.toString();
    const afterText = afterRange.toString();

    const beforeContext = beforeText.slice(Math.max(0, beforeText.length - CONTEXT_WINDOW));
    const afterContext = afterText.slice(0, CONTEXT_WINDOW);
    const context = normalizeText(beforeContext + " " + selectedText + " " + afterContext);
    return context && context !== normalizeText(selectedText) ? context : "";
  } catch (error) {
    logError("Range context read failed", error);
    return "";
  }
}

function getContextContainerNode(node) {
  if (!node) {
    return null;
  }

  let element = node.nodeType === 3 ? node.parentElement : node;
  if (!element) {
    return node;
  }

  if (typeof element.closest === "function") {
    const pageContainer = element.closest(".page, .textLayer, [data-page-number]");
    if (pageContainer) {
      return pageContainer;
    }
  }

  for (let depth = 0; element.parentElement && depth < 6; depth++) {
    element = element.parentElement;
  }
  return element;
}

function readSelectedTextByCopy(candidateWindow, selection) {
  return readSelectedTextBySyntheticCopy(candidateWindow, selection) || readSelectedTextBySystemCopy(candidateWindow);
}

function readSelectedTextBySyntheticCopy(candidateWindow, selection) {
  try {
    if (!candidateWindow.DataTransfer || !candidateWindow.ClipboardEvent) {
      return "";
    }

    const event = new candidateWindow.ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData: new candidateWindow.DataTransfer(),
    });
    if (!event.clipboardData) {
      return "";
    }

    getSelectionEventTarget(candidateWindow, selection).dispatchEvent(event);
    return normalizeText(event.clipboardData.getData("text/plain"));
  } catch (_error) {
    return "";
  }
}

function readSelectedTextBySystemCopy(candidateWindow) {
  const previousText = readClipboardText();
  try {
    if (!candidateWindow.document || typeof candidateWindow.document.execCommand !== "function") {
      return "";
    }
    candidateWindow.focus();
    if (!candidateWindow.document.execCommand("copy")) {
      return "";
    }
    return normalizeText(readClipboardText());
  } catch (error) {
    logError("Selection copy fallback failed", error);
    return "";
  } finally {
    if (previousText !== null) {
      writeClipboardText(previousText);
    }
  }
}

function getSelectionEventTarget(candidateWindow, selection) {
  const node = selection && (selection.focusNode || selection.anchorNode);
  if (node) {
    if (node.nodeType === 1) {
      return node;
    }
    return node.parentElement || node.parentNode || candidateWindow.document;
  }
  return candidateWindow.document.activeElement || candidateWindow.document;
}

function readClipboardText() {
  try {
    const transferable = Components.classes["@mozilla.org/widget/transferable;1"]
      .createInstance(Components.interfaces.nsITransferable);
    transferable.init(null);
    transferable.addDataFlavor("text/unicode");

    const clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
      .getService(Components.interfaces.nsIClipboard);
    clipboard.getData(transferable, Components.interfaces.nsIClipboard.kGlobalClipboard);

    const data = {};
    const length = {};
    transferable.getTransferData("text/unicode", data, length);
    return String(data.value.QueryInterface(Components.interfaces.nsISupportsString).data || "");
  } catch (_error) {
    return null;
  }
}

function writeClipboardText(text) {
  try {
    const string = Components.classes["@mozilla.org/supports-string;1"]
      .createInstance(Components.interfaces.nsISupportsString);
    string.data = String(text || "");

    const transferable = Components.classes["@mozilla.org/widget/transferable;1"]
      .createInstance(Components.interfaces.nsITransferable);
    transferable.init(null);
    transferable.addDataFlavor("text/unicode");
    transferable.setTransferData("text/unicode", string);

    const clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
      .getService(Components.interfaces.nsIClipboard);
    clipboard.setData(transferable, null, Components.interfaces.nsIClipboard.kGlobalClipboard);
  } catch (error) {
    logError("Clipboard restore failed", error);
  }
}

async function translateWithOpenAI({ fetchImpl, token, model, selectedText, context }) {
  const request = fetchImpl || createFetchImpl();
  const response = await request("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "你是学术论文翻译助手。请将 selected_text 翻译成中文，保留必要的学术术语，使用 context 仅用于理解语境和消歧。只输出译文。",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              selected_text: selectedText,
              context: context || "",
            },
            null,
            2
          ),
        },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : "OpenAI request failed";
    throw new Error(message);
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  const translation = String(content || "").trim();
  if (!translation) {
    throw new Error("empty translation");
  }
  return translation;
}

async function askPaperWithOpenAI({ fetchImpl, token, model, mode, question, paperContext, selectedText, conversationMessages }) {
  const request = fetchImpl || createFetchImpl();
  const response = await request("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildAskPayload({ model, mode, question, paperContext, selectedText, conversationMessages })),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : "OpenAI request failed";
    throw new Error(message);
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  const answer = String(content || "").trim();
  if (!answer) {
    throw new Error("empty answer");
  }
  return answer;
}

function buildAskPayload({ model, mode, question, paperContext, selectedText, conversationMessages }) {
  const paper = paperContext || {};
  const normalizedMode = mode === "ask-select" ? "ask-select" : "ask-pdf";
  const normalizedQuestion = normalizeText(question) || (normalizedMode === "ask-select"
    ? "请解释 selected_excerpt 在论文中的含义。"
    : "请总结这篇论文。");
  return {
    model: model || DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "你是学术论文阅读助手。请基于用户提供的 paper_text 和 conversation_history 回答 question；不要编造论文中没有的信息。回答默认使用中文，保留必要英文术语、数学符号和 LaTeX。引用论文内容时尽量标注 [[page N]]。",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            mode: normalizedMode,
            instruction: normalizedMode === "ask-select"
              ? "优先解释 selected_excerpt，并使用 paper_text 作为全文上下文。"
              : "使用 paper_text 回答 question。",
            question: sanitizeTransportText(normalizedQuestion),
            paper_page_count: Number(paper.pageCount) || 0,
            paper_text_truncated: Boolean(paper.truncated),
            selected_excerpt: normalizedMode === "ask-select" ? sanitizeTransportText(String(selectedText || "").trim()) : "",
            conversation_history: normalizeConversationMessages(conversationMessages),
            paper_text: sanitizeTransportText(String(paper.text || "")),
          },
          null,
          2
        ),
      },
    ],
  };
}

function normalizeConversationMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((message) => ({
      role: message && message.role === "assistant" ? "assistant" : "user",
      content: sanitizeTransportText(String(message && message.content ? message.content : "")).trim(),
    }))
    .filter((message) => message.content);
}

function createFetchImpl() {
  if (typeof fetch === "function") {
    return fetchWithEncodedJsonBody;
  }
  if (Zotero.HTTP && typeof Zotero.HTTP.request === "function") {
    return zoteroHTTPFetch;
  }
  throw new Error("No HTTP request implementation is available");
}

async function fetchWithEncodedJsonBody(url, options) {
  const requestOptions = options || {};
  const nextOptions = Object.assign({}, requestOptions);
  if (typeof requestOptions.body === "string" && isJsonRequest(requestOptions.headers)) {
    nextOptions.body = encodeUtf8RequestBody(requestOptions.body);
  }
  return fetch(url, nextOptions);
}

function isJsonRequest(headers) {
  if (!headers) {
    return false;
  }
  const contentType = typeof headers.get === "function"
    ? headers.get("Content-Type")
    : headers["Content-Type"] || headers["content-type"];
  return /application\/json/i.test(String(contentType || ""));
}

function encodeUtf8RequestBody(body) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(body);
  }
  return body;
}

async function zoteroHTTPFetch(url, options) {
  const requestOptions = options || {};
  const xhr = await Zotero.HTTP.request(requestOptions.method || "GET", url, {
    headers: requestOptions.headers || {},
    body: requestOptions.body,
    responseType: "text",
    successCodes: false,
    timeout: 60000,
    errorDelayMax: 0,
    anon: true,
  });

  return {
    ok: xhr.status >= 200 && xhr.status < 300,
    status: xhr.status,
    async json() {
      return JSON.parse(xhr.responseText || "{}");
    },
  };
}

function normalizeText(text) {
  return sanitizeTransportText(text).replace(/\s+/g, " ").trim();
}

function sanitizeTransportText(text) {
  const source = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
  let sanitized = "";
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        sanitized += source[index] + source[index + 1];
        index += 1;
      } else {
        sanitized += " ";
      }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) {
      sanitized += " ";
      continue;
    }
    sanitized += source[index];
  }
  return sanitized;
}

function logError(message, error) {
  const details = error && error.stack ? error.stack : String(error || "");
  if (typeof Zotero !== "undefined" && Zotero.debug) {
    Zotero.debug("[ScholarMate] " + message + ": " + details);
  }
}
