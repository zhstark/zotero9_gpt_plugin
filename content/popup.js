(function () {
  const CONTEXT_WINDOW = 600;

  let translateButton;
  let statusNode;
  let resultNode;
  let openerWindow;
  let prefs;

  window.addEventListener("load", init);

  function init() {
    translateButton = document.getElementById("translate-button");
    statusNode = document.getElementById("status");
    resultNode = document.getElementById("translation-result");

    const args = getArgs();
    openerWindow = args.opener || window.opener || null;
    prefs = ZoteroTranslationTranslator.normalizeSettings(args.prefs || readPrefsFromZotero());

    translateButton.addEventListener("command", translateSelection);
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

  async function translateSelection() {
    resultNode.value = "";
    const selectionData = readSelectionData();

    if (!prefs.token) {
      setStatus("请先在 Zotero 设置中配置 OpenAI access token。", true);
      return;
    }

    if (!selectionData.selectedText) {
      setStatus("请先在论文阅读器中划取要翻译的文本。", true);
      return;
    }

    setBusy(true);
    setStatus(formatRequestWordCountStatus(selectionData), false);

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

  function formatRequestWordCountStatus(selectionData) {
    return "正在请求 API，已传输 " + ZoteroTranslationTranslator.countExtractedWords(selectionData) + " 个单词。";
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
      logError(error);
      return "";
    }
  }

  function getContextContainerNode(node) {
    if (!node) {
      return null;
    }

    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
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
        zotero.debug(`[ScholarMate] ${message}`);
      }
    } catch (_ignored) {
      // Ignore logging failures so UI error handling still completes.
    }
  }
})();
