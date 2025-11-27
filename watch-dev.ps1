#!/usr/bin/env pwsh
# Watch for file changes and auto-deploy to Docker dev instance

Write-Host "Climate Scheduler - File Watcher & Auto-Deploy" -ForegroundColor Cyan
Write-Host "Watching: custom_components/climate_scheduler/" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

$source = "custom_components\climate_scheduler"
$lastDeployTime = Get-Date

# Create file watcher
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $source
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName

# Debounce function - only deploy once per 2 seconds
function Deploy-ToDocker {
    $now = Get-Date
    $timeSinceLastDeploy = ($now - $script:lastDeployTime).TotalSeconds
    
    if ($timeSinceLastDeploy -lt 2) {
        return
    }
    
    $script:lastDeployTime = $now
    
    Write-Host ""
    Write-Host "Change detected! Deploying..." -ForegroundColor Yellow
    
    # Copy files
    docker cp custom_components/climate_scheduler ha-dev:/config/custom_components/ 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Files synced to container" -ForegroundColor Green
        Write-Host "NOTE: Restart HA to load Python changes, or refresh browser for frontend changes" -ForegroundColor Cyan
    } else {
        Write-Host "ERROR: Failed to sync files" -ForegroundColor Red
    }
}

# Register event handlers
$onChange = Register-ObjectEvent $watcher "Changed" -Action {
    $global:changeDetected = $true
}

$onCreated = Register-ObjectEvent $watcher "Created" -Action {
    $global:changeDetected = $true
}

$onRenamed = Register-ObjectEvent $watcher "Renamed" -Action {
    $global:changeDetected = $true
}

# Initial deployment
Deploy-ToDocker

# Main loop
try {
    while ($true) {
        Start-Sleep -Milliseconds 500
        
        if ($global:changeDetected) {
            Deploy-ToDocker
            $global:changeDetected = $false
        }
    }
} finally {
    # Cleanup on exit
    Unregister-Event $onChange.Name
    Unregister-Event $onCreated.Name
    Unregister-Event $onRenamed.Name
    $watcher.Dispose()
    Write-Host ""
    Write-Host "File watcher stopped" -ForegroundColor Gray
}
