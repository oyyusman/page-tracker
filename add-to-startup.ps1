# Starts Page Tracker automatically (minimized) every time you log into Windows.
# Run once:  right-click > "Run with PowerShell"
# Undo:      delete "Page Tracker.lnk" from  shell:startup
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Page Tracker.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $node
$s.Arguments = '"' + (Join-Path $dir 'server.js') + '"'
$s.WorkingDirectory = $dir
$s.WindowStyle = 7   # minimized
$s.Save()
Write-Host "Added to Windows startup: $lnk"
Write-Host "Dashboard: http://localhost:3000"
