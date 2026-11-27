# ============================================================
#  Violet - one-click setup
#  Run it with setup.bat (double-click). Safe to run again anytime:
#  every step checks first and skips what's already done.
#
#  What it does:
#   1. Installs Node.js (via winget) if it's missing
#   2. Installs Claude Code if it's missing
#   3. Checks Claude Code is logged in (opens a login window if not)
#   4. Installs Violet's packages (npm install)
#   5. (Optional) Downloads voice features: whisper.cpp speech recognition,
#      the base + tiny speech models, Piper, and a natural voice (Amy)
#   6. Creates a desktop shortcut
#   7. (Optional) Builds the installer + portable .exe
#   8. Starts Violet
#  A full log is saved to setup-log.txt next to setup.bat.
# ============================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot           # the Violet folder (setup.ps1 lives in tools\)
$UserDir = Join-Path $env:APPDATA 'Violet'         # where Violet keeps its data
$Log = Join-Path $Root 'setup-log.txt'
try { Start-Transcript -Path $Log -Force | Out-Null } catch { }

# ---------- Download links (edit here if a link ever moves) ----------
$Urls = @{
  # whisper.cpp's newest tagged releases ship no files, so "latest" 404s: try known-good versions
  WhisperZips = @('v1.9.2', 'v1.9.1', 'v1.9.0', 'v1.8.2') | ForEach-Object { "https://github.com/ggml-org/whisper.cpp/releases/download/$_/whisper-bin-x64.zip" }
  ModelBase   = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin'
  PiperZip    = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip'
  VoiceOnnx   = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx'
  VoiceJson   = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json'
}

# ---------- Pretty output ----------
$script:StepNo = 0
function Step($text) {
  $script:StepNo++
  Write-Host ''
  Write-Host ("[{0}] {1}" -f $script:StepNo, $text) -ForegroundColor Magenta
}
function Ok($text)   { Write-Host "    OK  $text" -ForegroundColor Green }
function Info($text) { Write-Host "    ..  $text" -ForegroundColor Gray }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "    XX  $text" -ForegroundColor Red }

function Ask($question, [bool]$defaultYes = $true) {
  $hint = if ($defaultYes) { '[Y/n]' } else { '[y/N]' }
  $answer = Read-Host "    ?   $question $hint"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $defaultYes }
  return $answer.Trim().ToLower().StartsWith('y')
}

function Pause-Exit($code) {
  Write-Host ''
  Read-Host 'Press Enter to close'
  try { Stop-Transcript | Out-Null } catch { }
  exit $code
}

# After installing something, reload PATH so this window can see it
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user;$env:APPDATA\npm;$env:USERPROFILE\.local\bin"
}

function Has-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Download with curl.exe (built into Windows 10/11, shows progress); fall back to PowerShell
function Download($url, $dest) {
  $dir = Split-Path -Parent $dest
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $tmp = "$dest.part"
  Info "Downloading $(Split-Path -Leaf $dest)..."
  $done = $false
  if (Has-Command 'curl.exe') {
    & curl.exe -L --fail --retry 3 --progress-bar -o $tmp $url
    if ($LASTEXITCODE -eq 0) { $done = $true }
  }
  if (-not $done) { Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing }
  if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1000) { throw "Download failed: $url" }
  Move-Item -Force $tmp $dest
}

function Find-File($dir, $name) {
  if (-not (Test-Path $dir)) { return $null }
  return Get-ChildItem -Path $dir -Recurse -Filter $name -ErrorAction SilentlyContinue | Select-Object -First 1
}

# Run a command with a time limit; returns its text output (or $null on timeout)
function Run-WithTimeout($file, $arguments, $seconds) {
  $out = [IO.Path]::GetTempFileName()
  $err = [IO.Path]::GetTempFileName()
  $p = Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if (-not $p.WaitForExit($seconds * 1000)) {
    try { & taskkill.exe /PID $p.Id /T /F | Out-Null } catch { }
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    return $null
  }
  $text = (Get-Content $out -Raw -ErrorAction SilentlyContinue) + (Get-Content $err -Raw -ErrorAction SilentlyContinue)
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  return $text
}

