(function () {
  const PREF_TOKEN = "extensions.paperTranslationPopup.openaiToken";
  const PREF_MODEL = "extensions.paperTranslationPopup.openaiModel";
  const DEFAULT_MODEL = "gpt-4o-mini";

  let tokenInput;
  let modelInput;
  let statusNode;

  let initialized = false;

  if (document.readyState === "complete" || document.readyState === "interactive") {
    initWhenReady();
  }
  window.addEventListener("load", initWhenReady);
  document.addEventListener("DOMContentLoaded", initWhenReady);

  function initWhenReady() {
    if (initialized || !document.getElementById("openai-token")) {
      return;
    }
    initialized = true;
    init();
  }

  function init() {
    tokenInput = document.getElementById("openai-token");
    modelInput = document.getElementById("openai-model");
    statusNode = document.getElementById("settings-status");

    tokenInput.value = Zotero.Prefs.get(PREF_TOKEN) || "";
    modelInput.value = Zotero.Prefs.get(PREF_MODEL) || DEFAULT_MODEL;

    document.getElementById("save-settings").addEventListener("command", saveSettings);
  }

  function saveSettings() {
    const token = String(tokenInput.value || "").trim();
    const model = String(modelInput.value || "").trim() || DEFAULT_MODEL;

    Zotero.Prefs.set(PREF_TOKEN, token);
    Zotero.Prefs.set(PREF_MODEL, model);

    modelInput.value = model;
    statusNode.setAttribute("value", "已保存。");
    statusNode.classList.remove("error");
  }
})();
