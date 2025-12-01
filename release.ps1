#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Create and publish a new release of Climate Scheduler

.DESCRIPTION
    Updates the version in manifest.json, commits the change, creates a git tag,
    pushes to GitHub, and creates a GitHub release.

.PARAMETER Version
    The version number to release (e.g., 1.0.5). If not provided, reads current version from manifest.json.

.PARAMETER DryRun
    Run in dry-run mode - shows what would happen without making any changes.

.PARAMETER SkipGitHub
    Skip creating the GitHub release (only commit, tag, and push).

.EXAMPLE
    .\release.ps1 1.0.5
    
.EXAMPLE
    .\release.ps1
    (Uses current version from manifest.json)
    
.EXAMPLE
    .\release.ps1 -DryRun
    (Test the release process without making changes)
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Version,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipGitHub
)

# Check if we're in the right directory
if (-not (Test-Path "custom_components\climate_scheduler\manifest.json")) {
    Write-Error "manifest.json not found. Run this script from the repository root."
    exit 1
}

if ($DryRun) {
    Write-Host "`n*** DRY RUN MODE - No changes will be made ***`n" -ForegroundColor Magenta
}

# Check if GitHub CLI is available
$ghPath = $null
$hasGhCli = $null -ne (Get-Command gh -ErrorAction SilentlyContinue)

# If not in PATH, check default installation location
if (-not $hasGhCli) {
    $defaultGhPath = "C:\Program Files\GitHub CLI\gh.exe"
    if (Test-Path $defaultGhPath) {
        $ghPath = $defaultGhPath
        $hasGhCli = $true
        Write-Host "`nGitHub CLI found at: $ghPath" -ForegroundColor Gray
        Write-Host "Adding to PATH for this session..." -ForegroundColor Gray
        $env:Path += ";C:\Program Files\GitHub CLI"
    }
}

if (-not $hasGhCli -and -not $SkipGitHub) {
    Write-Host "`nGitHub CLI (gh) not found." -ForegroundColor Yellow
    Write-Host "To automatically create GitHub releases, install the GitHub CLI." -ForegroundColor Gray
    Write-Host "`nWould you like to install it now? (Y/N)" -ForegroundColor Cyan
    $install = Read-Host "  "
    
    if ($install -eq 'Y' -or $install -eq 'y') {
        Write-Host "`nInstalling GitHub CLI..." -ForegroundColor Yellow
        
        # Try winget first (most common on Windows)
        $hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
        if ($hasWinget) {
            winget install --id GitHub.cli --silent
            if ($LASTEXITCODE -eq 0) {
                Write-Host "GitHub CLI installed successfully!" -ForegroundColor Green
                Write-Host "Please close and reopen your terminal, then run this script again.`n" -ForegroundColor Yellow
                exit 0
            } else {
                Write-Host "Installation failed. Please install manually from: https://cli.github.com/" -ForegroundColor Red
                Write-Host "Then close and reopen your terminal.`n" -ForegroundColor Yellow
                $SkipGitHub = $true
            }
        } else {
            Write-Host "winget not found. Please install GitHub CLI manually from: https://cli.github.com/" -ForegroundColor Yellow
            $SkipGitHub = $true
        }
    } else {
        Write-Host "Skipping GitHub release creation. You can create it manually later.`n" -ForegroundColor Gray
        $SkipGitHub = $true
    }
}

# Get the latest git tag
$latestTag = git describe --tags --abbrev=0 2>$null
if ($latestTag) {
    # Remove 'v' prefix if present for consistent handling
    $latestTag = $latestTag.TrimStart('v')
    Write-Host "Latest git tag: $latestTag" -ForegroundColor Cyan
} else {
    Write-Host "No existing tags found." -ForegroundColor Yellow
    $latestTag = "0.0.0"
}

# Parse version and suggest next versions
if ($latestTag -match '^(\d+)\.(\d+)\.(\d+)$') {
    $major = [int]$matches[1]
    $minor = [int]$matches[2]
    $patch = [int]$matches[3]
    
    $suggestedPatch = "$major.$minor.$($patch + 1)"
    $suggestedMinor = "$major.$($minor + 1).0"
    $suggestedMajor = "$($major + 1).0.0"
}

# Read current version from manifest.json if not provided
$manifestPath = "custom_components\climate_scheduler\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$currentVersion = $manifest.version

