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
const DEFAULT_MODEL = "gpt-4o-mini";
const CONTEXT_WINDOW = 600;
const HTML_NS = "http://www.w3.org/1999/xhtml";

var rootURI;
var chromeHandle;
var translatorAPI;
var pluginWindows = new Set();

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
    label: "Paper Translation Popup",
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
  };
}

function togglePanel(window) {
  const panel = getOrCreatePanel(window);
  const isHidden = panel.hasAttribute("hidden");
  if (isHidden) {
    panel.removeAttribute("hidden");
  } else {
    panel.setAttribute("hidden", "hidden");
  }
  if (isHidden) {
    refreshSelectionPreview(window);
  }
}

function getOrCreatePanel(window) {
  const doc = window.document;
  let panel = doc.getElementById("paper-translation-popup-panel");
  if (panel) {
    return panel;
  }

  panel = doc.createElementNS(HTML_NS, "div");
  panel.id = "paper-translation-popup-panel";
  panel.setAttribute("hidden", "hidden");
  panel.setAttribute("style", [
    "position: fixed",
    "right: 24px",
    "top: 72px",
    "width: 520px",
    "max-width: calc(100vw - 48px)",
    "z-index: 2147483647",
    "box-sizing: border-box",
    "padding: 14px",
    "border: 1px solid #c9d1d9",
    "border-radius: 8px",
    "background: #f7f8fa",
    "box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18)",
    "font: menu",
    "color: #202124",
  ].join(";"));

  const dragHandle = createPanelDragHandle(doc);
  panel.appendChild(dragHandle);
  makePanelDraggable(window, panel, dragHandle);

  panel.appendChild(createPanelStatus(doc, "paper-translation-popup-context-note", ""));

  const toolbar = doc.createElementNS(HTML_NS, "div");
  toolbar.setAttribute("style", "display: flex; align-items: center; gap: 10px; margin: 8px 0;");

  const translateButton = doc.createElementNS(HTML_NS, "button");
  translateButton.id = "paper-translation-popup-translate";
  translateButton.textContent = "翻译";
  translateButton.setAttribute("style", "padding: 5px 12px;");
  translateButton.addEventListener("click", () => translateSelection(window));
  toolbar.appendChild(translateButton);
  toolbar.appendChild(createPanelStatus(doc, "paper-translation-popup-status", "请在论文中划取文字后点击翻译。"));
  panel.appendChild(toolbar);

  panel.appendChild(createPanelLabel(doc, "翻译结果"));
  panel.appendChild(createPanelTextarea(doc, "paper-translation-popup-result", true, "120px"));

  doc.documentElement.appendChild(panel);
  return panel;
}

function createPanelDragHandle(doc) {
  const handle = doc.createElementNS(HTML_NS, "div");
  handle.id = "paper-translation-popup-drag-handle";
  handle.textContent = "Paper Translation Popup";
  handle.setAttribute("style", [
    "cursor: move",
    "user-select: none",
    "font-weight: 600",
    "color: #24292f",
    "padding: 0 0 10px",
    "margin-bottom: 10px",
    "border-bottom: 1px solid #d0d7de",
  ].join(";"));
  return handle;
}

function makePanelDraggable(window, panel, handle) {
  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = panel.getBoundingClientRect();
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;

    panel.style.left = rect.left + "px";
    panel.style.top = rect.top + "px";
    panel.style.right = "auto";

    const onMouseMove = (moveEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      const nextLeft = Math.min(maxLeft, Math.max(0, moveEvent.clientX - offsetX));
      const nextTop = Math.min(maxTop, Math.max(0, moveEvent.clientY - offsetY));
      panel.style.left = nextLeft + "px";
      panel.style.top = nextTop + "px";
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };

    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
  });
}

function createPanelLabel(doc, value) {
  const label = doc.createElementNS(HTML_NS, "div");
  label.textContent = value;
  label.setAttribute("style", "font-weight: 600; color: #24292f; margin-bottom: 6px;");
  return label;
}

