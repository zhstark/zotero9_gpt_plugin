# Zotero Translation Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Zotero 9.0.4 plugin that opens a small translation popup with a shortcut, reads selected paper text, and translates it to Chinese through the official OpenAI Chat Completions API.

**Architecture:** Keep the plugin buildless and XHTML/JavaScript-only. Put Zotero lifecycle and window wiring in `bootstrap.js`, UI markup in `content/*.xhtml`, UI controllers in `content/*.js`, and pure request/response helpers in `content/translator.js` so they can be tested with Node.

**Tech Stack:** Zotero bootstrap plugin API, native JavaScript, XHTML, CSS, OpenAI Chat Completions API, Node built-in test runner for pure helper tests.

---

## File Structure

- Create `manifest.json`: Zotero plugin metadata, compatibility, and bootstrap flag.
- Create `bootstrap.js`: plugin lifecycle, default preferences, Tools menu entry, shortcut, popup window opening, preferences pane registration.
- Create `content/translator.js`: pure helper functions for defaults, prompt messages, OpenAI payload, response parsing, and request execution.
- Create `content/popup.xhtml`: compact popup UI.
- Create `content/popup.js`: popup controller, selection/context lookup, preference lookup, OpenAI call, UI state.
- Create `content/preferences.xhtml`: settings pane UI.
- Create `content/preferences.js`: token/model load and save.
- Create `content/styles.css`: compact popup and settings styles.
- Create `tests/translator.test.js`: Node tests for pure helper behavior.
- Create `package.json`: test script using Node's built-in runner.
- Create `README.md`: install and manual verification notes for macOS Zotero.

## Task 1: Testable Translation Helper

**Files:**
- Create: `content/translator.js`
- Create: `tests/translator.test.js`
- Create: `package.json`

- [ ] **Step 1: Write tests for defaults, payload construction, and response parsing**

```js
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
```

- [ ] **Step 2: Run tests and verify they fail before implementation**

Run: `node --test tests/translator.test.js`

Expected: FAIL because `content/translator.js` does not exist.

- [ ] **Step 3: Implement `content/translator.js`**

```js
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
      temperature: 0.2,
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
```

- [ ] **Step 4: Run helper tests**

Run: `node --test tests/translator.test.js`

Expected: PASS.

## Task 2: Zotero Plugin Shell

**Files:**
- Create: `manifest.json`
- Create: `bootstrap.js`

- [ ] **Step 1: Add Zotero manifest**

```json
{
  "manifest_version": 2,
  "name": "Paper Translation Popup",
  "version": "0.1.0",
  "description": "Translate selected paper text with OpenAI from a compact Zotero popup.",
  "author": "lobster",
  "homepage_url": "https://github.com/local/zotero-translation-popup",
  "applications": {
    "zotero": {
      "id": "paper-translation-popup@lobster.local",
      "strict_min_version": "9.0",
      "strict_max_version": "9.0.*"
    }
  }
}
```

- [ ] **Step 2: Add bootstrap lifecycle and window wiring**

`bootstrap.js` should define plugin id/path globals, register default prefs, add a Tools menu item, add a shortcut key, register the preference pane, and remove menu/key nodes on shutdown.

- [ ] **Step 3: Validate manifest JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`

Expected: `manifest ok`.

## Task 3: Popup UI and Controller

**Files:**
- Create: `content/popup.xhtml`
- Create: `content/popup.js`
- Create: `content/styles.css`

- [ ] **Step 1: Add popup XHTML**

The popup includes selected text, context note, Translate button, status area, and result area.

- [ ] **Step 2: Add popup controller**

The controller reads current selection from `window.arguments[0]`, asks the opening Zotero window for fallback selected text if needed, loads preferences, calls `ZoteroTranslationTranslator.translate`, and updates UI states.

- [ ] **Step 3: Add compact CSS**

The CSS should fit a small utility popup and avoid large decorative layout.

- [ ] **Step 4: Run syntax checks**

Run: `node --check content/translator.js` and `node --check content/popup.js`

Expected: both commands exit successfully.

## Task 4: Preferences UI

**Files:**
- Create: `content/preferences.xhtml`
- Create: `content/preferences.js`

- [ ] **Step 1: Add settings markup**

The settings pane has a password field for the OpenAI access token and a text field for the model name.

- [ ] **Step 2: Add settings controller**

The controller loads values from Zotero preferences on window load and saves changes to Zotero preferences.

- [ ] **Step 3: Run syntax checks**

Run: `node --check content/preferences.js`

Expected: command exits successfully.

## Task 5: Packaging Notes and Final Verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Add README**

The README explains how to load the plugin from source on macOS, how to configure token/model, the default shortcut, and manual verification steps.

- [ ] **Step 2: Run all automated checks**

Run: `node --test tests/translator.test.js` and syntax checks for all JS files.

Expected: tests pass and syntax checks pass.

- [ ] **Step 3: Inspect git diff**

Run: `git status --short` and `git diff --stat`

Expected: only plugin, tests, docs plan, and README files are changed.
