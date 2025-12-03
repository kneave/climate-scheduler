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
    
    # Remove old installation
    Write-Host "Removing old installation..." -ForegroundColor Yellow
    Remove-Item -Path $TARGET -Recurse -Force
    Write-Host "Old installation removed" -ForegroundColor Green
    Write-Host ""
}

# Deploy new version
Write-Host "Deploying new version..." -ForegroundColor Cyan

# Remove .dev file from source if it exists (shouldn't be there, but just in case)
if (Test-Path "$SOURCE\.dev") {
    Remove-Item "$SOURCE\.dev" -Force
}

# Copy all files
Copy-Item -Path $SOURCE -Destination (Split-Path $TARGET -Parent) -Recurse -Force

# Create .dev marker file to enable timestamp-based cache busting
Write-Host "Creating dev deployment marker..." -ForegroundColor Cyan
New-Item -ItemType File -Force -Path "$TARGET\.dev" | Out-Null

Write-Host "Files copied successfully" -ForegroundColor Green
Write-Host ""

# Verify deployment
$deployedFiles = Get-ChildItem -Recurse $TARGET | Measure-Object
Write-Host "Deployment verified: $($deployedFiles.Count) files deployed" -ForegroundColor Green
Write-Host ""

Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Go to Developer Tools -> YAML" -ForegroundColor White
Write-Host "  2. Click 'Restart' or reload the integration" -ForegroundColor White
Write-Host "  3. Refresh the Climate Scheduler panel (Ctrl+F5)" -ForegroundColor White
Write-Host ""
Write-Host "Note: Dev deployment marker created - using timestamp cache busting" -ForegroundColor Gray
Write-Host "      HACS deployments will use version-based cache busting" -ForegroundColor Gray
