/**
 * Climate Scheduler Card 
 */

// Version checking - detect if browser cache is stale
(async function() {
  try {
    const scriptUrl = document.currentScript?.src || new URL(import.meta.url).href;
    const loadedVersion = new URL(scriptUrl).searchParams.get('v');
    
    // Fetch the current server version
    const response = await fetch('/climate_scheduler/static/.version');
    if (response.ok) {
      const serverVersion = (await response.text()).trim().split(',')[0];
      
      // Compare versions - if they don't match, user has stale cache
      if (loadedVersion && serverVersion && loadedVersion !== serverVersion) {
        console.warn('[Climate Scheduler] Version mismatch detected. Loaded:', loadedVersion, 'Server:', serverVersion);
        
        // Store in sessionStorage to avoid showing repeatedly
        const notificationKey = 'climate_scheduler_refresh_shown';
        const shownVersion = sessionStorage.getItem(notificationKey);
        
        if (shownVersion !== serverVersion) {
          // Show persistent notification
          const event = new Event('hass-notification', {
            bubbles: true,
            cancelable: false,
            composed: true
          });
          event.detail = {
            message: 'Climate Scheduler has been updated. Please refresh your browser (Ctrl+F5 or Cmd+Shift+R) to load the new version.',
            duration: 0  // Persistent notification
          };
          document.body.dispatchEvent(event);
          
          // Mark as shown for this session
          sessionStorage.setItem(notificationKey, serverVersion);
          console.info('[Climate Scheduler] Refresh notification displayed');
        }
      }
    }
  } catch (e) {
    console.debug('[Climate Scheduler] Version check failed:', e);
  }
})();

// Register card in picker immediately before class definition
// This ensures the card appears in the card picker even if there are errors during class definition
(function() {
  try {
    window.customCards = window.customCards || [];
    const cardType = 'climate-scheduler-card';
    const exists = window.customCards.some((c) => c.type === cardType);
    
    if (!exists) {
      window.customCards.push({
        type: cardType,
        name: 'Climate Scheduler Card',
        description: 'Full Climate Scheduler UI as a Lovelace card',
        preview: false,
      });
      console.info('[Climate Scheduler] Card registered in picker');
    }
  } catch (e) {
    console.error('[Climate Scheduler] Failed to register card in picker:', e);
  }
})();

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

// Define custom element after class is fully defined
if (!customElements.get('climate-scheduler-card')) {
  try {
    customElements.define('climate-scheduler-card', ClimateSchedulerCard);
    console.info('[Climate Scheduler] Custom element defined');
  } catch (e) {
    console.error('[Climate Scheduler] Failed to define custom element:', e);
  }
}

export {};
