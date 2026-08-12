// remote-browser.js — Client for connecting to remote browser services.
// Supports Steel Browser REST API and compatible services.
// When connected, the iframe shows the remote browser view and the AI agent
// uses the remote browser for content extraction.

export class RemoteBrowserClient {
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.sessionId = null;
  }

  async createSession(options = {}) {
    const resp = await fetch(`${this.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        browserType: 'chromium',
        viewport: { width: 1280, height: 800 },
        ...options,
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create session: HTTP ${resp.status}`);
    const data = await resp.json();
    this.sessionId = data.id || data.sessionId;
    return this.sessionId;
  }

  async navigate(url) {
    const resp = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}/navigate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) throw new Error(`Navigate failed: HTTP ${resp.status}`);
    return resp.json();
  }

  async getPageContent() {
    const resp = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}/content`, {
      headers: {
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
    });
    if (!resp.ok) throw new Error(`Get content failed: HTTP ${resp.status}`);
    return resp.json();
  }

  async screenshot() {
    const resp = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}/screenshot`, {
      headers: {
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
    });
    if (!resp.ok) throw new Error(`Screenshot failed: HTTP ${resp.status}`);
    const data = await resp.json();
    return data.screenshotUrl || data.url || data.image;
  }

  async click(selector) {
    const resp = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}/click`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ selector }),
    });
    if (!resp.ok) throw new Error(`Click failed: HTTP ${resp.status}`);
    return resp.json();
  }

  async type(selector, text) {
    const resp = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}/type`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ selector, text }),
    });
    if (!resp.ok) throw new Error(`Type failed: HTTP ${resp.status}`);
    return resp.json();
  }

  async scroll(direction, amount) {
    const resp = await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}/scroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ direction, amount }),
    });
    if (!resp.ok) throw new Error(`Scroll failed: HTTP ${resp.status}`);
    return resp.json();
  }

  async closeSession() {
    if (!this.sessionId) return;
    try {
      await fetch(`${this.baseUrl}/v1/sessions/${this.sessionId}`, {
        method: 'DELETE',
        headers: {
          ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        },
      });
    } finally {
      this.sessionId = null;
    }
  }

  getViewUrl() {
    return this.sessionId ? `${this.baseUrl}/v1/sessions/${this.sessionId}/view` : null;
  }
}
