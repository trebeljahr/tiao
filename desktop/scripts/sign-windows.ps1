param([Parameter(Mandatory)][string]$FilePath)
$ErrorActionPreference = 'Stop'
Import-Module ArtifactSigning -RequiredVersion 0.1.20

# Use only the short-lived Azure CLI session established by azure/login OIDC.
$params = @{
    Endpoint = 'https://weu.codesigning.azure.net/'
    CodeSigningAccountName = 'ricoslabs-signing'
    CertificateProfileName = 'ricoslabs-public'
    Files = (Resolve-Path -LiteralPath $FilePath).Path
    FileDigest = 'SHA256'
    TimestampRfc3161 = 'http://timestamp.acs.microsoft.com'
    TimestampDigest = 'SHA256'
    ExcludeEnvironmentCredential = $true
    ExcludeWorkloadIdentityCredential = $true
    ExcludeManagedIdentityCredential = $true
    ExcludeSharedTokenCacheCredential = $true
    ExcludeVisualStudioCredential = $true
    ExcludeVisualStudioCodeCredential = $true
    ExcludeAzureCliCredential = $false
    ExcludeAzurePowerShellCredential = $true
    ExcludeAzureDeveloperCliCredential = $true
    ExcludeInteractiveBrowserCredential = $true
}
Invoke-ArtifactSigning @params

# Fail closed for each file, including the embedded NSIS uninstaller.
$signature = Get-AuthenticodeSignature -LiteralPath $FilePath
if ($signature.Status -ne 'Valid' -or
    $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne 'Ricos Labs LLC' -or
    $null -eq $signature.TimeStamperCertificate) {
    throw "Invalid, untimestamped, or unexpected publisher signature: $FilePath ($($signature.Status))"
}