if (-not $Version) {
    Write-Host "`nCurrent manifest.json version: $currentVersion" -ForegroundColor Cyan
    
    # Check if manifest version is valid for release
    $canUseManifest = $true
    if ($latestTag -ne "0.0.0" -and $currentVersion -eq $latestTag) {
        $canUseManifest = $false
    }
    
    if ($suggestedPatch) {
        Write-Host "`nSelect version to release:" -ForegroundColor Yellow
        Write-Host "  1. Patch (bug fixes):        $suggestedPatch"
        Write-Host "  2. Minor (new features):     $suggestedMinor"
        Write-Host "  3. Major (breaking changes): $suggestedMajor"
        Write-Host "  4. Custom version"
        if ($canUseManifest) {
            Write-Host "  5. Use manifest version:     $currentVersion"
        }
        Write-Host "  Q. Exit"
    }
    
    $validChoices = if ($canUseManifest) { "1-5, Q" } else { "1-4, Q" }
    $choice = Read-Host "`nEnter choice ($validChoices)"
    
    switch ($choice) {
        "1" { 
            $Version = $suggestedPatch
            Write-Host "Selected: $Version (patch)" -ForegroundColor Green
        }
        "2" { 
            $Version = $suggestedMinor
            Write-Host "Selected: $Version (minor)" -ForegroundColor Green
        }
        "3" { 
            $Version = $suggestedMajor
            Write-Host "Selected: $Version (major)" -ForegroundColor Green
        }
        "4" {
            $Version = Read-Host "Enter custom version number"
        }
        "5" {
            if ($canUseManifest) {
                $Version = $currentVersion
                Write-Host "Selected: $Version (from manifest)" -ForegroundColor Green
            } else {
                Write-Error "Option 5 not available. Manifest version matches latest tag."
                exit 1
            }
        }
        { $_ -eq "Q" -or $_ -eq "q" } {
            Write-Host "Release cancelled." -ForegroundColor Yellow
            exit 0
        }
        default {
            # Try to parse as direct version input
            if ($choice -match '^\d+\.\d+\.\d+$') {
                $Version = $choice
                Write-Host "Selected: $Version (custom)" -ForegroundColor Green
            } else {
                Write-Error "Invalid choice. Please run again and select $validChoices or enter a valid version number."
                exit 1
            }
        }
    }
}

# Validate version format (semantic versioning)
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Invalid version format. Use semantic versioning (e.g., 1.0.5)"
    exit 1
}

# Compare with latest tag to ensure version is incremented
if ($latestTag -ne "0.0.0") {
    # Parse versions for comparison
    $latestParts = $latestTag -split '\.'
    $newParts = $Version -split '\.'
    
    $latestMajor = [int]$latestParts[0]
    $latestMinor = [int]$latestParts[1]
    $latestPatch = [int]$latestParts[2]
    
    $newMajor = [int]$newParts[0]
    $newMinor = [int]$newParts[1]
    $newPatch = [int]$newParts[2]
    
    # Check if version is the same or lower
    if ($Version -eq $latestTag) {
        Write-Error "Version $Version is the same as the latest tag v$latestTag. Please increment the version."
        exit 1
    }
    
    # Check if version is lower
    if ($newMajor -lt $latestMajor -or 
        ($newMajor -eq $latestMajor -and $newMinor -lt $latestMinor) -or
        ($newMajor -eq $latestMajor -and $newMinor -eq $latestMinor -and $newPatch -le $latestPatch)) {
        Write-Error "Version $Version is lower than or equal to the latest tag v$latestTag. Version must be incremented."
        Write-Host "`nSuggested versions:" -ForegroundColor Yellow
        Write-Host "  Patch: $suggestedPatch"
        Write-Host "  Minor: $suggestedMinor"
        Write-Host "  Major: $suggestedMajor"
        exit 1
    }
    
    Write-Host "`nVersion check passed: $latestTag -> $Version" -ForegroundColor Green
}

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Warning "You have uncommitted changes:"
    git status --short
    $response = Read-Host "Continue anyway? (y/N)"
    if ($response -ne 'y' -and $response -ne 'Y') {
        Write-Host "Release cancelled."
        exit 0
    }
}

