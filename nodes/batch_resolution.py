"""
喵小黑批量：生图尺寸预设 (BatchResolutionPreset)
核心特性：
1. 专为大模型（FLUX、千问、SDXL、SD1.5）优化的比例与分辨率调度预设。
2. 涵盖 1:1、3:2、2:3、16:9、9:16、4:3、3:4、4:5、5:4、21:9、1:2、2:1、1:3、3:1、1:4、4:1 与自定义全画幅。
3. 科学的三级分辨率档位：1K（常用基准，如 3:2=1536×1024, 16:9=1920×1080）、1.5K（高清进阶）、2K（大一倍超清）。
4. 大比例（如 3:1、4:1）短边自动采用 512/768 等安全尺寸，彻底告别显存爆炸（CUDA OOM）。
5. 自动一键翻转横竖屏 (Swap Dimensions)。
6. 内置直接输出空 Latent（支持 FLUX/SD3 16通道 与 SDXL/SD1.5 4通道），无需额外串联 EmptyLatent 节点。
"""

import math
import torch

try:
    import comfy.model_management
except ImportError:
    comfy = None


# 预设比例分辨率矩阵 (宽高均为 1K/1.5K/2K 对应数值)
PRESET_RESOLUTIONS = {
    "1:1 (正方形)": {
        "1K": (1024, 1024),
        "1.5K": (1536, 1536),
        "2K": (2048, 2048),
        "ratio_name": "1:1",
    },
    "3:2 (经典横图)": {
        "1K": (1536, 1024),
        "1.5K": (2304, 1536),
        "2K": (3072, 2048),
        "ratio_name": "3:2",
    },
    "2:3 (经典竖图)": {
        "1K": (1024, 1536),
        "1.5K": (1536, 2304),
        "2K": (2048, 3072),
        "ratio_name": "2:3",
    },
    "4:3 (传统横图)": {
        "1K": (1024, 768),
        "1.5K": (1536, 1152),
        "2K": (2048, 1536),
        "ratio_name": "4:3",
    },
    "3:4 (传统竖图)": {
        "1K": (768, 1024),
        "1.5K": (1152, 1536),
        "2K": (1536, 2048),
        "ratio_name": "3:4",
    },
    "4:5 (社交竖图)": {
        "1K": (1024, 1280),
        "1.5K": (1536, 1920),
        "2K": (2048, 2560),
        "ratio_name": "4:5",
    },
    "5:4 (社交横图)": {
        "1K": (1280, 1024),
        "1.5K": (1920, 1536),
        "2K": (2560, 2048),
        "ratio_name": "5:4",
    },
    "16:9 (电脑横屏)": {
        "1K": (1920, 1080),
        "1.5K": (2880, 1620),
        "2K": (3840, 2160),
        "ratio_name": "16:9",
    },
    "9:16 (手机竖屏)": {
        "1K": (1080, 1920),
        "1.5K": (1620, 2880),
        "2K": (2160, 3840),
        "ratio_name": "9:16",
    },
    "21:9 (宽屏全景)": {
        "1K": (1792, 768),
        "1.5K": (2688, 1152),
        "2K": (3584, 1536),
        "ratio_name": "21:9",
    },
    "2:1 (超宽全景)": {
        "1K": (1536, 768),
        "1.5K": (2304, 1152),
        "2K": (3072, 1536),
        "ratio_name": "2:1",
    },
    "1:2 (超长竖图)": {
        "1K": (768, 1536),
        "1.5K": (1152, 2304),
        "2K": (1536, 3072),
        "ratio_name": "1:2",
    },
    "3:1 (极宽横条)": {
        "1K": (1536, 512),
        "1.5K": (2304, 768),
        "2K": (3072, 1024),
        "ratio_name": "3:1",
    },
    "1:3 (极长长条)": {
        "1K": (512, 1536),
        "1.5K": (768, 2304),
        "2K": (1024, 3072),
        "ratio_name": "1:3",
    },
    "4:1 (四联横幅)": {
        "1K": (2048, 512),
        "1.5K": (3072, 768),
        "2K": (4096, 1024),
        "ratio_name": "4:1",
    },
    "1:4 (四联竖幅)": {
        "1K": (512, 2048),
        "1.5K": (768, 3072),
        "2K": (1024, 4096),
        "ratio_name": "1:4",
    },
}

