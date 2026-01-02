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
    [Parameter(Mandatory = $false)]
    [string]$Version,
    
    [Parameter(Mandatory = $false)]
    [switch]$DryRun,
    
    [Parameter(Mandatory = $false)]
    [switch]$SkipGitHub
)

# Check if we're in the right directory
if (-not (Test-Path "custom_components\climate_scheduler\manifest.json")) {
    Write-Error "manifest.json not found. Run this script from the repository root."
    exit 1
}

# Detect current branch
$currentBranch = git rev-parse --abbrev-ref HEAD
if (-not $currentBranch) {
    Write-Error "Failed to detect current git branch"
    exit 1
}

$isPreRelease = $currentBranch -eq "develop"
if ($isPreRelease) {
    Write-Host "`nDetected branch: $currentBranch (will create pre-release)" -ForegroundColor Yellow
}
else {
    Write-Host "`nDetected branch: $currentBranch" -ForegroundColor Cyan
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
            }
            else {
                Write-Host "Installation failed. Please install manually from: https://cli.github.com/" -ForegroundColor Red
                Write-Host "Then close and reopen your terminal.`n" -ForegroundColor Yellow
                $SkipGitHub = $true
            }
        }
        else {
            Write-Host "winget not found. Please install GitHub CLI manually from: https://cli.github.com/" -ForegroundColor Yellow
            $SkipGitHub = $true
        }
    }
    else {
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
}
else {
    Write-Host "No existing tags found." -ForegroundColor Yellow
    $latestTag = "0.0.0.0"
}

# Parse version and suggest next versions (supports major.minor.patch[b].build or major.minor.patch.build[b])
if ($latestTag -match '^(\d+)\.(\d+)\.(\d+)(?:b)?(?:\.(\d+))?(?:b)?$') {
    $major = [int]$matches[1]
    $minor = [int]$matches[2]
    $patch = [int]$matches[3]
    $build = if ($matches[4]) { [int]$matches[4] } else { 0 }
    $hasBeta = $latestTag -match 'b'
    
    # Different version format based on branch
    if ($isPreRelease) {
        # Develop branch: use 4-part versions (major.minor.patch.build)
        $suggestedPatch = "$major.$minor.$($patch + 1).1"
        $suggestedMinor = "$major.$($minor + 1).0.1"
        $suggestedMajor = "$($major + 1).0.0.1"
        $suggestedBuild = "$major.$minor.$patch.$($build + 1)"
        
        # If latest tag is a pre-release, suggest incrementing build on same version
        $suggestedPreReleaseBuild = $null
        if ($hasBeta -and $build -gt 0) {
            $suggestedPreReleaseBuild = "$major.$minor.$patch.$($build + 1)"
        }
    }
    else {
        # Main branch: use 3-part versions (major.minor.patch)
        $suggestedPatch = "$major.$minor.$($patch + 1)"
        $suggestedMinor = "$major.$($minor + 1).0"
        $suggestedMajor = "$($major + 1).0.0"
        $suggestedBuild = $null
        $suggestedPreReleaseBuild = $null
    }
}

# Read current version from manifest.json if not provided
$manifestPath = "custom_components\climate_scheduler\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$currentVersion = $manifest.version

