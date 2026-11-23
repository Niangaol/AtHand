$ErrorActionPreference = 'Stop'
$path = 'D:\AgentPrograms\AtHand\参赛材料-Qoder大赛\作品帖-正文.md'
$t = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
Set-Clipboard -Value $t
Write-Output ("chars=" + $t.Length)
