# Development Guide

## Quick Start Development

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

Frontend files (HTML/CSS/JS) can be refreshed without restarting HA:
- Just refresh the browser (Ctrl+F5 for hard refresh)
- Clear browser cache if needed

### Backend Changes Require Restart

Python files require HA restart:
```powershell
# Via SSH
ssh user@ha-ip "ha core restart"

# Or use HA Developer Tools > Services
# Service: homeassistant.restart
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
- Network tab: Monitor API calls
- Application tab: Check localStorage/WebSocket connections
