# 在桌面和开始菜单创建「本地 AI 生图」快捷方式（双击即打开桌面版窗口）
# 用法：在项目目录运行  powershell -ExecutionPolicy Bypass -File .\create_shortcut.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonw = Join-Path $root ".venv\Scripts\pythonw.exe"
$entry = Join-Path $root "desktop.pyw"
$icon = Join-Path $root "static\app.ico"

if (-not (Test-Path $pythonw)) {
    Write-Error "找不到 $pythonw，请先按 README 创建虚拟环境并安装依赖。"
    exit 1
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs")
)
foreach ($dir in $targets) {
    $path = Join-Path $dir "本地 AI 生图.lnk"
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $pythonw
    $lnk.Arguments = "`"$entry`""
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = "本地 AI 生图"
    $lnk.Save()
    Write-Output "已创建：$path"
}
