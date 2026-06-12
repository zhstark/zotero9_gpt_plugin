(function () {
  const PREF_TOKEN = "extensions.paperTranslationPopup.openaiToken";
  const PREF_MODEL = "extensions.paperTranslationPopup.openaiModel";
  const DEFAULT_MODEL = "gpt-4o-mini";

  let tokenInput;
  let modelInput;
  let statusNode;

  let initialized = false;

  function init() {
    if (initialized || !document.getElementById("openai-token")) {
      return;
    }
    initialized = true;

    tokenInput = document.getElementById("openai-token");
    modelInput = document.getElementById("openai-model");
    statusNode = document.getElementById("settings-status");

    tokenInput.value = prefString(PREF_TOKEN) || "";
    modelInput.value = prefString(PREF_MODEL) || DEFAULT_MODEL;
  }

  function saveSettings() {
    init();

    const token = String(tokenInput.value || "").trim();
    const model = String(modelInput.value || "").trim() || DEFAULT_MODEL;

    Zotero.Prefs.set(PREF_TOKEN, token);
    Zotero.Prefs.set(PREF_MODEL, model);

    modelInput.value = model;
    statusNode.setAttribute("value", "已保存。");
    statusNode.classList.remove("error");
  }

  function prefString(prefName) {
    const value = Zotero.Prefs.get(prefName);
    if (typeof value !== "string" || value === "undefined") {
      return "";
    }
    return value;
  }

  window.PaperTranslationPopupPrefs = {
    init,
    saveSettings,
  };
})();
