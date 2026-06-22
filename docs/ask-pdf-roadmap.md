# Ask PDF / Ask Select Roadmap

## Current V1 scope

- Ask PDF reads the current Zotero PDF text layer, builds page-marked paper text, and sends it to the LLM with the user's question.
- Ask Select reads the same full-PDF context and adds the selected excerpt as higher-priority local context.
- Extracted paper text keeps `[[page N]]` page markers so answers can refer back to pages.
- Repeated margin text is removed only from the first and last lines of each page to reduce page header, footer, and page-number pollution.
- API responses in Ask PDF and Ask Select are rendered with a small safe Markdown renderer for headings, lists, emphasis, inline code, and code blocks.
- Ask PDF and Ask Select support in-memory multi-turn chat. The first question extracts PDF context; later turns reuse that context and send the full conversation history without truncation.

## Known limits

- Image-only PDF pages are not OCR'd.
- Figure content is not interpreted unless its caption or surrounding text exists in the PDF text layer.
- Complex formulas are preserved only when PDF.js exposes their text; visual formula parsing is not included.
- Very long papers are capped before sending to the model to avoid oversized API requests.
- Multi-turn chat history is in memory only and is lost after Zotero restarts.
- Multi-turn chat history is not truncated yet, so long conversations can produce oversized API requests.
- Markdown tables and links are not parsed yet.
- Responses are not yet typeset with KaTeX or MathJax; LaTeX source remains visible as text.

## Pending tasks

1. Add a PDF extraction inspection panel that shows page count, removed margin-line count, and truncation state before sending.
2. Improve text-layer ordering for two-column papers by grouping spans with both vertical position and column position.
3. Add optional page-image extraction with OCR or vision-model parsing for figures, scanned pages, and visually rendered formulas.
4. Extend the Markdown renderer for tables and safe links.
5. Add KaTeX or MathJax rendering for inline and block LaTeX after the sanitizer strategy is fixed.
6. Add chunked retrieval or map-reduce summarization for papers that exceed the selected model's context limit.
7. Add answer citations that link or jump back to Zotero Reader pages when `[[page N]]` appears in the response.
8. Add truncation or summarization for long multi-turn chat history.
9. Add integration tests around DOM-based page extraction once a Zotero Reader fixture is available.
10. Add persistent chat history if users want conversations to survive Zotero restarts.
