param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Output,[Parameter(Mandatory)][string]$Version)
$ErrorActionPreference='Stop'
foreach($name in @('WINDOWS_STORE_IDENTITY_NAME','WINDOWS_STORE_PUBLISHER','WINDOWS_STORE_PUBLISHER_DISPLAY_NAME')) {
  if(-not [Environment]::GetEnvironmentVariable($name)) {throw "Missing $name"}
}
$escape = {param($s) [System.Security.SecurityElement]::Escape($s)}
$name=& $escape $env:WINDOWS_STORE_IDENTITY_NAME
$publisher=& $escape $env:WINDOWS_STORE_PUBLISHER
$display=& $escape $env:WINDOWS_STORE_PUBLISHER_DISPLAY_NAME
New-Item -ItemType Directory -Force (Join-Path $Source 'Assets') | Out-Null
Copy-Item 'build/appx/*.png' (Join-Path $Source 'Assets')
$manifest=@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap desktop rescap">
<Identity Name="$name" Publisher="$publisher" Version="$Version.0" ProcessorArchitecture="x64"/>
<Properties><DisplayName>Tiao</DisplayName><PublisherDisplayName>$display</PublisherDisplayName><Logo>Assets/StoreLogo.png</Logo></Properties>
<Resources><Resource Language="en-US"/><Resource Language="de-DE"/><Resource Language="es-ES"/></Resources>
<Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
<Applications><Application Id="Tiao" Executable="Tiao.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="Tiao" Description="Tiao" BackgroundColor="#1a0f06" Square150x150Logo="Assets/Square150x150Logo.png" Square44x44Logo="Assets/Square44x44Logo.png"/><Extensions><uap:Extension Category="windows.protocol"><uap:Protocol Name="tiao"/></uap:Extension></Extensions></Application></Applications>
<Capabilities><rescap:Capability Name="runFullTrust"/><Capability Name="internetClient"/></Capabilities>
</Package>
"@
Set-Content -LiteralPath (Join-Path $Source 'AppxManifest.xml') -Value $manifest -Encoding utf8
$makeappx=(Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin/*/x64/makeappx.exe' | Sort-Object FullName -Descending | Select-Object -First 1).FullName
if(-not $makeappx){throw 'Windows SDK makeappx.exe not found'}
& $makeappx pack /d $Source /p $Output /o
if($LASTEXITCODE){throw 'AppX packaging failed'}
