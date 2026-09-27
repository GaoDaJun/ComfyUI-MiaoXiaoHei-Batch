"""
后端路由管理模块：处理批量图片上传、本地文件夹扫描、批次列表获取与缓存清理
"""

import os
import re
import uuid
import shutil
from aiohttp import web

# 尝试导入 ComfyUI 内部服务与路径管理器
try:
    import folder_paths
    from server import PromptServer
except ImportError:
    folder_paths = None
    PromptServer = None

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"}

def natural_sort_key(s):
    """自然排序算法 (例如: 1.jpg, 2.jpg, 10.jpg 而非 1.jpg, 10.jpg, 2.jpg)"""
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

def get_batch_temp_root():
    """获取批处理图片存储的根目录 (ComfyUI/input/batch_temp)"""
    if folder_paths and hasattr(folder_paths, "get_input_directory"):
        input_dir = folder_paths.get_input_directory()
    else:
        input_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "input")
    
    batch_root = os.path.join(input_dir, "batch_temp")
    os.makedirs(batch_root, exist_ok=True)
    return os.path.abspath(batch_root)

def ensure_sequential_batch_files(batch_dir):
    """
    确保批次目录下的现有图片带有固定 4 位序号前缀 (0001_xxx)，保证增量追加时新图片绝对在末尾
    """
    if not os.path.exists(batch_dir):
        return 0
    files = [
        f for f in os.listdir(batch_dir)
        if os.path.isfile(os.path.join(batch_dir, f)) and os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS
    ]
    files.sort(key=natural_sort_key)
    if not files:
        return 0

    all_have_prefix = True
    max_idx = 0
    for f in files:
        m = re.match(r'^(\d{4,})_', f)
        if m:
            max_idx = max(max_idx, int(m.group(1)))
        else:
            all_have_prefix = False

    if not all_have_prefix:
        # 对未加前缀的历史文件按现有顺序原地规范化重命名
        max_idx = 0
        for i, f in enumerate(files):
            m = re.match(r'^(\d{4,})_', f)
            if not m:
                new_name = f"{i+1:04d}_{f}"
                try:
                    os.rename(os.path.join(batch_dir, f), os.path.join(batch_dir, new_name))
                except Exception:
                    pass
                max_idx = max(max_idx, i + 1)
            else:
                max_idx = max(max_idx, int(m.group(1)))

    return max_idx

