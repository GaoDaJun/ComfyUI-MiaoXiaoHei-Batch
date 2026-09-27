Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "请选择批量生图保存目录"
$dialog.ShowNewFolderButton = $true

if ($args.Count -gt 0 -and (Test-Path $args[0])) {
    $dialog.SelectedPath = $args[0]
}

$topForm = New-Object System.Windows.Forms.Form
$topForm.TopMost = $true
$topForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen

$res = $dialog.ShowDialog($topForm)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output ("SELECTED:" + $dialog.SelectedPath)
} else {
    Write-Output "CANCELED"
}
