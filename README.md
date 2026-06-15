# ScholarMate

ScholarMate 是一个 Zotero 9 插件，用 OpenAI API 辅助阅读论文。当前版本聚焦“划词/划句翻译”：你在 Zotero PDF 阅读器中选中文本，打开插件面板，点击翻译后，ScholarMate 会把选中文本和可读取到的上下文一起发送给模型，并把中文译文显示在面板中。

这个插件的定位不是单纯的翻译工具，而是面向学术阅读的 AI 助手。后续可以继续扩展论文总结、术语解释、段落问答、方法对比、实验结论提取等功能。

## 解决的痛点

读英文论文时，直接复制句子到网页翻译工具会打断阅读节奏。你需要在 Zotero、浏览器和翻译页面之间切换，还经常丢失论文上下文。ScholarMate 把翻译入口放进 Zotero 阅读器里，减少切换。

学术句子经常依赖前后文。只翻译划取的半句话，模型容易误解代词、术语和研究对象。ScholarMate 会尽量从 PDF 文本层读取划取位置附近的上下文，把它和选中文本一起发给模型，让译文更贴近论文语境。

Zotero PDF.js 文本层的选区并不总是稳定。直接读 `selection.toString()` 可能出现偏移。ScholarMate 优先走 PDF.js 的复制管线读取选中文本，再回退到普通 selection，减少“选中内容和实际发送内容不一致”的问题。

## 当前功能

- 在 Zotero 中通过快捷键打开浮动面板。
- 在 Zotero 设置页配置 OpenAI access token 和模型名。
- 翻译 Zotero PDF 阅读器中划取的文本。
- 自动附带可读取到的上下文，帮助模型理解语境。
- 请求 API 时显示本次从论文文本中提取并发送的英文单词数。
- 直接显示 OpenAI 返回的错误信息，便于排查模型名、token 或网络问题。
- 面板可以拖动，适合放在论文页面旁边阅读。

## 快捷键

- macOS：`Cmd+Shift+T`
- Windows / Linux：`Ctrl+Shift+T`

也可以在 Zotero 菜单中选择 Tools > 翻译划取内容。

## 安装

仓库中包含已经打包好的 `paper-translation-popup.xpi`。在 Zotero 中打开：

```text
Tools > Add-ons > 齿轮菜单 > Install Add-on From File
```

选择 `paper-translation-popup.xpi` 安装。替换已有版本后，需要完全退出并重新打开 Zotero。

也可以从源码重新打包：

```bash
zip -r -FS paper-translation-popup.xpi manifest.json bootstrap.js content
```

## 配置

打开 Zotero 设置，找到 ScholarMate 设置页，填写：

- OpenAI access token
- OpenAI model，默认使用 `gpt-4o-mini`

当前版本调用 OpenAI Chat Completions API：

```text
https://api.openai.com/v1/chat/completions
```

## 使用

1. 在 Zotero 中打开论文 PDF。
2. 在阅读器中划取需要翻译的词、短语或句子。
3. 按快捷键打开 ScholarMate，或通过 Tools > 翻译划取内容打开。
4. 点击“翻译”。
5. 在面板中查看中文译文。

译文只显示在插件面板中，不会写入 Zotero 条目、笔记或 PDF 注释。

## 开发安装

macOS 开发时可以找到 Zotero profile 目录：

```bash
ls "$HOME/Library/Application Support/Zotero/Profiles"
```

创建插件 proxy 文件：

```bash
mkdir -p "$HOME/Library/Application Support/Zotero/Profiles/<profile>/extensions"
printf '%s\n' "/Users/lobster/Documents/zotero_plugin" > "$HOME/Library/Application Support/Zotero/Profiles/<profile>/extensions/paper-translation-popup@lobster.local"
```

开发调试时建议用清缓存方式启动 Zotero：

```bash
/Applications/Zotero.app/Contents/MacOS/zotero -purgecaches -ZoteroDebugText
```

如果 Zotero 没有识别 proxy 文件，完全退出 Zotero，并从 `prefs.js` 中删除这两项缓存：

```text
user_pref("extensions.lastAppBuildId", "...");
user_pref("extensions.lastAppVersion", "...");
```

然后用 `-purgecaches` 重新启动。

## 检查

提交前运行：

```bash
npm test
npm run check
xmllint --noout content/popup.xhtml content/preferences.xhtml
unzip -t paper-translation-popup.xpi
```

手动检查：

- Zotero 能识别 ScholarMate。
- 设置页能保存并重新加载 token 和模型名。
- 快捷键能打开插件面板。
- 点击“翻译”能读取当前 PDF 选区。
- 请求 API 时能显示发送的单词数。
- token 缺失、未选中文本、OpenAI 请求失败时有明确提示。

## Zotero 9 开发注意

- Zotero 9 安装 XPI 时要求 `manifest.json` 中包含 `applications.zotero.update_url`。缺少它时，界面只会提示插件可能不兼容。
- 只写 `browser_specific_settings.zotero` 不够；当前插件使用 `applications.zotero`。
- 在本地环境中，proxy 文件不一定稳定。直接把打包好的 XPI 放入 profile 的 `extensions/` 目录是目前验证过的安装路径。
- `window.openDialog()` 在 Zotero 9.0.4 中会打开 `about:blank`，所以 ScholarMate 使用 `bootstrap.js` 创建 in-window 浮动面板。
- Zotero Reader/PDF.js 可能吞掉 XUL key binding，所以插件同时在主窗口和 reader frame 上安装 capture 阶段的 `keydown` 监听。
- PDF.js 文本层会规范化空格和换行。读取上下文时不要只依赖 `containerText.indexOf(selectedText)`，优先用 DOM Range 边界读取前后文本。
- 不要硬编码 `temperature`。部分新模型只接受默认 temperature，显式传 `0.2` 会被 OpenAI 拒绝。
- 替换 XPI 后要重启 Zotero。资源看起来没更新时，用 `-purgecaches` 启动。
