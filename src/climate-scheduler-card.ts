/**
 * Climate Scheduler Card 
 */

import { LitElement, html, css, PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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
          }) as any;
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

@customElement('climate-scheduler-card')
export class ClimateSchedulerCard extends LitElement {
  @property({ type: Object }) hass?: any;
  @state() private _config: any = {};
  @state() private _hasIntegration = false;
  @state() private _errorMessage: TemplateResult | string | null = null;
  @state() private _panelLoaded = false;

  static getConfigElement() { return null; }
  static getStubConfig() { return {}; }

  static styles = css`
    :host {
      display: block;
    }
    .wrapper {
      width: 100%;
      min-height: 400px;
    }
    .message {
      padding: 16px;
    }
    .error {
      color: var(--error-color, red);
      border: 1px solid var(--error-color, red);
      border-radius: 4px;
      margin: 16px;
    }
    .warning {
      color: var(--warning-color, orange);
    }
    .error a {
      color: var(--primary-color, #03a9f4);
    }
  `;

  constructor() {
    super();
    // Register card in picker
    this._registerCard();
  }

  private _registerCard() {
    try {
      (window as any).customCards = (window as any).customCards || [];
      const cardType = 'climate-scheduler-card';
      const exists = (window as any).customCards.some((c: any) => c.type === cardType);
      
      if (!exists) {
        (window as any).customCards.push({
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
  }

  setConfig(config: any) {
    this._config = config || {};
  }

  async firstUpdated() {
    await this._loadPanel();
  }

  updated(changedProperties: PropertyValues) {
    if (changedProperties.has('hass') && this.hass && !this._panelLoaded) {
      this._loadPanel();
    }
  }

  render() {
    if (this._errorMessage) {
      return html`
        <div class="wrapper">
          <div class="message error">
            ${this._errorMessage}
          </div>
        </div>
      `;
    }

    if (!this.hass) {
      return html`
        <div class="wrapper">
          <div class="message warning">Waiting for Home Assistant connection...</div>
        </div>
      `;
    }

    if (!this._hasIntegration) {
      return html`
        <div class="wrapper">
          <div class="message error">
            <h3>❌ Climate Scheduler Integration Not Found</h3>
            <p>This card requires the Climate Scheduler integration to be installed.</p>
            <p>Install it from HACS or visit: 
              <a href="https://github.com/kneave/climate-scheduler" target="_blank">
                github.com/kneave/climate-scheduler
              </a>
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="wrapper">
        <climate-scheduler-panel 
          .hass=${this.hass} 
          embed="1">
        </climate-scheduler-panel>
      </div>
    `;
  }

  async _loadPanel() {
    // Check if integration is installed
    if (!this.hass) {
      return;
    }

    // Check if climate_scheduler domain services exist
    this._hasIntegration = this.hass.services?.climate_scheduler !== undefined;

    if (!this._hasIntegration) {
      this.requestUpdate();
      return;
    }

    // Load panel module
    try {
      // Determine base path - try integration-hosted static path first, fallback to standalone
      const scriptUrl = import.meta.url;
      // Integration registers frontend at /<domain>/static
      const basePath = '/climate_scheduler/static';

      // Only accept the integration-hosted static path; do not fallback.
      const testResponse = await fetch(`${basePath}/.version`);
      if (!testResponse.ok) {
        throw new Error('Integration frontend not found at /climate_scheduler/static');
      }
      
      const hacstag = new URL(scriptUrl).searchParams.get('hacstag');
      const versionParam = new URL(scriptUrl).searchParams.get('v');
      let versionString = null;
      
      // Check .version file first - if it has a timestamp, prioritize it over hacstag
      try {
        const response = await fetch(`${basePath}/.version`);
        if (response.ok) {
          const versionText = (await response.text()).trim();
          if (versionText.includes(',')) {
            // Has timestamp - this is a dev deployment, use it instead of hacstag
            versionString = versionText;
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
      
      this._panelLoaded = true;
      this.requestUpdate();
    } catch (e: any) {
      this._errorMessage = html`
        Failed to load panel module: ${e.message}<br>
        Make sure the Climate Scheduler integration is installed and the frontend is available at /climate_scheduler/static
      `;
      this.requestUpdate();
    }
  }

  getCardSize() {
    return 10;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'climate-scheduler-card': ClimateSchedulerCard;
  }
}
