param(
  [switch]$Build,
  [switch]$NoRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 18 or newer is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required.' }

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath 'env.example' -Destination '.env'
}

npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)." }

if ($Build) {
  npm run build:win
  if ($LASTEXITCODE -ne 0) { throw "Windows build failed ($LASTEXITCODE)." }
}

if (-not $NoRun) {
  npm start
}