if (-not $Version) {
    Write-Host "`nCurrent manifest.json version: $currentVersion" -ForegroundColor Cyan
    
    # Check if manifest version is valid for release
    $canUseManifest = $true
    $canReRelease = $false
    if ($latestTag -ne "0.0.0" -and $currentVersion -eq $latestTag) {
        $canUseManifest = $false
        $canReRelease = $true  # Allow re-release option
    }
    
    if ($suggestedPatch) {
        Write-Host "`nSelect version to release:" -ForegroundColor Yellow
        
        # Add 'b' suffix to displayed versions if this is a pre-release
        $displaySuffix = if ($isPreRelease) { "b" } else { "" }
        
        # Initialize option variables
        $optionNum = 1
        $preReleaseBuildOption = $null
        $patchOption = $null
        $minorOption = $null
        $majorOption = $null
        $buildOption = $null
        $customOption = $null
        $manifestOption = $null
        $reReleaseOption = $null
        
        # Show pre-release build increment option first if available
        if ($suggestedPreReleaseBuild) {
            $displayPreReleaseBuild = $suggestedPreReleaseBuild -replace '\.(\d+)$', "b.`$1"
            Write-Host "  $optionNum. Pre-release build:         $displayPreReleaseBuild (increment build only)"
            $preReleaseBuildOption = $optionNum
            $optionNum++
        }
        
        $displayPatch = $suggestedPatch -replace '\.(\d+)$', "$displaySuffix.`$1"
        Write-Host "  $optionNum. Patch (bug fixes):        $displayPatch"
        $patchOption = $optionNum
        $optionNum++
        
        $displayMinor = $suggestedMinor -replace '\.(\d+)$', "$displaySuffix.`$1"
        Write-Host "  $optionNum. Minor (new features):     $displayMinor"
        $minorOption = $optionNum
        $optionNum++
        
        $displayMajor = $suggestedMajor -replace '\.(\d+)$', "$displaySuffix.`$1"
        Write-Host "  $optionNum. Major (breaking changes): $displayMajor"
        $majorOption = $optionNum
        $optionNum++
        
        if ($build -gt 0 -and -not $suggestedPreReleaseBuild) {
            $displayBuild = $suggestedBuild -replace '\.(\d+)$', "$displaySuffix.`$1"
            Write-Host "  $optionNum. Build (increment build):  $displayBuild"
            $buildOption = $optionNum
            $optionNum++
        }
        
        Write-Host "  $optionNum. Custom version"
        $customOption = $optionNum
        $optionNum++
        
        if ($canUseManifest) {
            Write-Host "  $optionNum. Use manifest version:     $currentVersion"
            $manifestOption = $optionNum
            $optionNum++
        }
        
        if ($canReRelease) {
            Write-Host "  $optionNum. Re-release:                $currentVersion (force re-release existing tag)" -ForegroundColor Yellow
            $reReleaseOption = $optionNum
            $optionNum++
        }
        
        Write-Host "  Q. Exit"
    }
    
    $maxChoice = $optionNum - 1
    $validChoices = "1-$maxChoice, Q"
    $choice = Read-Host "`nEnter choice ($validChoices)"
    
    switch ($choice) {
        "1" { 
            if ($suggestedPreReleaseBuild) {
                $Version = $suggestedPreReleaseBuild
                Write-Host "Selected: $Version (pre-release build)" -ForegroundColor Green
            }
            else {
                $Version = $suggestedPatch
                Write-Host "Selected: $Version (patch)" -ForegroundColor Green
            }
        }
        { $_ -eq $patchOption.ToString() } { 
            $Version = $suggestedPatch
            Write-Host "Selected: $Version (patch)" -ForegroundColor Green
        }
        { $_ -eq $minorOption.ToString() } { 
            $Version = $suggestedMinor
            Write-Host "Selected: $Version (minor)" -ForegroundColor Green
        }
        { $_ -eq $majorOption.ToString() } { 
            $Version = $suggestedMajor
            Write-Host "Selected: $Version (major)" -ForegroundColor Green
        }
        { $buildOption -and $_ -eq $buildOption.ToString() } {
            $Version = $suggestedBuild
            Write-Host "Selected: $Version (build)" -ForegroundColor Green
        }
        { $_ -eq $customOption.ToString() } {
            if ($isPreRelease) {
                $Version = Read-Host "Enter custom version number (format: major.minor.patch.build)"
            }
            else {
                $Version = Read-Host "Enter custom version number (format: major.minor.patch)"
            }
        }
        { $canUseManifest -and $_ -eq $manifestOption.ToString() } {
            $Version = $currentVersion
            Write-Host "Selected: $Version (from manifest)" -ForegroundColor Green
        }
        { $canReRelease -and $_ -eq $reReleaseOption.ToString() } {
            $Version = $currentVersion
            $script:isReRelease = $true
            Write-Host "Selected: $Version (re-release - will force update existing tag)" -ForegroundColor Yellow
            Write-Host "WARNING: This will delete and recreate the tag v$Version" -ForegroundColor Red
            $confirm = Read-Host "Are you sure you want to re-release? (Y/N)"
            if ($confirm -notin @('Y', 'y', 'yes', 'Yes', 'YES')) {
                Write-Host "Re-release cancelled." -ForegroundColor Yellow
                exit 0
            }
        }
        { $_ -eq "Q" -or $_ -eq "q" } {
            Write-Host "Release cancelled." -ForegroundColor Yellow
            exit 0
        }
        default {
            # Try to parse as direct version input
            $versionPattern = if ($isPreRelease) { '^\d+\.\d+\.\d+\.\d+$' } else { '^\d+\.\d+\.\d+$' }
            $formatExample = if ($isPreRelease) { "major.minor.patch.build" } else { "major.minor.patch" }
            
            if ($choice -match $versionPattern) {
                $Version = $choice
                Write-Host "Selected: $Version (custom)" -ForegroundColor Green
            }
            else {
                Write-Error "Invalid choice. Please run again and select $validChoices or enter a valid version number (format: $formatExample)."
                exit 1
            }
        }
    }
}

