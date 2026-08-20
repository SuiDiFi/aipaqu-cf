$ErrorActionPreference = 'Stop'
$root = 'e:\aipaqu-cf\ios'

# 1. Read icon base64
$icon180B64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\icon-180.png"))
$icon512B64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$root\icon-512.png"))

# 2. Read plist template and inject icon base64
$plist = [IO.File]::ReadAllText("$root\template.plist")
$plist = $plist.Replace('__ICON_BASE64_PLACEHOLDER__', $icon180B64)

# Save .mobileconfig file (backup)
$mobileconfigPath = "$root\AI-statistics.mobileconfig"
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($mobileconfigPath, $plist, $utf8NoBom)

# 3. Convert mobileconfig to base64 data URI
$bytes = $utf8NoBom.GetBytes($plist)
$mcB64 = [Convert]::ToBase64String($bytes)
$dataUri = "data:application/x-apple-aspen-config;base64," + $mcB64

# 4. Read HTML template and inject
$tpl = [IO.File]::ReadAllText("$root\template.html")
$iconDataUri = "data:image/png;base64," + $icon512B64
$out = $tpl.Replace('__ICON_B64__', $iconDataUri).Replace('__MOBILECONFIG_DATA_URI__', $dataUri)

# 5. Output final index.html
[IO.File]::WriteAllText("$root\index.html", $out, $utf8NoBom)

Write-Output "===== Build OK ====="
Write-Output ("mobileconfig size : {0:N0} bytes" -f (Get-Item $mobileconfigPath).Length)
Write-Output ("data uri length   : {0:N0} chars" -f $dataUri.Length)
Write-Output ("index.html size   : {0:N0} bytes" -f (Get-Item "$root\index.html").Length)
