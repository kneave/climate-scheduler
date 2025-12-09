class ClimateSchedulerCard extends HTMLElement {
  static getConfigElement() { return null; }
  static getStubConfig() { return {}; }

  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._rendered = false;
  }

  setConfig(config) {
    // Accept any config, even empty - this must not throw
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    // Render when hass is available and we're connected
    if (this.isConnected && !this._rendered) {
      this._doRender();
    }
  }

  connectedCallback() {
    // Render when connected to DOM and hass is available
    if (this._hass && !this._rendered) {
      this._doRender();
    }
  }

  _doRender() {
    this._rendered = true;
    
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host { display: block; }
        .wrapper { width: 100%; min-height: 400px; }
      `;
      shadow.appendChild(style);
      
      this._container = document.createElement('div');
      this._container.className = 'wrapper';
      shadow.appendChild(this._container);
    }

    this._loadPanel();
  }

  async _loadPanel() {
    // Load the existing panel module and render the same UI inline
    try {
      // Avoid re-importing if the element is already registered
      if (!customElements.get('climate-scheduler-panel')) {
        await import('/api/climate_scheduler/panel.js');
      }
    } catch (e) {
      this._container.innerHTML = `<div style="padding: 16px; color: red;">Failed to load panel module: ${e}</div>`;
      return;
    }

    // Create the panel element if available
    const tag = 'climate-scheduler-panel';
    if (!customElements.get(tag)) {
      this._container.innerHTML = `<div style="padding: 16px; color: orange;">Panel component not registered. Please reload the integration.</div>`;
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
