#!/usr/bin/env pwsh
# Quick deployment script for Climate Scheduler development

Write-Host "Climate Scheduler - Quick Deploy to Docker Dev Instance" -ForegroundColor Cyan
Write-Host ""

# Check if container is running
$containerStatus = docker ps --filter "name=ha-dev" --format "{{.Status}}"
if (-not $containerStatus) {
    Write-Host "ERROR: Container 'ha-dev' is not running!" -ForegroundColor Red
    Write-Host "Start it with: docker start ha-dev" -ForegroundColor Yellow
    exit 1
}

Write-Host "Container is running" -ForegroundColor Green

# Copy files to container
Write-Host "Copying files to container..." -ForegroundColor Cyan
docker cp custom_components/climate_scheduler ha-dev:/config/custom_components/

if ($LASTEXITCODE -eq 0) {
    Write-Host "Files copied successfully" -ForegroundColor Green
} else {
    Write-Host "ERROR: Failed to copy files" -ForegroundColor Red
    exit 1
}

# Restart container
Write-Host "Restarting Home Assistant..." -ForegroundColor Cyan
docker restart ha-dev | Out-Null

Write-Host "Container restarted" -ForegroundColor Green
Write-Host ""
Write-Host "Waiting for Home Assistant to start (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

Write-Host ""
Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Access Home Assistant at: http://localhost:8123" -ForegroundColor Cyan
Write-Host "Check logs with: docker logs -f ha-dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Look for 'Climate Scheduler' in the sidebar after setup!" -ForegroundColor Yellow
