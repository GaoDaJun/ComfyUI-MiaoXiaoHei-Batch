/**
 * 喵小黑批量: 图片输入与调度器 前端控制器
 * 核心功能：
 * 1. 5列 x 3行 (15格可视，超出50张纵向滚动) 的方格排版
 * 2. 粘贴 (Ctrl+V) 上传、拖拽上传、点击上传
 * 3. 动态末尾【+】加号格，达到 50 张自动消失
 * 4. 串行防爆显存驱动循环、暂停 / 继续 / 清空
 * 5. 点击方格大图预览、悬浮红色删除
 */

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { lightboxInstance } from "./lightbox_modal.js";

// 动态载入配套 5x3 网格样式表
(function loadBatchMasterStyles() {
  const cssId = "comfyui-batch-master-css";
  if (!document.getElementById(cssId)) {
    const link = document.createElement("link");
    link.id = cssId;
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = new URL("./batch_style.css", import.meta.url).href;
    document.head.appendChild(link);
  }
})();

function isLoaderNode(node) {
  if (!node) return false;
  const c = node.comfyClass || node.type || "";
  const t = node.title || "";
  return c === "BatchImageLoader" || c === "喵小黑批量" || c === "喵小黑批量输入" || 
         c === "ComfyUI-Batch-Master" || c.includes("BatchImageLoader") || 
         t.includes("图片输入") || t.includes("Batch Loader");
}

// ==========================================
// 全局批量输入调度器剪贴板路由管理器 (单例)
// 彻底解决多节点冲突、幽灵监听器拦截、Chrome文件管理器复制与截图识别
// ==========================================
const activeLoaderNodes = new Set();
let lastActiveLoaderNode = null;
let isGlobalPasteRegistered = false;

function resolveTargetLoaderNode() {
  const aliveNodes = Array.from(activeLoaderNodes).filter(n => n && n.graph && app.graph?._nodes?.includes(n));
  if (aliveNodes.length === 0) return null;

  // 1. 如果光标正悬停在某个输入调度器容器或其子元素上
  const hoveredNode = aliveNodes.find(n => n._bm_container && (n._bm_container.matches(":hover") || n._bm_container.contains(document.activeElement)));
  if (hoveredNode) return hoveredNode;

  // 2. 检查 ComfyUI 画布选中节点
  const sn = app.canvas?.selected_nodes;
  const selectedList = sn ? (Array.isArray(sn) ? sn : (typeof sn.values === "function" ? Array.from(sn.values()) : Object.values(sn))) : [];

  // 如果用户显式单选了原生 LoadImage 单图节点，则放行不拦截
  const hasExplicitLoadImage = selectedList.some(n => n && (n.comfyClass === "LoadImage" || n.type === "LoadImage"));
  if (hasExplicitLoadImage) return null;

  // 如果当前选中的就是某个存活的 BatchImageLoader
  const selectedLoader = aliveNodes.find(n => n.is_selected || selectedList.includes(n) || (sn && (sn[n.id] || sn[String(n.id)])));
  if (selectedLoader) return selectedLoader;

  // 3. 当前聚焦节点
  if (app.canvas?.current_node && aliveNodes.includes(app.canvas.current_node)) {
    return app.canvas.current_node;
  }

  // 4. 用户最近点击交互过的节点 (记忆)
  if (lastActiveLoaderNode && aliveNodes.includes(lastActiveLoaderNode)) {
    return lastActiveLoaderNode;
  }

  // 5. 默认交付给第一个存活的输入调度器 (彻底杜绝 ComfyUI 自动创建空白 LoadImage 节点)
  return aliveNodes[0];
}