function createPanelTextarea(doc, id, readonly, minHeight) {
  const textarea = doc.createElementNS(HTML_NS, "textarea");
  textarea.id = id;
  textarea.readOnly = readonly;
  textarea.setAttribute("style", [
    "width: 100%",
    "min-height: " + minHeight,
    "box-sizing: border-box",
    "border: 1px solid #c9d1d9",
    "border-radius: 6px",
    "padding: 8px",
    "margin-bottom: 8px",
    "background: #fff",
    "color: #1f2328",
    "resize: vertical",
    "line-height: 1.45",
  ].join(";"));
  return textarea;
}

function createPanelStatus(doc, id, value) {
  const status = doc.createElementNS(HTML_NS, "span");
  status.id = id;
  status.textContent = value;
  status.setAttribute("style", "color: #57606a;");
  return status;
}

function refreshSelectionPreview(window) {
  const data = readSelectionData(window);
  setPanelText(window, "paper-translation-popup-context-note", formatContextStatus(data, false), false);
}

async function translateSelection(window) {
  const data = readSelectionData(window);
  setPanelValue(window, "paper-translation-popup-result", "");
  setPanelText(window, "paper-translation-popup-context-note", formatContextStatus(data, true), false);

  if (!translatorAPI) {
    setPanelText(window, "paper-translation-popup-status", "翻译模块未加载，请重启 Zotero 后重试。", true);
    return;
  }

  const token = Zotero.Prefs.get(PREF_TOKEN) || "";
  const model = Zotero.Prefs.get(PREF_MODEL) || DEFAULT_MODEL;
  if (!token) {
    setPanelText(window, "paper-translation-popup-status", "请先在 Zotero 设置中配置 OpenAI access token。", true);
    return;
  }
  if (!data.selectedText) {
    setPanelText(window, "paper-translation-popup-status", "请先在论文阅读器中划取要翻译的文本。", true);
    return;
  }

  const button = window.document.getElementById("paper-translation-popup-translate");
  button.disabled = true;
  setPanelText(window, "paper-translation-popup-status", "正在翻译...", false);

  try {
    const translation = await translatorAPI.translate({
      fetchImpl: createFetchImpl(),
      token,
      model,
      selectedText: data.selectedText,
      context: data.context,
    });
    setPanelValue(window, "paper-translation-popup-result", translation);
    setPanelText(window, "paper-translation-popup-status", "翻译完成。", false);
  } catch (error) {
    logError("Translation failed", error);
    setPanelText(window, "paper-translation-popup-status", "翻译失败：" + formatUserFacingError(error), true);
  } finally {
    button.disabled = false;
  }
}

function setPanelValue(window, id, value) {
  const node = window.document.getElementById(id);
  if (node) {
    node.value = value || "";
  }
}

function setPanelText(window, id, value, isError) {
  const node = window.document.getElementById(id);
  if (!node) {
    return;
  }
  node.textContent = value || "";
  node.style.color = isError ? "#b42318" : "#57606a";
}

function formatUserFacingError(error) {
  const rawMessage = error && error.message ? error.message : String(error || "");
  const message = rawMessage
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .trim();
  return message || "请检查网络、模型名或 OpenAI access token。";
}

function formatContextStatus(selectionData, isTranslating) {
  if (selectionData.hasContext) {
    return "已获取上下文，将随划取内容一起发送。";
  }
  return isTranslating ? "未获取到上下文，已仅翻译划取内容。" : "未获取到上下文，翻译时将仅使用划取内容。";
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

function createFetchImpl() {
  if (typeof fetch === "function") {
    return fetch;
  }
  if (Zotero.HTTP && typeof Zotero.HTTP.request === "function") {
    return zoteroHTTPFetch;
  }
  throw new Error("No HTTP request implementation is available");
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
  return String(text || "").replace(/\s+/g, " ").trim();
}

function logError(message, error) {
  const details = error && error.stack ? error.stack : String(error || "");
  if (typeof Zotero !== "undefined" && Zotero.debug) {
    Zotero.debug("[Paper Translation Popup] " + message + ": " + details);
  }
}
