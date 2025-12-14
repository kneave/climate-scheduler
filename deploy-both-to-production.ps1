# Deploy Both Climate Scheduler Integration and Card to Production
# Target: homeassistant.local

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Climate Scheduler Complete Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$integrationPath = $PSScriptRoot
$cardPath = Join-Path (Split-Path $PSScriptRoot -Parent) "climate-scheduler-card"

# Verify both repos exist
if (-not (Test-Path $integrationPath)) {
    Write-Host "ERROR: Integration repo not found at $integrationPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $cardPath)) {
    Write-Host "ERROR: Card repo not found at $cardPath" -ForegroundColor Red
    Write-Host "Expected location: $cardPath" -ForegroundColor Yellow
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

Write-Host "Found repositories:" -ForegroundColor Green
Write-Host "  Integration: $integrationPath" -ForegroundColor Gray
Write-Host "  Card:        $cardPath" -ForegroundColor Gray
Write-Host ""

# Deploy Integration
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 1/2: Deploying Integration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Push-Location $integrationPath
try {
    & ".\deploy-to-production.ps1"
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
        throw "Integration deployment failed"
    }
} catch {
    Write-Host "ERROR: Integration deployment failed: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host ""
Write-Host "Integration deployment successful!" -ForegroundColor Green

# Deploy Card
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Step 2/2: Deploying Card" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Push-Location $cardPath
try {
    & ".\deploy-to-production.ps1"
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
        throw "Card deployment failed"
    }
} catch {
    Write-Host "ERROR: Card deployment failed: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host ""
Write-Host "Card deployment successful!" -ForegroundColor Green

# Final Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  [OK] Complete Deployment Successful" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Both components deployed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Deployed components:" -ForegroundColor Cyan
Write-Host "  [OK] Integration: custom_components/climate_scheduler" -ForegroundColor White
Write-Host "  [OK] Card:        www/community/climate-scheduler-card" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Reload the integration:" -ForegroundColor White
Write-Host "     - Use 'Reload Integration (Dev)' button in the Climate Scheduler menu" -ForegroundColor Gray
Write-Host "     - Or restart Home Assistant" -ForegroundColor Gray
Write-Host "  2. Clear browser cache: Ctrl+Shift+R or Ctrl+F5" -ForegroundColor White
Write-Host "  3. Refresh the Climate Scheduler panel" -ForegroundColor White
Write-Host ""
Write-Host "New features deployed:" -ForegroundColor Cyan
Write-Host "  - Multiple schedule profiles per entity/group" -ForegroundColor White
Write-Host "  - Profile selector dropdown in schedule settings" -ForegroundColor White
Write-Host "  - Create, rename, delete, and switch profiles" -ForegroundColor White
Write-Host ""
