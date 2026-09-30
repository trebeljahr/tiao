param([string]$DistPath = 'desktop/dist')
$ErrorActionPreference = 'Stop'
$dist = (Resolve-Path -LiteralPath $DistPath).Path
$installers = @(Get-ChildItem -LiteralPath $dist -Filter '*-nsis.exe' -File)
$portable = @(Get-ChildItem -LiteralPath $dist -Filter '*-portable.exe' -File)
if ($installers.Count -ne 1 -or $portable.Count -ne 1) {
    throw 'Expected exactly one NSIS installer and one portable executable'
}
$files = @((Join-Path $dist 'win-unpacked/Tiao.exe'), $installers[0].FullName, $portable[0].FullName)
$report = [System.Collections.Generic.List[object]]::new()
function Assert-Signature([string]$FilePath) {
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne 'Valid') { throw "Invalid signature: $FilePath ($($signature.Status))" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -ne 'Ricos Labs LLC') { throw "Unexpected publisher: $publisher in $FilePath" }
    if ($null -eq $signature.TimeStamperCertificate) { throw "Missing timestamp: $FilePath" }
    $report.Add([pscustomobject]@{
        File = $FilePath
        Status = [string]$signature.Status
        Publisher = $publisher
        Subject = $signature.SignerCertificate.Subject
        Thumbprint = $signature.SignerCertificate.Thumbprint
        TimestampSubject = $signature.TimeStamperCertificate.Subject
        SHA256 = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash
    })
}
foreach ($file in $files) { Assert-Signature $file }

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
$report | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $dist 'windows-signatures.json')
$report | Format-Table File, Status, Publisher
