param([int]$s)
$t = Get-Content -Encoding UTF8 "$env:ProgramData\WOLwrt\warn.txt"
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object Windows.Forms.Form
$f.Text = 'WOLwrt'
$f.TopMost = $true
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'
$f.MaximizeBox = $false
$f.MinimizeBox = $false
$f.ClientSize = New-Object Drawing.Size(400, 124)
$f.Font = New-Object Drawing.Font('Segoe UI', 10)
$l = New-Object Windows.Forms.Label
$l.SetBounds(18, 18, 364, 44)
$f.Controls.Add($l)
$c = New-Object Windows.Forms.Button
$c.Text = $t[1]
$c.SetBounds(18, 74, 176, 34)
$f.Controls.Add($c)
$n = New-Object Windows.Forms.Button
$n.Text = $t[2]
$n.SetBounds(206, 74, 176, 34)
$f.Controls.Add($n)
$end = (Get-Date).AddSeconds($s)
$tick = {
	$left = [math]::Max(0, [int]($end - (Get-Date)).TotalSeconds)
	$l.Text = $t[0] -f $left
	if ($left -le 0) { $f.Close() }
}
& $tick
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick($tick)
$timer.Start()
$c.Add_Click({ shutdown.exe /a; New-Item -ItemType File -Force "$env:ProgramData\WOLwrt\cancelled" | Out-Null; $f.Close() })
$n.Add_Click({ shutdown.exe /s /t 0; $f.Close() })
$f.Add_Shown({ $f.Activate() })
[void]$f.ShowDialog()
