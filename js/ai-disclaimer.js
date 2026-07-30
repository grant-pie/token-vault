// Shows the AI-generated-art disclaimer modal whenever the vault page loads.
const aiDisclaimerModal = document.getElementById("ai-disclaimer-modal");
const aiDisclaimerCloseBtn = document.getElementById("ai-disclaimer-close");

if (aiDisclaimerModal) {
  aiDisclaimerModal.showModal();
}

if (aiDisclaimerCloseBtn) {
  aiDisclaimerCloseBtn.addEventListener("click", () => aiDisclaimerModal.close());
}
