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

  return {
    DEFAULT_MODEL,
    OPENAI_CHAT_COMPLETIONS_URL,
    normalizeSettings,
    buildChatPayload,
    parseChatCompletion,
    translate,
  };
});
