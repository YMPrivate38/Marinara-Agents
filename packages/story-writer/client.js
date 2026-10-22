const TAG = "marinara-capability-story-writer";

class StoryWriterElement extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<div style="padding:24px"><h2>Story Writer</h2><p data-out>Loading…</p><button data-btn>Ping server</button></div>';
    this.querySelector("[data-btn]").addEventListener("click", () => this.ping("post"));
    this.ping("get");
  }

  async ping(method) {
    const out = this.querySelector("[data-out]");
    try {
      const { count } = await globalThis.__MARINARA_HOST__.api.api[method]("/story-writer/hello");
      out.textContent = `Server reachable. Pings stored: ${count}`;
    } catch (error) {
      out.textContent = `Server error: ${error?.message ?? error}`;
    }
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, StoryWriterElement);