# Something else on your PC might also be called "claude" (for example a shortcut that
# opens VS Code). This checks each candidate and returns the one that really is Claude Code.
function Test-RealClaude($path) {
  $out = Run-WithTimeout 'cmd.exe' "/s /c `"`"$path`" --version`"" 25
  return ($out -and $out -match 'Claude Code')
}
function Find-RealClaude {
  $candidates = @()
  foreach ($c in (Get-Command claude -All -ErrorAction SilentlyContinue)) { if ($c.Source) { $candidates += $c.Source } }
  # The official installer's location goes first: it's the one npm can't break
  $candidates = @((Join-Path $env:USERPROFILE '.local\bin\claude.exe')) + $candidates
  $candidates += @(
    (Join-Path $env:APPDATA 'npm\claude.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\claude\claude.exe')
  )
  foreach ($p in ($candidates | Select-Object -Unique)) {
    # Only test real programs (.cmd/.exe/.bat). Running a .ps1 or extensionless file through
    # cmd.exe makes Windows pop up "Select an app to open this file".
    if ($p -and $p -match '\.(cmd|exe|bat)$' -and (Test-Path $p) -and $p -notmatch 'Microsoft VS Code') {
      if (Test-RealClaude $p) { return $p }
    }
  }
  return $null
}

# Merge a few values into Violet's settings.json without touching your other settings
function Set-VioletSettings([hashtable]$values, [string[]]$onlyIfEmpty = @()) {
  New-Item -ItemType Directory -Force -Path $UserDir | Out-Null
  $file = Join-Path $UserDir 'settings.json'
  $obj = [pscustomobject]@{}
  if (Test-Path $file) {
    try { $obj = Get-Content $file -Raw | ConvertFrom-Json } catch { Warn 'settings.json was unreadable; leaving it alone.'; return }
  }
  foreach ($key in $values.Keys) {
    $current = $obj.PSObject.Properties[$key]
    if ($onlyIfEmpty -contains $key -and $current -and -not [string]::IsNullOrWhiteSpace([string]$current.Value)) { continue }
    $obj | Add-Member -NotePropertyName $key -NotePropertyValue $values[$key] -Force
  }
  $json = $obj | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding($false)))
}

# ============================================================
Clear-Host
Write-Host ''
Write-Host '   VIOLET SETUP' -ForegroundColor Magenta
Write-Host '   Sets up everything Violet needs. Safe to run again anytime.' -ForegroundColor Gray
Write-Host "   Violet folder: $Root" -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path (Join-Path $Root 'package.json'))) {
  Fail 'Could not find package.json. Keep setup.bat inside the Violet folder (next to package.json).'
  Pause-Exit 1
}

# Ask the questions up front so you can walk away while it works
Write-Host '   A few quick questions first:' -ForegroundColor White
$wantVoice    = Ask 'Install voice features? (talk to Violet + natural voice, about 300 MB download)' $true
$wantShortcut = Ask 'Create a desktop shortcut?' $true
$wantBuild    = Ask 'Build the .exe installer too? (takes a few minutes)' $false
$wantLaunch   = Ask 'Start Violet when setup finishes?' $true

Refresh-Path
$hadErrors = $false

# ============================================================
Step 'Node.js'
if (Has-Command 'node') {
  $v = (& node -v)
  $major = [int]($v.TrimStart('v').Split('.')[0])
  if ($major -lt 20) { Warn "Node $v is old. Violet needs Node 20 or newer; updating..." ; $needNode = $true }
  else { Ok "Node $v is installed"; $needNode = $false }
} else { $needNode = $true }

