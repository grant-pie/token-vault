const form = document.getElementById("feedback-form");
const typeField = document.getElementById("feedback-type");
const nameField = document.getElementById("feedback-name");
const emailField = document.getElementById("feedback-email");
const messageField = document.getElementById("feedback-message");
const statusEl = document.getElementById("feedback-status");
const feedbackBtn = document.getElementById("feedback-btn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = messageField.value.trim();
  if (!message) {
    statusEl.textContent = "Write a message before sending.";
    messageField.focus();
    return;
  }

  const fullMessage = `[${typeField.value}] ${message}`;

  feedbackBtn.disabled = true;
  feedbackBtn.textContent = "Sending...";
  statusEl.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: fullMessage,
        name: nameField.value.trim(),
        email: emailField.value.trim(),
        page: document.referrer || "",
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.textContent = data.error || "Something went wrong. Try again.";
      return;
    }

    statusEl.textContent = "Thanks — feedback sent!";
    form.reset();
  } catch {
    statusEl.textContent = "Couldn't reach the server. Check your connection and try again.";
  } finally {
    feedbackBtn.disabled = false;
    feedbackBtn.textContent = "Send Feedback";
  }
});
