# Verify Climate Scheduler Deployment

$TARGET = "\\homeassistant.local\config\custom_components\climate_scheduler"

Write-Host "=== Verifying Climate Scheduler Installation ===" -ForegroundColor Cyan
Write-Host ""

# Check if directory exists
if (-not (Test-Path $TARGET)) {
    Write-Host "ERROR: climate_scheduler directory not found!" -ForegroundColor Red
    Write-Host "Expected at: $TARGET" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Directory exists" -ForegroundColor Green
Write-Host ""

# Check required files
$requiredFiles = @(
    "__init__.py",
    "manifest.json",
    "coordinator.py",
    "storage.py",
    "frontend\panel.js",
    "frontend\index.html",
    "frontend\app.js",
    "frontend\ha-api.js",
    "frontend\graph.js",
    "frontend\styles.css"
)

Write-Host "Checking required files:" -ForegroundColor Cyan
foreach ($file in $requiredFiles) {
    $path = Join-Path $TARGET $file
    if (Test-Path $path) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
    }
}
Write-Host ""

# Check manifest.json domain
$manifestPath = Join-Path $TARGET "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "Manifest domain: $($manifest.domain)" -ForegroundColor $(if ($manifest.domain -eq "climate_scheduler") { "Green" } else { "Red" })
Write-Host "Manifest name: $($manifest.name)" -ForegroundColor Gray
Write-Host "Manifest version: $($manifest.version)" -ForegroundColor Gray
Write-Host ""

# Config setup guidance (UI-based)
$configPath = "\\homeassistant.local\config\configuration.yaml"
Write-Host "Configuration method:" -ForegroundColor Cyan
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw
    if ($config -match "climate_scheduler:") {
        Write-Host "  [OK] YAML entry found (legacy)." -ForegroundColor Green
        Write-Host "    Tip: The integration now supports UI setup (Add Integration)." -ForegroundColor Gray
        Write-Host "    YAML will be auto-imported into a config entry." -ForegroundColor Gray
    } else {
        Write-Host "  Info: No YAML entry found (that is fine)." -ForegroundColor Yellow
        Write-Host "    Use Home Assistant: Settings -> Devices and Services -> Add Integration -> Climate Scheduler" -ForegroundColor Gray
    }
} else {
    Write-Host "  Info: Could not access configuration.yaml (skipping YAML check)." -ForegroundColor Yellow
    Write-Host "    Use Home Assistant: Settings -> Devices and Services -> Add Integration -> Climate Scheduler" -ForegroundColor Gray
}
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