if ($needNode) {
  if (Has-Command 'winget') {
    Info 'Installing Node.js LTS with winget (Windows may ask for permission)...'
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (Has-Command 'node') { Ok "Node $(& node -v) installed" }
    else {
      Fail 'Node.js installed, but this window can''t see it yet. Close this window and run setup.bat again.'
      Pause-Exit 1
    }
  } else {
    Fail 'winget isn''t available, so Node.js can''t be installed automatically.'
    Info 'Opening the Node.js download page. Install the LTS version, then run setup.bat again.'
    Start-Process 'https://nodejs.org/en/download'
    Pause-Exit 1
  }
}

# ============================================================
Step 'Claude Code'
Info 'Looking for Claude Code...'
$ClaudeExe = Find-RealClaude
if ($ClaudeExe) {
  Ok "Claude Code found: $ClaudeExe"
} else {
  $other = Get-Command claude -ErrorAction SilentlyContinue
  if ($other) { Warn "The 'claude' command on this PC is NOT Claude Code (it points to $($other.Source)). Installing the real one..." }
  # A broken npm copy (newer npm blocks the install script that copies the real claude.exe,
  # so Windows says "not compatible") gets removed first so it can't shadow the good one.
  $npmClaude = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code'
  if (Test-Path $npmClaude) {
    Info 'Removing a broken npm copy of Claude Code...'
    try { & npm uninstall -g @anthropic-ai/claude-code 2>$null | Out-Null } catch { }
  }
  # Official Windows installer first: it doesn't depend on npm, so npm can't break it
  Info 'Installing Claude Code with the official Windows installer...'
  try {
    Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1' -UseBasicParsing)
    Refresh-Path
  } catch { Warn "Official installer failed: $($_.Exception.Message)" }
  if (-not (Find-RealClaude)) {
    Info 'Trying npm instead (with its install script allowed)...'
    try {
      & npm install -g @anthropic-ai/claude-code --foreground-scripts
      $installCjs = Join-Path $npmClaude 'install.cjs'
      if (Test-Path $installCjs) { Push-Location $npmClaude; & node install.cjs; Pop-Location }
      Refresh-Path
    } catch { Warn "npm install of Claude Code failed: $($_.Exception.Message)" }
  }
  $ClaudeExe = Find-RealClaude
  if ($ClaudeExe) { Ok "Claude Code installed: $ClaudeExe" }
  else {
    Fail 'Could not install Claude Code automatically.'
    Info 'See https://docs.claude.com/en/docs/claude-code for manual install steps, then run setup.bat again.'
    $hadErrors = $true
  }
}

if ($ClaudeExe) {
  try { Set-VioletSettings @{ claudePath = $ClaudeExe } ; Ok 'Violet will use this exact Claude Code (saved in its settings)' }
  catch { Warn "Couldn't save the Claude path to Violet's settings: $($_.Exception.Message)" }
}

# ============================================================
Step 'Claude Code login'
if ($env:ANTHROPIC_API_KEY) {
  Warn 'ANTHROPIC_API_KEY is set on this PC. Violet ignores it so it uses your Pro plan, but other tools may bill that key.'
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
}
$testCmd = "/s /c `"echo Reply with only the word OK| `"$ClaudeExe`" -p --output-format text`""
if ($ClaudeExe) {
  Info 'Checking that Claude Code is logged in (sends one tiny test message)...'
  $reply = Run-WithTimeout 'cmd.exe' $testCmd 90
  if ($reply -and $reply -match '\bOK\b') {
    Ok 'Claude Code is logged in and working'
  } else {
    Warn 'Claude Code isn''t logged in yet.'
    Info 'A new window will open running "claude". Log in with your Claude Pro account there.'
    Info 'When it says you''re logged in, type /exit in that window, then come back here.'
    Start-Process 'cmd.exe' -ArgumentList "/s /k `"`"$ClaudeExe`"`""
    Read-Host '    ?   Press Enter here after you''ve logged in'
    $reply = Run-WithTimeout 'cmd.exe' $testCmd 90
    if ($reply -and $reply -match '\bOK\b') { Ok 'Logged in and working' }
    else {
      Warn 'Still couldn''t get a reply. Violet will tell you in the chat if Claude isn''t working.'
      if ($reply) {
        $short = ($reply.Trim() -replace '\s+', ' ')
        if ($short.Length -gt 200) { $short = $short.Substring(0, 200) + '...' }
        Info "Claude said: $short"
      }
      $hadErrors = $true
    }
  }
} else { Warn 'Skipped (Claude Code is not installed).' }