# Validate version format based on branch
if ($isPreRelease) {
    # Develop branch: require 4-part version (major.minor.patch.build)
    if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') {
        Write-Error "Invalid version format for develop branch. Use format: major.minor.patch.build (e.g., 1.0.5.1)"
        exit 1
    }
}
else {
    # Main branch: require 3-part version (major.minor.patch)
    if ($Version -notmatch '^\d+\.\d+\.\d+$') {
        Write-Error "Invalid version format for main branch. Use format: major.minor.patch (e.g., 1.0.5)"
        exit 1
    }
    if ($Version -match '^\d+\.\d+\.\d+\.\d+$') {
        Write-Error "Build numbers should not be used on main branch. Use format: major.minor.patch (e.g., 1.0.5)"
        exit 1
    }
}

# Compare with latest tag to ensure version is incremented
if ($latestTag -ne "0.0.0.0") {
    # Skip version validation for re-releases
    if ($script:isReRelease) {
        Write-Host "`nRe-release mode: Skipping version validation" -ForegroundColor Yellow
    }
    else {
        # Parse versions for comparison (with build number)
        $latestParts = $latestTag -replace 'b', '' -split '\.'
        $newParts = $Version -split '\.'
        
        $latestMajor = [int]$latestParts[0]
        $latestMinor = [int]$latestParts[1]
        $latestPatch = [int]$latestParts[2]
        $latestBuild = if ($latestParts.Count -gt 3) { [int]$latestParts[3] } else { 0 }
        
        $newMajor = [int]$newParts[0]
        $newMinor = [int]$newParts[1]
        $newPatch = [int]$newParts[2]
        $newBuild = if ($newParts.Count -gt 3) { [int]$newParts[3] } else { 0 }
        
        # Check if version is the same or lower
        if ($Version -eq ($latestTag -replace 'b', '')) {
            Write-Error "Version $Version is the same as the latest tag v$latestTag. Please increment the version."
            exit 1
        }
        
        # Check if version is lower
        if ($newMajor -lt $latestMajor -or 
            ($newMajor -eq $latestMajor -and $newMinor -lt $latestMinor) -or
            ($newMajor -eq $latestMajor -and $newMinor -eq $latestMinor -and $newPatch -lt $latestPatch) -or
            ($newMajor -eq $latestMajor -and $newMinor -eq $latestMinor -and $newPatch -eq $latestPatch -and $newBuild -le $latestBuild)) {
            Write-Error "Version $Version is lower than or equal to the latest tag v$latestTag. Version must be incremented."
            Write-Host "`nSuggested versions:" -ForegroundColor Yellow
            Write-Host "  Patch: $suggestedPatch"
            Write-Host "  Minor: $suggestedMinor"
            Write-Host "  Major: $suggestedMajor"
            exit 1
        }
        
        Write-Host "`nVersion check passed: $latestTag -> $Version" -ForegroundColor Green
    }
}
# Create full version string for git tags and GitHub releases
# Note: manifest.json gets numeric-only version, git tags get version with 'b' suffix for pre-releases
$versionSuffix = ""
$fullVersion = $Version
if ($isPreRelease) {
    $versionSuffix = "b"
    $fullVersion = "$Version$versionSuffix"
    Write-Host "`nPre-release detected:" -ForegroundColor Yellow
    Write-Host "  manifest.json version: $Version (numeric only, required by Home Assistant)" -ForegroundColor Cyan
    Write-Host "  Git tag version: $fullVersion (with beta suffix)" -ForegroundColor Cyan
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

Write-Host "`n=== Creating Release v$fullVersion ===" -ForegroundColor Cyan

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

# Helper: extract changelog section for a given version
function Get-ChangelogForVersion {
    param(
        [string]$VersionString
    )

    $path = "CHANGELOG.md"
    if (-not (Test-Path $path)) { return $null }

    $content = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return $null }

    # Robust extraction: find the starting heading and slice until the next '## [' or EOF
    $search1 = "## [$VersionString]"
    $search2 = "## [v$VersionString]"

    $startIdx = $content.IndexOf($search2)
    if ($startIdx -lt 0) { $startIdx = $content.IndexOf($search1) }
    if ($startIdx -lt 0) { return $null }

    $rest = $content.Substring($startIdx)
    # look for next heading marker starting on a new line
    $nextMarker = "`n## ["
    $nextIdx = $rest.IndexOf($nextMarker)
    if ($nextIdx -lt 0) { $section = $rest } else { $section = $rest.Substring(0, $nextIdx) }
    return $section.Trim()
}
 

