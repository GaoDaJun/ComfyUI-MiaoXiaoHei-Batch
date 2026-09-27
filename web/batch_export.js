/**
 * 喵小黑批量：指定目录导出 前端专属界面控制器
 * 特性：
 * 1. 彻底剔除/隐藏 ComfyUI 原生死板输入框，全部由定制 UI 独立渲染
 * 2. 文件夹选择：点击【📁 选择目录】直接调起 Windows 系统原生文件夹浏览对话框
 * 3. 文件夹打开：点击【📂 打开目录】直接在资源管理器中弹出该文件夹
 * 4. 格式与命名：精美胶囊按钮 (Pills)，一键切换 PNG / JPG / WEBP，带质量滑块
 * 5. 实时命名规则预览与动态状态提示
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

function hideExportWidgets(node) {
  if (node.widgets) {
    for (const w of node.widgets) {
      if (w.name !== "batch_export_custom_ui") {
        w.type = "hidden";
        w.computeSize = () => [0, -4];
      }
    }
  }
}

app.registerExtension({
  name: "ComfyUI.BatchMaster.BatchImageExport",

  async nodeCreated(node) {
    if (!isExportNode(node)) return;

    // 1. 彻底隐藏所有原生 widget 选项
    hideExportWidgets(node);

    const origConfigure = node.onConfigure;
    node.onConfigure = function () {
      const res = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      hideExportWidgets(node);
      setTimeout(syncWidgetsToUI, 50);
      return res;
    };

    // 寻找被隐藏的原生 widgets
    const findWidget = (name) => (node.widgets || []).find((w) => w.name === name);
    const dirWidget = findWidget("save_directory");
    const prefixWidget = findWidget("filename_prefix");
    const patternWidget = findWidget("naming_pattern");
    const formatWidget = findWidget("format");
    const qualityWidget = findWidget("quality");
    const overwriteWidget = findWidget("overwrite");

    // 2. 构建完全自定义的现代化 DOM 容器
    const container = document.createElement("div");
    container.className = "bm-export-panel";

    container.innerHTML = `
      <!-- 顶部品牌栏 -->
      <div class="bm-export-top-bar">
        <div class="bm-export-brand">
          <span>🐱</span>
          <span>指定目录导出与自动保存</span>
        </div>
        <div class="bm-export-badge" id="bm-export-status-badge">
          <span class="bm-export-dot"></span>
          <span id="bm-export-status-text">转一张存一张</span>
        </div>
      </div>

      <!-- 1. 本地保存目录卡片 -->
      <div class="bm-export-section">
        <div class="bm-export-sec-header">
          <span class="bm-export-sec-title">📁 保存目标目录</span>
          <div class="bm-export-sec-actions">
            <button type="button" class="bm-btn bm-btn-compact bm-btn-pick" id="bm-export-pick-btn" title="点击调起系统文件夹浏览窗口，直接可视化选择目录">
              📁 选择目录
            </button>
            <button type="button" class="bm-btn bm-btn-compact bm-btn-open" id="bm-export-open-btn" title="在系统文件管理器 (资源管理器) 中打开此文件夹">
              📂 打开目录
            </button>
          </div>
        </div>
        <div class="bm-export-input-wrap">
          <input type="text" class="bm-export-input" id="bm-export-dir-input" placeholder="可直接在此输入，或点击右上角【选择目录】按钮" spellcheck="false" />
        </div>
      </div>

      <!-- 2. 命名模式与前缀 -->
      <div class="bm-export-section">
        <div class="bm-export-sec-header">
          <span class="bm-export-sec-title">🏷️ 文件命名规则</span>
          <div class="bm-export-prefix-box">
            <span class="bm-export-sublabel">前缀:</span>
            <input type="text" class="bm-export-prefix-input" id="bm-export-prefix-input" value="Result" placeholder="前缀字符" />
          </div>
        </div>
        <div class="bm-export-pills-grid" id="bm-export-pattern-pills">
          <button type="button" class="bm-export-pill active" data-pattern="前缀_三位序号_原名">前缀_序号_原名</button>
          <button type="button" class="bm-export-pill" data-pattern="前缀_三位序号">前缀_序号</button>
          <button type="button" class="bm-export-pill" data-pattern="前缀_原文件名">前缀_原名</button>
          <button type="button" class="bm-export-pill" data-pattern="原文件名">原文件名</button>
          <button type="button" class="bm-export-pill" data-pattern="时间戳">原名_时间戳</button>
        </div>
      </div>

      <!-- 3. 文件格式与品质 -->
      <div class="bm-export-section">
        <div class="bm-export-sec-header">
          <span class="bm-export-sec-title">🎨 图片格式</span>
          <div class="bm-export-quality-wrap" id="bm-export-quality-container" style="display: none;">
            <span class="bm-export-sublabel">品质:</span>
            <input type="range" class="bm-export-slider" id="bm-export-quality-slider" min="10" max="100" value="95" step="1" />
            <span class="bm-export-quality-val" id="bm-export-quality-val">95%</span>
          </div>
        </div>
        <div class="bm-export-format-pills" id="bm-export-format-pills">
          <button type="button" class="bm-export-pill active" data-format="png">PNG (无损·工作流信息)</button>
          <button type="button" class="bm-export-pill" data-format="jpg">JPG (高清轻量)</button>
          <button type="button" class="bm-export-pill" data-format="webp">WEBP (超高压缩)</button>
        </div>
      </div>

      <!-- 4. 底部实时命名预览与状态 -->
      <div class="bm-export-footer">
        <div class="bm-export-sample-row">
          <span class="bm-export-sample-label">✨ 实时预览:</span>
          <span class="bm-export-sample-tag" id="bm-export-sample-name">Result_001_pic.png</span>
        </div>
        <div class="bm-export-latest-row" id="bm-export-latest-row" style="display: none;">
          <span class="bm-export-latest-label">🎉 最近导出:</span>
          <span class="bm-export-latest-file" id="bm-export-latest-file">-</span>
        </div>
      </div>
    `;

    // 获取 DOM 元素引用
    const dirInput = container.querySelector("#bm-export-dir-input");
    const pickBtn = container.querySelector("#bm-export-pick-btn");
    const openBtn = container.querySelector("#bm-export-open-btn");
    const prefixInput = container.querySelector("#bm-export-prefix-input");
    const patternPills = container.querySelectorAll("#bm-export-pattern-pills .bm-export-pill");
    const formatPills = container.querySelectorAll("#bm-export-format-pills .bm-export-pill");
    const qualityContainer = container.querySelector("#bm-export-quality-container");
    const qualitySlider = container.querySelector("#bm-export-quality-slider");
    const qualityVal = container.querySelector("#bm-export-quality-val");
    const sampleTag = container.querySelector("#bm-export-sample-name");
    const latestRow = container.querySelector("#bm-export-latest-row");
    const latestFile = container.querySelector("#bm-export-latest-file");
    const statusText = container.querySelector("#bm-export-status-text");

    // 计算实时预览名称
    function updateSampleName() {
      const pfx = prefixInput.value.trim() || "Result";
      let activeP = "前缀_三位序号_原名";
      patternPills.forEach((p) => {
        if (p.classList.contains("active")) activeP = p.dataset.pattern;
      });

      let activeF = "png";
      formatPills.forEach((f) => {
        if (f.classList.contains("active")) activeF = f.dataset.format;
      });

      let sample = `${pfx}_001_pic.${activeF}`;
      if (activeP === "前缀_三位序号") {
        sample = `${pfx}_001.${activeF}`;
      } else if (activeP === "前缀_原文件名") {
        sample = `${pfx}_pic.${activeF}`;
      } else if (activeP === "原文件名") {
        sample = `pic.${activeF}`;
      } else if (activeP === "时间戳") {
        sample = `pic_20260927_181000.${activeF}`;
      }
      sampleTag.textContent = sample;
    }

    // 同步底层 widget 数据到自定义 UI
    function syncWidgetsToUI() {
      if (dirWidget) {
        dirInput.value = dirWidget.value || "output/batch_export";
      }
      if (prefixWidget) {
        prefixInput.value = prefixWidget.value || "Result";
      }

      if (patternWidget) {
        const curPat = patternWidget.value || "";
        patternPills.forEach((btn) => {
          btn.classList.toggle("active", curPat.includes(btn.dataset.pattern));
        });
      }

      if (formatWidget) {
        const curFmt = (formatWidget.value || "png").toLowerCase();
        formatPills.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.format === curFmt);
        });
        const isJpgOrWebp = curFmt === "jpg" || curFmt === "webp";
        qualityContainer.style.display = isJpgOrWebp ? "inline-flex" : "none";
      }

      if (qualityWidget && qualitySlider) {
        qualitySlider.value = qualityWidget.value || 95;
        qualityVal.textContent = `${qualitySlider.value}%`;
      }

      updateSampleName();
    }

    // 目录输入框监听
    dirInput.addEventListener("input", () => {
      if (dirWidget) {
        dirWidget.value = dirInput.value;
        if (dirWidget.callback) dirWidget.callback(dirInput.value);
      }
      node.setDirtyCanvas(true, true);
    });

    // 点击【📁 选择目录】直接调起 Windows 原生选择文件夹对话框
    pickBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const origText = pickBtn.innerHTML;
      pickBtn.disabled = true;
      pickBtn.innerHTML = `<span>⏳ 选择中...</span>`;

      try {
        const curPath = dirInput.value.trim();
        const resp = await fetch("/batch_master/pick_folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initial_dir: curPath })
        });
        const res = await resp.json();
        if (res.success && res.folder_path) {
          dirInput.value = res.folder_path;
          if (dirWidget) {
            dirWidget.value = res.folder_path;
            if (dirWidget.callback) dirWidget.callback(res.folder_path);
          }
          statusText.textContent = "目录已更新";
          setTimeout(() => (statusText.textContent = "转一张存一张"), 2000);
          node.setDirtyCanvas(true, true);
        }
      } catch (err) {
        console.error("[BatchImageExport] 调起目录选择失败:", err);
        alert("调起系统目录选择器失败: " + err.message);
      } finally {
        pickBtn.disabled = false;
        pickBtn.innerHTML = origText;
      }
    });

    // 点击【📂 打开目录】在系统资源管理器中弹出该文件夹
    openBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const curPath = dirInput.value.trim() || "output/batch_export";
      const origText = openBtn.innerHTML;
      openBtn.disabled = true;
      openBtn.innerHTML = `<span>⏳ 打开中...</span>`;

      try {
        const resp = await fetch("/batch_master/open_folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_path: curPath })
        });
        const res = await resp.json();
        if (!res.success) {
          alert("打开文件夹失败: " + (res.error || "未知原因"));
        }
      } catch (err) {
        alert("请求打开文件夹失败: " + err.message);
      } finally {
        openBtn.disabled = false;
        openBtn.innerHTML = origText;
      }
    });

    // 前缀输入框监听
    prefixInput.addEventListener("input", () => {
      const val = prefixInput.value.trim() || "Result";
      if (prefixWidget) {
        prefixWidget.value = val;
        if (prefixWidget.callback) prefixWidget.callback(val);
      }
      updateSampleName();
      node.setDirtyCanvas(true, true);
    });

    // 命名胶囊点击切换
    patternPills.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        patternPills.forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");

        const patKey = btn.dataset.pattern;
        if (patternWidget) {
          const matchOpt = (patternWidget.options?.values || []).find((v) => v.includes(patKey));
          if (matchOpt) {
            patternWidget.value = matchOpt;
            if (patternWidget.callback) patternWidget.callback(matchOpt);
          }
        }
        updateSampleName();
        node.setDirtyCanvas(true, true);
      });
    });

    // 格式胶囊点击切换
    formatPills.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        formatPills.forEach((f) => f.classList.remove("active"));
        btn.classList.add("active");

        const fmt = btn.dataset.format;
        if (formatWidget) {
          formatWidget.value = fmt;
          if (formatWidget.callback) formatWidget.callback(fmt);
        }

        const isJpgOrWebp = fmt === "jpg" || fmt === "webp";
        qualityContainer.style.display = isJpgOrWebp ? "inline-flex" : "none";

        updateSampleName();
        node.setDirtyCanvas(true, true);
      });
    });

    // 品质滑块拖动监听
    qualitySlider.addEventListener("input", () => {
      const q = parseInt(qualitySlider.value, 10);
      qualityVal.textContent = `${q}%`;
      if (qualityWidget) {
        qualityWidget.value = q;
        if (qualityWidget.callback) qualityWidget.callback(q);
      }
    });

    // 执行完成钩子，反馈最新导出文件
    const origOnExecuted = node.onExecuted;
    node.onExecuted = function (msg) {
      if (origOnExecuted) origOnExecuted.apply(this, arguments);
      if (msg && msg.latest_file) {
        latestRow.style.display = "flex";
        latestFile.textContent = msg.latest_file;
        statusText.textContent = "已成功保存 1 张";
        setTimeout(() => (statusText.textContent = "转一张存一张"), 3000);
      }
    };

    // 挂载至节点 DOM Widget
    const domWidget = node.addDOMWidget("batch_export_custom_ui", "custom", container, {
      getValue() {
        return "";
      },
      setValue(v) {},
    });

    // 设定 DOM Widget 占用高度
    domWidget.computeSize = function (width) {
      const currentW = node.size && node.size[0] > 0 ? node.size[0] : (width || 440);
      return [currentW, 255];
    };

    // 锁定节点最小尺寸，防止遮挡
    function ensureNodeDimensions() {
      const minW = 440;
      const minH = 340;
      let changed = false;
      if (!node.size) {
        node.size = [minW, minH];
        changed = true;
      } else {
        if (node.size[0] < minW) {
          node.size[0] = minW;
          changed = true;
        }
        if (node.size[1] < minH) {
          node.size[1] = minH;
          changed = true;
        }
      }
      if (changed && typeof node.setSize === "function") {
        node.setSize([node.size[0], node.size[1]]);
        app.canvas?.setDirty(true, true);
      }
    }

    const origComputeSize = node.computeSize;
    node.computeSize = function (out) {
      const s = origComputeSize ? origComputeSize.apply(this, arguments) : [440, 340];
      s[0] = Math.max(s[0] || 440, 440);
      s[1] = Math.max(s[1] || 340, 340);
      return s;
    };

    ensureNodeDimensions();
    syncWidgetsToUI();
    setTimeout(ensureNodeDimensions, 50);
    setTimeout(syncWidgetsToUI, 100);
  },
});
