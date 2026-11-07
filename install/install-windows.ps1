# Exact Typer installer for Windows.
#
#   irm https://raw.githubusercontent.com/jrnobita/exact-typer/main/install/install-windows.ps1 | iex
#
# Downloads the extension into "%USERPROFILE%\Exact Typer", copies that path,
# and opens chrome://extensions. Chrome does not let any program add an
# extension by itself (outside the Chrome Web Store), so the last 3 clicks are
# yours. Running it again updates the files in place.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $Repo = 'jrnobita/exact-typer'
  $Branch = if ($env:EXACT_TYPER_BRANCH) { $env:EXACT_TYPER_BRANCH } else { 'main' }
  $Dest = if ($env:EXACT_TYPER_DIR) { $env:EXACT_TYPER_DIR } else { Join-Path $HOME 'Exact Typer' }
  $OnWindows = $env:OS -eq 'Windows_NT'

  function Fail($msg) {
    Write-Host "Install failed: $msg" -ForegroundColor Red
    throw 'ExactTyperInstallFailed'
  }

  try {
    Write-Host 'Installing Exact Typer...' -ForegroundColor White
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('exact-typer-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $zip = Join-Path $tmp 'src.zip'
      if ($env:EXACT_TYPER_SRC_ZIP) {
        Copy-Item -LiteralPath $env:EXACT_TYPER_SRC_ZIP -Destination $zip
      } else {
        try {
          Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip
        } catch { Fail 'could not download from GitHub. Check your internet connection and try again.' }
      }
      $out = Join-Path $tmp 'src'
      try { $null = Expand-Archive -LiteralPath $zip -DestinationPath $out -Force } catch { Fail 'the download is damaged. Try again.' }

      $src = Get-ChildItem -LiteralPath $out -Directory |
        ForEach-Object { Join-Path $_.FullName 'extension' } |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'manifest.json') } |
        Select-Object -First 1
      if (-not $src) { Fail 'the download does not contain the extension.' }

      # Only ever replace a folder that holds Exact Typer (or is empty).
      $updated = $false
      if (Test-Path -LiteralPath $Dest) {
        if (-not (Test-Path -LiteralPath $Dest -PathType Container)) { Fail "`"$Dest`" exists and is not a folder. Move it away and run this again." }
        $items = @(Get-ChildItem -LiteralPath $Dest -Force)
        $manifest = Join-Path $Dest 'manifest.json'
        $isOurs = (Test-Path -LiteralPath $manifest) -and ((Get-Content -LiteralPath $manifest -Raw) -match '"name":\s*"Exact Typer"')
        if ($items.Count -gt 0 -and -not $isOurs) { Fail "`"$Dest`" already exists and is not an Exact Typer folder. Move it away and run this again." }
        $items | Remove-Item -Recurse -Force
        $updated = $true
      } else {
        New-Item -ItemType Directory -Path $Dest | Out-Null
      }
      Get-ChildItem -LiteralPath $src -Force | Copy-Item -Destination $Dest -Recurse -Force
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }

    $version = ((Get-Content -LiteralPath (Join-Path $Dest 'manifest.json') -Raw) | ConvertFrom-Json).version
    try { Set-Clipboard -Value $Dest } catch {}

    Write-Host "Exact Typer $version is in: $Dest" -ForegroundColor Green
    Write-Host '(Keep this folder. Chrome loads the extension from it.)' -ForegroundColor DarkGray
    Write-Host ''
    if ($updated) {
      Write-Host 'Updated. If Exact Typer is already in Chrome, open chrome://extensions'
      Write-Host 'and click the round arrow (reload) on Exact Typer. That''s it.'
      Write-Host ''
      Write-Host 'If it is not in Chrome yet, do the steps below.'
      Write-Host ''
    }
    Write-Host 'Finish in Chrome (one time, about 20 seconds):' -ForegroundColor White
    Write-Host '  1. In the Chrome tab that just opened (chrome://extensions),'
    Write-Host '     turn on Developer mode (switch at the top right).'
    Write-Host '  2. Click Load unpacked.'
    Write-Host '  3. In the window that opens, click the address bar at the top, press'
    Write-Host '     Ctrl+V (the folder path is already copied), press Enter, then click'
    Write-Host '     Select Folder.'
    Write-Host '  4. Pin it: click the puzzle-piece icon in Chrome''s toolbar, then the pin'
    Write-Host '     next to Exact Typer.'
    Write-Host ''

    if ($OnWindows -and -not $env:EXACT_TYPER_NO_OPEN) {
      $chrome = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
      ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
      if ($chrome) {
        Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions/'
      } else {
        Write-Host 'Google Chrome was not found. Install Chrome, then open chrome://extensions' -ForegroundColor Red
        Write-Host 'and follow the steps above. (Edge and Brave work too: edge://extensions, brave://extensions.)'
      }
    }
  } catch {
    if ("$_" -ne 'ExactTyperInstallFailed') { Write-Host "Install failed: $_" -ForegroundColor Red }
  }
}
