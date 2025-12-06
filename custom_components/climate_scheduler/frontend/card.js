class ClimateSchedulerCard extends HTMLElement {
  static getConfigElement() { return null; }
  static getStubConfig() { return {}; }

  setConfig(config) {
    this._config = config || {};
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  async render() {
    if (!this._container) {
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host { display: block; }
        .wrapper { width: 100%; height: 100%; }
      `;
      this._container = document.createElement('div');
      this._container.className = 'wrapper';
      shadow.appendChild(style);
      shadow.appendChild(this._container);
    }

    // Load the existing panel module and render the same UI inline
    try {
      // Attempt to import the panel module that defines 'climate-scheduler-panel'
      // Cache-busting is handled by HA panel registration; the bare path works for cards
      await import('/api/climate_scheduler/panel.js');
    } catch (e) {
      this._container.innerHTML = `<div>Failed to load panel module: ${e}</div>`;
      return;
    }

    // Create the panel element if available
    const tag = 'climate-scheduler-panel';
    if (!customElements.get(tag)) {
      this._container.innerHTML = `<div>Panel component not registered. Please reload.</div>`;
      return;
    }

    // Clear previous content
    this._container.innerHTML = '';
    const el = document.createElement(tag);
    // Pass hass for HA API access
    if (this._hass) el.hass = this._hass;
    // Indicate embedded/card context if the panel supports it
    el.setAttribute('embed', '1');
    // Append
    this._container.appendChild(el);
  }

  getCardSize() {
    return 10; // approximate height
  }
}

if (!customElements.get('climate-scheduler-card')) {
  customElements.define('climate-scheduler-card', ClimateSchedulerCard);
}

window.customCards = window.customCards || [];
const exists = window.customCards.some((c) => c.type === 'climate-scheduler-card');
if (!exists) {
  window.customCards.push({
    type: 'climate-scheduler-card',
    name: 'Climate Scheduler',
    description: 'Full Climate Scheduler UI as a Lovelace card',
    preview: false,
  });
}

// Mark file as ES module to match Lovelace 'Module' resource type
export {};
