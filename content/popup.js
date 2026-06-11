(function () {
  const CONTEXT_WINDOW = 600;

  let selectedTextNode;
  let contextNoteNode;
  let translateButton;
  let statusNode;
  let resultNode;
  let openerWindow;
  let prefs;

  window.addEventListener("load", init);

  function init() {
    selectedTextNode = document.getElementById("selected-text");
    contextNoteNode = document.getElementById("context-note");
    translateButton = document.getElementById("translate-button");
    statusNode = document.getElementById("status");
    resultNode = document.getElementById("translation-result");

    const args = getArgs();
    openerWindow = args.opener || window.opener || null;
    prefs = ZoteroTranslationTranslator.normalizeSettings(args.prefs || readPrefsFromZotero());

    translateButton.addEventListener("command", translateSelection);
    refreshSelectionPreview();
  }

  function getArgs() {
    return window.arguments && window.arguments[0] ? window.arguments[0] : {};
  }

  function readPrefsFromZotero() {
    if (!openerWindow || !openerWindow.Zotero || !openerWindow.Zotero.Prefs) {
      return {};
    }
    return {
      token: openerWindow.Zotero.Prefs.get("extensions.paperTranslationPopup.openaiToken") || "",
      model: openerWindow.Zotero.Prefs.get("extensions.paperTranslationPopup.openaiModel") || "",
    };
  }

  function refreshSelectionPreview() {
    const selectionData = readSelectionData();
    selectedTextNode.value = selectionData.selectedText;
    contextNoteNode.setAttribute("value", selectionData.hasContext ? "" : "未获取到上下文，翻译时将仅使用选中文本。");
  }

  async function translateSelection() {
    resultNode.value = "";
    const selectionData = readSelectionData();
    selectedTextNode.value = selectionData.selectedText;
    contextNoteNode.setAttribute("value", selectionData.hasContext ? "" : "未获取到上下文，已仅翻译选中文本。");

    if (!prefs.token) {
      setStatus("请先在 Zotero 设置中配置 OpenAI access token。", true);
      return;
    }

    if (!selectionData.selectedText) {
      setStatus("请先在论文阅读器中划取要翻译的文本。", true);
      return;
    }

    setBusy(true);
    setStatus("正在翻译...", false);

    try {
      const translation = await ZoteroTranslationTranslator.translate({
        token: prefs.token,
        model: prefs.model,
        selectedText: selectionData.selectedText,
        context: selectionData.context,
      });
      resultNode.value = translation;
      setStatus("翻译完成。", false);
    } catch (error) {
      logError(error);
      setStatus("翻译失败，请检查网络、模型名或 OpenAI access token。", true);
    } finally {
      setBusy(false);
    }
  }

  function readSelectionData() {
    for (const candidateWindow of getCandidateWindows()) {
      const data = readSelectionFromWindow(candidateWindow);
      if (data.selectedText) {
        return data;
      }
    }
    return { selectedText: "", context: "", hasContext: false };
  }

  function getCandidateWindows() {
    const candidates = [];
    addCandidate(candidates, openerWindow);

    if (openerWindow && openerWindow.document) {
      addCandidate(candidates, openerWindow.document.commandDispatcher && openerWindow.document.commandDispatcher.focusedWindow);
      addCandidate(candidates, openerWindow.document.activeElement && openerWindow.document.activeElement.contentWindow);

      const browser = openerWindow.document.querySelector("browser[primary='true'], browser");
      addCandidate(candidates, browser && browser.contentWindow);
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
      const selectedText = normalizeText(selection ? selection.toString() : "");
      if (!selectedText) {
        return { selectedText: "", context: "", hasContext: false };
      }

      const context = readContextFromSelection(selection, selectedText);
      return {
        selectedText,
        context,
        hasContext: Boolean(context),
      };
    } catch (error) {
      logError(error);
      return { selectedText: "", context: "", hasContext: false };
    }
  }

  function readContextFromSelection(selection, selectedText) {
    if (!selection || !selection.rangeCount) {
      return "";
    }

    const range = selection.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node && node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
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

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function setBusy(isBusy) {
    translateButton.disabled = isBusy;
  }

  function setStatus(message, isError) {
    statusNode.setAttribute("value", message);
    statusNode.classList.toggle("error", Boolean(isError));
  }

  function logError(error) {
    try {
      const zotero = openerWindow && openerWindow.Zotero;
      const message = error && error.stack ? error.stack : String(error);
      if (zotero && typeof zotero.debug === "function") {
        zotero.debug(`[Paper Translation Popup] ${message}`);
      }
    } catch (_ignored) {
      // Ignore logging failures so UI error handling still completes.
    }
  }
})();
