/**
 * 喵小黑批量：指定目录导出 前端增强控制器
 * 1. 实时展示保存目录与最近导出状态
 * 2. 提供【📂 打开保存目录】按钮，一键在电脑资源管理器中弹出该文件夹
 * 3. 监听浏览器同步下载事件（如果开启了 browser_auto_download）
 */

import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

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

app.registerExtension({
  name: "ComfyUI.BatchMaster.BatchImageExport",

  async setup() {
    // 监听服务端 WebSocket 推送的导出下载事件 (如果启用了浏览器下载)
    api.addEventListener("batch_image_exported_download", (event) => {
      const data = event.detail;
      if (!data || !data.filename) return;
      if (data.client_id && data.client_id !== api.clientId) return;

      try {
        const downloadUrl = `/view?filename=${encodeURIComponent(data.filename)}&type=output`;
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (err) {
        console.warn("[BatchImageExport] 自动下载失败:", err);
      }
    });
  },

  async nodeCreated(node) {
    if (!isExportNode(node)) return;

    const findWidget = (name) => (node.widgets || []).find((w) => w.name === name);
    const dirWidget = findWidget("save_directory");
    const prefixWidget = findWidget("filename_prefix");
    const patternWidget = findWidget("naming_pattern");
    const formatWidget = findWidget("format");

    const container = document.createElement("div");
    container.className = "bm-export-panel";

    container.innerHTML = `
      <div class="bm-export-card">
        <div class="bm-export-header">
          <div class="bm-export-title">
            <span>💾</span>
            <span>自动导出就绪</span>
          </div>
          <button type="button" class="bm-btn bm-btn-compact bm-btn-open-dir" id="bm-export-open-btn" title="在系统资源管理器中打开此文件夹">
            <span>📂 打开目录</span>
          </button>
        </div>
        <div class="bm-export-meta">
          <div class="bm-export-meta-row">
            <span class="bm-export-meta-label">目标目录:</span>
            <span class="bm-export-meta-val" id="bm-export-path-preview" title="点击可复制路径">output/batch_export</span>
          </div>
          <div class="bm-export-meta-row">
            <span class="bm-export-meta-label">命名示例:</span>
            <span class="bm-export-meta-val" id="bm-export-name-sample" style="color: #60a5fa;">Result_001_pic.png</span>
          </div>
          <div class="bm-export-meta-row" id="bm-export-last-row" style="display: none;">
            <span class="bm-export-meta-label">最新导出:</span>
            <span class="bm-export-meta-val" id="bm-export-last-file" style="color: #34d399;">-</span>
          </div>
        </div>
      </div>
    `;

    const openBtn = container.querySelector("#bm-export-open-btn");
    const pathPreview = container.querySelector("#bm-export-path-preview");
    const nameSample = container.querySelector("#bm-export-name-sample");
    const lastRow = container.querySelector("#bm-export-last-row");
    const lastFile = container.querySelector("#bm-export-last-file");

    function updatePreview() {
      const curDir = dirWidget ? (dirWidget.value || "output/batch_export") : "output/batch_export";
      const curPrefix = prefixWidget ? (prefixWidget.value || "Result") : "Result";
      const curPattern = patternWidget ? patternWidget.value : "前缀_三位序号_原名";
      const curFmt = formatWidget ? (formatWidget.value || "png") : "png";

      if (pathPreview) {
        pathPreview.textContent = curDir;
        pathPreview.title = curDir;
      }

      let sample = `${curPrefix}_001_pic.${curFmt}`;
      if (curPattern.includes("原文件名") && !curPattern.includes("前缀")) {
        sample = `pic.${curFmt}`;
      } else if (curPattern.includes("前缀_原文件名")) {
        sample = `${curPrefix}_pic.${curFmt}`;
      } else if (curPattern.includes("前缀_三位序号") && !curPattern.includes("原名")) {
        sample = `${curPrefix}_001.${curFmt}`;
      } else if (curPattern.includes("时间戳")) {
        sample = `pic_20260927_181000.${curFmt}`;
      }
      if (nameSample) {
        nameSample.textContent = sample;
      }
    }

    if (openBtn) {
      openBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const curDir = dirWidget ? dirWidget.value : "output/batch_export";
        try {
          const resp = await fetch("/batch_master/open_folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_path: curDir })
          });
          const res = await resp.json();
          if (!res.success) {
            alert("打开目录失败: " + (res.error || "未知原因"));
          }
        } catch (err) {
          alert("请求打开目录失败: " + err.message);
        }
      });
    }

    [dirWidget, prefixWidget, patternWidget, formatWidget].forEach((w) => {
      if (w) {
        const origCb = w.callback;
        w.callback = function(...args) {
          if (origCb) origCb.apply(this, args);
          updatePreview();
        };
      }
    });

    const origOnExecuted = node.onExecuted;
    node.onExecuted = function(msg) {
      if (origOnExecuted) origOnExecuted.apply(this, arguments);
      if (msg && msg.latest_file && lastRow && lastFile) {
        lastRow.style.display = "flex";
        lastFile.textContent = msg.latest_file;
      }
    };

    const domWidget = node.addDOMWidget("batch_export_custom_ui", "custom", container, {
      getValue() { return ""; },
      setValue(v) {},
    });

    domWidget.computeSize = function(width) {
      const currentW = node.size && node.size[0] > 0 ? node.size[0] : (width || 380);
      return [currentW, 95];
    };

    updatePreview();
  }
});
