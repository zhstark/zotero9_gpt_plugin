# ScholarMate 开发文档

这份文档记录 ScholarMate 的开发安装、打包、检查命令和 Zotero 9 排坑信息。用户使用说明放在仓库根目录的 `README.md`。

## 插件标识

- 展示名称：`ScholarMate`
- 插件 ID：`paper-translation-popup@lobster.local`
- XPI 文件名：`paper-translation-popup.xpi`

当前保留旧插件 ID 和 XPI 文件名，避免破坏已安装插件的覆盖升级路径。

## 打包

从源码重新生成 XPI：

```bash
zip -r -FS paper-translation-popup.xpi manifest.json bootstrap.js content -x '*.DS_Store'
```

检查 XPI：

```bash
unzip -t paper-translation-popup.xpi
unzip -p paper-translation-popup.xpi manifest.json
```

## 开发安装

macOS 开发时先找到 Zotero profile 目录：

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

## 安装到本机测试 profile

当前本机验证过的覆盖安装路径：

```bash
cp paper-translation-popup.xpi "$HOME/Library/Application Support/Zotero/Profiles/tfejpq17.default/extensions/paper-translation-popup@lobster.local.xpi"
```

替换 XPI 后要完全重启 Zotero。

## 检查命令

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

## API 请求

当前版本调用 OpenAI Chat Completions API：

```text
https://api.openai.com/v1/chat/completions
```

实际生效的 Zotero in-window 面板请求代码在 `bootstrap.js` 的 `translateWithOpenAI()`。备用弹窗和测试使用 `content/translator.js`。

不要硬编码 `temperature`。部分新模型只接受默认 temperature，显式传 `0.2` 会被 OpenAI 拒绝。

## Zotero 9 开发注意

- Zotero 9 安装 XPI 时要求 `manifest.json` 中包含 `applications.zotero.update_url`。缺少它时，界面只会提示插件可能不兼容。
- 只写 `browser_specific_settings.zotero` 不够；当前插件使用 `applications.zotero`。
- 在本地环境中，proxy 文件不一定稳定。直接把打包好的 XPI 放入 profile 的 `extensions/` 目录是目前验证过的安装路径。
- `window.openDialog()` 在 Zotero 9.0.4 中会打开 `about:blank`，所以 ScholarMate 使用 `bootstrap.js` 创建 in-window 浮动面板。
- Zotero preference pane 应按 XUL fragment 注册：使用 `rootURI + "content/preferences.xhtml"`，设置 `defaultXUL: true`，不要在 preference fragment 顶部使用 XML declaration 或 stylesheet processing instruction。
- Zotero bootstrap scope 里不一定有全局 `fetch`。翻译时要传入请求实现，并在需要时回退到 `Zotero.HTTP.request`。
- Zotero Reader/PDF.js 可能吞掉 XUL key binding，所以插件同时在主窗口和 reader frame 上安装 capture 阶段的 `keydown` 监听。
- PDF.js 文本层会规范化空格和换行。读取上下文时不要只依赖 `containerText.indexOf(selectedText)`，优先用 DOM Range 边界读取前后文本。
- PDF.js 直接读取 `selection.toString()` 可能和可见高亮有偏移。优先使用 PDF.js 复制管线读取选中文本。
- 替换 XPI 后要重启 Zotero。资源看起来没更新时，用 `-purgecaches` 启动。