# If CHANGELOG.md already contains a section for this version, offer to use it
$changelogPath = "CHANGELOG.md"
$usePreparedNotes = $false
$preparedNotes = $null
if (Test-Path $changelogPath) {
    # Use the helper to robustly extract the full changelog section for this version
    $preparedNotes = Get-ChangelogForVersion $fullVersion
    if ($preparedNotes) {
        Write-Host "`nFound existing changelog entry for v$fullVersion in $changelogPath." -ForegroundColor Cyan
        $allLines = [regex]::Split($preparedNotes, "\r?\n")
        $maxPreview = 30
        $preview = $allLines | Select-Object -First $maxPreview
        Write-Host "Preview:" -ForegroundColor Gray
        foreach ($line in $preview) { Write-Host "  $line" -ForegroundColor DarkGray }
        if ($allLines.Count -gt $maxPreview) { Write-Host "  ... (truncated, showing first $maxPreview lines)" -ForegroundColor DarkGray }
        Write-Host ""
        $useResp = Read-Host "Use this changelog entry for the release? (Y/n)"
        if ([string]::IsNullOrWhiteSpace($useResp) -or $useResp -in @('Y', 'y')) {
            $usePreparedNotes = $true
            $changelogContent = $preparedNotes
            Write-Host "Using changelog entry from $changelogPath." -ForegroundColor Green
            Write-Host "`nFull changelog section that will be used:" -ForegroundColor Gray
            Write-Host "----------------------------------------" -ForegroundColor DarkGray
            Write-Host $changelogContent -ForegroundColor DarkGray
            Write-Host "----------------------------------------`n" -ForegroundColor DarkGray
        }
    }
}

if ($commitMessages.Count -gt 0) {
    Write-Host "`nCommits since $latestTag`:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $commitMessages.Count; $i++) {
        Write-Host "  [$i] $($commitMessages[$i])"
    }
    Write-Host "`nYou can reference commits by number (e.g., '0' to use first commit message)"
    Write-Host "Or type your own entries. Enter blank line when done.`n"
}
else {
    Write-Host "No commits found since last tag."
    Write-Host "Describe the changes in this release (enter each item, blank line when done):`n"
}

$changelogEntries = @{}
$categoryPrompts = @{
    "Added"   = "New features (e.g., 'Undo functionality' or '0 2' for commits 0 and 2)"
    "Changed" = "Changes to existing functionality"
    "Fixed"   = "Bug fixes (e.g., '1 3' for commits 1 and 3, or custom text)"
    "Removed" = "Removed features"
}

$needsChangelogUpdate = $false

