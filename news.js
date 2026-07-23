function formatNewsDate(isoDate) {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function renderNews() {
  const list = document.getElementById("news-list");
  if (!list) return;

  if (!NEWS || NEWS.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No news yet — check back soon.";
    list.appendChild(empty);
    return;
  }

  NEWS.forEach((item) => {
    const entry = document.createElement("article");
    entry.className = "news-item";

    const date = document.createElement("p");
    date.className = "news-date";
    date.textContent = formatNewsDate(item.date);

    const title = document.createElement("h3");
    title.className = "news-title";
    title.textContent = item.title;

    const body = document.createElement("p");
    body.className = "news-body";
    body.textContent = item.body;

    entry.appendChild(date);
    entry.appendChild(title);
    entry.appendChild(body);
    list.appendChild(entry);
  });
}

renderNews();
