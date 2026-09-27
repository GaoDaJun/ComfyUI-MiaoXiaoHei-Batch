"""
喵小黑批量：指定目录导出 (BatchImageExport)
核心功能：
1. 转好一张，自动保存/输出到指定目录一张
2. 支持自定义保存目录（支持任意绝对路径如 D:/生图结果 或相对路径，自动创建目录）
3. 支持丰富的命名模式（原文件名、前缀_原名、前缀_序号、前缀_序号_原名、时间戳等）
4. 支持格式切换（PNG / JPG / WEBP）及 JPG/WEBP 质量调整
5. 自动嵌入 ComfyUI 流程元数据 (PNGInfo)
6. 支持透传 images 引脚，可无缝串接画廊或其他下游节点
"""

import os
import json
import time
import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

try:
    import folder_paths
    from server import PromptServer
except ImportError:
    folder_paths = None
    PromptServer = None


class BatchImageExport:
    """
    喵小黑批量：指定目录导出
    """

    NAMING_PATTERNS = [
        "前缀_三位序号_原名 (如 Result_001_pic.jpg)",
        "前缀_三位序号 (如 Result_001.jpg)",
        "前缀_原文件名 (如 Result_pic.jpg)",
        "原文件名 (如 pic.jpg)",
        "原名_时间戳 (如 pic_20260927_181000.jpg)",
    ]

    FORMAT_OPTIONS = ["png", "jpg", "webp"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "模型 (FLUX/千问/SD) 输出的生成图像"
                }),
                "save_directory": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "自定义图片保存目录 (可选)，留空则保存至默认 output/batch_export"
                }),
                "filename_prefix": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "自定义图片名称 (可不填)"
                }),
                "filename_suffix": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "自定义后缀 (如:-v1)"
                }),
                "format": (cls.FORMAT_OPTIONS, {
                    "default": "png",
                    "tooltip": "保存格式 (PNG/JPG/WEBP)"
                }),
            },
            "optional": {
                "original_filename": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "输入的原文件名（从批量输入调度器的 filename 引脚连入）"
                }),
                "current_index": ("INT", {
                    "default": 1,
                    "min": 0,
                    "max": 999999,
                    "tooltip": "当前批次序号（从批量输入调度器的 index 引脚连入）"
                }),
                "batch_id": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "当前批次 ID"
                }),
                "naming_pattern": (cls.NAMING_PATTERNS, {
                    "default": "前缀_三位序号_原名 (如 Result_001_pic.jpg)",
                }),
                "quality": ("INT", {
                    "default": 100,
                    "min": 10,
                    "max": 100,
                    "step": 1,
                    "tooltip": "导出画质（默认100%满画质不压缩）"
                }),
                "overwrite": ("BOOLEAN", {
                    "default": False,
                    "label_on": "覆盖同名文件",
                    "label_off": "自动加序号重命名",
                    "tooltip": "如果目标文件夹存在同名文件，是覆盖还是自动加编号重命名"
                }),
                "browser_auto_download": ("BOOLEAN", {
                    "default": False,
                    "label_on": "开启 (同时触发浏览器下载)",
                    "label_off": "关闭 (仅自动写入本地目录)",
                    "tooltip": "推荐关闭。关闭时直接极速写入电脑硬盘指定目录；开启时浏览器每完成一张也会额外弹窗下载一张"
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "saved_path", "saved_filename")
    FUNCTION = "export_image"
    OUTPUT_NODE = True
    CATEGORY = "喵小黑批量"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        """免检通行证：确保任何格式和路径配置绝对不被 ComfyUI 拦截"""
        return True

    def export_image(
        self,
        images,
        save_directory="",
        filename_prefix="",
        filename_suffix="",
        format="png",
        original_filename="",
        current_index=1,
        batch_id="",
        quality=100,
        naming_pattern=None,
        overwrite=False,
        browser_auto_download=False,
        prompt=None,
        extra_pnginfo=None,
        **kwargs,
    ):
        # 1. 规范化并确定保存目录
        save_dir = str(save_directory or "").strip()
        output_dir = folder_paths.get_output_directory() if folder_paths and hasattr(folder_paths, "get_output_directory") else os.path.abspath("output")

        # 如果未指定，则默认存入 output/batch_export
        if not save_dir:
            full_save_dir = os.path.normpath(os.path.join(output_dir, "batch_export"))
        elif os.path.isabs(save_dir):
            full_save_dir = os.path.normpath(save_dir)
        else:
            clean_rel = save_dir.replace("\\", "/")
            if clean_rel.startswith("output/"):
                clean_rel = clean_rel[7:]
            full_save_dir = os.path.normpath(os.path.join(output_dir, clean_rel))

        os.makedirs(full_save_dir, exist_ok=True)

        # 2. 格式与扩展名
        fmt = str(format or "png").lower().strip()
        if fmt in ("jpg", "jpeg"):
            ext = ".jpg"
            pil_format = "JPEG"
        elif fmt == "webp":
            ext = ".webp"
            pil_format = "WEBP"
        else:
            ext = ".png"
            pil_format = "PNG"

        # 3. 提取原文件名基名 (去除路径与扩展名)
        orig_base = ""
        if original_filename:
            orig_base = os.path.splitext(os.path.basename(original_filename))[0].strip()

        # 4. 简单清晰的文件命名规则
        custom_name = str(filename_prefix or "").strip()
        suffix = str(filename_suffix or "").strip()

        try:
            c_idx = int(current_index) if current_index is not None else 1
        except Exception:
            c_idx = 1
        idx_str = f"{c_idx:03d}"

        # 构造基准文件名：
        # - 如果填了自定义图片名称：如 "主图_001"
        # - 没填自定义名称，但有原文件名连入：保留原图名 "原图名" (若原名空则用序号)
        # - 都没填：默认 "Result_001"
        if custom_name:
            base_name = f"{custom_name}_{idx_str}"
        elif orig_base:
            base_name = orig_base
        else:
            base_name = f"Result_{idx_str}"

        # 拼接后缀 (如用户填写了 -v1 或 _hd)
        if suffix:
            base_name = f"{base_name}{suffix}"

        # 5. 逐张处理并原画质/无损落盘写入本地目录 (不压缩)
        saved_paths = []
        saved_filenames = []
        download_events = []

        for i, image_tensor in enumerate(images):
            # 将 Tensor [H, W, C] 转换为 PIL.Image
            i_np = 255.0 * image_tensor.cpu().numpy()
            img = Image.fromarray(np.clip(i_np, 0, 255).astype(np.uint8))

            cur_base = base_name if len(images) == 1 else f"{base_name}_{i+1}"
            target_filename = f"{cur_base}{ext}"
            target_path = os.path.join(full_save_dir, target_filename)

            # 防重名覆盖处理
            if not overwrite and os.path.exists(target_path):
                dup_idx = 1
                while os.path.exists(os.path.join(full_save_dir, f"{cur_base}_{dup_idx}{ext}")):
                    dup_idx += 1
                target_filename = f"{cur_base}_{dup_idx}{ext}"
                target_path = os.path.join(full_save_dir, target_filename)

            # 嵌入 ComfyUI 流程元数据并原画质/无损保存 (不压缩)
            if pil_format == "PNG":
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for k, v in extra_pnginfo.items():
                        metadata.add_text(k, json.dumps(v))
                img.save(target_path, format="PNG", pnginfo=metadata, compress_level=1)
            elif pil_format == "JPEG":
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                # 原画质 100% 满画质导出，subsampling=0 禁止色度下采样，绝不压缩损失
                img.save(target_path, format="JPEG", quality=100, subsampling=0)
            elif pil_format == "WEBP":
                # 原画质无损导出：lossless=True 保持 100% 原始像素
                img.save(target_path, format="WEBP", lossless=True, quality=100)

            saved_paths.append(target_path)
            saved_filenames.append(target_filename)
            print(f"[喵小黑批量：自动保存导出] -> 已原画质保存至: {target_path} (批次: #{current_index})")

            # 如果开启了浏览器同步下载
            if browser_auto_download:
                download_events.append({
                    "filename": target_filename,
                    "file_path": target_path
                })

        # 6. 如果开启浏览器下载，通过 WebSocket 推送前端即时触发下载
        if download_events and PromptServer is not None and hasattr(PromptServer, "instance") and PromptServer.instance:
            curr_client_id = getattr(PromptServer.instance, "client_id", None)
            for ev in download_events:
                PromptServer.instance.send_sync("batch_image_exported_download", {
                    "client_id": curr_client_id,
                    "filename": ev["filename"],
                    "file_path": ev["file_path"]
                }, sid=curr_client_id)

        primary_path = saved_paths[0] if saved_paths else ""
        primary_name = saved_filenames[0] if saved_filenames else ""

        return {
            "ui": {
                "saved_paths": saved_paths,
                "save_dir": full_save_dir,
                "latest_file": primary_name
            },
            "result": (images, primary_path, primary_name)
        }
