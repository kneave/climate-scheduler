# Diagnostics Service Implementation Summary

## What Was Added

A comprehensive `diagnostics` service has been added to the Climate Scheduler integration to help users troubleshoot card visibility issues.

## Changes Made

### 1. Service Handler (services.py)
- Added `handle_diagnostics()` function that:
  - Reads integration version from manifest.json
  - Checks if card is registered in Lovelace resources
  - Detects YAML mode vs UI mode
  - Fetches card file via HTTP to verify accessibility
  - Returns first 10 lines of the card source code
  - Provides actionable recommendations

### 2. Service Registration (__init__.py)
- Added "diagnostics" to the expected_services list

### 3. Service Schema (services.py)
- Added voluptuous schema for the diagnostics service
- Configured as `SupportsResponse.ONLY` to return data

### 4. Service Definition (services.yaml)
- Added user-friendly service description for Home Assistant UI

### 5. Documentation (DIAGNOSTICS_SERVICE.md)
- Created comprehensive documentation
- Included usage examples
- Added troubleshooting guide
- Provided common issues and solutions

## How to Test

1. Restart Home Assistant or reload the integration
2. Go to Developer Tools → Services
3. Call `climate_scheduler.diagnostics`
4. Review the response

## Response Structure

```json
{
  "integration": {
    "version": "1.14.8",
    "domain": "climate_scheduler",
    "name": "Climate Scheduler",
    "ha_version": "2025.1.0"
  },
  "card_registration": {
    "status": "registered|not_registered|yaml_mode|...",
    "count": 1,
    "resources": [...]
  },
  "card_accessibility": {
    "status": "accessible|http_error|timeout|...",
    "http_status": 200,
    "content_length": 45678,
    "first_10_lines": ["line1", "line2", ...],
    "appears_valid": true
  },
  "recommendations": [
    "Actionable recommendation 1",
    "Actionable recommendation 2",
    ...
  ]
}
```

## Benefits for Users

1. **Self-Service Troubleshooting**: Users can diagnose issues themselves
2. **Clear Feedback**: Shows exactly what's wrong with card registration
3. **Proof of Accessibility**: First 10 lines prove the card file is accessible
4. **Actionable Recommendations**: Specific steps to fix issues
5. **Better Bug Reports**: Users can share diagnostics output when reporting issues

## Benefits for Maintainers

1. **Reduced Support Burden**: Users can self-diagnose common issues
2. **Better Issue Reports**: Diagnostics output provides complete context
3. **Quick Identification**: Instantly see if it's a registration, accessibility, or cache issue
4. **Version Tracking**: Always know what version users are running

## Next Steps

Consider adding to README.md:
- Link to DIAGNOSTICS_SERVICE.md in troubleshooting section
- Mention diagnostics service in FAQ
- Add to GitHub issue template (ask users to run diagnostics first)
