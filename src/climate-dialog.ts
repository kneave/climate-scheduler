import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// Climate Entity Feature Enum (matching Home Assistant)
export const ClimateEntityFeature = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  TARGET_HUMIDITY: 4,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  AUX_HEAT: 64,
  TURN_OFF: 128,
  TURN_ON: 256,
  SWING_HORIZONTAL_MODE: 512,
};

// Helper function to check if a feature is supported
export function supportsFeature(stateObj: any, feature: number): boolean {
  return (stateObj.attributes.supported_features & feature) !== 0;
}

export interface ClimateState {
  entity_id: string;
  state: string;
  attributes: {
    supported_features: number;
    hvac_modes: string[];
    current_temperature?: number;
    temperature?: number;
    target_temp_high?: number;
    target_temp_low?: number;
    target_humidity?: number;
    humidity_step?: number;
    current_humidity?: number;
    temperature_step?: number;
    min_temp: number;
    max_temp: number;
    min_humidity?: number;
    max_humidity?: number;
    fan_mode?: string;
    fan_modes?: string[];
    preset_mode?: string;
    preset_modes?: string[];
    swing_mode?: string;
    swing_modes?: string[];
    swing_horizontal_mode?: string;
    swing_horizontal_modes?: string[];
    aux_heat?: string;
    noChange?: boolean;
  };
}

@customElement('climate-control-dialog')
export class ClimateControlDialog extends LitElement {
  @property({ type: Object })
  stateObj: ClimateState | null = null;

