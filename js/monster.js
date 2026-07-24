const form = document.getElementById("summon-form");
const descriptionField = document.getElementById("description");
const statusEl = document.getElementById("generator-status");
const resultSection = document.getElementById("generator-result");
const resultFrame = document.getElementById("result-frame");
const resultImage = document.getElementById("result-image");
const downloadLink = document.getElementById("download-link");
const customizeBtn = document.getElementById("customize-btn");
const summonBtn = document.getElementById("summon-btn");

resultImage.crossOrigin = "anonymous";

function buildPrompt() {
  const description = descriptionField.value.trim();
  return `A monster. ${description}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const description = descriptionField.value.trim();
  if (!description) {
    statusEl.textContent = "Describe your monster before summoning.";
    descriptionField.focus();
    return;
  }

  const prompt = buildPrompt();

  summonBtn.disabled = true;
  summonBtn.textContent = "Summoning...";
  statusEl.textContent = "";
  downloadLink.hidden = true;
  customizeBtn.hidden = true;
  resultFrame.classList.add("is-loading");
  resultSection.hidden = false;

  try {
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: prompt }),
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = data.error || "Something went wrong. Try again.";
      resultFrame.classList.remove("is-loading");
      resultSection.hidden = true;
      return;
    }

    const imageUrl = `${API_BASE}${data.url}`;
    resultImage.src = imageUrl;
    downloadLink.href = imageUrl;
    downloadLink.download = `${data.id}.png`;
    resultFrame.classList.remove("is-loading");
    downloadLink.hidden = false;

    customizeBtn.hidden = false;
    customizeBtn.onclick = () => {
      if (window.openTokenCustomizer) {
        window.openTokenCustomizer({ name: "Monster" }, imageUrl);
      }
    };
  } catch {
    statusEl.textContent = "Couldn't reach the generator. Check your connection and try again.";
    resultFrame.classList.remove("is-loading");
    resultSection.hidden = true;
  } finally {
    summonBtn.disabled = false;
    summonBtn.textContent = "Summon";
  }
});
