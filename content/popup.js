(function () {
  const CONTEXT_WINDOW = 600;
  const DEFAULT_PAPER_CONTEXT_MAX_CHARS = 180000;

  let actionButton;
  let askActionButton;
  let toolbarNode;
  let copyButton;
  let statusNode;
  let askStatusNode;
  let askStatusRow;
  let resultNode;
  let markdownResultNode;
  let questionSection;
  let questionInput;
  let resultLabel;
  let clearChatButton;
  let openerWindow;
  let prefs;
  let assistantMode = "translate";
  let rawResultValue = "";
  let paperChatState = { key: "", sessions: {} };

  window.addEventListener("load", init);

  function init() {
    actionButton = document.getElementById("action-button");
    askActionButton = document.getElementById("ask-action-button");
    toolbarNode = document.querySelector(".toolbar");
    copyButton = document.getElementById("copy-button");
    statusNode = document.getElementById("status");
    askStatusNode = document.getElementById("ask-status");
    askStatusRow = document.getElementById("ask-status-row");
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
    askActionButton.addEventListener("command", runAssistantAction);
    questionInput.addEventListener("keydown", handleQuestionKeydown);
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
    toolbarNode.style.display = assistantMode === "translate" ? "flex" : "none";
    askStatusRow.style.display = assistantMode === "translate" ? "none" : "flex";
    actionButton.style.display = assistantMode === "translate" ? "flex" : "none";
    askActionButton.style.display = assistantMode === "translate" ? "none" : "flex";
    actionButton.setAttribute("label", "翻译");
    resultLabel.setAttribute("value", assistantMode === "translate" ? "翻译结果" : "对话");
    renderCurrentModeResult();
    setStatus(getInitialModeStatus(assistantMode), false);
  }

  function handleQuestionKeydown(event) {
    if (!ZoteroTranslationTranslator.shouldSubmitQuestionKey({
      mode: assistantMode,
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
    runAssistantAction();
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
    const session = getPaperChatSession(assistantMode);
    const selectionData = assistantMode === "ask-select" ? readSelectionData() : { selectedText: "" };
    if (assistantMode === "ask-select" && !selectionData.selectedText && session.messages.length === 0) {
      setStatus("请先在论文阅读器中划取要提问的片段。", true);
      return;
    }

    setBusy(true);
    setStatus(session.paperContext ? "正在请求 API，沿用已提取的 PDF 全文。" : "正在提取 PDF 全文...", false);

    try {
      if (!session.paperContext) {
        session.paperContext = await readPaperContext();
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
      renderCurrentModeResult();
      questionInput.value = "";
      setStatus(formatAnswerCompleteStatus(session.paperContext), false);
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

  function getPaperChatSession(mode) {
    const key = readPaperSessionKey();
    const sessionMode = mode === "ask-select" ? "ask-select" : "ask-pdf";
    if (paperChatState.key !== key) {
      paperChatState = { key, sessions: {} };
    }
    if (!paperChatState.sessions[sessionMode]) {
      paperChatState.sessions[sessionMode] = { key, mode: sessionMode, paperContext: null, messages: [] };
    }
    return paperChatState.sessions[sessionMode];
  }

  function readPaperSessionKey() {
    const readerKey = readCurrentReaderSessionKey();
    if (readerKey) {
      return readerKey;
    }
    return String(openerWindow && openerWindow.document && openerWindow.document.title ? openerWindow.document.title : "active-pdf");
  }

  function readCurrentReaderSessionKey() {
    const reader = getActiveReader();
    const tabID = readReaderTabID(reader);
    if (tabID) {
      return "reader-tab:" + tabID;
    }
    const selectedTabID = readSelectedTabID();
    if (selectedTabID) {
      return "selected-tab:" + selectedTabID;
    }
    return "";
  }

  function clearPaperChatSession() {
    const session = getPaperChatSession(assistantMode);
    session.paperContext = null;
    session.messages = [];
    renderCurrentModeResult();
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
    const extractionStatus = formatPaperExtractionStatus(paperContext);
    const parts = reusedContext
      ? ["正在请求 API，沿用已提取的 " + paperContext.pageCount + " 页 PDF 全文"]
      : [
        "正在请求 API，" + extractionStatus,
        "移除 " + paperContext.removedMarginLineCount + " 条重复页眉/页脚",
      ];
    if (reusedContext && extractionStatus) {
      parts.push(extractionStatus);
    }
    if (paperContext.truncated) {
      parts.push("因篇幅较长已截断");
    }
    return parts.join("，") + "。";
  }

  function formatPaperExtractionStatus(paperContext) {
    const source = paperContext && paperContext.extractionSource;
    if (source === "pdfjs") {
      const expected = Number(paperContext.pdfExpectedPageCount) || Number(paperContext.pageCount) || 0;
      const extracted = Number(paperContext.extractedPageCount) || Number(paperContext.pageCount) || 0;
      return "已通过 PDF.js 提取 " + extracted + "/" + expected + " 页";
    }
    if (source === "dom") {
      return "已通过页面 DOM 提取 " + paperContext.pageCount + " 页（可能只包含当前渲染页）";
    }
    return "已提取 " + (paperContext && paperContext.pageCount ? paperContext.pageCount : 0) + " 页";
  }

  function formatAnswerCompleteStatus(paperContext) {
    return "回答完成。提取诊断：" + formatPaperExtractionStatus(paperContext) + "。";
  }

  async function readPaperContext() {
    const candidateWindows = getCandidateWindows();
    const diagnostics = createPaperExtractionDiagnostics(candidateWindows);
    logInfo("PDF extraction started: candidateWindows=" + diagnostics.candidateWindowCount);

    const pdfResult = await extractPaperPagesFromPdfDocuments(candidateWindows, diagnostics);
    if (pdfResult.pages.length) {
      diagnostics.extractionSource = "pdfjs";
      diagnostics.extractedPageCount = pdfResult.pages.length;
      diagnostics.extractedCharCount = countPageTextChars(pdfResult.pages);
      const context = ZoteroTranslationTranslator.buildPaperContext(pdfResult.pages, {
        maxChars: DEFAULT_PAPER_CONTEXT_MAX_CHARS,
      });
      logPaperExtractionFinished(diagnostics);
      return attachPaperExtractionDiagnostics(context, diagnostics);
    }

    let bestPages = [];
    candidateWindows.forEach((candidateWindow, index) => {
      const pages = extractPaperPagesFromWindow(candidateWindow);
      const charCount = countPageTextChars(pages);
      if (pages.length) {
        diagnostics.domCandidateCount += 1;
      }
      logInfo(
        "DOM extraction candidate #" + (index + 1)
        + ": pages=" + pages.length
        + ", chars=" + charCount
        + ", " + describeCandidateWindow(candidateWindow)
      );
      if (pages.length && !bestPages.length) {
        bestPages = pages;
      }
    });
    diagnostics.extractionSource = bestPages.length ? "dom" : "none";
    diagnostics.extractedPageCount = bestPages.length;
    diagnostics.extractedCharCount = countPageTextChars(bestPages);
    if (bestPages.length) {
      diagnostics.warnings.push("PDF.js document was not available; fell back to rendered DOM pages only.");
    } else {
      diagnostics.warnings.push("No readable PDF.js document or rendered DOM pages were found.");
    }
    const context = ZoteroTranslationTranslator.buildPaperContext(bestPages, {
      maxChars: DEFAULT_PAPER_CONTEXT_MAX_CHARS,
    });
    logPaperExtractionFinished(diagnostics);
    return attachPaperExtractionDiagnostics(context, diagnostics);
  }

  async function extractPaperPagesFromPdfDocuments(candidateWindows, diagnostics) {
    let selectedPages = [];
    for (let index = 0; index < candidateWindows.length; index++) {
      const candidateWindow = candidateWindows[index];
      const pdfDocument = getPdfDocumentFromWindow(candidateWindow);
      if (!pdfDocument) {
        logInfo(
          "PDF.js candidate #" + (index + 1)
          + ": unavailable, " + describeCandidateWindow(candidateWindow)
        );
        continue;
      }
      diagnostics.pdfCandidateCount += 1;
      const expectedPageCount = Number.isInteger(pdfDocument.numPages) ? pdfDocument.numPages : 0;
      diagnostics.pdfExpectedPageCount = Math.max(diagnostics.pdfExpectedPageCount, expectedPageCount);
      const pages = await extractPaperPagesFromPdfDocument(pdfDocument);
      logInfo(
        "PDF.js candidate #" + (index + 1)
        + ": numPages=" + expectedPageCount
        + ", extractedPages=" + pages.length
        + ", chars=" + countPageTextChars(pages)
        + ", " + describeCandidateWindow(candidateWindow)
      );
      if (pages.length && !selectedPages.length) {
        selectedPages = pages;
      }
    }
    return { pages: selectedPages };
  }

  function getPdfDocumentFromWindow(candidateWindow) {
    if (!candidateWindow) {
      return null;
    }
    const unwrappedWindow = unwrapWindow(candidateWindow);
    const app = unwrappedWindow.PDFViewerApplication || candidateWindow.PDFViewerApplication;
    if (app && app.pdfDocument) {
      return app.pdfDocument;
    }
    const viewer = app && app.pdfViewer;
    if (viewer && viewer.pdfDocument) {
      return viewer.pdfDocument;
    }
    if (viewer && viewer._pdfDocument) {
      return viewer._pdfDocument;
    }
    const reader = unwrappedWindow.reader || candidateWindow.reader;
    const primaryView = reader
      && reader._internalReader
      && reader._internalReader._primaryView;
    const primaryWindow = primaryView && primaryView._iframeWindow;
    return primaryWindow && primaryWindow !== candidateWindow
      ? getPdfDocumentFromWindow(primaryWindow)
      : null;
  }

  function unwrapWindow(candidateWindow) {
    return candidateWindow && candidateWindow.wrappedJSObject
      ? candidateWindow.wrappedJSObject
      : candidateWindow;
  }

  async function extractPaperPagesFromPdfDocument(pdfDocument) {
    try {
      if (!pdfDocument || !Number.isInteger(pdfDocument.numPages) || typeof pdfDocument.getPage !== "function") {
        return [];
      }
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
        const pdfPage = await pdfDocument.getPage(pageNumber);
        if (!pdfPage || typeof pdfPage.getTextContent !== "function") {
          continue;
        }
        const textContent = await pdfPage.getTextContent();
        const text = serializePdfTextContent(textContent);
        if (normalizeText(text)) {
          pages.push({ pageNumber, text });
        }
      }
      return pages;
    } catch (error) {
      logError(error);
      return [];
    }
  }

  function serializePdfTextContent(textContent) {
    const items = textContent && Array.isArray(textContent.items) ? textContent.items : [];
    const positioned = items
      .map(readPdfTextItem)
      .filter((item) => item.text);
    if (!positioned.length) {
      return "";
    }
    if (positioned.some((item) => item.hasPosition)) {
      return groupPdfTextItems(positioned).join("\n");
    }
    return positioned.map((item) => item.text).join(" ");
  }

  function readPdfTextItem(item) {
    const transform = item && Array.isArray(item.transform) ? item.transform : [];
    return {
      text: normalizeLine(item && item.str ? item.str : ""),
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      hasPosition: Number.isFinite(transform[4]) && Number.isFinite(transform[5]),
    };
  }

  function groupPdfTextItems(items) {
    const sorted = items.slice().sort((left, right) => {
      if (Math.abs(left.y - right.y) > 3) {
        return right.y - left.y;
      }
      return left.x - right.x;
    });
    const lines = [];
    for (const item of sorted) {
      const last = lines[lines.length - 1];
      if (!last || Math.abs(last.y - item.y) > 3) {
        lines.push({ y: item.y, parts: [item.text] });
      } else {
        last.parts.push(item.text);
      }
    }
    return lines
      .map((line) => normalizeLine(line.parts.join(" ")))
      .filter(Boolean);
  }

  function countPageTextChars(pages) {
    return pages.reduce((total, page) => total + String(page.text || "").length, 0);
  }

  function createPaperExtractionDiagnostics(candidateWindows) {
    return {
      candidateWindowCount: Array.isArray(candidateWindows) ? candidateWindows.length : 0,
      pdfCandidateCount: 0,
      pdfExpectedPageCount: 0,
      domCandidateCount: 0,
      extractedPageCount: 0,
      extractedCharCount: 0,
      extractionSource: "none",
      warnings: [],
    };
  }

  function attachPaperExtractionDiagnostics(context, diagnostics) {
    const target = context || {};
    target.extractionSource = diagnostics.extractionSource;
    target.candidateWindowCount = diagnostics.candidateWindowCount;
    target.pdfCandidateCount = diagnostics.pdfCandidateCount;
    target.pdfExpectedPageCount = diagnostics.pdfExpectedPageCount;
    target.domCandidateCount = diagnostics.domCandidateCount;
    target.extractedPageCount = diagnostics.extractedPageCount;
    target.extractedCharCount = diagnostics.extractedCharCount;
    target.extractionWarnings = diagnostics.warnings.slice();
    return target;
  }

  function logPaperExtractionFinished(diagnostics) {
    logInfo(
      "PDF extraction finished: source=" + diagnostics.extractionSource
      + ", extractedPages=" + diagnostics.extractedPageCount
      + ", expectedPages=" + diagnostics.pdfExpectedPageCount
      + ", chars=" + diagnostics.extractedCharCount
      + ", pdfCandidates=" + diagnostics.pdfCandidateCount
      + ", domCandidates=" + diagnostics.domCandidateCount
      + ", candidateWindows=" + diagnostics.candidateWindowCount
    );
    for (const warning of diagnostics.warnings) {
      logInfo("PDF extraction warning: " + warning);
    }
  }

  function describeCandidateWindow(candidateWindow) {
    if (!candidateWindow) {
      return "window=null";
    }
    const unwrappedWindow = unwrapWindow(candidateWindow);
    const doc = candidateWindow.document || unwrappedWindow.document;
    const app = unwrappedWindow.PDFViewerApplication || candidateWindow.PDFViewerApplication;
    const reader = unwrappedWindow.reader || candidateWindow.reader;
    const features = [];
    if (candidateWindow.wrappedJSObject) {
      features.push("wrappedJSObject");
    }
    if (app) {
      features.push("PDFViewerApplication");
    }
    if (app && app.pdfViewer) {
      features.push("pdfViewer");
    }
    if (reader) {
      features.push("reader");
    }
    if (doc && typeof doc.querySelectorAll === "function") {
      features.push("document");
    }
    return "title=" + sanitizeLogValue(doc && doc.title ? doc.title : "")
      + ", features=" + (features.length ? features.join("|") : "none");
  }

  function sanitizeLogValue(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }

  function getCandidateWindows() {
    const candidates = [];
    for (const readerWindow of getActiveReaderWindows()) {
      addCandidate(candidates, readerWindow);
    }

    addCandidate(candidates, openerWindow);

    if (openerWindow && openerWindow.document) {
      addCandidate(candidates, openerWindow.document.commandDispatcher && openerWindow.document.commandDispatcher.focusedWindow);
      addCandidate(candidates, openerWindow.document.activeElement && openerWindow.document.activeElement.contentWindow);

      const browser = openerWindow.document.querySelector("browser[primary='true'], browser");
      addCandidate(candidates, browser && browser.contentWindow);
    }

    for (const readerWindow of getReaderRegistryWindows()) {
      addCandidate(candidates, readerWindow);
    }

    return candidates;
  }

  function getReaderRegistryWindows() {
    const windows = [];
    const activeReader = getActiveReader();
    addReaderWindows(windows, activeReader);

    const readers = getZoteroReaders();
    for (const reader of readers) {
      if (reader !== activeReader) {
        addReaderWindows(windows, reader);
      }
    }
    return windows;
  }

  function getActiveReaderWindows() {
    const windows = [];
    addReaderWindows(windows, getActiveReader());
    return windows;
  }

  function getActiveReader() {
    const readerAPI = openerWindow && openerWindow.Zotero && openerWindow.Zotero.Reader ? openerWindow.Zotero.Reader : null;
    const selectedTabID = readSelectedTabID();
    if (readerAPI && selectedTabID && typeof readerAPI.getByTabID === "function") {
      try {
        const reader = readerAPI.getByTabID(selectedTabID);
        if (reader) {
          return reader;
        }
      } catch (_error) {
        // Fall back to scanning the reader registry below.
      }
    }

    const readers = getZoteroReaders();
    if (selectedTabID) {
      for (const reader of readers) {
        if (readReaderTabID(reader) === selectedTabID) {
          return reader;
        }
      }
    }

    for (const reader of readers) {
      if (reader && (reader.active || reader._active || reader.selected || reader._selected)) {
        return reader;
      }
    }
    return null;
  }

  function getZoteroReaders() {
    return openerWindow && openerWindow.Zotero && openerWindow.Zotero.Reader && Array.isArray(openerWindow.Zotero.Reader._readers)
      ? openerWindow.Zotero.Reader._readers
      : [];
  }

  function readSelectedTabID() {
    const tabs = openerWindow && openerWindow.Zotero_Tabs ? openerWindow.Zotero_Tabs : null;
    if (!tabs) {
      return "";
    }
    const selected = typeof tabs.getSelectedID === "function" ? callWithoutThrow(tabs, "getSelectedID") : null;
    return normalizeIdentifier(
      selected
      || tabs.selectedID
      || tabs.selectedId
      || tabs._selectedID
      || tabs._selectedId
      || tabs.selected
      || tabs._selected
    );
  }

  function callWithoutThrow(target, method) {
    try {
      return target[method]();
    } catch (_error) {
      return null;
    }
  }

  function readReaderTabID(reader) {
    if (!reader) {
      return "";
    }
    return normalizeIdentifier(
      reader.tabID
      || reader.tabId
      || reader._tabID
      || reader._tabId
      || reader.id
      || reader._id
    );
  }

  function normalizeIdentifier(value) {
    if (value && typeof value === "object") {
      return normalizeIdentifier(value.id || value.ID || value.tabID || value.tabId || value._id);
    }
    const normalized = String(value || "").trim();
    return normalized && normalized !== "undefined" && normalized !== "null" ? normalized : "";
  }

  function addReaderWindows(windows, reader) {
    if (!reader) {
      return;
    }
    addCandidate(windows, reader._iframeWindow);
    addCandidate(windows, reader.iframeWindow);
    addCandidate(windows, reader.window);
    const internalReader = reader && reader._internalReader;
    addCandidate(windows, internalReader && internalReader._primaryView && internalReader._primaryView._iframeWindow);
    addCandidate(windows, internalReader && internalReader._secondaryView && internalReader._secondaryView._iframeWindow);
    const readerViews = internalReader && Array.isArray(internalReader._views) ? internalReader._views : [];
    for (const view of readerViews) {
      addCandidate(windows, view && view._iframeWindow);
    }
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
    askActionButton.disabled = isBusy;
  }

  function setStatus(message, isError) {
    const activeNode = assistantMode === "translate" ? statusNode : askStatusNode;
    const inactiveNode = assistantMode === "translate" ? askStatusNode : statusNode;
    inactiveNode.setAttribute("value", "");
    inactiveNode.classList.remove("error");
    activeNode.setAttribute("value", message);
    activeNode.classList.toggle("error", Boolean(isError));
  }

  function setResultValue(value) {
    const nextValue = value || "";
    rawResultValue = nextValue;
    resultNode.value = nextValue;
    try {
      markdownResultNode.innerHTML = ZoteroTranslationTranslator.renderMarkdown(nextValue);
    } catch (error) {
      logError(error);
      markdownResultNode.textContent = normalizeText(nextValue);
    }
  }

  function renderCurrentModeResult() {
    if (assistantMode === "translate") {
      resultNode.value = rawResultValue;
      markdownResultNode.textContent = "";
      return;
    }
    resultNode.value = "";
    const session = getPaperChatSession(assistantMode);
    try {
      markdownResultNode.innerHTML = ZoteroTranslationTranslator.renderMarkdown(formatConversationTranscript(session.messages));
    } catch (error) {
      logError(error);
      markdownResultNode.textContent = normalizeText(formatConversationTranscript(session.messages));
    }
  }

  async function copyTranslationResult() {
    const value = assistantMode === "translate"
      ? rawResultValue || resultNode.value || ""
      : formatConversationTranscript(getPaperChatSession(assistantMode).messages);
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
    logInfo(error && error.stack ? error.stack : String(error));
  }

  function logInfo(message) {
    try {
      const zotero = openerWindow && openerWindow.Zotero;
      if (zotero && typeof zotero.debug === "function") {
        zotero.debug(`[ScholarMate] ${message}`);
      }
    } catch (_ignored) {
      // Ignore logging failures so UI error handling still completes.
    }
  }
})();