RATIO_OPTIONS = list(PRESET_RESOLUTIONS.keys()) + ["自定义 (Custom)"]
TIER_OPTIONS = ["1K (常用基准)", "1.5K (高清进阶)", "2K (大一倍超清)"]
ALIGN_OPTIONS = ["无 / 原生 (如1080P/千问)", "16倍数 (FLUX推荐)", "32倍数 (通用优化)", "64倍数 (SDXL最稳)"]
LATENT_TYPE_OPTIONS = ["FLUX / SD3 (16通道)", "SDXL / SD1.5 / 千问 (4通道)"]


def align_dimension(val: int, step: int) -> int:
    """按步长进行最接近取整对齐"""
    if step <= 1:
        return int(val)
    return max(step, int(round(val / step) * step))


class BatchResolutionPreset:
    """
    喵小黑批量：生图尺寸预设
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratio": (RATIO_OPTIONS, {"default": "3:2 (经典横图)"}),
                "resolution_tier": (TIER_OPTIONS, {"default": "1K (常用基准)"}),
                "swap_dimensions": ("BOOLEAN", {"default": False, "label_on": "是 (翻转)", "label_off": "否 (正常)"}),
                "alignment": (ALIGN_OPTIONS, {"default": "无 / 原生 (如1080P/千问)"}),
                "latent_type": (LATENT_TYPE_OPTIONS, {"default": "FLUX / SD3 (16通道)"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64, "step": 1}),
            },
            "optional": {
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "LATENT", "STRING")
    RETURN_NAMES = ("width", "height", "latent", "ratio_text")
    FUNCTION = "calculate"
    CATEGORY = "喵小黑"

    def calculate(
        self,
        aspect_ratio: str,
        resolution_tier: str,
        swap_dimensions: bool = False,
        alignment: str = "无 / 原生 (如1080P/千问)",
        latent_type: str = "FLUX / SD3 (16通道)",
        batch_size: int = 1,
        custom_width: int = 1024,
        custom_height: int = 1024,
    ):
        # 1. 判定分辨率来源
        tier_key = "1K"
        if "1.5K" in resolution_tier:
            tier_key = "1.5K"
        elif "2K" in resolution_tier:
            tier_key = "2K"

        if aspect_ratio in PRESET_RESOLUTIONS:
            w, h = PRESET_RESOLUTIONS[aspect_ratio][tier_key]
            ratio_text = PRESET_RESOLUTIONS[aspect_ratio]["ratio_name"]
        else:
            w = int(custom_width)
            h = int(custom_height)
            ratio_text = f"{w}:{h}"

        # 2. 翻转长宽 (Swap)
        if swap_dimensions:
            w, h = h, w
            parts = ratio_text.split(":")
            if len(parts) == 2:
                ratio_text = f"{parts[1]}:{parts[0]}"

        # 3. 步长对齐处理
        step = 1
        if "16倍数" in alignment:
            step = 16
        elif "32倍数" in alignment:
            step = 32
        elif "64倍数" in alignment:
            step = 64

        final_w = align_dimension(w, step)
        final_h = align_dimension(h, step)

        # 4. 生成空 Latent
        channels = 16 if "16通道" in latent_type else 4

        # 对于 FLUX (16通道)，潜空间尺寸必须为偶数 (即像素为 16 的倍数)，自动防崩溃保护
        if channels == 16:
            eff_w = ((final_w + 15) // 16) * 16
            eff_h = ((final_h + 15) // 16) * 16
            latent_w = max(1, eff_w // 8)
            latent_h = max(1, eff_h // 8)
        else:
            latent_w = max(1, final_w // 8)
            latent_h = max(1, final_h // 8)

        if comfy is not None and hasattr(comfy, "model_management"):
            device = comfy.model_management.intermediate_device()
            dtype = comfy.model_management.intermediate_dtype()
        else:
            device = "cpu"
            dtype = torch.float32

        latent_tensor = torch.zeros([batch_size, channels, latent_h, latent_w], device=device, dtype=dtype)
        latent_dict = {"samples": latent_tensor, "downscale_ratio_spacial": 8}

        mp = (final_w * final_h) / 1_000_000.0
        info_summary = f"{ratio_text} | {final_w} × {final_h} ({tier_key}) | 约 {mp:.2f} MP"

        print(f"[喵小黑批量: 生图尺寸预设] -> {info_summary} (Latent: {channels}通道, Batch: {batch_size})")

        return (final_w, final_h, latent_dict, ratio_text)