# ============================================================
Step 'Violet packages (npm install)'
Push-Location $Root
try {
  & npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
  $electronExe = Join-Path $Root 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electronExe)) {
    # Newer npm versions block install scripts by default. Electron needs its script to
    # download the actual Electron program, so approve it and run it ourselves.
    Info 'npm blocked Electron''s download script (a newer npm safety feature). Running it directly...'
    try { & npm install-scripts approve electron electron-winstaller 2>$null | Out-Null } catch { }
    & node (Join-Path $Root 'node_modules\electron\install.js')
    # Optional helper (only used by a different installer type). It uses relative paths,
    # so run it from its own folder, and never let it stop setup.
    $winstaller = Join-Path $Root 'node_modules\electron-winstaller'
    if (Test-Path (Join-Path $winstaller 'script\select-7z-arch.js')) {
      Push-Location $winstaller
      try { & node 'script\select-7z-arch.js' 2>$null | Out-Null } catch { }
      Pop-Location
    }
  }
  if (Test-Path $electronExe) { Ok 'Packages installed (Electron + code editor)' }
  else { throw 'Electron did not download correctly' }
} catch {
  Fail "npm install failed: $($_.Exception.Message)"
  Info 'Usually a network hiccup. Delete the node_modules folder and run setup.bat again.'
  Pop-Location
  Pause-Exit 1
}
Pop-Location

# ============================================================
if ($wantVoice) {
  Step 'Voice features'
  $whisperDir = Join-Path $UserDir 'whisper'
  $piperDir = Join-Path $UserDir 'piper'
  $voicesDir = Join-Path $UserDir 'voices'
  New-Item -ItemType Directory -Force -Path $whisperDir, $piperDir, $voicesDir | Out-Null

  # Visual C++ runtime (whisper.cpp and Piper need it; harmless if already installed)
  if (Has-Command 'winget') {
    Info 'Making sure the Microsoft Visual C++ runtime is installed...'
    & winget install --id Microsoft.VCRedist.2015+.x64 -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  }

  # --- Speech recognition: whisper.cpp ---
  try {
    if (Find-File $whisperDir 'whisper-cli.exe') { Ok 'whisper.cpp already installed' }
    else {
      $zip = Join-Path $env:TEMP 'violet-whisper.zip'
      $got = $false
      foreach ($u in $Urls.WhisperZips) {
        try { Download $u $zip; $got = $true; break } catch { Warn "Not available: $u" }
      }
      if (-not $got) { throw 'Could not download whisper.cpp from any known version' }
      Expand-Archive -Path $zip -DestinationPath $whisperDir -Force
      Remove-Item $zip -ErrorAction SilentlyContinue
      if (Find-File $whisperDir 'whisper-cli.exe') { Ok 'whisper.cpp installed' } else { throw 'whisper-cli.exe not found after unzip' }
    }
    foreach ($m in @(@{ Name = 'ggml-base.en-q5_1.bin'; Url = $Urls.ModelBase })) {
      $dest = Join-Path $whisperDir $m.Name
      if (Test-Path $dest) { Ok "$($m.Name) already downloaded" } else { Download $m.Url $dest; Ok "$($m.Name) downloaded" }
    }
  } catch { Fail "Speech recognition setup failed: $($_.Exception.Message)"; $hadErrors = $true }

  # --- Custom voices: Piper + Amy ---
  try {
    if (Find-File $piperDir 'piper.exe') { Ok 'Piper already installed' }
    else {
      $zip = Join-Path $env:TEMP 'violet-piper.zip'
      Download $Urls.PiperZip $zip
      Expand-Archive -Path $zip -DestinationPath $piperDir -Force
      Remove-Item $zip -ErrorAction SilentlyContinue
      if (Find-File $piperDir 'piper.exe') { Ok 'Piper installed' } else { throw 'piper.exe not found after unzip' }
    }
    $onnx = Join-Path $voicesDir 'en_US-amy-medium.onnx'
    if (-not (Test-Path $onnx)) { Download $Urls.VoiceOnnx $onnx }
    if (-not (Test-Path "$onnx.json")) { Download $Urls.VoiceJson "$onnx.json" }
    Ok 'Voice "Amy" ready'
  } catch { Fail "Piper setup failed: $($_.Exception.Message)"; $hadErrors = $true }

  # Point Violet at what we installed (only where you haven't picked something already)
  try {
    $vals = @{ sttModel = 'ggml-base.en-q5_1.bin'; piperVoice = 'en_US-amy-medium.onnx' }
    if (Find-File $piperDir 'piper.exe') { $vals.ttsEngine = 'piper' }
    Set-VioletSettings $vals @('sttModel', 'piperVoice', 'ttsEngine')
    Ok 'Violet settings updated (speech model + voice)'
  } catch { Warn "Couldn't update settings: $($_.Exception.Message)" }
}

