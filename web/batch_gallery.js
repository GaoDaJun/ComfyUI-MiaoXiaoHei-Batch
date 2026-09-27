/**
 * 喵小黑批量: 结果排队画廊 前端组件
 * 核心功能：
 * 1. 上半部分：5列 x 3行 (15格可视，超出平滑滚动) 结果队列小卡片，点击放大
 * 2. 下半部分：最新生成图实时自适应展示区 (根据 16:9 / 1:1 / 任意宽高比自适应居中，显示分辨率与序号)
 * 3. 完美避让上方的 filename_prefix / save_subfolder / current_index 等选项，彻底消除遮挡
 * 4. 高清大图灯箱预览，点击空白处自动隐藏
 */

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";
import { lightboxInstance } from "./lightbox_modal.js";

// 确保配套样式加载
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

const LOGO_URL = (typeof import.meta !== "undefined" && import.meta.url) 
  ? new URL("./miaoxiaohei_logo.svg", import.meta.url).href 
  : "/extensions/ComfyUI-Batch-Master/miaoxiaohei_logo.svg";

function isGalleryNode(node) {
  if (!node) return false;
  const c = node.comfyClass || node.type || "";
  const t = node.title || "";
  return c === "BatchResultGallery" || c === "喵小黑批量画廊" || 
         c.includes("BatchResultGallery") || 
         t.includes("图片结果") || t.includes("结果排队画廊") || t.includes("Result Gallery");
}