  static styles = css`
    :host {
      display: block;
      background: transparent;
      border-radius: var(--ha-card-border-radius, 8px);
      padding: 0;
    }

    .dialog-header {
      font-size: 20px;
      font-weight: 500;
      color: var(--primary-text-color, #333);
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .entity-icon {
      font-size: 28px;
    }

    .section {
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--secondary-text-color, #666);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mode-row {
      display: flex;
      gap: 12px;
    }

    .mode-row .section {
      flex: 1;
    }

    .mode-select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      background: var(--card-background-color, white);
      font-size: 14px;
      color: var(--primary-text-color, #333);
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s;
    }

    .mode-select:hover {
      border-color: #999;
    }

    .mode-select:focus {
      border-color: var(--primary-color, #03a9f4);
      box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.1);
    }

    .temp-range-control {
      position: relative;
    }

    .dual-range-container {
      position: relative;
      margin: 0 0;
      padding: 0;
    }

    .dual-range-input {
      position: absolute;
      width: 100%;
      left: 0;
      pointer-events: none;
      -webkit-appearance: none;
      background: transparent;
      margin: 0;
      height: 20px;
    }

    .dual-range-input::-webkit-slider-runnable-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input::-webkit-slider-thumb {
      -webkit-appearance: none;
      pointer-events: all;
      width: 20px !important;
      height: 20px !important;
      border-radius: 10px;
      background: linear-gradient(to bottom, white, #f8f8f8);
      cursor: grab;
      border: 2px solid var(--primary-color, #03a9f4);
      box-shadow: 
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
      margin-top: -6px !important;
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .dual-range-input::-webkit-slider-thumb:hover {
      transform: scale(1.1);
      box-shadow: 
        0 4px 12px rgba(0,0,0,0.2),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    .dual-range-input::-moz-range-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input::-moz-range-thumb {
      pointer-events: all;
      border: none;
      width: 20px !important;
      height: 20px !important;
      border-radius: 10px;
      background: linear-gradient(to bottom, white, #f8f8f8);
      cursor: grab;
      border: 2px solid var(--primary-color, #03a9f4);
      box-shadow: 
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
      margin-top: -6px !important;
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .dual-range-input::-moz-range-thumb:hover {
      transform: scale(1.1);
      box-shadow: 
        0 4px 12px rgba(0,0,0,0.2),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    .dual-range-input:focus::-webkit-slider-thumb {
      box-shadow: 
        0 0 0 4px rgba(3, 169, 244, 0.2),
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    .dual-range-input:focus::-moz-range-thumb {
      box-shadow: 
        0 0 0 4px rgba(3, 169, 244, 0.2),
        0 2px 8px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.8);
    }

    /* Heating input - red from left to thumb */
    .dual-range-input.heating::-webkit-slider-runnable-track {
      background: linear-gradient(to right, 
        #f44336 0%, 
        #f44336 var(--track-fill, 50%), 
        transparent var(--track-fill, 50%));
      height: 8px;
      border-radius: 4px;
      position: relative;
      z-index: 5;
    }

    .dual-range-input.heating::-moz-range-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input.heating::-moz-range-progress {
      background: #f44336;
      height: 8px;
      border-radius: 4px 0 0 4px;
    }

    /* Cooling input - blue from right to thumb */
    .dual-range-input.cooling::-webkit-slider-runnable-track {
      background: linear-gradient(to left, 
        #2196f3 0%, 
        #2196f3 var(--track-fill, 50%), 
        transparent var(--track-fill, 50%));
      height: 8px;
      border-radius: 4px;
      position: relative;
      z-index: 5;
    }

    .dual-range-input.cooling::-moz-range-track {
      background: transparent;
      height: 8px;
      border-radius: 4px;
    }

    .dual-range-input.cooling::-moz-range-progress {
      background: #2196f3;
      height: 8px;
      border-radius: 0 4px 4px 0;
      transform: scaleX(-1);
      transform-origin: center;
    }

    /* Heat/Cool input - orange full track */
    .dual-range-input.heat-cool::-webkit-slider-runnable-track {
      background: #ff9800;
      height: 8px;
      border-radius: 4px;
      position: relative;
      z-index: 5;
    }

    .dual-range-input.heat-cool::-moz-range-track {
      background: #ff9800;
      height: 8px;
      border-radius: 4px;
    }

    .temp-range-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 12px;
      padding: 0 10px;
    }

    .temp-range-value {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .temp-range-label {
      font-size: 11px;
      color: var(--secondary-text-color, #666);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .temp-range-number {
      font-size: 24px;
      font-weight: 600;
      color: var(--primary-text-color, #333);
    }

    .dual-range-fill {
      position: absolute;
      height: 8px;
      background: linear-gradient(90deg, rgba(244, 67, 54, 0.3), rgba(33, 150, 243, 0.3));
      border-radius: 4px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      z-index: 1;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
    }

    .toggle-label {
      font-size: 14px;
      color: var(--primary-text-color, #333);
    }

    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 26px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 26px;
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }

    input:checked + .toggle-slider {
      background-color: var(--primary-color, #03a9f4);
    }

    input:checked + .toggle-slider:before {
      transform: translateX(22px);
    }
  `;

