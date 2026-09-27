"""
批量结果排队画廊节点 (BatchResultGallery)
接收模型输出、自动分类落盘保存、向前端广播实时完成事件并在画廊按序号排队
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

class BatchResultGallery:
    """
    批量结果排队画廊节点
    - 接收每张生成完成的图像
    - 带有原文件名与批次序号标记，自动归档
    - 发送实时 WebSocket 事件给前端，使结果动态挨个排在后面，点击即可查看大图
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": "模型 (FLUX/千问/SD) 输出的生成图像"
                }),
            },
            "optional": {
                "filename_prefix": ("STRING", {
                    "default": "Result",
                    "tooltip": "生成文件保存前缀"
                }),
                "save_subfolder": ("STRING", {
                    "default": "batch_results",
                    "tooltip": "保存的子文件夹名称"
                }),
                "batch_id": ("STRING", {
                    "default": "", 
                    "multiline": False,
                }),
                "original_filename": ("STRING", {
                    "default": "", 
                    "multiline": False,
                }),
                "current_index": ("INT", {
                    "default": 1, 
                    "min": 0, 
                    "max": 999999,
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "save_and_broadcast"
    OUTPUT_NODE = True
    CATEGORY = "喵小黑批量"

    def save_and_broadcast(self, images, batch_id="", filename_prefix="Result", original_filename="", current_index=1, save_subfolder="batch_results", prompt=None, extra_pnginfo=None):
        if folder_paths and hasattr(folder_paths, "get_output_directory"):
            output_dir = folder_paths.get_output_directory()
        else:
            output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "output")

        # 确定存放子目录：output/batch_results/<batch_id>/
        subfolder = os.path.join(save_subfolder, batch_id) if batch_id else save_subfolder
        full_output_dir = os.path.join(output_dir, subfolder)
        os.makedirs(full_output_dir, exist_ok=True)

        results_ui = []
        broadcast_items = []

        # 处理并保存生成的每张图 (通常为 1 张)
        for i, image_tensor in enumerate(images):
            # 将 Tensor [H, W, C] 转换为 PIL.Image
            i_np = 255.0 * image_tensor.cpu().numpy()
            img = Image.fromarray(np.clip(i_np, 0, 255).astype(np.uint8))

            # 嵌入 ComfyUI 流程元数据 (PNG Info)
            metadata = PngInfo()
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo is not None:
                for k, v in extra_pnginfo.items():
                    metadata.add_text(k, json.dumps(v))

            # 构建有规律的易读文件名
            orig_base = os.path.splitext(original_filename)[0] if original_filename else ""
            if orig_base:
                file_name = f"{filename_prefix}_{current_index:03d}_{orig_base}.png"
            else:
                file_name = f"{filename_prefix}_{current_index:03d}_{int(time.time()*1000)%100000:05d}.png"

            file_path = os.path.join(full_output_dir, file_name)
            img.save(file_path, pnginfo=metadata, compress_level=4)

            # Web 预览访问相对路径
            view_url = f"/view?filename={file_name}&subfolder={subfolder.replace(os.sep, '/')}&type=output"
            
            # 原图预览访问路径 (如果提供)
            orig_url = ""
            if original_filename and batch_id:
                orig_url = f"/view?filename={original_filename}&subfolder=batch_temp/{batch_id}&type=input"

            item_info = {
                "filename": file_name,
                "subfolder": subfolder.replace(os.sep, "/"),
                "type": "output",
                "url": view_url,
                "orig_url": orig_url,
                "index": current_index,
                "original_filename": original_filename,
                "timestamp": int(time.time() * 1000)
            }
            results_ui.append(item_info)
            broadcast_items.append(item_info)

        # 通过 WebSocket 实时向前端广播生成结果事件，触发画廊即时排队渲染
        # 核心：精准携带 client_id 并使用 sid=curr_client_id 定向推送，多浏览器标签页严格物理隔离
        if PromptServer is not None and hasattr(PromptServer, "instance") and PromptServer.instance:
            curr_client_id = getattr(PromptServer.instance, "client_id", None)
            for item in broadcast_items:
                PromptServer.instance.send_sync("batch_image_completed", {
                    "batch_id": batch_id,
                    "client_id": curr_client_id,
                    "item": item
                }, sid=curr_client_id)

        return {"ui": {"batch_results": results_ui}, "result": (images,)}