async function extractImagesFromClipboard(e) {
  const clipboardData = e ? (e.clipboardData || window.clipboardData) : null;
  const filesToUpload = [];

  if (clipboardData) {
    // 1. 优先检查 items (截图、二进制数据流、QQ/微信截图)
    if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.startsWith("image/") || item.kind === "file") {
          const blob = item.getAsFile();
          if (blob && blob.size > 0) {
            let ext = "png";
            if (item.type.includes("jpeg") || item.type.includes("jpg")) ext = "jpg";
            else if (item.type.includes("webp")) ext = "webp";
            else if (item.type.includes("gif")) ext = "gif";
            else if (item.type.includes("bmp")) ext = "bmp";

            let name = blob.name || `paste_${Date.now()}_${i + 1}.${ext}`;
            if (!/\.(png|jpe?g|webp|bmp|tiff|gif)$/i.test(name)) {
              name = `${name}.${ext}`;
            }
            filesToUpload.push(new File([blob], name, { type: item.type || `image/${ext}` }));
          }
        }
      }
    }

    // 2. 如果 items 没提取到，检查 clipboardData.files (文件管理器桌面/文件夹 Ctrl+C 复制的图片)
    if (filesToUpload.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const f = clipboardData.files[i];
        if (f.size > 0 && (f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff|gif)$/i.test(f.name))) {
          let name = f.name || `image_${Date.now()}_${i + 1}.png`;
          if (!/\.(png|jpe?g|webp|bmp|tiff|gif)$/i.test(name)) {
            const ext = f.type.split("/")[1] || "png";
            name = `${name}.${ext}`;
          }
          filesToUpload.push(new File([f], name, { type: f.type || "image/png" }));
        }
      }
    }

    // 3. 检查 HTML 中的内联 base64 图片 (如网页复制的 rich content)
    if (filesToUpload.length === 0) {
      try {
        const html = clipboardData.getData("text/html");
        if (html && html.includes("<img")) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const imgs = doc.querySelectorAll("img");
          for (let i = 0; i < imgs.length; i++) {
            const src = imgs[i].src;
            if (src && src.startsWith("data:image/")) {
              const res = await fetch(src);
              const blob = await res.blob();
              if (blob && blob.size > 0) {
                const ext = blob.type.split("/")[1] || "png";
                filesToUpload.push(new File([blob], `paste_html_${Date.now()}_${i + 1}.${ext}`, { type: blob.type }));
              }
            }
          }
        }
      } catch (err) {}
    }
  }

  // 4. 异步系统剪贴板 API 兜底 (针对某些浏览器限制或点击粘贴按钮触发)
  if (filesToUpload.length === 0 && navigator.clipboard && typeof navigator.clipboard.read === "function") {
    try {
      const clipItems = await navigator.clipboard.read();
      for (let i = 0; i < clipItems.length; i++) {
        const item = clipItems[i];
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            if (blob && blob.size > 0) {
              let ext = type.split("/")[1] || "png";
              if (ext.includes("jpeg")) ext = "jpg";
              filesToUpload.push(new File([blob], `paste_sys_${Date.now()}_${i + 1}.${ext}`, { type }));
              break;
            }
          }
        }
      }
    } catch (e) {
      // 剪贴板未授权或无图片，静默跳过
    }
  }

  return filesToUpload;
}

function initGlobalPasteManager() {
  if (isGlobalPasteRegistered) return;
  isGlobalPasteRegistered = true;

  const handleGlobalPaste = async (e) => {
    // 1. 如果用户正在普通输入框或文本域中输入且纯粘贴文字，则放行
    if (document.activeElement && 
        (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") && 
        document.activeElement.id !== "bm-file-input") {
      const dt = e.clipboardData || window.clipboardData;
      const hasImage = (dt?.files?.length && Array.from(dt.files).some(f => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff|gif)$/i.test(f.name))) ||
                       (dt?.items?.length && Array.from(dt.items).some(it => it.type.startsWith("image/") || it.kind === "file"));
      if (!hasImage) return; // 正在输入文本框且无图片，放行纯文字粘贴
    }

    const targetNode = resolveTargetLoaderNode();
    if (!targetNode) return; // 无对应存活节点或用户显式选中了原生 LoadImage

    // 尝试提取剪贴板中的图片
    const files = await extractImagesFromClipboard(e);
    if (files && files.length > 0) {
      // 成功提取到图片：强力截断原生事件流，绝不让 ComfyUI 创建空白 LoadImage 节点
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (typeof targetNode._bm_handleUploadFiles === "function") {
        targetNode._bm_handleUploadFiles(files);
      }
    } else {
      // 如果光标在节点上，或者当前节点被选中，而剪贴板内没有图片数据，提示用户
      const isOverOrFocused = targetNode._bm_container && (targetNode._bm_container.matches(":hover") || targetNode._bm_container.contains(document.activeElement) || targetNode.is_selected);
      if (isOverOrFocused) {
        if (typeof targetNode._bm_setStatus === "function") {
          targetNode._bm_setStatus("⚠️ 剪贴板中未检测到图片 (请先截图或复制图片后再按 Ctrl+V)", "#f59e0b", 3000);
        }
      }
    }
  };

  // 全局最先截获事件 (useCapture: true)，杜绝一切冲突
  window.addEventListener("paste", handleGlobalPaste, true);
  document.addEventListener("paste", handleGlobalPaste, true);
}