if (-not $usePreparedNotes) {
    foreach ($category in $categoryPrompts.Keys | Sort-Object) {
        Write-Host "`n$category - $($categoryPrompts[$category])" -ForegroundColor Cyan
        while ($true) {
            $entry = Read-Host "  - "
            if ([string]::IsNullOrWhiteSpace($entry)) { break }

            # Check if entry contains multiple commit numbers (space or comma-delimited)
            $tokens = $entry -split '[,\s]+' | Where-Object { $_ }
            $hasCommitRefs = $false

            foreach ($token in $tokens) {
                if ($token -match '^\d+$' -and [int]$token -lt $commitMessages.Count) {
                    $commitText = $commitMessages[[int]$token]
                    Write-Host "    Using [$token]: $commitText" -ForegroundColor Gray

                    if (-not $changelogEntries.ContainsKey($category)) { $changelogEntries[$category] = @() }
                    $changelogEntries[$category] += $commitText
                    $hasCommitRefs = $true
                }
            }

            # If no commit refs were found, treat entire entry as custom text
            if (-not $hasCommitRefs) {
                if (-not $changelogEntries.ContainsKey($category)) { $changelogEntries[$category] = @() }
                $changelogEntries[$category] += $entry
            }
        }
    }

    # Check if any changelog entries were provided
    $hasAnyEntries = $false
    foreach ($category in $changelogEntries.Keys) {
        if ($changelogEntries[$category] -and $changelogEntries[$category].Count -gt 0) {
            $hasAnyEntries = $true
            break
        }
    }

    if (-not $hasAnyEntries) {
        Write-Error "No changelog entries provided. Release requires either:"
        Write-Host "  1. Pre-existing changelog entry for v$fullVersion in CHANGELOG.md, OR" -ForegroundColor Yellow
        Write-Host "  2. Changelog entries entered during the release process" -ForegroundColor Yellow
        Write-Host "`nPlease update CHANGELOG.md with the release notes or provide entries when prompted." -ForegroundColor Yellow
        exit 1
    }

    # Generate changelog content
    $date = Get-Date -Format "yyyy-MM-dd"
    $changelogContent = @"

## [$fullVersion] - $date

"@

    foreach ($category in @("Added", "Changed", "Fixed", "Removed")) {
        if ($changelogEntries[$category] -and $changelogEntries[$category].Count -gt 0) {
            $changelogContent += "### $category`n"
            foreach ($entry in $changelogEntries[$category]) { $changelogContent += "- $entry`n" }
            $changelogContent += "`n"
        }
    }
    
    $needsChangelogUpdate = $true
}
else {
    # Using prepared notes extracted from CHANGELOG.md; $changelogContent already set
    Write-Host "`nUsing existing changelog entry - no need to update CHANGELOG.md" -ForegroundColor Green
}

# Update or create CHANGELOG.md only if we generated new content
if ($needsChangelogUpdate) {
    $changelogPath = "CHANGELOG.md"
    if (Test-Path $changelogPath) {
        $existingChangelog = Get-Content $changelogPath -Raw
        # Insert new entry after the header
        # Use regex with SingleLine mode so . matches newlines
        if ($existingChangelog -match '(?s)(# Changelog\s*\n)(.*)') {
            $newChangelog = $matches[1] + $changelogContent + $matches[2]
            if (-not $DryRun) {
                Set-Content $changelogPath $newChangelog
            }
        }
        else {
            # No proper header, prepend to file
            if (-not $DryRun) {
                Set-Content $changelogPath ($changelogContent + "`n" + $existingChangelog)
            }
        }
        Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would update' } else { 'Updated' }) CHANGELOG.md" -ForegroundColor Green
    }
    else {
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
}

# Update manifest.json only if version changed
# Always use numeric-only version for manifest.json (Home Assistant requirement)
if ($Version -ne $currentVersion) {
    Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would update' } else { 'Updating' }) manifest.json..." -ForegroundColor Yellow
    if (-not $DryRun) {
        $manifest.version = $Version
        $manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath
    }
    Write-Host "Version: $currentVersion -> $Version" -ForegroundColor Green
}
else {
    Write-Host "`nVersion unchanged: $Version" -ForegroundColor Yellow
}

# Commit the version change
Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would commit' } else { 'Committing' }) changes..." -ForegroundColor Yellow
if (-not $DryRun) {
    git add $manifestPath
    if ($needsChangelogUpdate -and (Test-Path "CHANGELOG.md")) {
        git add CHANGELOG.md
    }
    git commit -m "Release v$fullVersion"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to commit changes"
        exit 1
    }
}
else {
    Write-Host "Files to commit: manifest.json" -ForegroundColor Cyan
    if ($needsChangelogUpdate) {
        Write-Host "                 CHANGELOG.md (updated with new entries)" -ForegroundColor Cyan
    }
    else {
        Write-Host "                 CHANGELOG.md (already contains v$fullVersion entry)" -ForegroundColor Cyan
    }
    Write-Host "Commit message: 'Release v$fullVersion'" -ForegroundColor Cyan
}

