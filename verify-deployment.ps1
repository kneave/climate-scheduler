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

Write-Host "✓ Directory exists" -ForegroundColor Green
Write-Host ""

# Check required files
$requiredFiles = @(
    "__init__.py",
    "manifest.json",
    "coordinator.py",
    "storage.py",
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
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file MISSING!" -ForegroundColor Red
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

# Check configuration.yaml
$configPath = "\\homeassistant.local\config\configuration.yaml"
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw
    if ($config -match "climate_scheduler:") {
        Write-Host "✓ climate_scheduler found in configuration.yaml" -ForegroundColor Green
    } else {
        Write-Host "✗ climate_scheduler NOT in configuration.yaml" -ForegroundColor Red
        Write-Host ""
        Write-Host "Add this line to configuration.yaml:" -ForegroundColor Yellow
        Write-Host "  climate_scheduler:" -ForegroundColor White
    }
} else {
    Write-Host "⚠ Cannot access configuration.yaml" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
