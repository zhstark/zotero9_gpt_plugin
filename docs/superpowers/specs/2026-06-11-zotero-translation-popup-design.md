# Zotero Translation Popup Design

Date: 2026-06-11

## Goal

Build a Zotero 9.0.4 plugin for macOS that helps users translate selected text while reading papers. The first version focuses on a lightweight popup workflow: select text in the reader, open the popup with a keyboard shortcut, click Translate, and see the Chinese translation in the popup.

## Non-Goals

- Do not save translations back to Zotero notes, annotations, or items.
- Do not support providers other than the official OpenAI API.
- Do not support custom API base URLs or proxy configuration.
- Do not build a large persistent side panel.
- Do not introduce a TypeScript or bundler toolchain for the first version.

## User Experience

The user selects a word, phrase, sentence, or short passage in the Zotero paper reader. They press the plugin keyboard shortcut to open a small popup. The popup shows the selected text if it can be read, a Translate button, status text, and a translation result area.

When the user clicks Translate, the plugin sends the selected text and any available nearby context to OpenAI. The translation result is displayed only in the popup. Closing the popup discards the result.

The popup should stay focused on the current translation task. It should not contain note-management controls or long-form configuration fields.

## Settings

The plugin adds a Zotero settings entry with two fields:

- OpenAI access token
- OpenAI model name

The API endpoint is fixed to:

```text
https://api.openai.com/v1/chat/completions
```

The model field lets the user update the model without changing code. The plugin stores both values using Zotero preferences.

## Translation Request

The request payload uses the official OpenAI Chat Completions API. The plugin separates selected text from context in the prompt:

- `selected_text`: the text the user explicitly selected
- `context`: nearby text gathered by the plugin, if available

The model instruction should ask for a Chinese translation, preserve academic terms, and use the context only to resolve ambiguity. If no context is available, the plugin still translates the selected text.

The first implementation should keep token usage bounded by sending only a fixed-size context window.

## Context Strategy

Context extraction is best-effort.

The plugin first tries to read the current selection and nearby text from the active Zotero reader or focused document window. If Zotero exposes enough surrounding text, the plugin sends a fixed window around the selected text. If the surrounding text cannot be found reliably, the plugin sends an empty context value and continues.

When context is unavailable, the UI shows a low-disruption note such as:

```text
未获取到上下文，已仅翻译选中文本。
```

Context failure must not block translation.

## Error Handling

The popup handles these cases:

- Token is missing: tell the user to configure the OpenAI access token in settings.
- Model is missing: use the default model if available, otherwise tell the user to configure it.
- No selected text: tell the user to select text in the paper first.
- OpenAI request fails: show a short error message without exposing the token.
- OpenAI returns an empty message: show that the model did not return a translation.
- Network or JSON parsing fails: show a generic failure message and write technical details to Zotero debug logging.

## Technical Structure

Use a minimal Zotero plugin layout:

```text
manifest.json
bootstrap.js
content/popup.xhtml
content/popup.js
content/preferences.xhtml
content/preferences.js
content/styles.css
```

Responsibilities:

- `manifest.json`: plugin metadata and Zotero compatibility.
- `bootstrap.js`: startup, shutdown, keyboard shortcut registration, menu/settings wiring, popup opening, and shared plugin lifecycle.
- `content/popup.xhtml`: popup markup.
- `content/popup.js`: selection reading, translation request orchestration, UI state updates, and error presentation.
- `content/preferences.xhtml`: settings UI markup.
- `content/preferences.js`: load and save token/model preferences.
- `content/styles.css`: compact popup and settings styling.

Use native JavaScript and XHTML so the plugin can be loaded directly in Zotero without a build step.

## Verification

Manual verification should cover:

- Zotero recognizes the plugin manifest.
- The keyboard shortcut opens the popup.
- The settings UI saves and reloads the OpenAI token and model.
- Selected text is displayed in the popup when available.
- Clicking Translate sends the selected text to OpenAI and renders the translation.
- Missing context falls back to translating only the selected text.
- Missing token, missing selection, request failure, and empty model response produce clear UI messages.

## Open Questions Deferred

- Whether a later version should save translations to notes or annotations.
- Whether to support OpenAI-compatible API base URLs.
- Whether to add a persistent side panel after the popup workflow is proven useful.
- Whether to use reader-specific internal APIs for richer context extraction after testing against Zotero 9.x.
