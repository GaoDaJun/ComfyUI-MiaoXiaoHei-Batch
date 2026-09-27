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

/**
 * 网页端原生可视化文件夹浏览弹窗
 * 100% 在当前浏览器画布上弹出，零依赖操作系统弹窗，绝不死锁、绝不被遮挡
 */
function openFolderModal(currentPath, onSelect) {
  const backdrop = document.createElement("div");
  backdrop.className = "bm-folder-modal-backdrop";

  backdrop.innerHTML = `
    <div class="bm-folder-modal-dialog">
      <div class="bm-modal-header">
        <div class="bm-modal-title">
          <span>📁</span>
          <span>选择保存目录</span>
        </div>
        <button type="button" class="bm-modal-close" id="bm-modal-close">✕</button>
      </div>

      <div class="bm-modal-body">
        <!-- 快捷位置与盘符 -->
        <div class="bm-modal-shortcuts" id="bm-modal-shortcuts">
          <span style="font-size: 11px; color: #71717a; margin-right: 4px;">快捷位置:</span>
        </div>

        <!-- 当前路径输入栏与导航操作 -->
        <div class="bm-modal-path-row">
          <button type="button" class="bm-modal-btn-sub" id="bm-modal-btn-up" title="返回上一层目录">⬆️ 上一级</button>
          <input type="text" class="bm-modal-path-input" id="bm-modal-cur-path" value="${currentPath || ''}" spellcheck="false" />
          <button type="button" class="bm-modal-btn-sub" id="bm-modal-btn-mkdir" title="在当前目录下新建文件夹">➕ 新建</button>
        </div>

        <!-- 文件夹滚动视窗 -->
        <div class="bm-modal-folder-list" id="bm-modal-folder-list">
          <div class="bm-modal-empty">正在加载目录列表...</div>
        </div>
      </div>

      <div class="bm-modal-footer">
        <button type="button" class="bm-modal-btn-sub" id="bm-modal-btn-open-sys" title="在系统资源管理器中打开此文件夹">↗️ 打开文件夹</button>
        <div class="bm-modal-footer-right">
          <button type="button" class="bm-modal-btn-cancel" id="bm-modal-btn-cancel">取消</button>
          <button type="button" class="bm-modal-btn-confirm" id="bm-modal-btn-confirm">✅ 确定选择此目录</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const closeBtn = backdrop.querySelector("#bm-modal-close");
  const cancelBtn = backdrop.querySelector("#bm-modal-btn-cancel");
  const confirmBtn = backdrop.querySelector("#bm-modal-btn-confirm");
  const openSysBtn = backdrop.querySelector("#bm-modal-btn-open-sys");
  const upBtn = backdrop.querySelector("#bm-modal-btn-up");
  const mkdirBtn = backdrop.querySelector("#bm-modal-btn-mkdir");
  const pathInput = backdrop.querySelector("#bm-modal-cur-path");
  const shortcutsWrap = backdrop.querySelector("#bm-modal-shortcuts");
  const folderList = backdrop.querySelector("#bm-modal-folder-list");

  let activePath = currentPath || "";
  let parentPath = null;

  function closeModal() {
    backdrop.remove();
  }

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  confirmBtn.addEventListener("click", () => {
    const finalPath = pathInput.value.trim() || activePath;
    if (finalPath && onSelect) {
      onSelect(finalPath);
    }
    closeModal();
  });

  openSysBtn.addEventListener("click", async () => {
    try {
      await fetch("/batch_master/open_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: pathInput.value.trim() || activePath })
      });
    } catch (err) {
      console.error(err);
    }
  });

  async function loadDirectory(targetPath) {
    folderList.innerHTML = `<div class="bm-modal-empty">正在加载目录列表...</div>`;
    try {
      const resp = await fetch("/batch_master/list_folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath })
      });
      const data = await resp.json();
      if (!data.success) {
        folderList.innerHTML = `<div class="bm-modal-empty" style="color:#ef4444;">无法读取目录: ${data.error || '权限不足'}</div>`;
        return;
      }

      activePath = data.current_path;
      parentPath = data.parent_path;
      pathInput.value = activePath;

      // 渲染快捷方式与驱动器
      shortcutsWrap.innerHTML = `<span style="font-size: 11px; color: #71717a; margin-right: 4px;">快捷位置:</span>`;
      (data.shortcuts || []).forEach((sc) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bm-modal-shortcut-btn";
        btn.textContent = sc.name;
        btn.addEventListener("click", () => loadDirectory(sc.path));
        shortcutsWrap.appendChild(btn);
      });

      (data.drives || []).forEach((drv) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bm-modal-shortcut-btn";
        btn.textContent = `💾 ${drv}`;
        btn.addEventListener("click", () => loadDirectory(`${drv}\\`));
        shortcutsWrap.appendChild(btn);
      });

      // 渲染子文件夹列表
      folderList.innerHTML = "";
      if (!data.folders || data.folders.length === 0) {
        folderList.innerHTML = `<div class="bm-modal-empty">(当前目录下无子文件夹)</div>`;
        return;
      }

      data.folders.forEach((folderName) => {
        const item = document.createElement("div");
        item.className = "bm-modal-folder-item";
        item.innerHTML = `
          <span class="bm-modal-folder-icon">📁</span>
          <span class="bm-modal-folder-name">${folderName}</span>
        `;
        item.addEventListener("click", () => {
          const sep = activePath.includes("/") && !activePath.includes("\\") ? "/" : "\\";
          const next = activePath.endsWith(sep) ? `${activePath}${folderName}` : `${activePath}${sep}${folderName}`;
          loadDirectory(next);
        });
        folderList.appendChild(item);
      });
    } catch (err) {
      folderList.innerHTML = `<div class="bm-modal-empty" style="color:#ef4444;">加载异常: ${err.message}</div>`;
    }
  }

  upBtn.addEventListener("click", () => {
    if (parentPath) {
      loadDirectory(parentPath);
    }
  });

  mkdirBtn.addEventListener("click", async () => {
    const name = prompt("请输入新建文件夹名称:");
    if (!name || !name.trim()) return;
    try {
      const resp = await fetch("/batch_master/create_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: activePath, name: name.trim() })
      });
      const res = await resp.json();
      if (res.success && res.created_path) {
        loadDirectory(res.created_path);
      } else {
        alert("创建文件夹失败: " + (res.error || "未知原因"));
      }
    } catch (err) {
      alert("创建文件夹异常: " + err.message);
    }
  });

  pathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      loadDirectory(pathInput.value.trim());
    }
  });

  loadDirectory(activePath);
}

app.registerExtension({
  name: "ComfyUI.BatchMaster.BatchImageExport",

  async nodeCreated(node) {
    if (!isExportNode(node)) return;

    // 1. 彻底隐藏并关闭所有原生 widget 的绘制
    hideExportWidgets(node);

    const origConfigure = node.onConfigure;
    node.onConfigure = function () {
      const res = origConfigure ? origConfigure.apply(this, arguments) : undefined;
      hideExportWidgets(node);
      setTimeout(syncWidgetsToUI, 50);
      setTimeout(ensureNodeDimensions, 60);
      return res;
    };

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

    // 5. 点击【📁 选择目录】调起网页端可视化目录选择弹窗 (100% 出现、永不卡死)
    pickBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const curVal = dirInput.value.trim();
      openFolderModal(curVal, (chosen) => {
        dirInput.value = chosen;
        if (dirWidget) {
          dirWidget.value = chosen;
          if (dirWidget.callback) dirWidget.callback(chosen);
        }
        node.setDirtyCanvas(true, true);
      });
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
