# Writes one WAV per narration line with the Windows voice "Microsoft Zira Desktop" (en-US), for the video recorder
# (record.spec.ts). Input: a JSON file with [{ "id": "...", "text": "..." }]; output: <outDir>/<id>.wav.
param([Parameter(Mandatory = $true)][string]$InputJson, [Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 $InputJson | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutDir | Out-Null
foreach ($item in $items) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice("Microsoft Zira Desktop")
  $s.Rate = 0
  $s.SetOutputToWaveFile((Join-Path $OutDir "$($item.id).wav"))
  $s.Speak([string]$item.text)
  $s.Dispose()
}
