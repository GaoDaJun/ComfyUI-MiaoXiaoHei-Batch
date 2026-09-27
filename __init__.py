"""
ComfyUI-Batch-Master
专用于批量逐张流式生图、队列防爆显存调度、随时暂停继续与结果排队画廊大图查看的自定义节点插件。
"""

import os
import sys

# 挂载 Web 静态目录，ComfyUI 前端会自动加载此目录下的 JS 与 CSS 文件
WEB_DIRECTORY = "./web"

from .nodes.batch_loader import BatchImageLoader
from .nodes.batch_gallery import BatchResultGallery
from .nodes.batch_resolution import BatchResolutionPreset
from .nodes.batch_export import BatchImageExport
from .nodes import server_routes

# 节点映射表 (输入调度器、结果排队画廊、生图尺寸预设、指定目录导出)
NODE_CLASS_MAPPINGS = {
    "BatchImageLoader": BatchImageLoader,
    "BatchResultGallery": BatchResultGallery,
    "BatchResolutionPreset": BatchResolutionPreset,
    "BatchImageExport": BatchImageExport,
}

# 节点在 ComfyUI 搜索菜单中的友好显示名称
NODE_DISPLAY_NAME_MAPPINGS = {
    "BatchImageLoader": "喵小黑批量：图片输入",
    "BatchResultGallery": "喵小黑批量：图片结果",
    "BatchResolutionPreset": "喵小黑批量：生图尺寸预设",
    "BatchImageExport": "喵小黑批量：指定目录导出",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
