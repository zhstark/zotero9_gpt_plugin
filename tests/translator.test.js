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
  assert.equal(payload.temperature, 0.2);
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
