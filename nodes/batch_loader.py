"""
批量图片加载器核心节点 (BatchImageLoader)
逐张精准读取、色彩与 EXIF 纠偏、自动适配分辨率，输出标准 IMAGE 张量与文件路径
"""

import os
import re
import torch
import numpy as np
from PIL import Image, ImageOps, ImageSequence

try:
    import folder_paths
except ImportError:
    folder_paths = None

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

def get_batch_temp_root():
    if folder_paths and hasattr(folder_paths, "get_input_directory"):
        input_dir = folder_paths.get_input_directory()
    else:
        input_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "input")
    return os.path.abspath(os.path.join(input_dir, "batch_temp"))

class BatchImageLoader:
    """
    批量图片加载与流式调度器节点
    - 支持 1 ~ 50 张图片批量载入 (拖拽、文件选择或剪贴板 Ctrl+V 粘贴)
    - 支持通过前端上传的 batch_id 读取，或直接指定本地图片文件夹路径
    - 严格根据 image_index 单张加载，保证单次只进入 1 张图到显存，彻底防止 FLUX/千问 OOM
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "auto_scale_mode": ([
                    "保持原尺寸 (Original)",
                    "等比缩放 (长边 1024)",
                    "等比缩放 (长边 1344 - 推荐FLUX)",
                    "等比缩放 (长边 1536)",
                    "等比缩放 (长边 2048)",
                ], {
                    "default": "保持原尺寸 (Original)"
                }),
            },
            "optional": {
                "custom_folder": ("STRING", {
                    "default": "", 
                    "multiline": False,
                    "tooltip": "可选：指定电脑本地文件夹路径 (免上传直接批量读取)"
                }),
                "batch_id": ("STRING", {
                    "default": "", 
                    "multiline": False,
                    "tooltip": "批次标识 ID (支持 1~50 张图片拖入、多选或 Ctrl+V 粘贴上传自动填充)"
                }),
                "image_index": ("INT", {
                    "default": 0, 
                    "min": 0, 
                    "max": 999999, 
                    "step": 1,
                    "tooltip": "当前读取的图片索引 (从 0 开始，由前端控制器逐个自动递增)"
                }),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "load_batch_image"
    CATEGORY = "喵小黑批量"

    def load_batch_image(self, auto_scale_mode, batch_id="", image_index=0, custom_folder=""):
        # 1. 确定扫描目录
        effective_batch_id = batch_id.strip() if batch_id else ""
        target_dir = ""
        if custom_folder and os.path.isdir(custom_folder.strip()):
            target_dir = os.path.abspath(custom_folder.strip())
            if not effective_batch_id:
                effective_batch_id = os.path.basename(target_dir)
        elif effective_batch_id:
            target_dir = os.path.join(get_batch_temp_root(), effective_batch_id)

        # 2. 检查目录与收集文件
        if not target_dir or not os.path.exists(target_dir):
            return self._create_placeholder_result("未找到批次目录或尚未上传图片", effective_batch_id)

        all_files = [
            f for f in os.listdir(target_dir)
            if os.path.isfile(os.path.join(target_dir, f)) and os.path.splitext(f)[1].lower() in SUPPORTED_EXTENSIONS
        ]
        all_files.sort(key=natural_sort_key)
        total_count = len(all_files)

        if total_count == 0:
            return self._create_placeholder_result(f"目录中无有效图片: {target_dir}", effective_batch_id)

        # 3. 计算并获取目标索引
        safe_index = image_index % total_count
        target_filename = all_files[safe_index]
        image_path = os.path.join(target_dir, target_filename)

        # 4. 读取图像并处理 EXIF 旋转
        try:
            pil_image = Image.open(image_path)
            pil_image = ImageOps.exif_transpose(pil_image)
        except Exception as e:
            print(f"[BatchMaster] 加载图片失败: {image_path}, 错误: {e}")
            return self._create_placeholder_result(f"加载异常: {target_filename}", effective_batch_id)

        # 5. 尺寸规整与缩放 (以适配 FLUX、千问最佳分辨率)
        pil_image = self._apply_scale(pil_image, auto_scale_mode)

        # 6. 提取 Alpha 通道生成 MASK
        if "A" in pil_image.getbands():
            mask_data = np.array(pil_image.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask_data)
        else:
            mask = torch.zeros((pil_image.height, pil_image.width), dtype=torch.float32, device="cpu")

        # 7. 转为标准 PyTorch Tensor [1, H, W, C]
        rgb_image = pil_image.convert("RGB")
        image_data = np.array(rgb_image).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_data)[None,]

        # 仅返回单个标准图像张量
        return (image_tensor,)

    def _apply_scale(self, img, mode):
        """根据配置等比缩放图像，并确保长宽能被 8 整除 (ComfyUI VAE/Latent 规范)"""
        w, h = img.size
        max_edge = 0

        if "1024" in mode:
            max_edge = 1024
        elif "1344" in mode:
            max_edge = 1344
        elif "1536" in mode:
            max_edge = 1536
        elif "2048" in mode:
            max_edge = 2048

        if max_edge > 0 and max(w, h) > max_edge:
            scale = max_edge / max(w, h)
            new_w = int(round(w * scale))
            new_h = int(round(h * scale))
            # 保持 8 的倍数
            new_w = (new_w // 8) * 8
            new_h = (new_h // 8) * 8
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        else:
            # 确保原尺寸也是 8 的倍数
            mod_w = (w // 8) * 8
            mod_h = (h // 8) * 8
            if mod_w != w or mod_h != h:
                img = img.resize((mod_w, mod_h), Image.Resampling.LANCZOS)

        return img

    def _create_placeholder_result(self, error_msg, batch_id=""):
        """异常降级：输出纯色带提示的图像，防止整个流程中断崩溃"""
        print(f"[BatchMaster Warning] {error_msg}")
        blank = np.zeros((512, 512, 3), dtype=np.float32)
        blank_tensor = torch.from_numpy(blank)[None,]
        return (blank_tensor,)
