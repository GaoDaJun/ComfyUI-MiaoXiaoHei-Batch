/**
 * 喵小黑批量：生图尺寸预设 (BatchResolutionPreset) 前端控制器
 * 核心交互：
 * 1. 1K / 1.5K / 2K 快速一键切换按钮
 * 2. 16种黄金比例 + 自定义 6列对齐网格胶囊 (Pills)
 * 3. 实时高清像素量 (MP) 与尺寸计算展示
 * 4. 实时长宽比矩形预览图形 (Mini Preview Box)
 * 5. 一键翻转横竖屏 (Swap Dimensions)
 * 6. 自动撑开节点高度 (min 520px)，杜绝底部遮挡或截断
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

// 17 种比例定义 (顺序科学排布为 6 列网格：第1行6个，第2行6个，第3行4个+自定义占2格)
const PRESET_RESOLUTIONS = {
  // 第 1 排：经典摄影与标准比例
  "1:1 (正方形)": { "1K": [1024, 1024], "1.5K": [1536, 1536], "2K": [2048, 2048], shortName: "1:1" },
  "3:2 (经典横图)": { "1K": [1536, 1024], "1.5K": [2304, 1536], "2K": [3072, 2048], shortName: "3:2" },
  "2:3 (经典竖图)": { "1K": [1024, 1536], "1.5K": [1536, 2304], "2K": [2048, 3072], shortName: "2:3" },
  "4:3 (传统横图)": { "1K": [1024, 768], "1.5K": [1536, 1152], "2K": [2048, 1536], shortName: "4:3" },
  "3:4 (传统竖图)": { "1K": [768, 1024], "1.5K": [1152, 1536], "2K": [1536, 2048], shortName: "3:4" },
  "4:5 (社交竖图)": { "1K": [1024, 1280], "1.5K": [1536, 1920], "2K": [2048, 2560], shortName: "4:5" },

  // 第 2 排：屏幕影视与宽景
  "5:4 (社交横图)": { "1K": [1280, 1024], "1.5K": [1920, 1536], "2K": [2560, 2048], shortName: "5:4" },
  "16:9 (电脑横屏)": { "1K": [1920, 1080], "1.5K": [2880, 1620], "2K": [3840, 2160], shortName: "16:9" },
  "9:16 (手机竖屏)": { "1K": [1080, 1920], "1.5K": [1620, 2880], "2K": [2160, 3840], shortName: "9:16" },
  "21:9 (宽屏全景)": { "1K": [1792, 768], "1.5K": [2688, 1152], "2K": [3584, 1536], shortName: "21:9" },
  "2:1 (超宽全景)": { "1K": [1536, 768], "1.5K": [2304, 1152], "2K": [3072, 1536], shortName: "2:1" },
  "1:2 (超长竖图)": { "1K": [768, 1536], "1.5K": [1152, 2304], "2K": [1536, 3072], shortName: "1:2" },

  // 第 3 排：长条极窄画幅与自定义
  "3:1 (极宽横条)": { "1K": [1536, 512], "1.5K": [2304, 768], "2K": [3072, 1024], shortName: "3:1" },
  "1:3 (极长长条)": { "1K": [512, 1536], "1.5K": [768, 2304], "2K": [1024, 3072], shortName: "1:3" },
  "4:1 (四联横幅)": { "1K": [2048, 512], "1.5K": [3072, 768], "2K": [4096, 1024], shortName: "4:1" },
  "1:4 (四联竖幅)": { "1K": [512, 2048], "1.5K": [768, 3072], "2K": [1024, 4096], shortName: "1:4" },
  "自定义 (Custom)": { "1K": [1024, 1024], "1.5K": [1536, 1536], "2K": [2048, 2048], shortName: "自定义" },
};

function isResolutionNode(node) {
  if (!node) return false;
  const c = node.comfyClass || node.type || "";
  const t = node.title || "";
  return c === "BatchResolutionPreset" || t.includes("生图尺寸预设") || t.includes("比例预设");
}

app.registerExtension({
  name: "ComfyUI.BatchMaster.ResolutionPreset",

  async nodeCreated(node) {
    if (!isResolutionNode(node)) return;

    // 寻找相关 widgets
    const findWidget = (name) => (node.widgets || []).find((w) => w.name === name);
    const aspectWidget = findWidget("aspect_ratio");
    const tierWidget = findWidget("resolution_tier");
    const swapWidget = findWidget("swap_dimensions");
    const alignWidget = findWidget("alignment");
    const customWidthWidget = findWidget("custom_width");
    const customHeightWidget = findWidget("custom_height");

    // 创建 DOM 容器
    const container = document.createElement("div");
    container.className = "bm-res-panel";

    // 1. 顶部栏 (Logo与1K/1.5K/2K切换组)
    const topBar = document.createElement("div");
    topBar.className = "bm-res-top-bar";

    const brand = document.createElement("div");
    brand.className = "bm-res-brand";
    brand.innerHTML = `<span>🐱</span><span>比例与生图尺寸</span>`;

    const tierGroup = document.createElement("div");
    tierGroup.className = "bm-res-tier-group";

    const tiers = [
      { key: "1K", label: "1K" },
      { key: "1.5K", label: "1.5K" },
      { key: "2K", label: "2K" },
    ];

    const tierBtns = {};
    tiers.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bm-res-tier-btn";
      btn.textContent = t.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (tierWidget) {
          const matchVal = (tierWidget.options?.values || []).find((v) => v.startsWith(t.key));
          if (matchVal) {
            tierWidget.value = matchVal;
            if (tierWidget.callback) tierWidget.callback(matchVal);
          }
        }
        updateUI();
        node.setDirtyCanvas(true, true);
      });
      tierGroup.appendChild(btn);
      tierBtns[t.key] = btn;
    });

    topBar.appendChild(brand);
    topBar.appendChild(tierGroup);
    container.appendChild(topBar);

    // 2. 核心大标签卡片 (显示尺寸、描述、微缩比例框、翻转按钮)
    const badgeCard = document.createElement("div");
    badgeCard.className = "bm-res-badge-card";

    const badgeInfo = document.createElement("div");
    badgeInfo.className = "bm-res-badge-info";

    const sizeTitle = document.createElement("div");
    sizeTitle.className = "bm-res-size-title";
    sizeTitle.textContent = "1536 × 1024";

    const sizeDesc = document.createElement("div");
    sizeDesc.className = "bm-res-size-desc";
    sizeDesc.textContent = "3:2 (经典横图) · 约 1.57 MP";

    badgeInfo.appendChild(sizeTitle);
    badgeInfo.appendChild(sizeDesc);

    const badgeActions = document.createElement("div");
    badgeActions.className = "bm-res-badge-actions";

    // 比例矩形预览盒子
    const previewWrap = document.createElement("div");
    previewWrap.className = "bm-res-preview-box-wrap";
    const previewBox = document.createElement("div");
    previewBox.className = "bm-res-preview-box";
    previewWrap.appendChild(previewBox);

    // 翻转按钮
    const swapBtn = document.createElement("button");
    swapBtn.type = "button";
    swapBtn.className = "bm-res-swap-btn";
    swapBtn.innerHTML = `<span>🔄</span><span>翻转</span>`;
    swapBtn.title = "长宽互换 (对调横竖屏)";
    swapBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (swapWidget) {
        swapWidget.value = !swapWidget.value;
        if (swapWidget.callback) swapWidget.callback(swapWidget.value);
      }
      updateUI();
      node.setDirtyCanvas(true, true);
    });

    badgeActions.appendChild(previewWrap);
    badgeActions.appendChild(swapBtn);

    badgeCard.appendChild(badgeInfo);
    badgeCard.appendChild(badgeActions);
    container.appendChild(badgeCard);

    // 3. 比例快捷胶囊区 (Pills)
    const pillsWrap = document.createElement("div");
    pillsWrap.className = "bm-res-pills-wrap";

    const pillBtns = {};
    Object.keys(PRESET_RESOLUTIONS).forEach((ratioKey) => {
      const info = PRESET_RESOLUTIONS[ratioKey];
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "bm-res-pill";
      if (info.shortName === "自定义") {
        pill.classList.add("span-2");
      }
      pill.textContent = info.shortName;
      pill.title = ratioKey;

      pill.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (aspectWidget) {
          aspectWidget.value = ratioKey;
          if (aspectWidget.callback) aspectWidget.callback(ratioKey);
        }
        updateUI();
        node.setDirtyCanvas(true, true);
      });

      pillsWrap.appendChild(pill);
      pillBtns[ratioKey] = pill;
    });

    container.appendChild(pillsWrap);

    // 核心更新函数
    function updateUI() {
      const curRatio = aspectWidget ? aspectWidget.value : "3:2 (经典横图)";
      const curTierStr = tierWidget ? tierWidget.value : "1K";
      const isSwap = swapWidget ? !!swapWidget.value : false;
      const curAlign = alignWidget ? alignWidget.value : "无";

      let curTierKey = "1K";
      if (curTierStr.includes("1.5K")) curTierKey = "1.5K";
      else if (curTierStr.includes("2K")) curTierKey = "2K";

      // 激活 Tier 按钮高亮
      Object.keys(tierBtns).forEach((k) => {
        tierBtns[k].classList.toggle("active", k === curTierKey);
      });

      // 激活 Pill 按钮高亮
      Object.keys(pillBtns).forEach((k) => {
        pillBtns[k].classList.toggle("active", k === curRatio);
      });

      // 激活翻转按钮高亮
      swapBtn.classList.toggle("active", isSwap);

      // 计算当前宽高
      let w = 1024, h = 1024, ratioText = "1:1";
      if (curRatio in PRESET_RESOLUTIONS && curRatio !== "自定义 (Custom)") {
        const pair = PRESET_RESOLUTIONS[curRatio][curTierKey];
        w = pair[0];
        h = pair[1];
        ratioText = PRESET_RESOLUTIONS[curRatio].shortName;
      } else {
        w = customWidthWidget ? parseInt(customWidthWidget.value, 10) || 1024 : 1024;
        h = customHeightWidget ? parseInt(customHeightWidget.value, 10) || 1024 : 1024;
        ratioText = "Custom";
      }

      if (isSwap) {
        const tmp = w;
        w = h;
        h = tmp;
        const parts = ratioText.split(":");
        if (parts.length === 2) {
          ratioText = `${parts[1]}:${parts[0]}`;
        }
      }

      // 对齐处理
      let step = 1;
      if (curAlign.includes("16倍数")) step = 16;
      else if (curAlign.includes("32倍数")) step = 32;
      else if (curAlign.includes("64倍数")) step = 64;

      if (step > 1) {
        w = Math.max(step, Math.round(w / step) * step);
        h = Math.max(step, Math.round(h / step) * step);
      }

      const mp = (w * h) / 1000000;
      sizeTitle.textContent = `${w} × ${h}`;
      sizeDesc.textContent = `${ratioText} · ${curTierKey} · 约 ${mp.toFixed(2)} MP`;

      // 动态更新微缩矩形预览 (最大包围盒 30x30)
      const maxBox = 30;
      let boxW = maxBox;
      let boxH = maxBox;
      if (w >= h) {
        boxW = maxBox;
        boxH = Math.max(8, Math.round((h / w) * maxBox));
      } else {
        boxH = maxBox;
        boxW = Math.max(8, Math.round((w / h) * maxBox));
      }
      previewBox.style.width = `${boxW}px`;
      previewBox.style.height = `${boxH}px`;

      // 保证尺寸充足
      ensureNodeDimensions();
    }

    // 挂载到节点 DOM Widget
    const domWidget = node.addDOMWidget("batch_res_custom_ui", "custom", container, {
      getValue() {
        return "";
      },
      setValue(v) {},
    });

    // 显式声明 DOM Widget 计算尺寸，向 LiteGraph 宣告高度需要 230px
    domWidget.computeSize = function (width) {
      const currentW = node.size && node.size[0] > 0 ? node.size[0] : (width || 400);
      return [currentW, 230];
    };

    // 计算并锁定节点最小宽高，杜绝任何遮挡截断
    function ensureNodeDimensions() {
      const minW = 400;
      const minH = 530;

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

    // 重载 node.computeSize，确保 LiteGraph 不会收缩该节点
    const origComputeSize = node.computeSize;
    node.computeSize = function (out) {
      const s = origComputeSize ? origComputeSize.apply(this, arguments) : [400, 530];
      s[0] = Math.max(s[0] || 400, 400);
      s[1] = Math.max(s[1] || 530, 530);
      return s;
    };

    // 监听原生 widget 变化，保持双向同步
    [aspectWidget, tierWidget, swapWidget, alignWidget, customWidthWidget, customHeightWidget].forEach((w) => {
      if (w) {
        const origCb = w.callback;
        w.callback = function (...args) {
          if (origCb) origCb.apply(this, args);
          updateUI();
        };
      }
    });

    // 监听节点配置载入 (加载保存的工作流时)
    const origOnConfigure = node.onConfigure;
    node.onConfigure = function () {
      if (origOnConfigure) origOnConfigure.apply(this, arguments);
      setTimeout(updateUI, 50);
      setTimeout(ensureNodeDimensions, 100);
    };

    // 首次进入强制刷新尺寸与界面
    ensureNodeDimensions();
    setTimeout(updateUI, 30);
    setTimeout(ensureNodeDimensions, 150);
    setTimeout(ensureNodeDimensions, 500);
  },
});
