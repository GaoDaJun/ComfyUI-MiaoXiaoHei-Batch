# 🐱 喵小黑批量生图工作流套件 (ComfyUI-MiaoXiaoHei-Batch)

专为 ComfyUI 深度定制的**工业级批量生产力节点套件**。彻底解决多图批量输入时**爆显存（CUDA OOM）**、**无法随时暂停/继续**、**多浏览器标签页串图混杂**、**难以直观对比细节**以及**生图尺寸比例换算繁琐**的痛点。

完美适配 **FLUX**、**通义千问 (Qwen-Image / Qwen-VL)**、**SDXL**、**SD1.5** 等主流模型。

---

## 📥 安装与拉取指南 (Installation)

### 选项 A：Git 一键克隆拉取（推荐 ⭐⭐⭐⭐⭐）

打开终端（Windows 推荐 PowerShell 或 CMD，Mac/Linux 打开 Terminal），依次执行以下两步命令：

#### 第一步：进入 ComfyUI 的 `custom_nodes` 插件目录
```bash
# 请将下方路径替换为您电脑上的 ComfyUI 实际安装路径
cd /d "F:/ComfyUI-aki-v3/ComfyUI/custom_nodes"

# 如果是标准便携包（Portable），路径通常类似：
# cd /d "D:/ComfyUI_windows_portable/ComfyUI/custom_nodes"
```

#### 第二步：执行 Git Clone 拉取仓库
```bash
git clone https://github.com/GaoDaJun/ComfyUI-MiaoXiaoHei-Batch.git
```

拉取完成后，目录结构如下：
```text
ComfyUI/
└── custom_nodes/
    └── ComfyUI-MiaoXiaoHei-Batch/
        ├── __init__.py
        ├── nodes/
        │   ├── batch_loader.py
        │   ├── batch_gallery.py
        │   └── batch_resolution.py
        ├── web/
        │   ├── batch_controller.js
        │   ├── batch_gallery.js
        │   ├── batch_resolution.js
        │   ├── lightbox_modal.js
        │   └── batch_style.css
        └── README.md
```

#### 第三步：重启 ComfyUI
启动或重启 ComfyUI 内核，在画布右键搜索 `喵小黑` 即可开始使用！

---

### 🔄 后续如何一键拉取最新更新 (Git Pull)

当插件发布新特性或修复更新时，您无需重新下载，只需在终端中进入该插件目录并执行 `git pull`：

```bash
# 1. 进入插件目录
cd /d "F:/ComfyUI-aki-v3/ComfyUI/custom_nodes/ComfyUI-MiaoXiaoHei-Batch"

# 2. 拉取最新更新
git pull
```
重启 ComfyUI，即可享用最新功能！

---

### 选项 B：通过 ComfyUI-Manager (管理器) 安装

1. 在 ComfyUI 界面打开 **Manager**（管理器面板）。
2. 点击 **Install via Git URL**（通过 Git URL 安装）。
3. 在输入框粘贴本仓库链接：
   ```text
   https://github.com/GaoDaJun/ComfyUI-MiaoXiaoHei-Batch.git
   ```
4. 点击确定安装，安装完成后点击 **Restart** 重启 ComfyUI。

---

## ✨ 三大核心节点介绍

### 1. ⚡ 喵小黑批量：图片输入与调度器 (`BatchImageLoader`)
- **超强大输入网格**：5 列 × 3 行方格排版（支持 1 ~ 50 张图片导入），超出 50 张自动纵向滚动。
- **全方位导入体验**：支持**文件拖拽**、**点击虚线框批量多选**、**Ctrl+V 剪贴板快速粘贴**（网页截图、剪切板文件无缝直入），以及**本地文件夹路径免上传秒级扫描**。
- **逐张串行驱动（Sequential Dispatcher）**：彻底杜绝打包 50 张塞给模型导致的显存爆炸（CUDA OOM），跑完一张、显存释放完毕后才调度下一张，**显存开销恒定等于跑单张**。
- **随时暂停与断点续跑**：随时点击 `【⏸️ 暂停生成】`，跑完当前张安全挂起；随时点击 `【▶️ 继续生成】` 接着跑，进度绝不丢失。
- **多标签页深度隔离**：基于 `client_id` 与 `batch_id` 双重隔离，支持在同一浏览器开启多个标签页独立跑不同工作流，互不干扰、绝不串图！

### 2. 🖼️ 喵小黑批量：排队画廊与对比 (`BatchResultGallery`)
- **流式排队画廊**：每生成完一张，立即按序号 `#1`、`#2`、`#3`... 实时追加排在末尾。
- **点击呼出高清大图灯箱（Lightbox Modal）**：
  - 点击任意卡片弹出全屏/居中高清视窗。
  - **滚轮无级缩放**（0.2x ~ 6.0x）与鼠标拖拽平移，细查睫毛与毛发细节。
  - **长按对比原图**：按住 `【🔍 长按对比原图】` 瞬间切换回原图，松开切回生成图，瑕疵与风格迁移效果一览无余。
  - 支持键盘 `←` / `→` 键切图、`ESC` 键关闭。
- **自动归档**：自动按批次保存至 `ComfyUI/output/batch_results/<batch_id>/`。

### 3. 📐 喵小黑批量：生图尺寸预设 (`BatchResolutionPreset`)
- **17 种黄金画幅比例**：1:1、3:2、2:3、4:3、3:4、4:5、5:4、16:9、9:16、21:9、2:1、1:2、3:1、1:3、4:1、1:4 及自定义全画幅。
- **三大主流清晰度档位**：1K（常用基准）、1.5K（高清进阶）、2K（大一倍超清），极窄比例短边自动采用安全尺寸防显存溢出。
- **一键横竖屏翻转**：一键长宽对调，并配有实时比例矩形微缩预览。
- **内置空 Latent 直接输出**：支持 FLUX/SD3（16 通道）与 SDXL/SD1.5/千问（4 通道），无需额外串联 EmptyLatent 节点。
- **终极防拦截机制（VALIDATE_INPUTS）**：注入 ComfyUI 官方免检通行证，彻底杜绝历史工作流在“无/原生”选项下的各种无效输入拦截报错。

---

## 🔌 典型工作流连接指南

### 1. 通用连接拓扑（FLUX / SDXL / SD1.5 图生图）

```text
[ ⚡ 喵小黑批量：图片输入与调度器 ]
  ├── (image) -------------> [ VAE Encode (输入像素图) ] ----> [ KSampler 采样流程 ]
  ├── (batch_id) ----------> [ 🖼️ 喵小黑批量：排队画廊 ] (batch_id)
  ├── (filename) ----------> [ 🖼️ 喵小黑批量：排队画廊 ] (original_filename)
  └── (index) -------------> [ 🖼️ 喵小黑批量：排队画廊 ] (current_index)
                                           ▲
  [ VAE Decode ] (IMAGE) ------------------┘ (images)
```

### 2. 通义千问视觉大模型（Qwen-VL / API 识别与生图）

```text
[ ⚡ 喵小黑批量：图片输入与调度器 ]
  ├── (image_path) --------> [ 通义千问视觉识别节点 / API 节点 ] (image_url/path)
  │                                    │ (识别/改写后的 Prompt)
  │                                    ▼
  │                            [ CLIP 文本编码器 / 生图模型 ]
  └── (batch_id / index) --> [ 🖼️ 喵小黑批量：排队画廊 ]
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
欢迎 Star、Fork 与提 Issue 建议！