Write-Host "`n=== Creating Release v$Version ===" -ForegroundColor Cyan

# Get commit messages since last tag
$commitMessages = @()
if ($latestTag -ne "0.0.0") {
    # Try to get commits - handle both with and without 'v' prefix in tags
    $commits = git log "$latestTag..HEAD" --pretty=format:"%s" 2>$null
    if (-not $commits) {
        # Try with v prefix
        $commits = git log "v$latestTag..HEAD" --pretty=format:"%s" 2>$null
    }
    if ($commits) {
        $commitMessages = $commits -split "`n" | Where-Object { $_ -and $_ -notmatch '^Merge' }
    }
}

# Collect changelog information
Write-Host "`n--- Changelog Entry ---" -ForegroundColor Yellow

if ($commitMessages.Count -gt 0) {
    Write-Host "`nCommits since $latestTag`:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $commitMessages.Count; $i++) {
        Write-Host "  [$i] $($commitMessages[$i])"
    }
    Write-Host "`nYou can reference commits by number (e.g., '0' to use first commit message)"
    Write-Host "Or type your own entries. Enter blank line when done.`n"
} else {
    Write-Host "No commits found since last tag."
    Write-Host "Describe the changes in this release (enter each item, blank line when done):`n"
}

$changelogEntries = @{}
$categoryPrompts = @{
    "Added" = "New features (e.g., 'Undo functionality' or '0 2' for commits 0 and 2)"
    "Changed" = "Changes to existing functionality"
    "Fixed" = "Bug fixes (e.g., '1 3' for commits 1 and 3, or custom text)"
    "Removed" = "Removed features"
}

foreach ($category in $categoryPrompts.Keys | Sort-Object) {
    Write-Host "`n$category - $($categoryPrompts[$category])" -ForegroundColor Cyan
    while ($true) {
        $entry = Read-Host "  - "
        if ([string]::IsNullOrWhiteSpace($entry)) {
            break
        }
        
        # Check if entry contains multiple commit numbers (space or comma-delimited)
        $tokens = $entry -split '[,\s]+' | Where-Object { $_ }
        $hasCommitRefs = $false
        
        foreach ($token in $tokens) {
            if ($token -match '^\d+$' -and [int]$token -lt $commitMessages.Count) {
                $commitText = $commitMessages[[int]$token]
                Write-Host "    Using [$token]: $commitText" -ForegroundColor Gray
                
                if (-not $changelogEntries.ContainsKey($category)) {
                    $changelogEntries[$category] = @()
                }
                $changelogEntries[$category] += $commitText
                $hasCommitRefs = $true
            }
        }
        
        # If no commit refs were found, treat entire entry as custom text
        if (-not $hasCommitRefs) {
            if (-not $changelogEntries.ContainsKey($category)) {
                $changelogEntries[$category] = @()
            }
            $changelogEntries[$category] += $entry
        }
    }
}

# Generate changelog content
$date = Get-Date -Format "yyyy-MM-dd"
$changelogContent = @"

## [$Version] - $date

"@

foreach ($category in @("Added", "Changed", "Fixed", "Removed")) {
    if ($changelogEntries[$category] -and $changelogEntries[$category].Count -gt 0) {
        $changelogContent += "### $category`n"
        foreach ($entry in $changelogEntries[$category]) {
            $changelogContent += "- $entry`n"
        }
        $changelogContent += "`n"
    }
}

# Update or create CHANGELOG.md
$changelogPath = "CHANGELOG.md"
if (Test-Path $changelogPath) {
    $existingChangelog = Get-Content $changelogPath -Raw
    # Insert new entry after the header
    if ($existingChangelog -match '(# Changelog\s*)(.*)') {
        $newChangelog = $matches[1] + $changelogContent + $matches[2]
        if (-not $DryRun) {
            Set-Content $changelogPath $newChangelog
        }
    } else {
        # No proper header, prepend to file
        if (-not $DryRun) {
            Set-Content $changelogPath ($changelogContent + "`n" + $existingChangelog)
        }
    }
    Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would update' } else { 'Updated' }) CHANGELOG.md" -ForegroundColor Green
} else {
    # Create new CHANGELOG.md
    $header = @"
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

"@
    if (-not $DryRun) {
        Set-Content $changelogPath ($header + $changelogContent)
    }
    Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would create' } else { 'Created' }) CHANGELOG.md" -ForegroundColor Green
}

