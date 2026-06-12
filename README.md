# Paper Translation Popup

A buildless Zotero 9.0.x plugin for translating selected paper text with the official OpenAI Chat Completions API.

## Features

- Open a compact popup from Zotero with `Cmd+Shift+T` on macOS.
- Configure an OpenAI access token and model in Zotero settings.
- Translate selected text to Chinese.
- Send best-effort nearby context when it can be read from the current selection.
- Fall back to translating only the selected text when context is unavailable.

## Development Install on macOS

1. Find your Zotero profile directory:

   ```bash
   ls "$HOME/Library/Application Support/Zotero/Profiles"
   ```

2. Create an extension proxy file named after the plugin id:

   ```bash
   mkdir -p "$HOME/Library/Application Support/Zotero/Profiles/<profile>/extensions"
   printf '%s\n' "/Users/lobster/Documents/zotero_plugin" > "$HOME/Library/Application Support/Zotero/Profiles/<profile>/extensions/paper-translation-popup@lobster.local"
   ```

3. Start Zotero with cache purging while developing:

   ```bash
   /Applications/Zotero.app/Contents/MacOS/zotero -purgecaches -ZoteroDebugText
   ```

If Zotero does not detect the proxy file, fully quit Zotero and remove these two profile cache preferences from `prefs.js`:

```text
user_pref("extensions.lastAppBuildId", "..."); 
user_pref("extensions.lastAppVersion", "...");
```

Then start Zotero again with `-purgecaches`.

## XPI Install

The repository also supports packaging as an `.xpi` file:

```bash
zip -r -FS paper-translation-popup.xpi manifest.json bootstrap.js content
```

Install it from Zotero with Tools > Add-ons > gear menu > Install Add-on From File.

## Zotero 9 Failure Notes

These are the failure causes found while installing on Zotero 9.0.4 for macOS:

- Zotero 9 rejected the XPI until `manifest.json` included `applications.zotero.update_url`. The generic UI error was "it may be incompatible with this version of Zotero", but the internal AddonManager error was `Reading manifest: applications.zotero.update_url not provided`.
- Do not leave only `browser_specific_settings.zotero`; Zotero 9 accepted the existing installed plugins' `applications.zotero` manifest shape.
- A plugin proxy file was not reliable in this environment. Installing the packaged XPI into the Zotero profile's `extensions/` directory was the working path.
- `window.openDialog()` with plugin XHTML produced an `about:blank` window in Zotero 9.0.4, even after chrome registration. The working implementation uses an in-window floating HTML panel created from `bootstrap.js`.
- Zotero preference panes should be registered like a XUL fragment: use `rootURI + "content/preferences.xhtml"`, set `defaultXUL: true`, and do not start the preference fragment with XML declarations or stylesheet processing instructions. Zotero loads `scripts` before inserting the preference fragment, then dispatches `load` on the fragment root, so preference UI initialization must be triggered from the root `onload` attribute instead of `DOMContentLoaded` or `window.load`.
- Zotero bootstrap scope may not expose global `fetch`. Do not reference `fetch` while constructing the translator sandbox; pass a request implementation at translation time and fall back to `Zotero.HTTP.request`.
- Zotero Reader/PDF.js can consume XUL key bindings while focus is inside the reader. Keep the menu `key` binding, but also install capture-phase `keydown` listeners on the main window and nested reader frames.
- Direct `selection.toString()` from the PDF.js text layer can be offset from the visible highlight. Prefer the PDF.js copy pipeline for selected text, then fall back to direct selection only if copy output is unavailable.
- PDF.js selections often report a small span as `commonAncestorContainer`, so using only that node's `textContent` makes context look empty. Climb to the PDF page/text-layer container before slicing surrounding context.
- Do not rely on `containerText.indexOf(selectedText)` for context. PDF.js copy output can normalize spaces or line breaks differently from page `textContent`; use DOM Range boundaries to read surrounding text directly.
- A configured model name such as `gpt-5.5` can make OpenAI reject the request. Surface the real API error in the panel instead of only showing a generic translation failure.
- Do not hard-code `temperature`. Some newer models only support the API default temperature value and reject explicit values such as `0.2`.
- The translation panel is an in-window fixed HTML panel, not a native movable dialog. Add explicit drag handling on the panel header if users need to reposition it.
- For HTML elements, `hidden="false"` still hides the element because `hidden` is a boolean attribute. Show the panel by removing `hidden`; hide it by adding `hidden="hidden"`.
- Restart Zotero after replacing the XPI. Use `-purgecaches` when resource changes appear stale.

## Configure

Open Zotero settings and find the Paper Translation Popup pane. Set:

- OpenAI access token
- OpenAI model, defaulting to `gpt-4o-mini`

The plugin calls:

```text
https://api.openai.com/v1/chat/completions
```

## Use

1. Open a PDF or paper in Zotero.
2. Select text in the reader.
3. Press `Cmd+Shift+T`, or choose Tools > 翻译选中文本.
4. Click 翻译 in the popup.

The translation is displayed only in the popup and is not saved to Zotero.

## Checks

Run the helper tests and syntax checks:

```bash
npm test
npm run check
```

Manual Zotero checks:

- Zotero recognizes the plugin.
- The settings pane saves and reloads token/model.
- `Cmd+Shift+T` opens the popup.
- Selected text appears in the popup.
- Translation works with a valid token and model.
- Missing token, missing selection, and failed OpenAI requests show clear messages.
