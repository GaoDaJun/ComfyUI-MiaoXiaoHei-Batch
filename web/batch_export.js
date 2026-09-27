/**
 * 喵小黑批量：指定目录导出 前端专属界面控制器
 * 界面风格 1:1 像素级复刻极简深色高级卡片
 * 功能：
 * 1. 自定义图片名称 / 后缀 (如 _HD)
 * 2. 保存格式 (PNG / JPG / WEBP 分段切换)
 * 3. 自定义图片保存目录 (可选) + 【📁 选择目录】网页原生可视化穿透选择器（永不死锁、零遮挡）
 * 4. 彻底屏蔽所有原生死板组件，无压缩、原画质无损导出
 */

import { app } from "/scripts/app.js";

// 动态载入样式表
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

function isExportNode(node) {
  if (!node) return false;
  const c = node.comfyClass || node.type || "";
  const t = node.title || "";
  return c === "BatchImageExport" || t.includes("指定目录导出") || t.includes("自动保存导出");
}

function hideExportWidgets(node) {
  if (node.widgets) {
    for (const w of node.widgets) {
      if (w.name !== "batch_export_custom_ui") {
        w.type = "hidden";
        w.hidden = true;
        w.computeSize = () => [0, -4];
        w.draw = () => {};
      }
    }
  }
}



