// "Edit this token" flow shared by generate.html and monster.html: sends the
// id of an already-generated token plus a text description of the desired
// change to /api/edit, which fetches the original image server-side and asks
// OpenAI to edit it. No image is ever uploaded from the browser.

const editSection = document.getElementById("edit-section");
const editDescriptionField = document.getElementById("edit-description");
const editBtn = document.getElementById("edit-btn");
const editStatusEl = document.getElementById("edit-status");

// Suffixed to avoid colliding with generate.js/monster.js, which declare
// their own top-level const of the same DOM elements — plain <script> tags
// share one global scope, so two same-named top-level consts across files is
// a SyntaxError that aborts the whole script.
const editorResultImage = document.getElementById("result-image");
const editorDownloadLink = document.getElementById("download-link");
const editorCustomizeBtn = document.getElementById("customize-btn");
const editorResultFrame = document.getElementById("result-frame");

let currentTokenId = null;
let currentTokenName = "Token";

// Called by generate.js/monster.js once a generation succeeds, so the edit
// box only ever appears once there's something in R2 to edit.
function showEditableToken(id, tokenName) {
  currentTokenId = id;
  currentTokenName = tokenName || "Token";
  if (editDescriptionField) editDescriptionField.value = "";
  if (editStatusEl) editStatusEl.textContent = "";
  if (editSection) editSection.hidden = false;
}

// Called while a fresh generation is in flight, so a stale edit box can't be
// applied to a token that's about to be replaced.
function hideTokenEditor() {
  currentTokenId = null;
  if (editSection) editSection.hidden = true;
}

if (editBtn) {
  editBtn.addEventListener("click", async () => {
    const instruction = editDescriptionField ? editDescriptionField.value.trim() : "";
    if (!instruction) {
      if (editStatusEl) editStatusEl.textContent = "Describe the change you want first.";
      if (editDescriptionField) editDescriptionField.focus();
      return;
    }
    if (!currentTokenId) return;

    editBtn.disabled = true;
    editBtn.textContent = "Editing...";
    if (editStatusEl) editStatusEl.textContent = "";
    if (editorResultFrame) editorResultFrame.classList.add("is-loading");

    try {
      const res = await fetch(`${API_BASE}/api/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(window.getCreditAuthHeaders ? window.getCreditAuthHeaders() : {}),
        },
        body: JSON.stringify({ id: currentTokenId, description: instruction }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (editStatusEl) editStatusEl.textContent = data.error || "Couldn't make that edit. Try again.";
        return;
      }

      if (typeof data.creditsRemaining === "number" && window.renderCreditBalance) {
        window.renderCreditBalance(data.creditsRemaining);
      }

      const imageUrl = `${API_BASE}${data.url}`;
      editorResultImage.src = imageUrl;
      editorDownloadLink.href = imageUrl;
      editorDownloadLink.download = `${data.id}.png`;
      editorCustomizeBtn.onclick = () => {
        if (window.openTokenCustomizer) {
          window.openTokenCustomizer({ name: currentTokenName }, imageUrl);
        }
      };

      currentTokenId = data.id;
      editDescriptionField.value = "";
    } catch {
      if (editStatusEl) {
        editStatusEl.textContent = "Couldn't reach the generator. Check your connection and try again.";
      }
    } finally {
      if (editorResultFrame) editorResultFrame.classList.remove("is-loading");
      editBtn.disabled = false;
      editBtn.textContent = "Apply Edit";
    }
  });
}

window.showEditableToken = showEditableToken;
window.hideTokenEditor = hideTokenEditor;
