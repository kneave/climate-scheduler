/**
 * Climate Scheduler Card - Standalone Version
 * Requires Climate Scheduler integration to be installed for backend services
 */

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
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    if (this.isConnected && !this._rendered) {
      this._doRender();
    }
  }

  connectedCallback() {
    if (this._hass && !this._rendered) {
      this._doRender();
    }
  }

  async _doRender() {
    this._rendered = true;
    
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `:host { display: block; } .wrapper { width: 100%; min-height: 400px; }`;
      shadow.appendChild(style);
      
      this._container = document.createElement('div');
      this._container.className = 'wrapper';
      shadow.appendChild(this._container);
    }

    await this._loadPanel();
  }

  async _loadPanel() {
    // Check if integration is installed
    if (!this._hass) {
      this._container.innerHTML = '<div style="padding: 16px; color: orange;">Waiting for Home Assistant connection...</div>';
      return;
    }

    // Check if climate_scheduler domain services exist
    const hasIntegration = this._hass.services?.climate_scheduler !== undefined;

    if (!hasIntegration) {
      this._container.innerHTML = `
        <div style="padding: 16px; color: red; border: 1px solid red; border-radius: 4px; margin: 16px;">
          <h3>❌ Climate Scheduler Integration Not Found</h3>
          <p>This card requires the Climate Scheduler integration to be installed.</p>
          <p>Install it from HACS or visit: 
            <a href="https://github.com/kneave/climate-scheduler" target="_blank" style="color: #03a9f4;">
              github.com/kneave/climate-scheduler
            </a>
          </p>
        </div>
      `;
      return;
    }

    // Load panel module
    try {
      // Determine base path - try integration-hosted static path first, fallback to standalone
      const scriptUrl = import.meta.url;
      // Integration registers frontend at /<domain>/static
      let basePath = '/climate_scheduler/static';

      // Flag visible to outer scope so error handlers can reference it
      // Only accept the integration-hosted static path; do not fallback.
      let isBundled = false;
      const testResponse = await fetch(`${basePath}/.version`);
      if (testResponse.ok) {
        isBundled = true;
      } else {
        // Explicitly fail if the integration static path is not present
        throw new Error('Integration frontend not found at /climate_scheduler/static');
      }
      
      const hacstag = new URL(scriptUrl).searchParams.get('hacstag');
      const versionParam = new URL(scriptUrl).searchParams.get('v');
      let versionString = null;
      let isDevDeployment = false;
      
      // Check .version file first - if it has a timestamp, prioritize it over hacstag
      try {
        const response = await fetch(`${basePath}/.version`);
        if (response.ok) {
          const versionText = (await response.text()).trim();
          if (versionText.includes(',')) {
            // Has timestamp - this is a dev deployment, use it instead of hacstag
            versionString = versionText;
            isDevDeployment = true;
          } else if (!hacstag && !versionParam) {
            // No timestamp and no hacstag - production release via script
            versionString = versionText;
          }
        }
      } catch (e) {
        console.warn('Failed to load .version file:', e);
      }
      
      // Prefer v= param (bundled integration), then hacstag (HACS standalone)
      if (!versionString && versionParam) {
        versionString = versionParam;
      } else if (!versionString && hacstag) {
        versionString = hacstag;
      }
      
      if (!customElements.get('climate-scheduler-panel')) {
        await import(`${basePath}/panel.js?v=${versionString}`);
      }
    } catch (e) {
      this._container.innerHTML = `
        <div style="padding: 16px; color: red;">
          Failed to load panel module: ${e.message}<br>
          Make sure the Climate Scheduler integration is installed and the frontend is available at /climate_scheduler/static
        </div>
      `;
      return;
    }

    const tag = 'climate-scheduler-panel';
    if (!customElements.get(tag)) {
      this._container.innerHTML = '<div style="padding: 16px; color: orange;">Panel component not registered. Please reload the page.</div>';
      return;
    }

    this._container.innerHTML = '';
    const el = document.createElement(tag);
    if (this._hass) el.hass = this._hass;
    el.setAttribute('embed', '1');
    this._container.appendChild(el);
  }

  getCardSize() {
    return 10;
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
    name: 'Climate Scheduler Card',
    description: 'Full Climate Scheduler UI as a Lovelace card',
    preview: false,
  });
}

export {};