function setupGalleryNode(node) {
  if (!isGalleryNode(node)) return;
  if (node._bm_gallery_initialized) return;
  node._bm_gallery_initialized = true;

  // 规范化统一节点标题为「喵小黑批量：图片结果」
  if (!node.title || node.title === "BatchResultGallery" || node.title.includes("结果排队画廊") || node.title.includes("喵小黑批量")) {
    node.title = "喵小黑批量：图片结果";
  }

  // 仅隐藏内部控制且无需用户填写的 batch_id 和 original_filename
  // 保留 current_index, filename_prefix, save_subfolder 正常可见与操作
  const hideGalleryWidgets = () => {
    if (node.widgets) {
      for (const w of node.widgets) {
        if (w.name === "batch_id" || w.name === "original_filename") {
          w.type = "hidden";
          w.hidden = true;
          w.computeSize = () => [0, -4];
          w.draw = () => {};
        }
      }
    }
  };
  hideGalleryWidgets();

  const origGalleryConfigure = node.onConfigure;
  node.onConfigure = function() {
    const res = origGalleryConfigure ? origGalleryConfigure.apply(this, arguments) : undefined;
    hideGalleryWidgets();
    return res;
  };

  node.galleryItems = [];
  let latestItem = null;

  const container = document.createElement("div");
  container.className = "bm-gallery-container";

  container.innerHTML = `
    <!-- 顶部状态栏与清空/下载按钮 -->
    <div class="bm-gallery-top-bar">
      <div class="bm-progress-header" style="flex: 1; margin: 0; align-items: center;">
        <span style="font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; gap: 4px;">
          🖼️ <span>生成结果队列</span>
        </span>
        <span id="bm-gallery-total" style="color: #10b981; font-weight: bold; font-size: 11px;">0 / 50 张</span>
      </div>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button id="bm-gallery-clear" class="bm-btn bm-btn-reset bm-btn-compact" title="清空全部生成结果画廊">清空画廊</button>
        <button id="bm-gallery-download-all" class="bm-btn bm-btn-compact bm-btn-download-all" title="打包当前画廊中全部已生成的图片为 ZIP 文件下载">📦 下载全部</button>
      </div>
    </div>

    <!-- 上部：5列 x 3行 (15格可视) 结果队列小卡片网格 -->
    <div class="bm-grid-container bm-gallery-grid-fixed is-empty" id="bm-gallery-grid" tabindex="0">
      <div id="bm-gallery-empty" class="bm-empty-banner">
        <div class="bm-status-logo-wrap">
          <img class="bm-status-logo-img" src="${LOGO_URL}" alt="喵小黑" />
        </div>
        <div class="bm-empty-title">队列等待中</div>
        <div class="bm-empty-sub">每完成一张将在此处按 5x3 方格排队展示</div>
      </div>
    </div>

    <!-- 下部：最新生成结果实时自适应大图卡片 -->
    <div class="bm-latest-section">
      <div class="bm-latest-header">
        <div class="bm-latest-title">
          <span class="bm-latest-dot"></span>
          <span>最新生成预览</span>
          <span id="bm-latest-badge" class="bm-latest-badge" style="display: none;">#0</span>
        </div>
        <div id="bm-latest-meta" class="bm-latest-meta">等待任务生成</div>
      </div>

      <div class="bm-latest-viewport" id="bm-latest-viewport" title="点击呼出高清大图全屏预览">
        <!-- 占位空状态 (原列队等待中的图像图标改至此处) -->
        <div id="bm-latest-placeholder" class="bm-latest-empty">
          <div style="font-size: 30px; opacity: 0.85;">🖼️</div>
          <div style="font-size: 12px; font-weight: 600; color: #9ca3af; margin-top: 6px;">等待生成结果</div>
          <div style="font-size: 10px; color: #6b7280; margin-top: 2px;">实时按原图比例自适应呈现最新大图</div>
        </div>
        <!-- 实时自适应大图 -->
        <img id="bm-latest-preview-img" class="bm-latest-preview-img" style="display: none;" alt="最新生成结果" />
      </div>
    </div>
  `;

  // 挂载至 LiteGraph 节点
  const widget = node.addDOMWidget("batch_gallery_ui", "custom", container, {
    getValue() { return node.galleryItems; },
    setValue(v) { node.galleryItems = v || []; },
    getMinHeight() { return 300; },
    hideOnZoom: false,
    afterResize() {
      updateContainerDimensions();
    }
  });

  widget.computeLayoutSize = function() {
    return {
      minHeight: 280,
      maxHeight: 999999,
      minWidth: 0,
      maxWidth: 999999
    };
  };

  // 精准计算前面所有可见 widget 的占用高度，彻底避免遮挡任何上方选项
  const calculateWidgetsHeight = () => {
    let topOffset = 38; // 标题栏与 Slot 区域
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

    // 底部留白留出 12px 舒适边距，确保下框绝不被节点底边紧贴或裁剪
    const availableH = Math.max(280, node.size[1] - startY - 12);
    container.style.height = `${availableH}px`;
    container.style.width = "100%";
    container.style.maxWidth = "100%";
    container.style.boxSizing = "border-box";
  };

  widget.computeSize = function(width) {
    const currentW = (node && node.size && node.size[0] > 0) ? node.size[0] : (width || 520);
    widget.width = currentW;
    const startY = calculateWidgetsHeight();
    const h = (node && node.size && node.size[1] > 0) ? Math.max(280, node.size[1] - startY - 12) : 440;
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
    const minH = calculateWidgetsHeight() + 240;
    if (size[0] < 340) size[0] = 340;
    if (size[1] < minH) size[1] = minH;
    updateContainerDimensions();
    app.canvas?.setDirty(true, true);
  };

  // 严格同步节点灰色外框与内部画廊组件宽度，上下伸拉自如
  const syncNodeBounds = () => {
    const minAcceptableW = 520; // 与输入节点保持一致，宽裕大气
    const minAcceptableH = calculateWidgetsHeight() + 440; // 宽裕适中基准高度，完整容纳队列与大图预览
    let changed = false;
    if (!node.size) {
      node.size = [minAcceptableW, minAcceptableH];
      changed = true;
    } else {
      if (node.size[0] < minAcceptableW) {
        node.size[0] = minAcceptableW;
        changed = true;
      }
      // 如果此前因自动拉伸异常导致高度被撑得过大(例如大于 750px)，初始化时自动复位到正常的适中高度
      if (node.size[1] > 750) {
        node.size[1] = minAcceptableH;
        changed = true;
      } else if (node.size[1] < minAcceptableH) {
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

  // DOM 元素引用
  const grid = container.querySelector("#bm-gallery-grid");
  const totalEl = container.querySelector("#bm-gallery-total");
  const emptyEl = container.querySelector("#bm-gallery-empty");
  const clearBtn = container.querySelector("#bm-gallery-clear");

  const latestSection = container.querySelector(".bm-latest-section");
  const latestBadge = container.querySelector("#bm-latest-badge");
  const latestMeta = container.querySelector("#bm-latest-meta");
  const latestViewport = container.querySelector("#bm-latest-viewport");
  const latestPlaceholder = container.querySelector("#bm-latest-placeholder");
  const latestImg = container.querySelector("#bm-latest-preview-img");

  // 阻止小网格滚轮事件冒泡到画布，支持顺畅向下滚动至30排甚至更多海量历史结果
  grid.addEventListener("wheel", (e) => {
    e.stopPropagation();
  }, { passive: false });

  // 更新下方最新生成大图自适应视图
  const updateLatestPreview = (item, seqNum) => {
    if (!item || !item.url) return;
    latestItem = item;

    const num = seqNum || node.galleryItems.length;
    latestBadge.style.display = "inline-block";
    latestBadge.innerText = `#${num}`;
    latestMeta.innerText = "载入中...";

    latestPlaceholder.style.display = "none";
    latestImg.style.display = "block";
    latestImg.src = item.url;

    latestImg.onload = () => {
      const w = latestImg.naturalWidth;
      const h = latestImg.naturalHeight;
      if (w && h) {
        const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
        const divisor = gcd(w, h);
        const rW = Math.round(w / divisor);
        const rH = Math.round(h / divisor);
        let ratioStr = `${rW}:${rH}`;
        const ratio = w / h;
        if (Math.abs(ratio - 16 / 9) < 0.05) ratioStr = "16:9";
        else if (Math.abs(ratio - 9 / 16) < 0.05) ratioStr = "9:16";
        else if (Math.abs(ratio - 1) < 0.02) ratioStr = "1:1";
        else if (Math.abs(ratio - 3 / 2) < 0.05) ratioStr = "3:2";
        else if (Math.abs(ratio - 4 / 3) < 0.05) ratioStr = "4:3";

        latestMeta.innerText = `${w}×${h} (${ratioStr})`;
      } else {
        latestMeta.innerText = "已就绪";
      }
    };
  };

  // 点击下方最新大图，呼出灯箱全屏预览
  latestViewport.onclick = () => {
    if (latestItem && node.galleryItems.length > 0) {
      const pos = node.galleryItems.indexOf(latestItem);
      lightboxInstance.open(node.galleryItems, pos >= 0 ? pos : node.galleryItems.length - 1);
    }
  };

  // 清空画廊
  clearBtn.onclick = () => {
    node.galleryItems = [];
    latestItem = null;
    grid.innerHTML = "";
    if (emptyEl) {
      emptyEl.style.removeProperty("display");
      emptyEl.style.display = "flex";
      if (emptyEl.parentNode !== grid) {
        grid.appendChild(emptyEl);
      }
    }
    grid.classList.add("is-empty");
    totalEl.innerText = "0 / 50 张";

    latestBadge.style.display = "none";
    latestMeta.innerText = "等待任务生成";
    latestImg.style.display = "none";
    latestImg.src = "";
    latestPlaceholder.style.display = "flex";
  };

  // 打包全部下载 (ZIP)
  const downloadAllBtn = container.querySelector("#bm-gallery-download-all");
  if (downloadAllBtn) {
    downloadAllBtn.onclick = async (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      if (!node.galleryItems || node.galleryItems.length === 0) {
        alert("当前画廊中暂无生成的图片！");
        return;
      }

      const origText = downloadAllBtn.innerHTML;
      downloadAllBtn.disabled = true;
      downloadAllBtn.innerHTML = `<span>⏳ 打包中...</span>`;

      try {
        const batchName = node.galleryItems[0]?.subfolder?.split("/").pop() || "results";
        const zipFileName = `batch_${batchName}_${node.galleryItems.length}张.zip`;

        const resp = await fetch("/batch_master/download_zip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: node.galleryItems.map((it) => ({
              filename: it.filename,
              subfolder: it.subfolder,
              type: it.type || "output",
              file_path: it.file_path || ""
            })),
            zip_name: zipFileName
          })
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || resp.statusText);
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = zipFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[BatchResultGallery] 打包下载失败:", err);
        alert("打包下载失败: " + err.message);
      } finally {
        downloadAllBtn.disabled = false;
        downloadAllBtn.innerHTML = origText;
      }
    };
  }

  // 暴露给控制器的清空接口，在新批次开始时保证画廊纯净
  node._bm_clear_gallery = () => {
    clearBtn.click();
  };

  // 向队列追加结果卡片
  const appendItemToGallery = (item) => {
    grid.classList.remove("is-empty");
    if (emptyEl) {
      emptyEl.style.setProperty("display", "none", "important");
      emptyEl.style.display = "none";
      if (emptyEl.parentNode === grid) {
        grid.removeChild(emptyEl);
      }
    }

    const seqNumber = node.galleryItems.length + 1; // 严谨计算画廊中的自然递增编号，防止全显示#1

    // 严密对齐原图信息 (若后端未带 orig_url，自动从输入调度器当前批次文件按序号对齐)
    if (!item.orig_url) {
      const loaderNode = app.graph?._nodes?.find(n => {
        const c = n.comfyClass || n.type || "";
        const t = n.title || "";
        return c === "BatchImageLoader" || c === "喵小黑批量" || c === "喵小黑批量输入" || 
               c.includes("BatchImageLoader") || t.includes("图片输入") || t.includes("Batch Loader");
      });
      if (loaderNode && loaderNode.batchState?.files) {
        const origFile = loaderNode.batchState.files[seqNumber - 1];
        if (origFile) {
          item.orig_url = origFile.url;
          item.original_filename = origFile.filename;
        }
      }
    }

    node.galleryItems.push(item);
    totalEl.innerText = seqNumber <= 50 ? `${seqNumber} / 50 张` : `${seqNumber} 张 (已支持多排)`;

    // 1. 在结果网格中生成小方格卡片
    const cell = document.createElement("div");
    cell.className = "bm-grid-cell";
    cell.title = `点击放大预览 #${seqNumber}: ${item.filename}`;

    cell.innerHTML = `
      <span class="bm-cell-badge">#${seqNumber}</span>
      <img class="bm-grid-thumb" src="${item.url}" loading="lazy" alt="${item.filename}" />
    `;

    cell.onclick = () => {
      const itemPos = node.galleryItems.indexOf(item);
      lightboxInstance.open(node.galleryItems, itemPos >= 0 ? itemPos : 0);
    };

    grid.appendChild(cell);
    grid.scrollTop = grid.scrollHeight;

    // 2. 实时刷新下方自适应最新大图 (传递正确的递增序号)
    updateLatestPreview(item, seqNumber);
  };

  // 监听 WebSocket 生成完成事件 (双重严格校验：防止多浏览器标签页串流)
  api.addEventListener("batch_image_completed", (e) => {
    const data = e.detail;
    if (!data || !data.item) return;

    // 关键校验 1：校验 client_id，非当前浏览器标签页派发的任务直接拒绝
    if (data.client_id && api.clientId && data.client_id !== api.clientId) {
      return;
    }

    // 关键校验 2：校验 batch_id，必须与本画廊绑定的当前批次一致
    const nodeBatchId = node.widgets?.find(w => w.name === "batch_id")?.value;
    if (data.batch_id && nodeBatchId && data.batch_id !== nodeBatchId) {
      return;
    }

    // 查重防止重复追加
    const alreadyExists = node.galleryItems.some(item => item.filename === data.item.filename);
    if (!alreadyExists) {
      appendItemToGallery(data.item);
    }
  });

  // 执行结束钩子
  const onExecutedOriginal = node.onExecuted;
  node.onExecuted = function(output) {
    if (onExecutedOriginal) {
      onExecutedOriginal.apply(this, arguments);
    }
    // 关键：彻底压制并清空 ComfyUI 原生图像预览画布，防止节点底部渲染重复大图
    node.imgs = null;

    const results = output?.batch_results || output?.images;
    if (results && Array.isArray(results)) {
      results.forEach(img => {
        const viewUrl = img.url || `/view?filename=${img.filename}&subfolder=${img.subfolder || ''}&type=${img.type || 'output'}`;
        const alreadyExists = node.galleryItems.some(item => item.filename === img.filename);
        if (!alreadyExists) {
          appendItemToGallery({
            filename: img.filename,
            subfolder: img.subfolder,
            type: img.type,
            url: viewUrl,
            orig_url: img.orig_url || '',
            index: img.index || (node.galleryItems.length + 1),
            original_filename: img.original_filename || img.filename
          });
        }
      });
    }
  };
}

app.registerExtension({
  name: "BatchMaster.ResultGallery",

  nodeCreated(node) {
    if (isGalleryNode(node)) {
      node.title = "喵小黑批量：图片结果";
      setupGalleryNode(node);
    }
  },

  loadedGraphNode(node) {
    if (isGalleryNode(node)) {
      setupGalleryNode(node);
    }
  }
});
