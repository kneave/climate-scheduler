# Development Guide

## Architecture

Climate Scheduler uses a **modern custom panel** architecture (as of v1.4.0+):

- **Frontend**: Custom Web Component (`climate-scheduler-panel`) loaded as a JavaScript module
- **Backend**: Python integration with service-based API
- **Panel Type**: Custom panel (not iframe) with version-based cache busting
- **Communication**: Hass object passed from Home Assistant to panel

### Key Benefits

- ✅ **Proper cache control** - Version parameter forces reload on updates
- ✅ **No iframe limitations** - Direct access to Home Assistant context
- ✅ **Fast development** - Changes load immediately without hard refresh
- ✅ **Modern pattern** - Follows current Home Assistant best practices

## Quick Start Development

## AI Workflow (Copilot)

For reliable low-token sessions, start each code task with this context order:
- `documents/CONTEXT_SNAPSHOT.md`
- `documents/ARCHITECTURE_MAP.md`
- `documents/CONTRACTS.md`
- Relevant hotspot docs (`documents/HOTSPOTS_APP_JS.md`, `documents/HOTSPOTS_COORDINATOR.md`) and `documents/adr/README.md`

Editing and verification rules:
- Edit `src/*.ts` for compiled frontend components; do not hand-edit compiled JS outputs when TS source exists.
- `custom_components/climate_scheduler/frontend/app.js` is runtime source and may be edited directly.
- After scheduling UI changes, verify node select/move/delete in active and profile timelines, plus save/debounce and mode/day/profile transitions.
- If contracts change, update `documents/CONTEXT_SNAPSHOT.md`, `documents/CONTRACTS.md`, relevant hotspot docs, and ADRs as needed.

### Method 1: Live Development on HA Server (Recommended)

#### Using File Share/Network Drive:
```powershell
# Map your HA config folder as network drive or use UNC path
$haConfig = "\\your-ha-ip\config"  # or "Z:\config" if mapped

# Create sync script
Copy-Item -Recurse -Force "custom_components\climate_scheduler" "$haConfig\custom_components\"
```

#### Using SSH/SCP:
```powershell
# Sync files to HA server
scp -r custom_components/climate_scheduler user@ha-ip:/config/custom_components/

# Restart HA via SSH
ssh user@ha-ip "ha core restart"
```

#### Watch Mode (Auto-sync on file changes):
```powershell
# Install and run a file watcher
# Create watch-sync.ps1:

$source = "custom_components\climate_scheduler"
$destination = "\\ha-ip\config\custom_components\climate_scheduler"

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $source
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$action = {
    Write-Host "Change detected, syncing..."
    Copy-Item -Recurse -Force $source $destination
}

Register-ObjectEvent $watcher "Changed" -Action $action
```

### Method 2: Frontend Preview (No HA Required)

Open the development preview in your browser:

```powershell
# Start a simple HTTP server
cd c:\Users\keegan\Documents\GitHub\heating-control
python -m http.server 8080

# Or use PowerShell built-in web server (PS 5.1+)
# Open dev-preview.html directly in browser
Start-Process "dev-preview.html"
```

Then open: `http://localhost:8080/dev-preview.html`

This lets you test the graph UI without connecting to Home Assistant.

### Method 3: Docker Development Environment

If you want to test the full integration locally:

```powershell
# Create a test HA instance with Docker
docker run -d `
  --name ha-dev `
  -p 8123:8123 `
  -v ${PWD}/test-config:/config `
  homeassistant/home-assistant:latest

# Copy integration files
Copy-Item -Recurse "custom_components\climate_scheduler" "test-config\custom_components\"

# Restart container
docker restart ha-dev
```

### Method 4: VS Code Remote Development

Use VS Code Remote SSH extension to edit files directly on the HA server:

1. Install "Remote - SSH" extension in VS Code
2. Connect to HA server: `ssh user@ha-ip`
3. Open `/config/custom_components/climate_scheduler`
4. Edit files directly, restart HA from UI

## Development Workflow

### Hot Reload Frontend Changes

**Custom panel supports instant reload:**
1. Make changes to `app.js`, `graph.js`, `ha-api.js`, or `panel.js`
2. Deploy: `.\deploy-to-production.ps1`
3. Click "Reload Integration (Dev)" button in the menu
4. Changes load immediately - no browser refresh needed!

**Version-based cache busting:**
- Each deployment with new version number forces reload
- No need for Ctrl+F5 or clearing browser cache
- Works on mobile apps too

### Backend Changes Require Reload

Python files require integration reload:
```powershell
# Option 1: Use the "Reload Integration (Dev)" button in the UI

# Option 2: Via SSH
ssh user@ha-ip "ha core restart"

# Option 3: Use HA Developer Tools > Actions
# Action: homeassistant.reload_config_entry
# Target: Climate Scheduler integration
```

## Debugging

### View HA Logs:
```powershell
# SSH into HA
ssh user@ha-ip
ha core logs -f  # Follow logs in real-time
```

### Enable Debug Logging:
Add to HA `configuration.yaml`:
```yaml
logger:
  default: info
  logs:
    custom_components.climate_scheduler: debug
```

### Browser Developer Tools:
- F12 to open DevTools
- Console tab: Check for JavaScript errors
- Network tab: Monitor API calls (look for `/api/climate_scheduler/` requests)
- Elements tab: Inspect `<climate-scheduler-panel>` custom element

## File Structure

```
custom_components/climate_scheduler/
├── __init__.py              # Integration setup, panel registration, services
├── const.py                 # Constants
├── coordinator.py           # Data polling coordinator  
├── manifest.json            # Integration metadata
├── services.yaml            # Service definitions
├── storage.py               # JSON storage management
├── version.py               # Version string
└── frontend/
    ├── panel.js             # Custom panel entry point (Web Component)
    ├── app.js               # Main application logic
    ├── graph.js             # Interactive temperature graph
    ├── ha-api.js            # Home Assistant API wrapper
    ├── styles.css           # All styling
    └── index.html           # (Legacy - not used in custom panel mode)
```

## Migration Notes

### v1.3.x → v1.4.0+ (Iframe → Custom Panel)

**What Changed:**
- Panel registration changed from `component_name="iframe"` to `component_name="custom"`
- Frontend now loads as JavaScript module via `/api/climate_scheduler/panel.js`
- Cache busting uses version parameter (`?v=140`) instead of file timestamps
- Direct access to hass object instead of WebSocket authentication

**Breaking Changes:**
- None for users - panel path remains `/climate_scheduler`
- Developers: Old URL `/climate_scheduler_panel/index.html` redirects to new module system

**Benefits:**
- Instant reload on version change
- No more aggressive iframe caching
- Modern HA integration pattern
- Better mobile app compatibility