  // Helper to capitalize mode text
  private _capitalize(text: string): string {
    // Special case for heat_cool
    if (text === 'heat_cool') {
      return 'Heat/Cool';
    }
    return text.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  render() {
    if (!this.stateObj) {
      return html`<div>No climate entity data</div>`;
    }

    return html`
      ${this._renderModeRow()}
      ${this._renderNoTemperatureChangeToggle()}
      ${this._renderTargetTemperature()}
      ${this._renderTargetTemperatureRange()}
      ${this._renderTargetHumidity()}
      ${this._renderFanSwingRow()}
      ${this._renderAuxHeat()}
    `;
  }

  private _renderModeRow() {
    const hasPresetMode = supportsFeature(this.stateObj!, ClimateEntityFeature.PRESET_MODE);
    
    if (!hasPresetMode) {
      return this._renderHvacModes();
    }
    
    return html`
      <div class="mode-row">
        ${this._renderHvacModes()}
        ${this._renderPresetModes()}
      </div>
    `;
  }

  private _renderHvacModes() {
    if (!this.stateObj) return '';

    return html`
      <div class="section">
        <div class="section-title">HVAC Mode</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.state || ''}
          @change=${this._handleHvacModeChange}
        >
          <option value="">-- No Change --</option>
          ${this.stateObj.attributes.hvac_modes.map(mode => html`
            <option value="${mode}" ?selected=${this.stateObj!.state === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
  }

  private _renderTargetTemperature() {
    if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_TEMPERATURE)) {
      return '';
    }

    const isNoTempChange = this._isNoTemperatureChangeEnabled();
    const temperatureStep = this._getTemperatureStep();
    const { min_temp, max_temp, temperature } = this.stateObj.attributes;
    const range = max_temp - min_temp;
    const tempPercent = ((temperature! - min_temp) / range) * 100;

    // Use the currently selected HVAC mode to determine styling
    const currentMode = this.stateObj.state;

    // Determine class, track fill, and label based on current mode
    let inputClass = '';
    let trackFill = tempPercent;
    let label = 'Set to';
    
    if (currentMode === 'heat_cool') {
      inputClass = 'heat-cool';
    } else if (currentMode === 'cool') {
      inputClass = 'cooling';
      trackFill = 100 - tempPercent;
      label = 'Cool to';
    } else if (currentMode === 'heat') {
      inputClass = 'heating';
      label = 'Heat to';
    }

    return html`
      <div class="section">
        <div class="section-title">Target Temperature</div>
        <div class="temp-range-control">
          <div class="temp-range-labels" style="justify-content: center;">
            <div class="temp-range-value">
              <span class="temp-range-label">${label}</span>
              <span class="temp-range-number">${temperature}°</span>
            </div>
          </div>
          <div class="dual-range-container">
            <input 
              type="range" 
              class="dual-range-input ${inputClass}"
              min="${min_temp}"
              max="${max_temp}"
              step="${temperatureStep}"
              ?disabled=${isNoTempChange}
              .value="${temperature}"
              @input=${this._handleTempSlider}
              style="top: 0; --track-fill: ${trackFill}%;"
            />
          </div>
        </div>
      </div>
    `;
  }

