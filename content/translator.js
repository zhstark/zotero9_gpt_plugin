/* exported ZoteroTranslationTranslator */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZoteroTranslationTranslator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const DEFAULT_MODEL = "gpt-4o-mini";
  const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
  const DEFAULT_PAPER_CONTEXT_MAX_CHARS = 180000;
  const DEFAULT_PANEL_WIDTH = 390;
  const MIN_PANEL_WIDTH = 320;
  const PANEL_VIEWPORT_MARGIN = 24;

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
    return sanitizeTransportText(line)
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
      question: sanitizeTransportText(normalizedQuestion),
      paper_page_count: Number(paper.pageCount) || 0,
      paper_text_truncated: Boolean(paper.truncated),
      selected_excerpt: normalizedMode === "ask-select" ? sanitizeTransportText(String(selectedText || "").trim()) : "",
      conversation_history: normalizeConversationMessages(conversationMessages),
      paper_text: sanitizeTransportText(String(paper.text || "")),
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
        content: sanitizeTransportText(String(message && message.content ? message.content : "")).trim(),
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
    return sanitizeTransportText(text).replace(/\s+/g, " ").trim();
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

      const displayMath = parseDisplayMathBlock(block);
      if (displayMath) {
        html.push(renderMathHtml(displayMath, true));
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

  function normalizeMarkdownForRendering(markdown) {
    const displayMathBlocks = [];
    return sanitizeTransportText(markdown)
      .replace(/\r\n/g, "\n")
      .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, formula) => stashDisplayMathBlock(displayMathBlocks, formula))
      .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, formula) => stashDisplayMathBlock(displayMathBlocks, formula))
      .replace(/[ \t]+-{3,}[ \t]+/g, "\n\n---\n\n")
      .replace(/[ \t]+(#{1,4}\s+)/g, "\n\n$1")
      .replace(/[ \t]+([-*]\s+)/g, "\n$1")
      .replace(/\u0000MATHBLOCK(\d+)\u0000/g, (_match, index) => {
        const formula = displayMathBlocks[Number(index)] || "";
        return "\n\n\\[\n" + formula.trim() + "\n\\]\n\n";
      });
  }

  function stashDisplayMathBlock(blocks, formula) {
    const index = blocks.length;
    blocks.push(String(formula || ""));
    return "\n\n\u0000MATHBLOCK" + index + "\u0000\n\n";
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
    const mathSpans = [];
    let html = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
      const token = "\u0000CODE" + codeSpans.length + "\u0000";
      codeSpans.push("<code>" + code + "</code>");
      return token;
    });

    html = html.replace(/\\\((.+?)\\\)|\$(?!\$)([^$]+?)\$/g, (_match, parenMath, dollarMath) => {
      const token = "\u0000MATH" + mathSpans.length + "\u0000";
      mathSpans.push(renderMathHtml(unescapeHtml(parenMath || dollarMath || ""), false));
      return token;
    });

    html = html
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

    return html
      .replace(/\u0000MATH(\d+)\u0000/g, (_match, index) => mathSpans[Number(index)] || "")
      .replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)] || "");
  }

  function parseDisplayMathBlock(block) {
    const trimmed = String(block || "").trim();
    const bracketMatch = trimmed.match(/^\\\[\s*([\s\S]*?)\s*\\\]$/);
    if (bracketMatch) {
      return bracketMatch[1].trim();
    }
    const dollarMatch = trimmed.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/);
    if (dollarMatch) {
      return dollarMatch[1].trim();
    }
    return "";
  }

  function renderMathHtml(source, displayMode) {
    const formula = String(source || "").trim();
    const className = "scholarmate-math " + (displayMode ? "scholarmate-math-display" : "scholarmate-math-inline");
    if (root && root.katex && typeof root.katex.renderToString === "function") {
      try {
        return root.katex.renderToString(formula, {
          displayMode,
          throwOnError: false,
          strict: "ignore",
          output: "html",
        }).replace(/^<span class="katex/, "<span class=\"" + className + " katex");
      } catch (_error) {
        // Fall back to readable source text below.
      }
    }
    const tag = displayMode ? "div" : "span";
    return "<" + tag + " class=\"" + className + "\">" + escapeHtml(formula) + "</" + tag + ">";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unescapeHtml(value) {
    return String(value || "")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&");
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
    calculatePanelDragWidth,
    shouldSubmitQuestionKey,
  };
});
