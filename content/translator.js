/* exported ZoteroTranslationTranslator */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZoteroTranslationTranslator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_MODEL = "gpt-4o-mini";
  const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
  const DEFAULT_PAPER_CONTEXT_MAX_CHARS = 180000;

  function normalizeSettings(settings) {
    const source = settings || {};
    return {
      token: String(source.token || "").trim(),
      model: String(source.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    };
  }

  function buildChatPayload({ model, selectedText, context }) {
    return {
      model,
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
    };
  }

  function parseChatCompletion(data) {
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    const translation = String(content || "").trim();
    if (!translation) {
      throw new Error("empty translation");
    }
    return translation;
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
      text: truncated ? text.slice(0, maxChars) : text,
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
    const lines = rawLines
      .map((line) => normalizeLine(line))
      .filter(Boolean);
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
    return String(line || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function isPageNumberLine(line) {
    return /^\s*(?:page\s*)?\d+\s*$/i.test(String(line || ""));
  }

  function buildAskPayload({ model, mode, question, paperContext, selectedText, conversationMessages }) {
    const paper = paperContext || {};
    const normalizedMode = mode === "ask-select" ? "ask-select" : "ask-pdf";
    const normalizedQuestion = normalizeText(question) || (normalizedMode === "ask-select"
      ? "请解释 selected_excerpt 在论文中的含义。"
      : "请总结这篇论文。");
    const userPayload = {
      mode: normalizedMode,
      instruction: normalizedMode === "ask-select"
        ? "优先解释 selected_excerpt，并使用 paper_text 作为全文上下文。"
        : "使用 paper_text 回答 question。",
      question: normalizedQuestion,
      paper_page_count: Number(paper.pageCount) || 0,
      paper_text_truncated: Boolean(paper.truncated),
      selected_excerpt: normalizedMode === "ask-select" ? String(selectedText || "").trim() : "",
      conversation_history: normalizeConversationMessages(conversationMessages),
      paper_text: String(paper.text || ""),
    };

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
          content: JSON.stringify(userPayload, null, 2),
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
        content: String(message && message.content ? message.content : "").trim(),
      }))
      .filter((message) => message.content);
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

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  async function translate({ fetchImpl, token, model, selectedText, context }) {
    const request = fetchImpl || fetch;
    const payload = buildChatPayload({ model, selectedText, context });
    const response = await request(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data && data.error && data.error.message ? data.error.message : "OpenAI request failed";
      throw new Error(message);
    }
    return parseChatCompletion(data);
  }

  async function askPaper({ fetchImpl, token, model, mode, question, paperContext, selectedText, conversationMessages }) {
    const request = fetchImpl || fetch;
    const payload = buildAskPayload({ model, mode, question, paperContext, selectedText, conversationMessages });
    const response = await request(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data && data.error && data.error.message ? data.error.message : "OpenAI request failed";
      throw new Error(message);
    }
    return parseChatCompletion(data);
  }

  function renderMarkdown(markdown) {
    const normalized = String(markdown || "").replace(/\r\n/g, "\n");
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

      const lines = block.split("\n");
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        html.push("<ul>" + lines.map((line) => "<li>" + renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, "")) + "</li>").join("") + "</ul>");
        continue;
      }

      if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
        html.push("<ol>" + lines.map((line) => "<li>" + renderInlineMarkdown(line.replace(/^\s*\d+\.\s+/, "")) + "</li>").join("") + "</ol>");
        continue;
      }

      if (/^#{1,4}\s+/.test(block)) {
        const level = Math.min(4, block.match(/^#+/)[0].length);
        html.push("<h" + level + ">" + renderInlineMarkdown(block.replace(/^#{1,4}\s+/, "")) + "</h" + level + ">");
        continue;
      }

      html.push("<p>" + renderInlineMarkdown(block).replace(/\n/g, "<br>") + "</p>");
    }

    return html.join("");
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

  return {
    DEFAULT_MODEL,
    OPENAI_CHAT_COMPLETIONS_URL,
    DEFAULT_PAPER_CONTEXT_MAX_CHARS,
    normalizeSettings,
    buildChatPayload,
    buildAskPayload,
    buildPaperContext,
    parseChatCompletion,
    countExtractedWords,
    translate,
    askPaper,
    renderMarkdown,
  };
});
