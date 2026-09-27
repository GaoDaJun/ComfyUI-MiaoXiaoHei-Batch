# ComfyUI-Batch-Master: 批量逐张流式生图与结果排队画廊插件

专为 ComfyUI 打造的**批量生产力自定义插件节点**。解决多图批量输入时**爆显存（CUDA OOM）**、**无法随时暂停/继续**、**难以直观对比和预览大量生成结果**的痛点。

---

## ✨ 核心特性

1. **批量导入与扫描（灵活支持 1 ~ 50 张）**
   - **拖拽 / 点击多选 / Ctrl+V 剪贴板粘贴**：无论是单张测试，还是 10 张、30 张、50 张批量生成，均支持直接拖拽、文件多选或直接使用 `Ctrl+V` 粘贴剪贴板中的图片/截图。
   - **本地目录免上传直读**：支持直接输入电脑本地文件夹路径（如 `D:/my_photos`），秒级扫描，省去重复上传时间。
2. **逐张串行驱动（Sequential Queue Dispatcher）**
   - 绝不一次性将 50 张图片打包塞给模型，而是**跑完一张、显存释放完毕后，自动触发下一张**。
   - 无论多大的批次，显存占用恒定等于“单张生成”的开销，**彻底告别 FLUX / SDXL 显存爆炸（OOM）**。
3. **随时暂停（Pause）与断点继续（Resume）**
   - 随时点击 `【⏸️ 暂停生成】`：当前正在跑的一张完成后安全挂起，保留进度（如停在 `16/50`）。
   - 随时点击 `【▶️ 继续生成】`：从第 17 张无缝接着跑，无需从头重来。
4. **结果流式排队画廊（Result Gallery）**
   - 结束节点内置现代化暗色画廊面板，每生成完一张，立即按序号 `#1`、`#2`、`#3`... 实时挨个追加排在末尾。
   - 自动按批次规整保存至 `ComfyUI/output/batch_results/<batch_id>/`。
5. **点击呼出高清大图灯箱（Lightbox Modal）**
   - **点击任意卡片**：弹出全屏/居中高清大图查看。
   - **滚轮缩放与平移**：支持 0.2x ~ 6.0x 无级滚轮缩放，按住鼠标拖拽平移局部细节。
   - **长按对比原图**：按住 `【🔍 长按对比原图】` 按钮，画面即刻切换回原始输入图，松开即切回生成图，细节变化一目了然！
   - **快捷键**：支持键盘 `←` / `→` 左右切图，`ESC` 退出。
6. **模型超强通用兼容**
   - 同时输出标准单张 `IMAGE`（Tensor `[1, H, W, C]`）、`MASK`、`image_path`（绝对路径字符串）、`filename`、`batch_id`、`index`。
   - **FLUX**：直接连入 VAE Encode / Redux / Pulid / ControlNet。
   - **通义千问**：直接将 `image_path` 连入 Qwen-VL API 或本地视觉语言大模型节点。

---

## 📦 安装方法

1. 将当前文件夹复制到你的 ComfyUI 自定义节点目录下，建议重命名为 `ComfyUI-Batch-Master`：
   ```
   ComfyUI/
   └── custom_nodes/
       └── ComfyUI-Batch-Master/
           ├── __init__.py
           ├── nodes/
           ├── web/
           └── README.md
   ```
2. 重启 ComfyUI。
3. 在 ComfyUI 画布空白处右键搜索或双击添加以下两个节点：
   - `⚡ 批量图片输入与调度器 (Batch Loader & Controller)`
   - `🖼️ 批量结果排队画廊 (Batch Result Gallery)`

---

## 🔌 工作流连线指南

### 1. 通用连接拓扑（以 FLUX / SD 图生图为例）

```
[ ⚡ Batch Loader & Controller (批量输入节点) ]
  ├── (image) ---------------> [ VAE Encode (输入像素图) ] ----> [ FLUX 采样流程 ]
  ├── (batch_id) ------------> [ 🖼️ Batch Result Gallery ] (batch_id)
  ├── (filename) ------------> [ 🖼️ Batch Result Gallery ] (original_filename)
  └── (index) ---------------> [ 🖼️ Batch Result Gallery ] (current_index)
                                           ▲
  [ FLUX 采样器/VAE Decode ] (IMAGE) -------┘ (images)
```

### 2. 通义千问（Qwen-VL / API 识别与生图）工作流连接

```
[ ⚡ Batch Loader & Controller (批量输入节点) ]
  ├── (image_path) ----------> [ 通义千问视觉识别节点 / API 节点 ] (image_url/path)
  │                                    │ (识别/改写后的 Prompt)
  │                                    ▼
  │                            [ CLIP Text Encode / FLUX 文本输入 ]
  └── (batch_id / index) ----> [ 🖼️ Batch Result Gallery ]
```

---

## 🚀 极简操作步骤

1. **导入图片（1 ~ 50 张）**：
   - **方式 A（拖拽 / 多选 / 粘贴）**：直接将 1~50 张图片拖入节点，或点击虚线框多选，或在节点激活时直接按 `Ctrl+V` 粘贴图片或截图。
   - **方式 B（本地路径直读）**：在输入框粘贴电脑上的图片文件夹路径，点击 `【扫描目录】`。
2. **启动**：
   - 连好你的模型工作流后，点击输入节点上的 `【🚀 开始批量生成】` 按钮。
3. **监控与暂停**：
   - 进度条会实时推进（如 `12 / 50`）。
   - 随时可点击 `【⏸️ 暂停生成】`，当前张跑完即停；点击 `【▶️ 继续生成】` 恢复。
4. **查看与对比大图**：
   - 在后端的 `BatchResultGallery` 节点中，生成好的卡片会一张接一张排列出来。
   - 点击任何一张，呼出灯箱弹窗，滚轮放大查看瑕疵，长按对比原图效果。
