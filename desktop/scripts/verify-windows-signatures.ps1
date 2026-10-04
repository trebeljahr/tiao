param([string]$DistPath = 'desktop/dist')
$ErrorActionPreference = 'Stop'
# Verifies every signed Windows deliverable: the direct NSIS installer and
# portable EXE, the app inside the itch ZIP, the unpacked apps (direct, itch,
# Steam depot), and the app plus uninstaller that the NSIS installer lays down.
$dist = (Resolve-Path -LiteralPath $DistPath).Path
$direct = Join-Path $dist 'direct'
$installers = @(Get-ChildItem -LiteralPath $direct -Filter '*-setup.exe' -File)
$portable = @(Get-ChildItem -LiteralPath $direct -Filter '*-portable.exe' -File)
if ($installers.Count -ne 1 -or $portable.Count -ne 1) {
    throw 'Expected exactly one NSIS installer and one portable executable'
}
$itchZips = @(Get-ChildItem -LiteralPath (Join-Path $dist 'itch') -Filter '*.zip' -File)
if ($itchZips.Count -ne 1) { throw 'Expected exactly one itch ZIP' }
$report = [System.Collections.Generic.List[object]]::new()
function Assert-Signature([string]$FilePath) {
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne 'Valid') { throw "Invalid signature: $FilePath ($($signature.Status))" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne 'Ricos Labs LLC') { throw "Unexpected publisher: $publisher in $FilePath" }
    if ($null -eq $signature.TimeStamperCertificate) { throw "Missing timestamp: $FilePath" }
    $report.Add([pscustomobject]@{
        File = [IO.Path]::GetRelativePath($dist, $FilePath)
        Status = [string]$signature.Status
        Publisher = $publisher
        Subject = $signature.SignerCertificate.Subject
        Thumbprint = $signature.SignerCertificate.Thumbprint
        TimestampSubject = $signature.TimeStamperCertificate.Subject
        SHA256 = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash
        Commit = $env:GITHUB_SHA
        RunId = $env:GITHUB_RUN_ID
    })
}
$files = @(
    $installers[0].FullName,
    $portable[0].FullName,
    (Join-Path $dist 'direct/win-unpacked/Tiao.exe'),
    (Join-Path $dist 'itch/win-unpacked/Tiao.exe'),
    (Join-Path $dist 'steam/win-unpacked/Tiao.exe')
)
foreach ($file in $files) { Assert-Signature $file }

$itchCheck = Join-Path $env:RUNNER_TEMP 'tiao-itch-zip'
Expand-Archive -LiteralPath $itchZips[0].FullName -DestinationPath $itchCheck -Force
$itchExe = @(Get-ChildItem -LiteralPath $itchCheck -Recurse -Filter 'Tiao.exe' -File)
if ($itchExe.Count -ne 1) { throw 'Expected one Tiao.exe in the itch ZIP' }
Assert-Signature $itchExe[0].FullName

# Install only on the disposable hosted runner to inspect the embedded payload.
$installPath = Join-Path $env:RUNNER_TEMP 'tiao-signing-verification'
$process = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$installPath") -PassThru
if (-not $process.WaitForExit(120000)) {
    Stop-Process -Id $process.Id -Force
    throw 'NSIS verification install timed out'
}
if ($process.ExitCode -ne 0) { throw "NSIS install failed: $($process.ExitCode)" }
Assert-Signature (Join-Path $installPath 'Tiao.exe')
$uninstallers = @(Get-ChildItem -LiteralPath $installPath -Filter '*uninstall*.exe' -File)
if ($uninstallers.Count -ne 1) { throw 'Expected one installed NSIS uninstaller' }
Assert-Signature $uninstallers[0].FullName
$report | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $direct 'windows-signatures.json')
$report | Format-Table File, Status, Publisher, SHA256 -AutoSize
