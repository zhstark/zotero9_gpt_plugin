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