# Create and push tag
Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would create' } else { 'Creating' }) git tag v$fullVersion..." -ForegroundColor Yellow
if (-not $DryRun) {
    # If re-releasing, delete the existing tag first
    if ($script:isReRelease) {
        Write-Host "Deleting existing tag v$fullVersion (re-release mode)..." -ForegroundColor Yellow
        git tag -d "v$fullVersion" 2>$null
        git push origin ":refs/tags/v$fullVersion" 2>$null
        Write-Host "Existing tag deleted" -ForegroundColor Green
    }
    
    git tag -a "v$fullVersion" -m "Release v$fullVersion"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create tag"
        exit 1
    }
}

# Push to GitHub
Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would push' } else { 'Pushing' }) to GitHub..." -ForegroundColor Yellow
if (-not $DryRun) {
    git push origin $currentBranch

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push to $currentBranch"
        exit 1
    }

    # Force push tag if re-releasing
    if ($script:isReRelease) {
        git push origin "v$fullVersion" --force
    }
    else {
        git push origin "v$fullVersion"
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push tag"
        exit 1
    }
}
else {
    Write-Host "Would push to: origin $currentBranch" -ForegroundColor Cyan
    Write-Host "Would push tag: v$fullVersion" -ForegroundColor Cyan
}

Write-Host "`n=== $(if ($DryRun) { 'DRY RUN: Release v' + $fullVersion + ' Summary' } else { 'Release v' + $fullVersion + ' Created Successfully' }) ===" -ForegroundColor Green
Write-Host "`nChangelog preview:" -ForegroundColor Cyan
$finalNotesToShow = $null
if (Get-Variable -Name releaseNotes -Scope Script -ErrorAction SilentlyContinue) { $finalNotesToShow = $script:releaseNotes }
if (-not $finalNotesToShow -and (Get-Variable -Name changelogContent -Scope Script -ErrorAction SilentlyContinue)) { $finalNotesToShow = $script:changelogContent }
if ($finalNotesToShow) { Write-Host $finalNotesToShow } else { Write-Host "(no changelog content available)" -ForegroundColor Yellow }

# Create GitHub release
function Get-ChangelogForVersion {
    param(
        [string]$VersionString
    )

    $path = "CHANGELOG.md"
    if (-not (Test-Path $path)) { return $null }

    $content = Get-Content $path -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return $null }

    # Parse version to get major.minor (e.g., "1.14.2" -> "1.14")
    $versionParts = $VersionString -split '\.'
    if ($versionParts.Count -lt 2) { 
        # If we can't parse major.minor, fall back to exact version match
        $search1 = "## [$VersionString]"
        $search2 = "## [v$VersionString]"
        $startIdx = $content.IndexOf($search2)
        if ($startIdx -lt 0) { $startIdx = $content.IndexOf($search1) }
        if ($startIdx -lt 0) { return $null }
        $rest = $content.Substring($startIdx)
        $nextMarker = "`n## ["
        $nextIdx = $rest.IndexOf($nextMarker)
        if ($nextIdx -lt 0) { $section = $rest } else { $section = $rest.Substring(0, $nextIdx) }
        return $section.Trim()
    }

    $majorMinor = "$($versionParts[0]).$($versionParts[1])"
    
    # Find the first occurrence of this major.minor version
    $pattern = "## \[$majorMinor\."
    $patternV = "## \[v$majorMinor\."
    
    $startIdx = -1
    $searchPos = 0
    
    # Find the first heading with this major.minor version
    while ($searchPos -lt $content.Length) {
        $idx1 = $content.IndexOf($pattern, $searchPos)
        $idx2 = $content.IndexOf($patternV, $searchPos)
        
        if ($idx1 -ge 0 -and ($idx2 -lt 0 -or $idx1 -lt $idx2)) {
            $startIdx = $idx1
            break
        }
        elseif ($idx2 -ge 0) {
            $startIdx = $idx2
            break
        }
        else {
            break
        }
    }
    
    if ($startIdx -lt 0) { return $null }
    
    # Extract from start until we hit a different major.minor version or EOF
    $rest = $content.Substring($startIdx)
    $lines = $rest -split "`n"
    $result = @()
    $foundFirst = $false
    
    foreach ($line in $lines) {
        if ($line -match '^## \[v?(\d+\.\d+)\.' -or $line -match '^## \[v?(\d+\.\d+)\]') {
            $lineVersion = $matches[1]
            if (-not $foundFirst) {
                # This is the first version header
                $foundFirst = $true
                $result += $line
            }
            elseif ($lineVersion -eq $majorMinor) {
                # Same major.minor, keep including
                $result += $line
            }
            else {
                # Different major.minor, stop here
                break
            }
        }
        else {
            if ($foundFirst) {
                $result += $line
            }
        }
    }
    
    return ($result -join "`n").Trim()
}