function setupLoaderNode(node) {
  if (!isLoaderNode(node)) return;
  if (node._bm_controller_initialized) return;
  node._bm_controller_initialized = true;

  // 规范化统一节点标题为「喵小黑批量：图片输入」
  if (!node.title || node.title === "BatchImageLoader" || node.title.includes("图片输入与调度器") || node.title.includes("喵小黑批量")) {
    node.title = "喵小黑批量：图片输入";
  }

  // 彻底隐藏内部控制使用的 batch_id 与 image_index 输入框，并清空 draw 方法防止 LiteGraph 误绘制 0 ►
  const hideInternalWidgets = () => {
    if (node.widgets) {
      for (const w of node.widgets) {
        if (w.name === "batch_id" || w.name === "image_index") {
          w.type = "hidden";
          w.hidden = true;
          w.computeSize = () => [0, -4];
          w.draw = () => {};
        }
      }
    }
  };
  hideInternalWidgets();

  // 自动数据清洗与矫正 (防止因旧版本工作流反序列化导致控件值错位，如 auto_scale_mode 被填入 batch_id 等)
  const sanitizeWidgets = () => {
    if (!node.widgets) return;
    const autoScaleW = node.widgets.find(w => w.name === "auto_scale_mode");
    if (autoScaleW) {
      const validOptions = [
        "保持原尺寸 (Original)",
        "等比缩放 (长边 1024)",
        "等比缩放 (长边 1344 - 推荐FLUX)",
        "等比缩放 (长边 1536)",
        "等比缩放 (长边 2048)"
      ];
      if (!validOptions.includes(autoScaleW.value)) {
        autoScaleW.value = "保持原尺寸 (Original)";
      }
    }
    const customFolderW = node.widgets.find(w => w.name === "custom_folder");
    if (customFolderW && (typeof customFolderW.value === "number" || /^\d+$/.test(String(customFolderW.value).trim()))) {
      customFolderW.value = "";
    }
  };
  sanitizeWidgets();

  const origOnConfigure = node.onConfigure;
  node.onConfigure = function() {
    const res = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
    hideInternalWidgets();
    sanitizeWidgets();
    return res;
  };

  // 运行状态机
  node.batchState = {
    status: "IDLE", // IDLE | RUNNING | PAUSED | FINISHED
    batchId: "",
    files: [],
    currentIndex: 0,
    totalCount: 0,
    isExecutingStep: false,
    completedFilenames: new Set(),
    completedIndices: new Set(),
  };

  const ensureCompletedSets = () => {
    if (!node.batchState) return;
    if (!node.batchState.completedFilenames || typeof node.batchState.completedFilenames.has !== "function") {
      node.batchState.completedFilenames = new Set();
    }
    if (!node.batchState.completedIndices || typeof node.batchState.completedIndices.has !== "function") {
      node.batchState.completedIndices = new Set();
    }
  };
  ensureCompletedSets();

  // 如果前端当前没有图片，强制将 batchId 置空，绝不复用残留的历史批次
  if (!node.batchState.files || node.batchState.files.length === 0) {
    node.batchState.batchId = "";
    const bIdW = node.widgets?.find(w => w.name === "batch_id");
    if (bIdW) bIdW.value = "";
  } else {
    const existingBatchWidget = node.widgets?.find(w => w.name === "batch_id");
    if (existingBatchWidget && existingBatchWidget.value) {
      node.batchState.batchId = existingBatchWidget.value;
    }
  }

  // 构建 5x3 网格 DOM 容器
  const container = document.createElement("div");
  container.className = "bm-controller-container";

  container.innerHTML = `
    <input type="file" id="bm-file-input" multiple accept="image/*" style="display:none;" />

    <!-- 顶部状态栏与进度条 -->
    <div class="bm-progress-wrap">
      <div class="bm-progress-header">
        <span id="bm-status-text" class="bm-status-badge">⚪ 暂无图片 (请添加或粘贴)</span>
        <span id="bm-count-text" style="font-weight: bold; color: #10b981;">0 / 50</span>
      </div>
      <div class="bm-progress-bar-bg">
        <div id="bm-progress-fill" class="bm-progress-bar-fill"></div>
      </div>
    </div>

    <!-- 5列 x 3行 网格方格容器 -->
    <div class="bm-grid-container" id="bm-grid-container" tabindex="0" title="点击可激活，直接按 Ctrl+V 粘贴图片">
    </div>

    <!-- 控制调度按钮组 -->
    <div class="bm-button-group">
      <button id="bm-btn-start" class="bm-btn bm-btn-start">🚀 开始批量生成</button>
      <button id="bm-btn-pause" class="bm-btn bm-btn-pause" style="display:none;">⏸️ 暂停生成</button>
      <button id="bm-btn-resume" class="bm-btn bm-btn-resume" style="display:none;">▶️ 继续生成</button>
      <button id="bm-btn-reset" class="bm-btn bm-btn-reset">⏹️ 清空重置</button>
    </div>
  `;

  // 挂载至 LiteGraph 节点
  const widget = node.addDOMWidget("batch_controller_ui", "custom", container, {
    getValue() { return node.batchState.batchId; },
    setValue(v) { node.batchState.batchId = v; },
    getMinHeight() { return 290; },
    hideOnZoom: false,
    afterResize() {
      updateContainerDimensions();
    }
  });

  widget.computeLayoutSize = function() {
    return {
      minHeight: 260,
      maxHeight: 999999,
      minWidth: 0,
      maxWidth: 999999
    };
  };

  const calculateWidgetsHeight = () => {
    let topOffset = 38;
    if (node.widgets) {
      for (const w of node.widgets) {
        if (w === widget) break;
        if (w.type === "hidden" || w.type === "converted-widget" || w.hidden) continue;
        const s = w.computeSize ? w.computeSize(node.size?.[0] || 520) : [0, 26];
        const h = (s && s[1] > 0) ? s[1] : 26;
        topOffset += h + 6;
      }
    }
    return topOffset + 10;
  };

  const updateContainerDimensions = () => {
    if (!container || !node.size) return;
    const startY = calculateWidgetsHeight();
    const nodeW = node.size[0] || 520;
    widget.width = nodeW;

    const availableH = Math.max(260, node.size[1] - startY - 15);
    container.style.height = `${availableH}px`;
    container.style.width = "100%";
    container.style.maxWidth = "100%";
    container.style.boxSizing = "border-box";
  };

  widget.computeSize = function(width) {
    const currentW = (node && node.size && node.size[0] > 0) ? node.size[0] : (width || 520);
    widget.width = currentW;
    const startY = calculateWidgetsHeight();
    const h = (node && node.size && node.size[1] > 0) ? Math.max(260, node.size[1] - startY - 15) : 340;
    return [currentW, h];
  };

  const origDraw = widget.draw;
  widget.draw = function(ctx, n, widget_width, y, widget_height) {
    if (origDraw) origDraw.apply(this, arguments);
    updateContainerDimensions();
  };

  const origOnResize = node.onResize;
  node.onResize = function(size) {
    if (origOnResize) origOnResize.apply(this, arguments);
    const minH = calculateWidgetsHeight() + 260;
    if (size[0] < 340) size[0] = 340;
    if (size[1] < minH) size[1] = minH;
    updateContainerDimensions();
    app.canvas?.setDirty(true, true);
  };

  // 严格同步节点灰色外框与内部组件宽度，彻底杜绝右侧突出现象
  const syncNodeBounds = () => {
    const minAcceptableW = 520; // 宽裕大气默认宽度，与图二宽度完全一致
    const minAcceptableH = calculateWidgetsHeight() + 325;
    let changed = false;
    if (!node.size) {
      node.size = [minAcceptableW, minAcceptableH];
      changed = true;
    } else {
      if (node.size[0] < minAcceptableW) {
        node.size[0] = minAcceptableW;
        changed = true;
      }
      if (node.size[1] < minAcceptableH) {
        node.size[1] = minAcceptableH;
        changed = true;
      }
    }
    if (changed && typeof node.setSize === "function") {
      node.setSize([node.size[0], node.size[1]]);
      app.canvas?.setDirty(true, true);
    }
    updateContainerDimensions();
  };

  syncNodeBounds();
  setTimeout(syncNodeBounds, 50);
  setTimeout(syncNodeBounds, 300);

  // DOM 引用
  const fileInput = container.querySelector("#bm-file-input");
  const gridContainer = container.querySelector("#bm-grid-container");
  const statusText = container.querySelector("#bm-status-text");
  const countText = container.querySelector("#bm-count-text");
  const progressFill = container.querySelector("#bm-progress-fill");

  const btnStart = container.querySelector("#bm-btn-start");
  const btnPause = container.querySelector("#bm-btn-pause");
  const btnResume = container.querySelector("#bm-btn-resume");
  const btnPaste = container.querySelector("#bm-btn-paste");
  const btnReset = container.querySelector("#bm-btn-reset");

  // 状态文本辅助方法
  let statusTimeout = null;
  const setStatus = (text, color = "#9ca3af", autoRestoreMs = 0) => {
    if (statusTimeout) {
      clearTimeout(statusTimeout);
      statusTimeout = null;
    }
    statusText.innerText = text;
    statusText.style.color = color;
    if (autoRestoreMs > 0) {
      statusTimeout = setTimeout(() => {
        updateUIState();
      }, autoRestoreMs);
    }
  };

  // 激活状态与选中同步
  const activateNode = () => {
    lastActiveLoaderNode = node;
    node._is_last_active = true;
    node.is_selected = true;
    if (app.canvas && typeof app.canvas.selectNode === "function") {
      try { app.canvas.selectNode(node); } catch (e) {}
    }
  };

  // 手动触发粘贴或点击按钮读取剪贴板
  const triggerPasteAction = async () => {
    activateNode();
    setStatus("⏳ 正在读取系统剪贴板图片...", "#3b82f6");
    const files = await extractImagesFromClipboard(null);
    if (files && files.length > 0) {
      handleUploadFiles(files);
    } else {
      container.focus();
      gridContainer.focus();
      setStatus("💡 请先复制/截图，然后直接按键盘 Ctrl + V 粘贴", "#3b82f6", 3500);
    }
  };

  if (btnPaste) {
    btnPaste.onclick = () => {
      triggerPasteAction();
    };
  }

  // 渲染 5x3 方格
  const renderGrid = (autoScrollBottom = false) => {
    ensureCompletedSets();
    gridContainer.innerHTML = "";
    const files = node.batchState.files || [];
    const count = files.length;

    // 1. 空状态提示 (自动撑满整个网格区域，消除空白断层)
    if (count === 0) {
      gridContainer.classList.add("is-empty");
      const emptyBanner = document.createElement("div");
      emptyBanner.className = "bm-empty-banner";
      emptyBanner.innerHTML = `
        <div style="font-size: 28px; line-height: 1.2;">📁</div>
        <div class="bm-empty-title">暂无图片，请上传图片</div>
        <div class="bm-empty-sub">支持点击选择、拖拽图片到此处，或直接按 <b>Ctrl+V</b> 粘贴上传</div>
        <div class="bm-banner-actions">
          <button class="bm-banner-btn bm-banner-btn-upload" id="bm-banner-upload">📁 选择图片</button>
          <button class="bm-banner-btn bm-banner-btn-paste" id="bm-banner-paste">📋 粘贴图片</button>
        </div>
      `;
      const bannerUpload = emptyBanner.querySelector("#bm-banner-upload");
      if (bannerUpload) bannerUpload.onclick = (e) => { e.stopPropagation(); fileInput.click(); };
      const bannerPaste = emptyBanner.querySelector("#bm-banner-paste");
      if (bannerPaste) bannerPaste.onclick = (e) => { e.stopPropagation(); triggerPasteAction(); };
      emptyBanner.onclick = () => fileInput.click();
      gridContainer.appendChild(emptyBanner);
      return;
    }

    gridContainer.classList.remove("is-empty");

    // 2. 渲染已上传的图片方格
    files.forEach((file, index) => {
      const isDone = (node.batchState.completedFilenames && node.batchState.completedFilenames.has(file.filename)) || 
                     (node.batchState.completedIndices && node.batchState.completedIndices.has(index)) ||
                     (node.batchState.status === "FINISHED" && index < node.batchState.totalCount);
      const isRunning = node.batchState.status === "RUNNING" && node.batchState.currentIndex === index && !isDone;

      const cell = document.createElement("div");
      cell.className = "bm-grid-cell" + (isDone ? " is-done" : "") + (isRunning ? " is-running" : "");
      cell.title = `点击放大预览 #${index + 1}: ${file.filename}${isDone ? ' (已完成)' : ''}`;

      let statusBadgeHtml = "";
      if (isDone) {
        statusBadgeHtml = `<span class="bm-cell-done-badge" title="该图片已生成完成">✓ 已完成</span>`;
      } else if (isRunning) {
        statusBadgeHtml = `<span class="bm-cell-running-badge" title="当前正在生成此图">⚡ 生成中</span>`;
      }

      cell.innerHTML = `
        <span class="bm-cell-badge">#${index + 1}</span>
        <button class="bm-cell-del-btn" title="删除此张图片">✕</button>
        <img class="bm-grid-thumb" src="${file.url}" loading="lazy" alt="${file.filename}" />
        ${statusBadgeHtml}
      `;

      // 删除单张
      const delBtn = cell.querySelector(".bm-cell-del-btn");
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteFileByIndex(index);
      };

      // 点击放大预览
      cell.onclick = () => {
        lightboxInstance.open(files, index);
      };

      gridContainer.appendChild(cell);
    });

    // 3. 末尾动态加号格 (满 50 张时自动隐藏)
    if (count < 50) {
      const addCell = document.createElement("div");
      addCell.className = "bm-grid-add-cell";
      addCell.title = `点击继续添加图片，或按 Ctrl+V 粘贴 (当前 ${count}/50)`;
      addCell.innerHTML = `
        <span class="bm-add-icon">+</span>
        <span class="bm-add-text">继续上传</span>
      `;
      addCell.onclick = () => fileInput.click();
      gridContainer.appendChild(addCell);
    }

    if (autoScrollBottom) {
      setTimeout(() => {
        gridContainer.scrollTop = gridContainer.scrollHeight;
      }, 50);
    }
  };

  // 阻止滚轮冒泡到 ComfyUI 画布，确保 3 排之后可顺畅上下滚动
  gridContainer.addEventListener("wheel", (e) => {
    e.stopPropagation();
  }, { passive: false });

  // 删除单张图片
  const deleteFileByIndex = async (index) => {
    const file = node.batchState.files[index];
    if (!file) return;

    try {
      const resp = await fetch("/batch_workflow/delete_image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: node.batchState.batchId,
          filename: file.filename
        })
      });
      const res = await resp.json();
      if (res.success) {
        node.batchState.files = res.files;
        node.batchState.totalCount = res.total;
        node.batchState.completedFilenames.delete(file.filename);
        if (res.total === 0) {
          node.batchState.batchId = "";
          const bIdW = node.widgets?.find(w => w.name === "batch_id");
          if (bIdW) bIdW.value = "";
          node.batchState.currentIndex = 0;
          node.batchState.status = "IDLE";
        } else if (node.batchState.currentIndex >= res.total) {
          node.batchState.currentIndex = Math.max(0, res.total - 1);
        }
        updateUIState();
        renderGrid();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 更新进度与状态
  const updateUIState = () => {
    const state = node.batchState;
    const total = state.totalCount;
    const cur = state.currentIndex;

    countText.innerText = `${cur} / ${total} (上限 50)`;
    const percent = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
    progressFill.style.width = `${percent}%`;

    if (state.status === "IDLE") {
      btnStart.style.display = "inline-flex";
      btnPause.style.display = "none";
      btnResume.style.display = "none";
      btnStart.disabled = total === 0;
      statusText.innerText = total > 0 ? `🟢 已就绪 (共 ${total} 张)` : "⚪ 暂无图片 (请添加或粘贴)";
      statusText.style.color = total > 0 ? "#10b981" : "#9ca3af";
    } else if (state.status === "RUNNING") {
      btnStart.style.display = "none";
      btnPause.style.display = "inline-flex";
      btnResume.style.display = "none";
      statusText.innerText = `⚡ 正在生成第 ${cur + 1} / ${total} 张...`;
      statusText.style.color = "#3b82f6";
    } else if (state.status === "PAUSED") {
      btnStart.style.display = "none";
      btnPause.style.display = "none";
      btnResume.style.display = "inline-flex";
      statusText.innerText = `⏸️ 已暂停在第 ${cur} / ${total} 张`;
      statusText.style.color = "#f59e0b";
    } else if (state.status === "FINISHED") {
      btnStart.style.display = "inline-flex";
      btnPause.style.display = "none";
      btnResume.style.display = "none";
      statusText.innerText = `🎉 批量生成全部完成！共 ${total} 张`;
      statusText.style.color = "#10b981";
    }
  };

  // 上传图片处理 (支持拖拽/点击/Ctrl+V 粘贴累加)
  const handleUploadFiles = async (files) => {
    if (!files || files.length === 0) return;

    ensureCompletedSets();
    const currentCount = node.batchState.files ? node.batchState.files.length : 0;
    if (currentCount >= 50) {
      alert("已达到 50 张图片上限，如需添加请先删除部分图片或清空。");
      return;
    }

    const availableSlots = 50 - currentCount;
    let filesToUpload = Array.from(files);
    if (filesToUpload.length > availableSlots) {
      alert(`本次添加超出 50 张上限，已自动保留前 ${availableSlots} 张。`);
      filesToUpload = filesToUpload.slice(0, availableSlots);
    }

    statusText.innerText = `⏳ 正在载入 ${filesToUpload.length} 张图片中...`;
    statusText.style.color = "#3b82f6";

    // 核心逻辑判定：
    // 如果当前已有图片 (currentCount > 0) 且有已有 batchId，则属于【增量追加】，携带已有 batch_id；
    // 如果当前没有图片 (currentCount === 0)，说明是全新的新批次，绝不携带旧 batch_id，让后端创建全新的 batch 目录！
    const isAppending = currentCount > 0 && !!node.batchState.batchId;
    const formData = new FormData();
    if (isAppending) {
      formData.append("batch_id", node.batchState.batchId);
    }
    for (let i = 0; i < filesToUpload.length; i++) {
      formData.append("files", filesToUpload[i]);
    }

    try {
      const resp = await fetch("/batch_workflow/upload", {
        method: "POST",
        body: formData
      });
      const res = await resp.json();
      if (res.success) {
        const wasRunning = node.batchState.status === "RUNNING";
        const wasPaused = node.batchState.status === "PAUSED";
        const wasFinished = node.batchState.status === "FINISHED";

        node.batchState.batchId = res.batch_id;
        node.batchState.files = res.files;
        node.batchState.totalCount = res.total;

        const batchIdWidget = node.widgets?.find(w => w.name === "batch_id");
        if (batchIdWidget) batchIdWidget.value = res.batch_id;

        if (wasRunning) {
          // 转换中追加：绝不中断当前执行任务，状态持续保持 RUNNING，currentIndex 绝不改变，已完成的不受影响
          statusText.innerText = `⚡ 正在生成第 ${node.batchState.currentIndex + 1} / ${res.total} 张 (已在末尾追加 ${filesToUpload.length} 张新图)...`;
        } else if (wasPaused) {
          // 暂停中追加：保持暂停状态
          statusText.innerText = `⏸️ 已暂停在第 ${node.batchState.currentIndex} / ${res.total} 张 (已追加新图)`;
        } else if (wasFinished) {
          // 之前全部完成，现在在末尾追加了新图片：转为就绪待开始
          // currentIndex 定位到第一张新未生成图片 (即追加前的旧总数位置)
          node.batchState.status = "IDLE";
          node.batchState.currentIndex = currentCount;
          statusText.innerText = `🟢 已在末尾追加 ${filesToUpload.length} 张新图，就绪待转换`;
          statusText.style.color = "#10b981";
        } else {
          // 初始空闲状态 (全新批次)
          node.batchState.currentIndex = 0;
          node.batchState.status = "IDLE";
          ensureCompletedSets();
          node.batchState.completedIndices?.clear();
          node.batchState.completedFilenames?.clear();
          const idxWidget = node.widgets?.find(w => w.name === "image_index");
          if (idxWidget) idxWidget.value = 0;
        }

        updateUIState();
        renderGrid(true); // 自动平滑滚动到底部显示新追加在末尾的图片
      } else {
        alert(`上传失败: ${res.error}`);
        statusText.innerText = `❌ 上传失败`;
      }
    } catch (err) {
      console.error(err);
      alert(`上传出错: ${err.message}`);
    }
  };

  // 拖拽支持 (阻止向 ComfyUI 主画布冒泡)
  gridContainer.ondragover = (e) => {
    e.preventDefault();
    e.stopPropagation();
    gridContainer.classList.add("dragover");
  };

  gridContainer.ondragleave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    gridContainer.classList.remove("dragover");
  };

  gridContainer.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    gridContainer.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  fileInput.onchange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files);
      fileInput.value = "";
    }
  };

  // 注册并维护全局单例活跃节点管理器
  activeLoaderNodes.add(node);
  node._bm_container = container;
  node._bm_handleUploadFiles = handleUploadFiles;
  node._bm_setStatus = setStatus;

  // 卸载与清理 (当节点在画布被删除时，及时从管理器中剔除)
  const origOnRemoved = node.onRemoved;
  node.onRemoved = function() {
    activeLoaderNodes.delete(node);
    if (lastActiveLoaderNode === node) lastActiveLoaderNode = null;
    if (origOnRemoved) origOnRemoved.apply(this, arguments);
  };

  // 激活状态与焦点记忆维护
  container.setAttribute("tabindex", "0");
  container.addEventListener("pointerdown", activateNode);
  container.addEventListener("focus", activateNode);
  gridContainer.addEventListener("pointerdown", activateNode);

  // 初始化全局剪贴板路由器 (仅注册一次全局最高优先级监听器)
  initGlobalPasteManager();

  // 实现 ComfyUI 原生节点的 pasteFile / pasteFiles 接口作为双保险
  node.previewMediaType = "image";
  node.pasteFile = (file) => {
    if (file) handleUploadFiles([file]);
  };
  node.pasteFiles = (files) => {
    if (files && files.length > 0) handleUploadFiles(files);
  };

  // 逐张串行驱动引擎 (Sequential Queue Loop)
  const dispatchNextStep = () => {
    const state = node.batchState;
    if (state.status !== "RUNNING") return;

    if (state.currentIndex >= state.totalCount) {
      state.status = "FINISHED";
      updateUIState();
      return;
    }

    const idxWidget = node.widgets.find(w => w.name === "image_index");
    if (idxWidget) {
      idxWidget.value = state.currentIndex;
    }

    const currentFile = state.files[state.currentIndex];
    const currentOrigFilename = currentFile ? currentFile.filename : "";

    // 核心联动：将当前批次ID、原图文件名与自然递增序号实时同步至画布中的 BatchResultGallery 画廊节点
    const galleryNodes = app.graph?._nodes?.filter(n => {
      const c = n.comfyClass || n.type || "";
      const t = n.title || "";
      return c === "BatchResultGallery" || c === "喵小黑批量画廊" || 
             c.includes("BatchResultGallery") || 
             t.includes("结果排队画廊") || t.includes("Result Gallery");
    }) || [];

    for (const gNode of galleryNodes) {
      if (gNode.widgets) {
        const bIdW = gNode.widgets.find(w => w.name === "batch_id");
        if (bIdW) bIdW.value = state.batchId;

        const origW = gNode.widgets.find(w => w.name === "original_filename");
        if (origW) origW.value = currentOrigFilename;

        const curIdxW = gNode.widgets.find(w => w.name === "current_index");
        if (curIdxW) curIdxW.value = state.currentIndex + 1;
      }
    }

    state.isExecutingStep = true;
    updateUIState();
    renderGrid(); // 刷新网格，让当前正在生成的图片显示【⚡ 生成中】
    app.queuePrompt(0);
  };

  // 监听 WebSocket 生成完成事件，自动触发下一张
  api.addEventListener("batch_image_completed", (e) => {
    const state = node.batchState;
    if (state.status === "RUNNING") {
      state.isExecutingStep = false;

      // 核心：标记刚完成的原图为已完成 (按文件名和索引双重记录)
      const finishedFile = state.files[state.currentIndex];
      if (finishedFile) {
        state.completedFilenames.add(finishedFile.filename);
      }
      state.completedIndices.add(state.currentIndex);

      state.currentIndex += 1;

      if (state.currentIndex < state.totalCount) {
        updateUIState();
        renderGrid(); // 立即重新渲染网格，在左下角实时打上【✓ 已完成】
        setTimeout(() => {
          dispatchNextStep();
        }, 150);
      } else {
        state.status = "FINISHED";
        for (let i = 0; i < state.totalCount; i++) {
          state.completedIndices.add(i);
          if (state.files[i]) state.completedFilenames.add(state.files[i].filename);
        }
        updateUIState();
        renderGrid(); // 全部生成完成，原图全部打上【✓ 已完成】
      }
    } else if (state.status === "PAUSED") {
      state.isExecutingStep = false;
      const finishedFile = state.files[state.currentIndex];
      if (finishedFile) {
        state.completedFilenames.add(finishedFile.filename);
      }
      state.completedIndices.add(state.currentIndex);
      state.currentIndex += 1;
      updateUIState();
      renderGrid();
    }
  });

  // 按钮交互
  btnStart.onclick = () => {
    if (node.batchState.totalCount === 0) {
      alert("请先上传或粘贴要批量生成的图片！");
      return;
    }
    ensureCompletedSets();
    // 如果已经达到或超出了总数，说明之前这批图片全部完成了，用户再次点击“开始”表示希望从第1张重新跑
    if (node.batchState.currentIndex >= node.batchState.totalCount) {
      node.batchState.currentIndex = 0;
      node.batchState.completedIndices.clear();
      node.batchState.completedFilenames.clear();
    }
    // 若在已完成部分图后又追加了新图 (如 currentIndex=5, totalCount=7)，保留已完成状态，直接从第6张新图启动！
    node.batchState.status = "RUNNING";
    updateUIState();
    renderGrid();
    dispatchNextStep();
  };

  btnPause.onclick = () => {
    if (node.batchState.status === "RUNNING") {
      node.batchState.status = "PAUSED";
      updateUIState();
      renderGrid();
    }
  };

  btnResume.onclick = () => {
    if (node.batchState.status === "PAUSED") {
      node.batchState.status = "RUNNING";
      updateUIState();
      renderGrid();
      dispatchNextStep();
    }
  };

  btnReset.onclick = () => {
    if (node.batchState.status === "RUNNING") {
      if (!confirm("当前正在批量生成中，确定要中断并清空吗？")) return;
      try { api.interrupt(); } catch (e) {}
    }

    // 通知服务端清理磁盘临时批次目录，释放磁盘空间
    const oldBatchId = node.batchState.batchId;
    if (oldBatchId) {
      fetch("/batch_workflow/clear_batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: oldBatchId })
      }).catch(err => console.error("清理旧批次失败:", err));
    }

    // 彻底重置前端状态机，还原成全新未初始化的空白状态
    node.batchState.status = "IDLE";
    node.batchState.batchId = "";
    node.batchState.files = [];
    node.batchState.totalCount = 0;
    node.batchState.currentIndex = 0;
    ensureCompletedSets();
    node.batchState.completedIndices.clear();
    node.batchState.completedFilenames.clear();

    const batchIdWidget = node.widgets?.find(w => w.name === "batch_id");
    if (batchIdWidget) batchIdWidget.value = "";
    const idxWidget = node.widgets?.find(w => w.name === "image_index");
    if (idxWidget) idxWidget.value = 0;

    updateUIState();
    renderGrid();
  };

  updateUIState();
  renderGrid();
}

