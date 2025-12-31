# Deploy Climate Scheduler to Production
# Target: homeassistant.local

$ErrorActionPreference = "Stop"

$SOURCE = ".\custom_components\climate_scheduler"
$TARGET = "\\homeassistant.local\config\custom_components\climate_scheduler"

Write-Host "=== Deploying Climate Scheduler to Production ===" -ForegroundColor Cyan
Write-Host "Source: $SOURCE" -ForegroundColor Gray
Write-Host "Target: $TARGET" -ForegroundColor Gray
Write-Host ""

# Check if source exists
if (-not (Test-Path $SOURCE)) {
    Write-Host "ERROR: Source directory not found!" -ForegroundColor Red
    exit 1
}

# Check if target is accessible
if (-not (Test-Path "\\homeassistant.local\config")) {
    Write-Host "ERROR: Cannot access Samba share. Please check:" -ForegroundColor Red
    Write-Host "  1. Samba add-on is running" -ForegroundColor Yellow
    Write-Host "  2. Network connectivity to homeassistant.local" -ForegroundColor Yellow
    Write-Host "  3. Credentials are correct" -ForegroundColor Yellow
    exit 1
}

# Backup existing installation if present
if (Test-Path $TARGET) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = "\\homeassistant.local\config\backups\climate_scheduler_$timestamp"
    Write-Host "Backing up existing installation to:" -ForegroundColor Yellow
    Write-Host "  $backupPath" -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "\\homeassistant.local\config\backups" | Out-Null
    Copy-Item -Recurse $TARGET $backupPath
    Write-Host "Backup complete" -ForegroundColor Green
    Write-Host ""
    # Keep only the latest backup for climate_scheduler -- remove older ones
    try {
        $allBackups = Get-ChildItem -Path "\\homeassistant.local\config\backups" -Directory | Where-Object { $_.Name -like "climate_scheduler_*" } | Sort-Object -Property Name -Descending
        if ($allBackups.Count -gt 1) {
            $toRemove = $allBackups | Select-Object -Skip 1
            foreach ($dir in $toRemove) {
                try {
                    Remove-Item -Path $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
                    Write-Host "Removed old backup: $($dir.FullName)" -ForegroundColor Gray
                } catch {
                    Write-Host "Warning: failed to remove old backup $($dir.FullName): $_" -ForegroundColor Yellow
                }
            }
        }
    } catch {
        Write-Host "Warning: could not prune old backups: $_" -ForegroundColor Yellow
    }
    
    # Remove old installation
    Write-Host "Removing old installation..." -ForegroundColor Yellow
    try {
        # First try to remove all files
        Get-ChildItem -Path $TARGET -Recurse -File | Remove-Item -Force -ErrorAction SilentlyContinue
        # Then remove all directories from deepest to shallowest
        Get-ChildItem -Path $TARGET -Recurse -Directory | Sort-Object -Property FullName -Descending | Remove-Item -Force -Recurse -Confirm:$false -ErrorAction SilentlyContinue
        # Finally remove the root directory
        Remove-Item -Path $TARGET -Force -Recurse -Confirm:$false -ErrorAction Stop
        Write-Host "Old installation removed" -ForegroundColor Green
    } catch {
        Write-Host "Warning: Could not fully remove old installation: $_" -ForegroundColor Yellow
        Write-Host "Attempting to continue with deployment..." -ForegroundColor Yellow
    }
    Write-Host ""
}

# Deploy new version
Write-Host "Deploying new version..." -ForegroundColor Cyan

# Increment build number in manifest.json
$manifestPath = Join-Path $SOURCE "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$currentVersion = $manifest.version

if ($currentVersion -match '^(\d+)\.(\d+)\.(\d+)\.(\d+)$') {
    $major = $matches[1]
    $minor = $matches[2]
    $patch = $matches[3]
    $build = [int]$matches[4]
    
    $newBuild = $build + 1
    $newVersion = "$major.$minor.$patch.$newBuild"
    
    Write-Host "Incrementing build number: $currentVersion -> $newVersion" -ForegroundColor Yellow
    $manifest.version = $newVersion
    $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath
} else {
    Write-Host "Warning: Version format not recognized, skipping build increment" -ForegroundColor Yellow
}

# Create .dev_version file with timestamp to mark as dev deployment
$unixTimestamp = [int][double]::Parse((Get-Date -UFormat %s))
$devVersionPath = Join-Path $SOURCE ".dev_version"
Set-Content -Path $devVersionPath -Value $unixTimestamp -NoNewline
Write-Host "Created .dev_version file with timestamp: $unixTimestamp" -ForegroundColor Green

# Copy all files
Copy-Item -Path $SOURCE -Destination (Split-Path $TARGET -Parent) -Recurse -Force

# Clean up local .dev_version file (keep it only on server)
Remove-Item $devVersionPath -Force

Write-Host "Files copied successfully" -ForegroundColor Green
Write-Host "Local manifest.json kept at new version: $newVersion" -ForegroundColor Gray
Write-Host ""

# Verify deployment
$deployedFiles = Get-ChildItem -Recurse $TARGET | Measure-Object
Write-Host "Deployment verified: $($deployedFiles.Count) files deployed" -ForegroundColor Green
Write-Host ""

Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Use the 'Reload Integration (Dev)' button in the menu" -ForegroundColor White
Write-Host "  2. Or restart Home Assistant to load new code" -ForegroundColor White
Write-Host ""
Write-Host "Note: Custom panel uses version-based cache busting - changes should load immediately" -ForegroundColor Gray