app.registerExtension({
  name: "ComfyUI.BatchMaster.BatchImageExport",

  async nodeCreated(node) {
    if (!isExportNode(node)) return;

    // 1. 彻底隐藏并关闭所有原生 widget 的绘制
    function sanitizeWidgets() {
      if (node.widgets) {
        for (const w of node.widgets) {
          if (w.name === "current_index") {
            if (w.value === "" || w.value === undefined || isNaN(parseInt(w.value))) {
              w.value = 1;
            }
          }
          if (w.name === "quality") {
            if (w.value === "" || w.value === undefined || isNaN(parseInt(w.value))) {
              w.value = 100;
            }
          }
        }
      }
    }

    const origConfigure = node.onConfigure;
    node.onConfigure = function () {
      const res = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      hideExportWidgets(node);
      sanitizeWidgets();
      setTimeout(syncWidgetsToUI, 50);
      setTimeout(ensureNodeDimensions, 60);
      return res;
    };

    sanitizeWidgets();

    // 寻找被隐藏的原生 widgets 以同步数据
    const findWidget = (name) => (node.widgets || []).find((w) => w.name === name);
    const dirWidget = findWidget("save_directory");
    const prefixWidget = findWidget("filename_prefix");
    let suffixWidget = findWidget("filename_suffix");
    const formatWidget = findWidget("format");

    // 确保 suffixWidget 在旧版本工作流中也能稳定持久化
    if (!suffixWidget) {
      suffixWidget = node.addWidget("text", "filename_suffix", node.properties?.["filename_suffix"] || "", (v) => {
        if (!node.properties) node.properties = {};
        node.properties["filename_suffix"] = v;
      });
      suffixWidget.type = "hidden";
      suffixWidget.hidden = true;
      suffixWidget.computeSize = () => [0, -4];
      suffixWidget.draw = () => {};
    }

    // 2. 构建 1:1 像素级极简现代卡片 DOM
    const container = document.createElement("div");
    container.className = "bm-export-card";

    container.innerHTML = `
      <!-- 1. 自定义图片名称 / 后缀 (可不填) -->
      <div class="bm-card-group">
        <div class="bm-card-label">自定义图片名称 / 后缀 (可不填)</div>
        <div class="bm-card-row">
          <input type="text" class="bm-card-input bm-input-name" id="bm-input-name" placeholder="这里输入你的图片名称" spellcheck="false" />
          <input type="text" class="bm-card-input bm-input-suffix" id="bm-input-suffix" placeholder="后缀(如:_HD)" spellcheck="false" />
        </div>
      </div>

      <!-- 2. 保存格式 -->
      <div class="bm-card-group">
        <div class="bm-card-label">保存格式</div>
        <div class="bm-format-tabs" id="bm-format-tabs">
          <button type="button" class="bm-format-tab active" data-fmt="png">PNG</button>
          <button type="button" class="bm-format-tab" data-fmt="jpg">JPG</button>
          <button type="button" class="bm-format-tab" data-fmt="webp">WEBP</button>
        </div>
      </div>

      <!-- 3. 自定义图片保存目录 (可选) -->
      <div class="bm-card-group">
        <div class="bm-card-label">自定义图片保存目录 (可选)</div>
        <div class="bm-card-row">
          <input type="text" class="bm-card-input bm-input-dir" id="bm-input-dir" placeholder="C:/Users/Administrator/Desktop" spellcheck="false" />
          <button type="button" class="bm-btn-pick-folder" id="bm-btn-pick-folder" title="点击调起可视化目录选择器">
            <span class="bm-folder-icon">📁</span>
            <span id="bm-btn-text">选择目录</span>
          </button>
        </div>
      </div>
    `;

    // DOM 元素引用
    const nameInput = container.querySelector("#bm-input-name");
    const suffixInput = container.querySelector("#bm-input-suffix");
    const formatTabs = container.querySelectorAll("#bm-format-tabs .bm-format-tab");
    const dirInput = container.querySelector("#bm-input-dir");
    const pickBtn = container.querySelector("#bm-btn-pick-folder");

    // 同步底层 widget 数据到自定义 UI
    function syncWidgetsToUI() {
      if (dirWidget) {
        dirInput.value = dirWidget.value || "";
      }
      if (prefixWidget) {
        nameInput.value = prefixWidget.value || "";
      }

      // 彻底清理旧工作流中可能残留的 naming_pattern 历史字符串
      let suf = suffixWidget?.value || node.properties?.["filename_suffix"] || "";
      if (suf.includes("前缀") || suf.includes("原文件名") || suf.includes("序号") || suf.includes("时间戳") || suf.length > 20) {
        suf = "";
        if (suffixWidget) suffixWidget.value = "";
        if (node.properties) node.properties["filename_suffix"] = "";
      }
      suffixInput.value = suf;

      if (formatWidget) {
        const curFmt = (formatWidget.value || "png").toLowerCase();
        formatTabs.forEach((tab) => {
          tab.classList.toggle("active", tab.dataset.fmt === curFmt);
        });
      }
    }

    // 1. 名称输入框监听
    nameInput.addEventListener("input", () => {
      const val = nameInput.value;
      if (prefixWidget) {
        prefixWidget.value = val;
        if (prefixWidget.callback) prefixWidget.callback(val);
      }
      node.setDirtyCanvas(true, true);
    });

    // 2. 后缀输入框监听
    suffixInput.addEventListener("input", () => {
      const val = suffixInput.value;
      if (suffixWidget) {
        suffixWidget.value = val;
        if (suffixWidget.callback) suffixWidget.callback(val);
      }
      if (!node.properties) node.properties = {};
      node.properties["filename_suffix"] = val;
      node.setDirtyCanvas(true, true);
    });

    // 3. 格式分段按钮点击监听
    formatTabs.forEach((tab) => {
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        formatTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        const fmt = tab.dataset.fmt;
        if (formatWidget) {
          formatWidget.value = fmt;
          if (formatWidget.callback) formatWidget.callback(fmt);
        }
        node.setDirtyCanvas(true, true);
      });
    });

    // 4. 目录输入框监听
    dirInput.addEventListener("input", () => {
      const val = dirInput.value;
      if (dirWidget) {
        dirWidget.value = val;
        if (dirWidget.callback) dirWidget.callback(val);
      }
      node.setDirtyCanvas(true, true);
    });

    // 5. 点击【📁 选择目录】直接调起 Windows 系统原生文件夹选择器（如选图片般秒级直出）
    pickBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const btnText = container.querySelector("#bm-btn-text");
      const origText = btnText ? btnText.textContent : "选择目录";
      if (btnText) btnText.textContent = "正在选择...";
      pickBtn.style.opacity = "0.7";
      pickBtn.style.pointerEvents = "none";

      try {
        const curVal = dirInput.value.trim();
        const resp = await fetch("/batch_master/pick_folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initial_dir: curVal })
        });
        const res = await resp.json();
        if (res.success && res.folder_path) {
          dirInput.value = res.folder_path;
          if (dirWidget) {
            dirWidget.value = res.folder_path;
            if (dirWidget.callback) dirWidget.callback(res.folder_path);
          }
          node.setDirtyCanvas(true, true);
        }
      } catch (err) {
        console.error("调用系统文件夹选择器失败:", err);
      } finally {
        if (btnText) btnText.textContent = origText;
        pickBtn.style.opacity = "";
        pickBtn.style.pointerEvents = "";
      }
    });

    // 挂载至节点 DOM Widget
    const domWidget = node.addDOMWidget("batch_export_custom_ui", "custom", container, {
      getValue() {
        return "";
      },
      setValue(v) {},
    });

    // 设定 DOM Widget 占用高度 (250px 保证底部留白充裕绝对不贴边)
    domWidget.computeSize = function (width) {
      const currentW = node.size && node.size[0] > 0 ? node.size[0] : (width || 440);
      return [currentW, 250];
    };

    // 紧凑贴合大背景尺寸
    function ensureNodeDimensions() {
      const targetW = 440;
      const targetH = 345;
      if (!node.size || node.size[0] !== targetW || Math.abs(node.size[1] - targetH) > 5) {
        node.size = [targetW, targetH];
        if (typeof node.setSize === "function") {
          node.setSize([targetW, targetH]);
        }
        app.canvas?.setDirty(true, true);
      }
    }

    node.computeSize = function (out) {
      return [440, 345];
    };

    hideExportWidgets(node);
    ensureNodeDimensions();
    syncWidgetsToUI();
    setTimeout(ensureNodeDimensions, 50);
    setTimeout(syncWidgetsToUI, 100);
    setTimeout(ensureNodeDimensions, 200);
  },
});
