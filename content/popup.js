(function () {
  const CONTEXT_WINDOW = 600;
  const DEFAULT_PAPER_CONTEXT_MAX_CHARS = 180000;

  let actionButton;
  let copyButton;
  let statusNode;
  let resultNode;
  let markdownResultNode;
  let questionSection;
  let questionInput;
  let resultLabel;
  let clearChatButton;
  let openerWindow;
  let prefs;
  let assistantMode = "translate";
  let paperChatSession = { key: "", paperContext: null, messages: [] };

  window.addEventListener("load", init);

  function init() {
    actionButton = document.getElementById("action-button");
    copyButton = document.getElementById("copy-button");
    statusNode = document.getElementById("status");
    resultNode = document.getElementById("translation-result");
    markdownResultNode = document.getElementById("markdown-result");
    questionSection = document.getElementById("question-section");
    questionInput = document.getElementById("question-input");
    resultLabel = document.getElementById("result-label");
    clearChatButton = document.getElementById("clear-chat-button");

    const args = getArgs();
    openerWindow = args.opener || window.opener || null;
    prefs = ZoteroTranslationTranslator.normalizeSettings(args.prefs || readPrefsFromZotero());

    actionButton.addEventListener("command", runAssistantAction);
    copyButton.addEventListener("command", copyTranslationResult);
    clearChatButton.addEventListener("command", clearPaperChatSession);
    document.getElementById("tab-translate").addEventListener("command", () => updateAssistantMode("translate"));
    document.getElementById("tab-ask-pdf").addEventListener("command", () => updateAssistantMode("ask-pdf"));
    document.getElementById("tab-ask-select").addEventListener("command", () => updateAssistantMode("ask-select"));
    updateAssistantMode("translate");
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

  function runAssistantAction() {
    if (assistantMode === "ask-pdf" || assistantMode === "ask-select") {
      askPaperQuestion();
      return;
    }
    translateSelection();
  }

  function updateAssistantMode(mode) {
    assistantMode = mode === "ask-pdf" || mode === "ask-select" ? mode : "translate";
    for (const tab of document.querySelectorAll(".assistant-tab")) {
      tab.classList.remove("active");
    }
    document.getElementById("tab-" + assistantMode).classList.add("active");
    questionSection.style.display = assistantMode === "translate" ? "none" : "block";
    clearChatButton.style.display = assistantMode === "translate" ? "none" : "flex";
    resultNode.style.display = assistantMode === "translate" ? "block" : "none";
    markdownResultNode.style.display = assistantMode === "translate" ? "none" : "block";
    questionInput.placeholder = assistantMode === "ask-select" ? "这里提到的概念是什么意思？" : "总结这篇论文";
    actionButton.setAttribute("label", assistantMode === "translate" ? "翻译" : "提问");
    resultLabel.setAttribute("value", assistantMode === "translate" ? "翻译结果" : "对话");
    setStatus(getInitialModeStatus(assistantMode), false);
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

  async function translateSelection() {
    setResultValue("");
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
      setResultValue(translation);
      setStatus("翻译完成。", false);
    } catch (error) {
      logError(error);
      setStatus("翻译失败，请检查网络、模型名或 OpenAI access token。", true);
    } finally {
      setBusy(false);
    }
  }

  async function askPaperQuestion() {
    if (!prefs.token) {
      setStatus("请先在 Zotero 设置中配置 OpenAI access token。", true);
      return;
    }

    const question = readQuestion();
    const session = getPaperChatSession();
    const selectionData = assistantMode === "ask-select" ? readSelectionData() : { selectedText: "" };
    if (assistantMode === "ask-select" && !selectionData.selectedText && session.messages.length === 0) {
      setStatus("请先在论文阅读器中划取要提问的片段。", true);
      return;
    }

    setBusy(true);
    setStatus(session.paperContext ? "正在请求 API，沿用已提取的 PDF 全文。" : "正在提取 PDF 全文...", false);

    try {
      if (!session.paperContext) {
        session.paperContext = readPaperContext();
      }
      if (!session.paperContext.text) {
        setStatus("未能读取当前 PDF 正文，请确认已打开论文阅读器。", true);
        return;
      }

      setStatus(formatPaperContextStatus(session.paperContext, session.messages.length > 0), false);
      const answer = await ZoteroTranslationTranslator.askPaper({
        token: prefs.token,
        model: prefs.model,
        mode: assistantMode,
        question,
        paperContext: session.paperContext,
        selectedText: selectionData.selectedText,
        conversationMessages: session.messages,
      });
      session.messages.push({
        role: "user",
        content: formatConversationUserMessage(question, selectionData.selectedText),
      });
      session.messages.push({ role: "assistant", content: answer });
      setResultValue(formatConversationTranscript(session.messages));
      questionInput.value = "";
      setStatus("回答完成。", false);
    } catch (error) {
      logError(error);
      setStatus("问答失败，请检查 PDF、网络、模型名或 OpenAI access token。", true);
    } finally {
      setBusy(false);
    }
  }

  function readQuestion() {
    const question = questionInput && questionInput.value ? questionInput.value.trim() : "";
    if (question) {
      return question;
    }
    return assistantMode === "ask-select" ? "请解释划取片段在论文中的含义。" : "请总结这篇论文。";
  }

  function getPaperChatSession() {
    const key = readPaperSessionKey();
    if (paperChatSession.key === key) {
      return paperChatSession;
    }
    paperChatSession = { key, paperContext: null, messages: [] };
    return paperChatSession;
  }

  function readPaperSessionKey() {
    return String(openerWindow && openerWindow.document && openerWindow.document.title ? openerWindow.document.title : "active-pdf");
  }

  function clearPaperChatSession() {
    const session = getPaperChatSession();
    session.paperContext = null;
    session.messages = [];
    setResultValue("");
    setStatus(getInitialModeStatus(assistantMode), false);
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

  function readPaperContext() {
    let bestPages = [];
    for (const candidateWindow of getCandidateWindows()) {
      const pages = extractPaperPagesFromWindow(candidateWindow);
      if (countPageTextChars(pages) > countPageTextChars(bestPages)) {
        bestPages = pages;
      }
    }
    return ZoteroTranslationTranslator.buildPaperContext(bestPages, {
      maxChars: DEFAULT_PAPER_CONTEXT_MAX_CHARS,
    });
  }

  function countPageTextChars(pages) {
    return pages.reduce((total, page) => total + String(page.text || "").length, 0);
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
      logError(error);
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
    return lines.map((line) => normalizeLine(line.parts.join(" "))).filter(Boolean);
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

  function normalizeLine(line) {
    return String(line || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function setBusy(isBusy) {
    actionButton.disabled = isBusy;
  }

  function setStatus(message, isError) {
    statusNode.setAttribute("value", message);
    statusNode.classList.toggle("error", Boolean(isError));
  }

  function setResultValue(value) {
    const nextValue = value || "";
    resultNode.value = nextValue;
    resultNode.setAttribute("data-raw-value", nextValue);
    markdownResultNode.innerHTML = ZoteroTranslationTranslator.renderMarkdown(nextValue);
  }

  async function copyTranslationResult() {
    const value = resultNode.getAttribute("data-raw-value") || "";
    if (!value) {
      setStatus(assistantMode === "translate" ? "暂无可复制的译文。" : "暂无可复制的对话。", true);
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        resultNode.focus();
        resultNode.select();
        document.execCommand("copy");
      }
      setStatus(assistantMode === "translate" ? "译文已复制。" : "对话已复制。", false);
    } catch (error) {
      logError(error);
      setStatus("复制失败，请手动选中内容复制。", true);
    }
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
