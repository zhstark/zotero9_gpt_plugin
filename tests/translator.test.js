const test = require("node:test");
const assert = require("node:assert/strict");
const translator = require("../content/translator.js");

test("normalizes settings with a default model", () => {
  assert.deepEqual(translator.normalizeSettings({ token: " sk-test " }), {
    token: "sk-test",
    model: translator.DEFAULT_MODEL,
  });
});

test("builds chat payload with selected text and context", () => {
  const payload = translator.buildChatPayload({
    model: "gpt-4o-mini",
    selectedText: "Photosynthesis improves biomass.",
    context: "In crop science, photosynthesis is linked to biomass accumulation.",
  });

  assert.equal(payload.model, "gpt-4o-mini");
  assert.equal(Object.hasOwn(payload, "temperature"), false);
  assert.match(payload.messages[1].content, /selected_text/);
  assert.match(payload.messages[1].content, /Photosynthesis improves biomass/);
  assert.match(payload.messages[1].content, /context/);
});

test("parses translation from chat completion response", () => {
  const translation = translator.parseChatCompletion({
    choices: [{ message: { content: "光合作用提高生物量。" } }],
  });

  assert.equal(translation, "光合作用提高生物量。");
});

test("rejects empty chat completion response", () => {
  assert.throws(
    () => translator.parseChatCompletion({ choices: [{ message: { content: "   " } }] }),
    /empty translation/
  );
});

test("counts extracted words without double-counting selected text inside context", () => {
  assert.equal(translator.countExtractedWords({
    selectedText: "photosynthesis improves biomass",
    context: "In crop science photosynthesis improves biomass under stress",
  }), 8);
});

test("counts selected text and context when context does not contain the selection", () => {
  assert.equal(translator.countExtractedWords({
    selectedText: "source phrase",
    context: "nearby context words",
  }), 5);
});

test("sends official OpenAI chat completions request", async () => {
  let requestUrl = "";
  let requestOptions = null;
  const fetchImpl = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "译文" } }] };
      },
    };
  };

  const result = await translator.translate({
    fetchImpl,
    token: "sk-test",
    model: "gpt-4o-mini",
    selectedText: "source",
    context: "context",
  });

  assert.equal(result, "译文");
  assert.equal(requestUrl, translator.OPENAI_CHAT_COMPLETIONS_URL);
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.Authorization, "Bearer sk-test");
  assert.equal(JSON.parse(requestOptions.body).model, "gpt-4o-mini");
});

test("builds paper context and removes repeated page headers and footers", () => {
  const context = translator.buildPaperContext([
    {
      pageNumber: 1,
      text: [
        "Journal of Example Studies",
        "A useful abstract sentence.",
        "The first contribution is robust extraction.",
        "1",
      ].join("\n"),
    },
    {
      pageNumber: 2,
      text: [
        "Journal of Example Studies",
        "The method section explains the pipeline.",
        "Figure 1: Overview of the system.",
        "2",
      ].join("\n"),
    },
    {
      pageNumber: 3,
      text: [
        "Journal of Example Studies",
        "The conclusion states the main limitation.",
        "Future work should include visual parsing.",
        "3",
      ].join("\n"),
    },
  ]);

  assert.match(context.text, /\[\[page 1\]\]/);
  assert.match(context.text, /A useful abstract sentence/);
  assert.match(context.text, /Figure 1: Overview/);
  assert.doesNotMatch(context.text, /Journal of Example Studies/);
  assert.doesNotMatch(context.text, /\n1\n/);
  assert.equal(context.pageCount, 3);
  assert.equal(context.removedMarginLineCount, 6);
});

test("truncates oversized paper context with metadata", () => {
  const context = translator.buildPaperContext(
    [{ pageNumber: 7, text: "Alpha beta gamma delta epsilon zeta eta theta." }],
    { maxChars: 32 }
  );

  assert.equal(context.truncated, true);
  assert.equal(context.text.length, 32);
  assert.equal(context.originalCharCount > context.text.length, true);
});

test("builds ask PDF payload with paper text and question", () => {
  const payload = translator.buildAskPayload({
    model: "gpt-4o-mini",
    mode: "ask-pdf",
    question: "总结这篇论文",
    paperContext: { text: "[[page 1]]\nPaper body.", pageCount: 1 },
  });

  assert.equal(payload.model, "gpt-4o-mini");
  assert.match(payload.messages[0].content, /学术论文阅读助手/);
  assert.match(payload.messages[1].content, /ask-pdf/);
  assert.match(payload.messages[1].content, /总结这篇论文/);
  assert.match(payload.messages[1].content, /\[\[page 1\]\]/);
});

test("builds ask select payload with selected excerpt", () => {
  const payload = translator.buildAskPayload({
    model: "gpt-4o-mini",
    mode: "ask-select",
    question: "这里提到的平均有向距离是什么？",
    selectedText: "average directed distance",
    paperContext: { text: "[[page 2]]\nThe selected term appears here.", pageCount: 1 },
  });

  const body = payload.messages[1].content;
  assert.match(body, /ask-select/);
  assert.match(body, /average directed distance/);
  assert.match(body, /优先解释 selected_excerpt/);
});

test("builds ask payload with full conversation history without truncation", () => {
  const payload = translator.buildAskPayload({
    model: "gpt-4o-mini",
    mode: "ask-pdf",
    question: "继续解释实验结果",
    paperContext: { text: "[[page 1]]\nPaper body.", pageCount: 1 },
    conversationMessages: [
      { role: "user", content: "先总结这篇论文" },
      { role: "assistant", content: "这篇论文提出了一个方法。" },
      { role: "user", content: "它用了哪些指标？" },
      { role: "assistant", content: "它使用了 VUS-PR 和 VUS-ROC。" },
    ],
  });

  const body = JSON.parse(payload.messages[1].content);
  assert.deepEqual(body.conversation_history, [
    { role: "user", content: "先总结这篇论文" },
    { role: "assistant", content: "这篇论文提出了一个方法。" },
    { role: "user", content: "它用了哪些指标？" },
    { role: "assistant", content: "它使用了 VUS-PR 和 VUS-ROC。" },
  ]);
  assert.equal(body.question, "继续解释实验结果");
});

test("sends ask paper request through OpenAI chat completions", async () => {
  let requestOptions = null;
  const fetchImpl = async (_url, options) => {
    requestOptions = options;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: "这是回答。" } }] };
      },
    };
  };

  const answer = await translator.askPaper({
    fetchImpl,
    token: "sk-test",
    model: "gpt-4o-mini",
    mode: "ask-pdf",
    question: "总结",
    paperContext: { text: "[[page 1]]\nPaper body.", pageCount: 1 },
  });

  assert.equal(answer, "这是回答。");
  assert.equal(requestOptions.method, "POST");
  assert.match(requestOptions.headers.Authorization, /sk-test/);
  assert.match(requestOptions.body, /paper_text/);
});

test("renders markdown answers to safe html", () => {
  const html = translator.renderMarkdown([
    "# Summary",
    "",
    "**Method** keeps `$x_i$` and *scores*.",
    "",
    "- VUS-ROC",
    "- VUS-PR",
    "",
    "```python",
    "print('<script>alert(1)</script>')",
    "```",
    "",
    "<script>alert(1)</script>",
  ].join("\n"));

  assert.match(html, /<h1>Summary<\/h1>/);
  assert.match(html, /<strong>Method<\/strong>/);
  assert.match(html, /<code>\$x_i\$<\/code>/);
  assert.match(html, /<ul><li>VUS-ROC<\/li><li>VUS-PR<\/li><\/ul>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