  private _renderTargetTemperatureRange() {
    if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_TEMPERATURE_RANGE)) {
      return '';
    }

    const isNoTempChange = this._isNoTemperatureChangeEnabled();
    const temperatureStep = this._getTemperatureStep();
    const { min_temp, max_temp, target_temp_low, target_temp_high } = this.stateObj.attributes;
    const range = max_temp - min_temp;
    const lowPercent = ((target_temp_low! - min_temp) / range) * 100;
    const highPercent = ((target_temp_high! - min_temp) / range) * 100;

    // Use the currently selected HVAC mode to determine layout
    const currentMode = this.stateObj.state;
    
    // Determine if we need dual range or single based on current mode
    const heatOnly = currentMode === 'heat';
    const coolOnly = currentMode === 'cool';
    const isOffOrAuto = currentMode === 'off' || currentMode === 'auto';

    // Render heat only (single input with red track)
    if (heatOnly) {
      return html`
        <div class="section">
          <div class="section-title">Target Temperature</div>
          <div class="temp-range-control">
            <div class="temp-range-labels" style="justify-content: center;">
              <div class="temp-range-value">
                <span class="temp-range-label">Heat to</span>
                <span class="temp-range-number">${target_temp_low}°</span>
              </div>
            </div>
            <div class="dual-range-container">
              <input 
                type="range" 
                class="dual-range-input heating"
                min="${min_temp}"
                max="${max_temp}"
                step="${temperatureStep}"
                ?disabled=${isNoTempChange}
                .value="${target_temp_low}"
                @input=${this._handleTempLowSlider}
                style="top: 0; --track-fill: ${lowPercent}%;"
              />
            </div>
          </div>
        </div>
      `;
    }

    // Render cool only (single input with blue track)
    if (coolOnly) {
      return html`
        <div class="section">
          <div class="section-title">Target Temperature</div>
          <div class="temp-range-control">
            <div class="temp-range-labels" style="justify-content: center;">
              <div class="temp-range-value">
                <span class="temp-range-label">Cool to</span>
                <span class="temp-range-number">${target_temp_high}°</span>
              </div>
            </div>
            <div class="dual-range-container">
              <input 
                type="range" 
                class="dual-range-input cooling"
                min="${min_temp}"
                max="${max_temp}"
                step="${temperatureStep}"
                ?disabled=${isNoTempChange}
                .value="${target_temp_high}"
                @input=${this._handleTempHighSlider}
                style="top: 0; --track-fill: ${100 - highPercent}%;"
              />
            </div>
          </div>
        </div>
      `;
    }

    // Render dual range (both heat and cool, heat_cool, auto, or off)
    return html`
      <div class="section">
        <div class="section-title">Temperature Range</div>
        <div class="temp-range-control">
          <div class="temp-range-labels">
            <div class="temp-range-value">
              <span class="temp-range-label">Heat to</span>
              <span class="temp-range-number">${target_temp_low}°</span>
            </div>
            <div class="temp-range-value">
              <span class="temp-range-label">Cool to</span>
              <span class="temp-range-number">${target_temp_high}°</span>
            </div>
          </div>
          <div class="dual-range-container">
            ${!isOffOrAuto ? html`
              <div class="dual-range-fill" 
                style="left: ${lowPercent}%; width: ${highPercent - lowPercent}%">
              </div>
            ` : ''}
            <input 
              type="range" 
              class="dual-range-input ${!isOffOrAuto ? 'heating' : ''}"
              min="${min_temp}"
              max="${max_temp}"
              step="${temperatureStep}"
              ?disabled=${isNoTempChange}
              .value="${target_temp_low}"
              @input=${this._handleTempLowSlider}
              style="top: 0; --track-fill: ${lowPercent}%;"
            />
            <input 
              type="range" 
              class="dual-range-input ${!isOffOrAuto ? 'cooling' : ''}"
              min="${min_temp}"
              max="${max_temp}"
              step="${temperatureStep}"
              ?disabled=${isNoTempChange}
              .value="${target_temp_high}"
              @input=${this._handleTempHighSlider}
              style="top: 0; --track-fill: ${100 - highPercent}%;"
            />
          </div>
        </div>
      </div>
    `;
  }

  private _renderTargetHumidity() {
    if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_HUMIDITY)) {
      return '';
    }

    const humidityStep = this._getHumidityStep();
    const { min_humidity, max_humidity, target_humidity } = this.stateObj.attributes;
    const range = max_humidity! - min_humidity!;
    const humidityPercent = ((target_humidity! - min_humidity!) / range) * 100;

    return html`
      <div class="section">
        <div class="section-title">Target Humidity</div>
        <div class="temp-range-control">
          <div class="temp-range-labels" style="justify-content: center;">
            <div class="temp-range-value">
              <span class="temp-range-label">Set to</span>
              <span class="temp-range-number">${target_humidity}%</span>
            </div>
          </div>
          <div class="dual-range-container">
            <input 
              type="range" 
              class="dual-range-input"
              min="${min_humidity}"
              max="${max_humidity}"
              step="${humidityStep}"
              .value="${target_humidity}"
              @input=${this._handleHumiditySlider}
              style="top: 0; --track-fill: ${humidityPercent}%;"
            />
          </div>
        </div>
      </div>
    `;
  }

  private _renderFanSwingRow() {
    const hasFanMode = supportsFeature(this.stateObj!, ClimateEntityFeature.FAN_MODE);
    const hasSwingMode = supportsFeature(this.stateObj!, ClimateEntityFeature.SWING_MODE);
    const hasSwingHorizontal = supportsFeature(this.stateObj!, ClimateEntityFeature.SWING_HORIZONTAL_MODE);
    
    // If none are present, return nothing
    if (!hasFanMode && !hasSwingMode && !hasSwingHorizontal) {
      return '';
    }
    
    // If only one is present, show it full width
    if (hasFanMode && !hasSwingMode && !hasSwingHorizontal) {
      return this._renderFanModes();
    }
    if (!hasFanMode && hasSwingMode && !hasSwingHorizontal) {
      return this._renderSwingModes();
    }
    if (!hasFanMode && !hasSwingMode && hasSwingHorizontal) {
      return this._renderSwingHorizontalModes();
    }
    
    // Show all present modes in a row
    return html`
      <div class="mode-row">
        ${hasFanMode ? this._renderFanModes() : ''}
        ${hasSwingMode ? this._renderSwingModes() : ''}
        ${hasSwingHorizontal ? this._renderSwingHorizontalModes() : ''}
      </div>
    `;
  }

  private _renderFanModes() {
    if (!this.stateObj) return '';

    return html`
      <div class="section">
        <div class="section-title">Fan Mode</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.fan_mode || ''}
          @change=${this._handleFanModeChange}
        >
          <option value="">-- No Change --</option>
          ${this.stateObj.attributes.fan_modes!.map(mode => html`
            <option value="${mode}" ?selected=${this.stateObj!.attributes.fan_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
  }

  private _renderPresetModes() {
    if (!this.stateObj) return '';

    return html`
      <div class="section">
        <div class="section-title">Thermostat Preset</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.preset_mode || ''}
          @change=${this._handlePresetModeChange}
        >
          <option value="">-- No Change --</option>
          ${this.stateObj.attributes.preset_modes!.map(mode => html`
            <option value="${mode}" ?selected=${this.stateObj!.attributes.preset_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
  }

  private _renderSwingModes() {
    if (!this.stateObj) return '';

    return html`
      <div class="section">
        <div class="section-title">Swing (Vertical)</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.swing_mode || ''}
          @change=${this._handleSwingModeChange}
        >
          <option value="">-- No Change --</option>
          ${this.stateObj.attributes.swing_modes!.map(mode => html`
            <option value="${mode}" ?selected=${this.stateObj!.attributes.swing_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
  }

  private _renderSwingHorizontalModes() {
    if (!this.stateObj) return '';

    return html`
      <div class="section">
        <div class="section-title">Swing (Horizontal)</div>
        <select 
          class="mode-select"
          .value=${this.stateObj.attributes.swing_horizontal_mode || ''}
          @change=${this._handleSwingHorizontalModeChange}
        >
          <option value="">-- No Change --</option>
          ${this.stateObj.attributes.swing_horizontal_modes!.map(mode => html`
            <option value="${mode}" ?selected=${this.stateObj!.attributes.swing_horizontal_mode === mode}>
              ${this._capitalize(mode)}
            </option>
          `)}
        </select>
      </div>
    `;
  }

  private _renderAuxHeat() {
    if (!this.stateObj || !supportsFeature(this.stateObj, ClimateEntityFeature.AUX_HEAT)) {
      return '';
    }

    return html`
      <div class="section">
        <div class="section-title">Auxiliary Heat</div>
        <div class="toggle-row">
          <span class="toggle-label">Aux Heat</span>
          <label class="toggle-switch">
            <input 
              type="checkbox" 
              .checked=${this.stateObj.attributes.aux_heat === 'on'}
              @change=${this._handleAuxHeatToggle}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;
  }

  private _isNoTemperatureChangeEnabled() {
    return Boolean(this.stateObj?.attributes.noChange);
  }

  private _getTemperatureStep() {
    const configuredStep = this.stateObj?.attributes.temperature_step;
    if (typeof configuredStep === 'number' && Number.isFinite(configuredStep) && configuredStep > 0) {
      return configuredStep;
    }
    return 0.5;
  }

  private _getHumidityStep() {
    const configuredStep = this.stateObj?.attributes.humidity_step;
    if (typeof configuredStep === 'number' && Number.isFinite(configuredStep) && configuredStep > 0) {
      return configuredStep;
    }
    return 1;
  }

  private _normalizeToStep(value: number, step: number): number {
    const snapped = step > 0 ? Math.round(value / step) * step : value;
    const precision = this._getStepPrecision(step);
    const factor = 10 ** precision;
    return Math.round((snapped + Number.EPSILON) * factor) / factor;
  }

  private _getStepPrecision(step: number): number {
    if (!Number.isFinite(step) || step <= 0) {
      return 3;
    }

    const stepString = step.toString().toLowerCase();
    if (stepString.includes('e-')) {
      const exponent = Number(stepString.split('e-')[1]);
      return Number.isFinite(exponent) ? exponent : 3;
    }

    const decimalPart = stepString.split('.')[1];
    return decimalPart ? decimalPart.length : 0;
  }

  private _renderNoTemperatureChangeToggle() {
    if (!this.stateObj) return '';

    const supportsTemperature =
      supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_TEMPERATURE) ||
      supportsFeature(this.stateObj, ClimateEntityFeature.TARGET_TEMPERATURE_RANGE);

    if (!supportsTemperature) {
      return '';
    }

    return html`
      <div class="section">
        <div class="toggle-row">
          <span class="toggle-label">No Temperature Change</span>
          <label class="toggle-switch">
            <input
              type="checkbox"
              .checked=${this._isNoTemperatureChangeEnabled()}
              @change=${this._handleNoTemperatureChangeToggle}
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;
  }

  // Event handlers that dispatch custom events for parent to handle
  private _handleHvacModeChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;

    if (this.stateObj) {
      this.stateObj = {
        ...this.stateObj,
        state: value
      };
    }

    this.dispatchEvent(new CustomEvent('hvac-mode-changed', {
      detail: { mode: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleTempSlider(e: Event) {
    const rawValue = parseFloat((e.target as HTMLInputElement).value);
    const value = this._normalizeToStep(rawValue, this._getTemperatureStep());
    // Update stateObj to trigger re-render with new track fill
    if (this.stateObj) {
      this.stateObj = {
        ...this.stateObj,
        attributes: {
          ...this.stateObj.attributes,
          temperature: value
        }
      };
    }
    this.dispatchEvent(new CustomEvent('temperature-changed', {
      detail: { temperature: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleTempLowSlider(e: Event) {
    const rawValue = parseFloat((e.target as HTMLInputElement).value);
    const value = this._normalizeToStep(rawValue, this._getTemperatureStep());
    // Update stateObj to trigger re-render with new track fill
    if (this.stateObj) {
      this.stateObj = {
        ...this.stateObj,
        attributes: {
          ...this.stateObj.attributes,
          target_temp_low: value
        }
      };
    }
    this.dispatchEvent(new CustomEvent('target-temp-low-changed', {
      detail: { temperature: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleTempHighSlider(e: Event) {
    const rawValue = parseFloat((e.target as HTMLInputElement).value);
    const value = this._normalizeToStep(rawValue, this._getTemperatureStep());
    // Update stateObj to trigger re-render with new track fill
    if (this.stateObj) {
      this.stateObj = {
        ...this.stateObj,
        attributes: {
          ...this.stateObj.attributes,
          target_temp_high: value
        }
      };
    }
    this.dispatchEvent(new CustomEvent('target-temp-high-changed', {
      detail: { temperature: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleHumiditySlider(e: Event) {
    const rawValue = parseFloat((e.target as HTMLInputElement).value);
    const value = this._normalizeToStep(rawValue, this._getHumidityStep());
    // Update stateObj to trigger re-render with new track fill
    if (this.stateObj) {
      this.stateObj = {
        ...this.stateObj,
        attributes: {
          ...this.stateObj.attributes,
          target_humidity: value
        }
      };
    }
    this.dispatchEvent(new CustomEvent('humidity-changed', {
      detail: { humidity: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleFanModeChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent('fan-mode-changed', {
      detail: { mode: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handlePresetModeChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent('preset-mode-changed', {
      detail: { mode: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleSwingModeChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent('swing-mode-changed', {
      detail: { mode: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleSwingHorizontalModeChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(new CustomEvent('swing-horizontal-mode-changed', {
      detail: { mode: value },
      bubbles: true,
      composed: true
    }));
  }

  private _handleAuxHeatToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this.dispatchEvent(new CustomEvent('aux-heat-changed', {
      detail: { enabled: checked },
      bubbles: true,
      composed: true
    }));
  }

  private _handleNoTemperatureChangeToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;

    if (this.stateObj) {
      this.stateObj = {
        ...this.stateObj,
        attributes: {
          ...this.stateObj.attributes,
          noChange: checked
        }
      };
    }

    this.dispatchEvent(new CustomEvent('no-temp-change-changed', {
      detail: { enabled: checked },
      bubbles: true,
      composed: true
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'climate-control-dialog': ClimateControlDialog;
  }
}