# 注册 API 路由 (使用 ComfyUI 标准 PromptServer.instance.routes)
try:
    if PromptServer is not None and hasattr(PromptServer, "instance") and PromptServer.instance:
        routes = PromptServer.instance.routes

        @routes.post("/batch_workflow/upload")
        async def upload_batch_images(request):
            """
            接收前端一次性批量上传的图片 (支持 10、50、100+ 张)
            落盘至 input/batch_temp/<batch_id>/ 目录
            """
            try:
                reader = await request.multipart()
                batch_id = None
                created_temp_batch_id = None
                uploaded_files = []
                cur_seq = None

                # 遍历表单中的所有字段与文件
                while True:
                    part = await reader.next()
                    if part is None:
                        break

                    if part.name == "batch_id":
                        val = await part.text()
                        explicit_id = val.strip()
                        if explicit_id:
                            if batch_id and batch_id != explicit_id and created_temp_batch_id == batch_id:
                                # 若先前使用了临时生成的 batch_id，将已写入的文件平滑合并迁移至前端指定的 batch 目录
                                old_dir = os.path.join(get_batch_temp_root(), batch_id)
                                new_dir = os.path.join(get_batch_temp_root(), explicit_id)
                                os.makedirs(new_dir, exist_ok=True)
                                if os.path.exists(old_dir):
                                    for f_name in os.listdir(old_dir):
                                        shutil.move(os.path.join(old_dir, f_name), os.path.join(new_dir, f_name))
                                    try:
                                        os.rmdir(old_dir)
                                    except Exception:
                                        pass
                            batch_id = explicit_id
                        continue

                    if part.filename:
                        # 确定批次 ID
                        if not batch_id:
                            batch_id = f"batch_{uuid.uuid4().hex[:10]}"
                            created_temp_batch_id = batch_id

                        batch_dir = os.path.join(get_batch_temp_root(), batch_id)
                        os.makedirs(batch_dir, exist_ok=True)

                        raw_filename = os.path.basename(part.filename)
                        base_name, file_ext = os.path.splitext(raw_filename)
                        ext = file_ext.lower()
                        if ext not in SUPPORTED_EXTENSIONS:
                            ct = (part.headers.get("Content-Type", "") if hasattr(part, "headers") else "").lower()
                            if "png" in ct:
                                ext = ".png"
                            elif "jpeg" in ct or "jpg" in ct:
                                ext = ".jpg"
                            elif "webp" in ct:
                                ext = ".webp"
                            elif "gif" in ct:
                                ext = ".gif"
                            elif "bmp" in ct:
                                ext = ".bmp"
                            else:
                                ext = ".png"
                            file_ext = ext
                            if not base_name or base_name == "blob":
                                base_name = f"paste_{uuid.uuid4().hex[:6]}"

                        if cur_seq is None:
                            cur_seq = ensure_sequential_batch_files(batch_dir)

                        cur_seq += 1
                        clean_base = re.sub(r'^\d{4,}_', '', base_name)
                        filename = f"{cur_seq:04d}_{clean_base}{file_ext}"

                        save_path = os.path.join(batch_dir, filename)
                        with open(save_path, "wb") as f:
                            while True:
                                chunk = await part.read_chunk()
                                if not chunk:
                                    break
                                f.write(chunk)

                        if os.path.exists(save_path) and os.path.getsize(save_path) > 0:
                            uploaded_files.append(filename)
                        elif os.path.exists(save_path):
                            try:
                                os.remove(save_path)
                            except Exception:
                                pass

                if not batch_id or (not uploaded_files and not os.path.exists(os.path.join(get_batch_temp_root(), batch_id))):
                    return web.json_response({
                        "success": False,
                        "error": "未接收到有效图片或文件格式不支持"
                    }, status=400)

                # 扫描该批次文件夹下的全部文件（支持累加多轮上传与粘贴）
                batch_dir = os.path.join(get_batch_temp_root(), batch_id)
                all_files = [
                    f for f in os.listdir(batch_dir)
                    if os.path.isfile(os.path.join(batch_dir, f)) and os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS
                ]
                all_files.sort(key=natural_sort_key)

                # 最多保留 50 张
                if len(all_files) > 50:
                    all_files = all_files[:50]

                result_list = []
                for fn in all_files:
                    result_list.append({
                        "filename": fn,
                        "url": f"/view?filename={fn}&subfolder=batch_temp/{batch_id}&type=input"
                    })

                return web.json_response({
                    "success": True,
                    "batch_id": batch_id,
                    "total": len(result_list),
                    "files": result_list
                })

            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_workflow/delete_image")
        async def delete_image(request):
            """删除批次中的单张图片"""
            try:
                data = await request.json()
                batch_id = data.get("batch_id", "").strip()
                filename = data.get("filename", "").strip()
                if not batch_id or not filename:
                    return web.json_response({"success": False, "error": "缺少参数"}, status=400)

                target = os.path.join(get_batch_temp_root(), batch_id, filename)
                if os.path.exists(target):
                    os.remove(target)

                # 返回删除后的最新文件列表
                batch_dir = os.path.join(get_batch_temp_root(), batch_id)
                all_files = [
                    f for f in os.listdir(batch_dir)
                    if os.path.isfile(os.path.join(batch_dir, f)) and os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS
                ] if os.path.exists(batch_dir) else []
                all_files.sort(key=natural_sort_key)

                result_list = [
                    {"filename": fn, "url": f"/view?filename={fn}&subfolder=batch_temp/{batch_id}&type=input"}
                    for fn in all_files
                ]
                return web.json_response({"success": True, "total": len(result_list), "files": result_list})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_workflow/scan_local_folder")
        async def scan_local_folder(request):
            """
            支持直接读取本地电脑上的图片文件夹 (免重复上传，高效读取大批量图片)
            """
            try:
                data = await request.json()
                folder_path = data.get("folder_path", "").strip()

                if not folder_path or not os.path.isdir(folder_path):
                    return web.json_response({
                        "success": False,
                        "error": f"无效的本地文件夹路径: {folder_path}"
                    }, status=400)

                files = []
                for item in os.listdir(folder_path):
                    full_path = os.path.join(folder_path, item)
                    if os.path.isfile(full_path):
                        ext = os.path.splitext(item)[1].lower()
                        if ext in SUPPORTED_EXTENSIONS:
                            files.append(item)

                files.sort(key=natural_sort_key)

                return web.json_response({
                    "success": True,
                    "folder_path": folder_path,
                    "total": len(files),
                    "files": files
                })

            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_workflow/clear_batch")
        async def clear_batch(request):
            """清理已完成或废弃的批次临时缓存"""
            try:
                data = await request.json()
                batch_id = data.get("batch_id", "").strip()
                if not batch_id:
                    return web.json_response({"success": False, "error": "缺少 batch_id"}, status=400)

                target_dir = os.path.join(get_batch_temp_root(), batch_id)
                if os.path.exists(target_dir):
                    shutil.rmtree(target_dir, ignore_errors=True)

                return web.json_response({"success": True})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_master/download_zip")
        async def download_batch_zip(request):
            """
            将画廊或批次中的多张图片直接在内存中高速打包为 ZIP 文件并提供流式下载
            """
            import io
            import zipfile
            import urllib.parse

            try:
                data = await request.json()
                items = data.get("items", [])
                zip_name = data.get("zip_name", "batch_results.zip")

                if not items:
                    return web.json_response({"success": False, "error": "没有可供下载的图片"}, status=400)

                output_base = folder_paths.get_output_directory() if folder_paths and hasattr(folder_paths, "get_output_directory") else os.path.abspath("output")
                input_base = folder_paths.get_input_directory() if folder_paths and hasattr(folder_paths, "get_input_directory") else os.path.abspath("input")
                temp_base = folder_paths.get_temp_directory() if folder_paths and hasattr(folder_paths, "get_temp_directory") else os.path.abspath("temp")

                zip_buffer = io.BytesIO()
                count = 0
                seen_names = set()

                with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as zf:
                    for idx, it in enumerate(items):
                        fname = it.get("filename", "")
                        subfolder = it.get("subfolder", "")
                        img_type = it.get("type", "output")
                        file_path = it.get("file_path", "")

                        if not file_path or not os.path.exists(file_path):
                            if img_type == "output":
                                base_dir = output_base
                            elif img_type == "input":
                                base_dir = input_base
                            elif img_type == "temp":
                                base_dir = temp_base
                            else:
                                base_dir = output_base

                            file_path = os.path.join(base_dir, subfolder, fname)

                        if os.path.exists(file_path) and os.path.isfile(file_path):
                            arc_name = fname if fname else os.path.basename(file_path)
                            # 避免压缩包内文件名冲突
                            if arc_name in seen_names:
                                base, ext = os.path.splitext(arc_name)
                                arc_name = f"{base}_{idx+1}{ext}"
                            seen_names.add(arc_name)

                            zf.write(file_path, arcname=arc_name)
                            count += 1

                if count == 0:
                    return web.json_response({"success": False, "error": "未在服务器上找到对应的图片文件，可能已被清理"}, status=404)

                zip_buffer.seek(0)
                encoded_name = urllib.parse.quote(zip_name)
                headers = {
                    "Content-Type": "application/zip",
                    "Content-Disposition": f"attachment; filename=\"{encoded_name}\"; filename*=UTF-8''{encoded_name}"
                }
                return web.Response(body=zip_buffer.getvalue(), headers=headers)
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_master/pick_folder")
        async def pick_folder(request):
            """
            在独立主线程子进程中调起 Windows / 系统原生文件夹选择器，绝不死锁卡死
            """
            import asyncio
            import sys

            try:
                try:
                    data = await request.json()
                except Exception:
                    data = {}

                initial_dir = data.get("initial_dir", "").strip()
                output_dir = folder_paths.get_output_directory() if folder_paths and hasattr(folder_paths, "get_output_directory") else os.path.abspath("output")

                if initial_dir and not os.path.isabs(initial_dir):
                    clean_rel = initial_dir.replace("\\", "/")
                    if clean_rel.startswith("output/"):
                        clean_rel = clean_rel[7:]
                    initial_dir = os.path.normpath(os.path.join(output_dir, clean_rel))

                if not initial_dir or not os.path.exists(initial_dir):
                    initial_dir = output_dir

                # 调用独立置顶选择器脚本：自带焦点置顶与双重容错（Tkinter + PowerShell）
                picker_script = os.path.join(os.path.dirname(__file__), "folder_picker_dialog.py")
                proc = await asyncio.create_subprocess_exec(
                    sys.executable, picker_script, initial_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout_data, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
                out_str = stdout_data.decode("utf-8", errors="ignore").strip()

                if "SELECTED:" in out_str:
                    path_line = [line for line in out_str.splitlines() if line.startswith("SELECTED:")][0]
                    chosen_folder = os.path.normpath(path_line.replace("SELECTED:", "").strip())
                    return web.json_response({"success": True, "folder_path": chosen_folder})
                else:
                    return web.json_response({"success": False, "canceled": True})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_master/open_folder")
        async def open_folder(request):
            """
            在本地系统资源管理器 (Windows Explorer / macOS Finder) 中直接打开指定文件夹
            """
            import subprocess
            import platform

            try:
                try:
                    data = await request.json()
                except Exception:
                    data = {}

                folder_path = data.get("folder_path", "").strip()
                if not folder_path:
                    folder_path = "batch_export"

                output_dir = folder_paths.get_output_directory() if folder_paths and hasattr(folder_paths, "get_output_directory") else os.path.abspath("output")

                # 相对路径解析 (避免 output/output/xxx)
                if not os.path.isabs(folder_path):
                    clean_rel = folder_path.replace("\\", "/")
                    if clean_rel.startswith("output/"):
                        clean_rel = clean_rel[7:]
                    full_path = os.path.normpath(os.path.join(output_dir, clean_rel))
                else:
                    full_path = os.path.normpath(folder_path)

                os.makedirs(full_path, exist_ok=True)

                sys_name = platform.system()
                if sys_name == "Windows":
                    os.startfile(full_path)
                elif sys_name == "Darwin":
                    subprocess.run(["open", full_path])
                else:
                    subprocess.run(["xdg-open", full_path])

                return web.json_response({"success": True, "opened": full_path})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_master/list_folders")
        async def list_folders(request):
            """
            列出指定路径下的子文件夹、盘符与常用快捷目录（桌面、ComfyUI Output 等）
            """
            import sys
            import string

            try:
                try:
                    data = await request.json()
                except Exception:
                    data = {}

                output_dir = folder_paths.get_output_directory() if folder_paths and hasattr(folder_paths, "get_output_directory") else os.path.abspath("output")
                desktop_dir = os.path.normpath(os.path.join(os.path.expanduser("~"), "Desktop"))

                req_path = str(data.get("path", "")).strip()
                if not req_path:
                    req_path = output_dir

                # 相对路径转绝对路径
                if not os.path.isabs(req_path):
                    clean_rel = req_path.replace("\\", "/")
                    if clean_rel.startswith("output/"):
                        clean_rel = clean_rel[7:]
                    req_path = os.path.normpath(os.path.join(output_dir, clean_rel))
                else:
                    req_path = os.path.normpath(req_path)

                if not os.path.exists(req_path):
                    req_path = output_dir

                # 常用快捷路径
                shortcuts = []
                if os.path.exists(desktop_dir):
                    shortcuts.append({"name": "🖥️ 桌面", "path": desktop_dir})
                if os.path.exists(output_dir):
                    shortcuts.append({"name": "📦 ComfyUI output", "path": output_dir})

                # 可用驱动器盘符 (Windows)
                drives = []
                if sys.platform == "win32":
                    for letter in string.ascii_uppercase:
                        d_path = f"{letter}:\\"
                        if os.path.exists(d_path):
                            drives.append(f"{letter}:")

                # 获取上一级目录
                parent_path = os.path.dirname(req_path)
                if parent_path == req_path:
                    parent_path = None

                # 列出子文件夹
                subfolders = []
                try:
                    with os.scandir(req_path) as entries:
                        for entry in entries:
                            try:
                                if entry.is_dir(follow_symlinks=False) and not entry.name.startswith("."):
                                    subfolders.append(entry.name)
                            except PermissionError:
                                pass
                    subfolders.sort(key=lambda s: s.lower())
                except Exception:
                    pass

                return web.json_response({
                    "success": True,
                    "current_path": req_path,
                    "parent_path": parent_path,
                    "shortcuts": shortcuts,
                    "drives": drives,
                    "folders": subfolders
                })
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)

        @routes.post("/batch_master/create_folder")
        async def create_folder(request):
            """
            在当前目录下新建子文件夹
            """
            try:
                data = await request.json()
                parent = data.get("parent", "").strip()
                name = data.get("name", "").strip()
                if not parent or not name:
                    return web.json_response({"success": False, "error": "目录或名称不能为空"}, status=400)
                new_path = os.path.normpath(os.path.join(parent, name))
                os.makedirs(new_path, exist_ok=True)
                return web.json_response({"success": True, "created_path": new_path})
            except Exception as e:
                return web.json_response({"success": False, "error": str(e)}, status=500)
except Exception as e:
    print(f"[ComfyUI-Batch-Master] 警告：初始化服务端路由时出现异常: {e}")
