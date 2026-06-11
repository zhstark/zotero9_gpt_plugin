var Services;
try {
  ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (_error) {
  try {
    ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
  } catch (_ignored) {
    Services = null;
  }
}

const PLUGIN_ID = "paper-translation-popup@lobster.local";
const PREF_TOKEN = "extensions.paperTranslationPopup.openaiToken";
const PREF_MODEL = "extensions.paperTranslationPopup.openaiModel";
const DEFAULT_MODEL = "gpt-4o-mini";

var rootURI;
var pluginWindows = new Set();

function install() {}

function uninstall() {}

async function startup(data) {
  rootURI = data.rootURI;
  setDefaultPreferences();
  registerPreferencePane();

  const mainWindow = getMainWindow();
  if (mainWindow) {
    onMainWindowLoad({ window: mainWindow });
  }
}

function shutdown() {
  for (const win of pluginWindows) {
    removeFromWindow(win);
  }
  pluginWindows.clear();
}

function onMainWindowLoad({ window }) {
  addToWindow(window);
}

function onMainWindowUnload({ window }) {
  removeFromWindow(window);
}

function setDefaultPreferences() {
  if (!Zotero.Prefs.get(PREF_MODEL)) {
    Zotero.Prefs.set(PREF_MODEL, DEFAULT_MODEL);
  }
}

function registerPreferencePane() {
  if (!Zotero.PreferencePanes || !Zotero.PreferencePanes.register) {
    return;
  }

  Zotero.PreferencePanes.register({
    pluginID: PLUGIN_ID,
    src: rootURI + "content/preferences.xhtml",
    scripts: [rootURI + "content/preferences.js"],
  });
}

function getMainWindow() {
  if (typeof Zotero.getMainWindow === "function") {
    return Zotero.getMainWindow();
  }
  if (!Services) {
    return null;
  }
  return Services.wm.getMostRecentWindow("navigator:browser");
}

function addToWindow(window) {
  if (!window || !window.document || window.document.getElementById("paper-translation-popup-menuitem")) {
    return;
  }

  const doc = window.document;
  const menuPopup = doc.getElementById("menu_ToolsPopup");
  const keySet = getOrCreateKeySet(doc);

  const key = doc.createXULElement("key");
  key.id = "paper-translation-popup-key";
  key.setAttribute("key", "T");
  key.setAttribute("modifiers", "accel,shift");
  key.addEventListener("command", () => openPopup(window));
  keySet.appendChild(key);

  if (menuPopup) {
    const menuItem = doc.createXULElement("menuitem");
    menuItem.id = "paper-translation-popup-menuitem";
    menuItem.setAttribute("label", "翻译选中文本");
    menuItem.setAttribute("key", "paper-translation-popup-key");
    menuItem.addEventListener("command", () => openPopup(window));
    menuPopup.appendChild(menuItem);
  }

  pluginWindows.add(window);
}

function removeFromWindow(window) {
  if (!window || !window.document) {
    return;
  }

  const doc = window.document;
  for (const id of ["paper-translation-popup-menuitem", "paper-translation-popup-key"]) {
    const node = doc.getElementById(id);
    if (node) {
      node.remove();
    }
  }
  pluginWindows.delete(window);
}

function getOrCreateKeySet(doc) {
  let keySet = doc.getElementById("paper-translation-popup-keyset");
  if (keySet) {
    return keySet;
  }

  keySet = doc.createXULElement("keyset");
  keySet.id = "paper-translation-popup-keyset";
  doc.documentElement.appendChild(keySet);
  return keySet;
}

function openPopup(window) {
  const args = {
    opener: window,
    rootURI,
    prefs: {
      token: Zotero.Prefs.get(PREF_TOKEN) || "",
      model: Zotero.Prefs.get(PREF_MODEL) || DEFAULT_MODEL,
    },
  };

  window.openDialog(
    rootURI + "content/popup.xhtml",
    "paper-translation-popup",
    "chrome,centerscreen,resizable,width=520,height=460",
    args
  );
}
