"""
独立子进程文件夹选择器
确保在 Windows / macOS / Linux 上弹出的对话框 100% 置顶在所有窗口（包含浏览器）最前方，并获取系统焦点
"""
import os
import sys

def main():
    initial_dir = sys.argv[1] if len(sys.argv) > 1 else ""
    if not initial_dir or not os.path.exists(initial_dir):
        initial_dir = os.path.expanduser("~")

    chosen = ""
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        # 置顶无边框 0 尺寸宿主窗口，强制获得 Windows 焦点并置顶
        root.overrideredirect(True)
        root.geometry("0x0+0+0")
        root.deiconify()
        root.lift()
        root.focus_force()
        root.attributes("-topmost", True)

        chosen = filedialog.askdirectory(
            parent=root,
            title="请选择批量生图保存目录",
            initialdir=initial_dir
        )
        root.destroy()
    except Exception as e:
        sys.stderr.write(f"TKINTER_ERROR: {e}\n")

    # 如果 Tkinter 失败且处于 Windows 环境，降级至 PowerShell 原生置顶文件夹对话框
    if not chosen and sys.platform == "win32":
        try:
            import subprocess
            clean_dir = initial_dir.replace("'", "''")
            ps_script = (
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;\n"
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog;\n"
                "$f.Description = '请选择批量生图保存目录';\n"
                f"$f.SelectedPath = '{clean_dir}';\n"
                "$f.ShowNewFolderButton = $true;\n"
                "$top = New-Object System.Windows.Forms.Form;\n"
                "$top.TopMost = $true;\n"
                "if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {\n"
                "  Write-Host ('SELECTED:' + $f.SelectedPath)\n"
                "} else {\n"
                "  Write-Host 'CANCELED'\n"
                "}\n"
            )
            res = subprocess.run(
                ["powershell", "-STA", "-NoProfile", "-Command", ps_script],
                capture_output=True,
                text=True,
                timeout=120
            )
            out = res.stdout.strip()
            if "SELECTED:" in out:
                for line in out.splitlines():
                    if line.startswith("SELECTED:"):
                        chosen = line.replace("SELECTED:", "").strip()
                        break
        except Exception as pe:
            sys.stderr.write(f"POWERSHELL_ERROR: {pe}\n")

    if chosen:
        print(f"SELECTED:{chosen}")
    else:
        print("CANCELED")

if __name__ == "__main__":
    main()