app.registerExtension({
  name: "BatchMaster.ImageLoaderController",

  init() {
    // 保持对旧保存工作流别名的静默兼容，不在搜索菜单重复出现
    if (window.LiteGraph && LiteGraph.registered_node_types) {
      if (LiteGraph.registered_node_types["BatchImageLoader"]) {
        LiteGraph.registered_node_types["喵小黑批量"] = LiteGraph.registered_node_types["BatchImageLoader"];
        LiteGraph.registered_node_types["喵小黑批量输入"] = LiteGraph.registered_node_types["BatchImageLoader"];
        LiteGraph.registered_node_types["喵小黑批量：图片输入"] = LiteGraph.registered_node_types["BatchImageLoader"];
        LiteGraph.registered_node_types["喵小黑批量: 图片输入与调度器 (5x3网格)"] = LiteGraph.registered_node_types["BatchImageLoader"];
        LiteGraph.registered_node_types["喵小黑批量: 图片输入与调度器 (5×3网格)"] = LiteGraph.registered_node_types["BatchImageLoader"];
      }
      if (LiteGraph.registered_node_types["BatchResultGallery"]) {
        LiteGraph.registered_node_types["喵小黑批量画廊"] = LiteGraph.registered_node_types["BatchResultGallery"];
        LiteGraph.registered_node_types["喵小黑批量：图片结果"] = LiteGraph.registered_node_types["BatchResultGallery"];
        LiteGraph.registered_node_types["喵小黑批量: 结果排队画廊 (5x3网格)"] = LiteGraph.registered_node_types["BatchResultGallery"];
        LiteGraph.registered_node_types["喵小黑批量: 结果排队画廊 (5×3网格)"] = LiteGraph.registered_node_types["BatchResultGallery"];
      }
    }
  },

  nodeCreated(node) {
    if (isLoaderNode(node)) {
      node.title = "喵小黑批量：图片输入";
      setupLoaderNode(node);
    }
  },

  loadedGraphNode(node) {
    if (isLoaderNode(node)) {
      setupLoaderNode(node);
    }
  }
});