# ============================================================
if ($wantBuild) {
  Step 'Building the .exe'
  Push-Location $Root
  try {
    & npm run dist
    if ($LASTEXITCODE -ne 0) { throw "build exited with code $LASTEXITCODE" }
    $setupExe = Get-ChildItem (Join-Path $Root 'dist') -Filter 'Violet-Setup-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    Ok "Built! Files are in $(Join-Path $Root 'dist')"
  } catch { Fail "Build failed: $($_.Exception.Message)"; $hadErrors = $true }
  Pop-Location
}

# ============================================================
if ($wantShortcut) {
  Step 'Desktop shortcut'
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk = Join-Path $desktop 'Violet.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnk)
    $unpacked = Join-Path $Root 'dist\win-unpacked\Violet.exe'
    if (Test-Path $unpacked) {
      $sc.TargetPath = $unpacked
      $sc.WorkingDirectory = Split-Path -Parent $unpacked
      $sc.IconLocation = "$unpacked,0"
    } else {
      # Run Electron directly: no black console window
      $electron = Join-Path $Root 'node_modules\electron\dist\electron.exe'
      $sc.TargetPath = $electron
      $sc.Arguments = "`"$Root`""
      $sc.WorkingDirectory = $Root
      $sc.IconLocation = "$electron,0"
    }
    $sc.Description = 'Violet - your AI assistant'
    $sc.Save()
    Ok "Shortcut created: $lnk"
  } catch { Fail "Couldn't create the shortcut: $($_.Exception.Message)"; $hadErrors = $true }
}

# ============================================================
Write-Host ''
if ($hadErrors) {
  Write-Host '   Setup finished, with a few warnings (see above, or setup-log.txt).' -ForegroundColor Yellow
  Write-Host '   Violet should still run. Fix the warnings and run setup.bat again anytime.' -ForegroundColor Yellow
} else {
  Write-Host '   All set! Violet is ready.' -ForegroundColor Green
}
Write-Host ''
Write-Host '   Handy shortcuts:  Alt+Shift+V show/hide   Ctrl+K commands   Ctrl+D voice dashboard' -ForegroundColor Gray
Write-Host '                     Alt+Shift+Space talk     Ctrl+Shift+U classic UI   Alt+Shift+A quick ask' -ForegroundColor Gray

if ($wantBuild) {
  $setupExe = Get-ChildItem (Join-Path $Root 'dist') -Filter 'Violet-Setup-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($setupExe -and (Ask 'Run the installer now? (installs Violet like a normal app)' $false)) {
    Start-Process $setupExe.FullName
    $wantLaunch = $false
  }
}

if ($wantLaunch) {
  $electron = Join-Path $Root 'node_modules\electron\dist\electron.exe'
  Info 'Starting Violet...'
  Start-Process -FilePath $electron -ArgumentList "`"$Root`"" -WorkingDirectory $Root
}

Pause-Exit 0
