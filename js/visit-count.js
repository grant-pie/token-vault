// Pings the Worker to increment the server-side visit counter. Fire-and-forget:
// unlike third-party analytics scripts, this calls our own API_BASE domain, so
// it isn't caught by ad/tracker blockers that target known analytics hosts.
fetch(`${API_BASE}/api/visit`).catch(() => {});