if (-not $DryRun -and -not $SkipGitHub -and $hasGhCli) {
    Write-Host "`n$(if ($DryRun) { '[DRY RUN] Would create' } else { 'Creating' }) GitHub release..." -ForegroundColor Yellow

    # Prompt for release title (optional)
    Write-Host "`nRelease title (press Enter for 'v$fullVersion'):" -ForegroundColor Cyan
    $releaseTitle = Read-Host "  "
    if ([string]::IsNullOrWhiteSpace($releaseTitle)) {
        $releaseTitle = "v$fullVersion"
    }

    # Prefer extracting a prepared section from CHANGELOG.md for this version
    # This will extract all versions with the same major.minor (e.g., all 1.14.x versions)
    $preparedNotes = Get-ChangelogForVersion $fullVersion

    if ($preparedNotes) {
        $versionParts = $fullVersion -split '\.'
        if ($versionParts.Count -ge 2) {
            $majorMinor = "$($versionParts[0]).$($versionParts[1])"
            Write-Host "Using release notes extracted from CHANGELOG.md for all v$majorMinor.x versions" -ForegroundColor Green
        }
        else {
            Write-Host "Using release notes extracted from CHANGELOG.md for v$fullVersion" -ForegroundColor Green
        }
        $releaseNotes = $preparedNotes
    }
    else {
        # Fall back to interactive / auto-generated changelog content
        $releaseNotes = $changelogContent
    }

    # Save release notes to temporary file for gh
    $tempChangelogFile = [System.IO.Path]::GetTempFileName()
    $releaseNotes | Set-Content $tempChangelogFile -Encoding UTF8

    try {
        $releaseArgs = @(
            "v$fullVersion",
            "--title", $releaseTitle,
            "--notes-file", $tempChangelogFile
        )

        # Add prerelease flag if on develop branch
        if ($isPreRelease) {
            $releaseArgs += "--prerelease"
            Write-Host "Creating as pre-release..." -ForegroundColor Yellow
        }

        gh release create @releaseArgs

        if ($LASTEXITCODE -eq 0) {
            $releaseType = if ($isPreRelease) { "pre-release" } else { "release" }
            Write-Host "`nGitHub $releaseType created successfully!" -ForegroundColor Green
            Write-Host "View at: https://github.com/kneave/climate-scheduler/releases/tag/v$fullVersion" -ForegroundColor Cyan
        }
        else {
            Write-Host "`nFailed to create GitHub release. You can create it manually at:" -ForegroundColor Yellow
            Write-Host "https://github.com/kneave/climate-scheduler/releases/new?tag=v$fullVersion" -ForegroundColor Cyan
        }
    }
    finally {
        Remove-Item $tempChangelogFile -ErrorAction SilentlyContinue
    }
}

if ($DryRun) {
    Write-Host "`n*** DRY RUN COMPLETE - No changes were made ***" -ForegroundColor Magenta
    Write-Host "Run without -DryRun to perform the actual release." -ForegroundColor Yellow
}
elseif ($SkipGitHub -or -not $hasGhCli) {
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "  1. Go to https://github.com/kneave/climate-scheduler/releases/new"
    Write-Host "  2. Select tag: v$fullVersion"
    Write-Host "  3. Set title (e.g., 'v$fullVersion' or 'v$fullVersion - Description')"
    Write-Host "  4. Copy the changelog content above into the release notes"
    Write-Host "  5. Click 'Publish release'"
    Write-Host "`nHACS will automatically detect the new release within 24 hours.`n"
}
else {
    Write-Host "`nHACS will automatically detect the new release within 24 hours.`n" -ForegroundColor Cyan
}
