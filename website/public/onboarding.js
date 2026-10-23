const prompt = document.getElementById("onboarding-prompt");
const button = document.getElementById("copy-onboarding-prompt");
const status = document.getElementById("copy-status");

if (prompt && button && status) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    try {
      await navigator.clipboard.writeText(prompt.textContent.trim());
      status.textContent =
        "Copied. Paste this into Codex with your application project open.";
    } catch {
      prompt.focus();
      const range = document.createRange();
      range.selectNodeContents(prompt);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent =
        "Copy unavailable. Select the prompt below and copy it manually.";
    } finally {
      button.disabled = false;
    }
  });
}