# Update manifest.json only if version changed
if ($Version -ne $currentVersion) {
    Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would update' } else { 'Updating' }) manifest.json..." -ForegroundColor Yellow
    if (-not $DryRun) {
        $manifest.version = $Version
        $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath
    }
    Write-Host "Version: $currentVersion -> $Version" -ForegroundColor Green
} else {
    Write-Host "`nVersion unchanged: $Version" -ForegroundColor Yellow
}

# Commit the version change
Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would commit' } else { 'Committing' }) changes..." -ForegroundColor Yellow
if (-not $DryRun) {
    git add $manifestPath
    if (Test-Path "CHANGELOG.md") {
        git add CHANGELOG.md
    }
    git commit -m "Release v$Version"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to commit changes"
        exit 1
    }
} else {
    Write-Host "Files to commit: manifest.json, CHANGELOG.md" -ForegroundColor Cyan
    Write-Host "Commit message: 'Release v$Version'" -ForegroundColor Cyan
}

# Create and push tag
Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would create' } else { 'Creating' }) git tag v$Version..." -ForegroundColor Yellow
if (-not $DryRun) {
    git tag -a "v$Version" -m "Release v$Version"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create tag"
        exit 1
    }
}

# Push to GitHub
Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would push' } else { 'Pushing' }) to GitHub..." -ForegroundColor Yellow
if (-not $DryRun) {
    git push origin main

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push to main"
        exit 1
    }

    git push origin "v$Version"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push tag"
        exit 1
    }
} else {
    Write-Host "Would push to: origin main" -ForegroundColor Cyan
    Write-Host "Would push tag: v$Version" -ForegroundColor Cyan
}

Write-Host "`n=== $(if ($DryRun) { 'DRY RUN: Release v' + $Version + ' Summary' } else { 'Release v' + $Version + ' Created Successfully' }) ===" -ForegroundColor Green
Write-Host "`nChangelog preview:" -ForegroundColor Cyan
Write-Host $changelogContent

# Create GitHub release
if (-not $DryRun -and -not $SkipGitHub -and $hasGhCli) {
    Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would create' } else { 'Creating' }) GitHub release..." -ForegroundColor Yellow
    
    # Prompt for release title (optional)
    Write-Host "`nRelease title (press Enter for 'v$Version'):" -ForegroundColor Cyan
    $releaseTitle = Read-Host "  "
    if ([string]::IsNullOrWhiteSpace($releaseTitle)) {
        $releaseTitle = "v$Version"
    }
    
    # Save changelog to temporary file for release notes
    $tempChangelogFile = [System.IO.Path]::GetTempFileName()
    $changelogContent | Set-Content $tempChangelogFile -Encoding UTF8
    
    try {
        gh release create "v$Version" `
            --title $releaseTitle `
            --notes-file $tempChangelogFile
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "`nGitHub release created successfully!" -ForegroundColor Green
            Write-Host "View at: https://github.com/kneave/climate-scheduler/releases/tag/v$Version" -ForegroundColor Cyan
        } else {
            Write-Host "`nFailed to create GitHub release. You can create it manually at:" -ForegroundColor Yellow
            Write-Host "https://github.com/kneave/climate-scheduler/releases/new?tag=v$Version" -ForegroundColor Cyan
        }
    } finally {
        Remove-Item $tempChangelogFile -ErrorAction SilentlyContinue
    }
}

if ($DryRun) {
    Write-Host "`n*** DRY RUN COMPLETE - No changes were made ***" -ForegroundColor Magenta
    Write-Host "Run without -DryRun to perform the actual release.`n" -ForegroundColor Yellow
} elseif ($SkipGitHub -or -not $hasGhCli) {
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "  1. Go to https://github.com/kneave/climate-scheduler/releases/new"
    Write-Host "  2. Select tag: v$Version"
    Write-Host "  3. Set title (e.g., 'v$Version' or 'v$Version - Description')"
    Write-Host "  4. Copy the changelog content above into the release notes"
    Write-Host "  5. Click 'Publish release'"
    Write-Host "`nHACS will automatically detect the new release within 24 hours.`n"
} else {
    Write-Host "`nHACS will automatically detect the new release within 24 hours.`n" -ForegroundColor Cyan
}
