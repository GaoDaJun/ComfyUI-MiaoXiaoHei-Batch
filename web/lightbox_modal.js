/**
 * 高清大图灯箱预览组件 (BatchLightbox)
 * 核心升级特性：
 * 1. 🐱 喵小黑滑块对比 (Slider Compare)：1:1像素完美贴合对齐，带喵小黑猫咪 Logo 滑块，支持高精度细节比对
 * 2. 🔀 左右双屏对比 (Side-by-side Compare)：标题与控件始终保持 1x 清晰度，图片同步缩放，绝不模糊！
 * 3. 🖼️ 仅看结果 (Single Image)：全屏纯净大图预览与高清检视
 * 4. 🎨 Figma 级以鼠标指向点为中心无级精准缩放与拖拽平移 (100%~1000%)
 * 5. 循环切图、双击快速聚焦、键盘快捷键 (1/2/3/C/←/→/0/ESC)
 */

const LOGO_URL = (typeof import.meta !== "undefined" && import.meta.url) 
  ? new URL("./miaoxiaohei_logo.svg", import.meta.url).href 
  : "/extensions/ComfyUI-Batch-Master/miaoxiaohei_logo.svg";

export class BatchLightbox {
  constructor() {
    this.items = [];
    this.currentIndex = 0;
    this.scale = 1.0;
    this.translateX = 0;
    this.translateY = 0;
    this.isDragging = false;
    this.isSliding = false;
    this.hasDragged = false;
    this.startX = 0;
    this.startY = 0;
    this.sliderRatio = 0.5;

    // 记忆用户对比模式偏好：'slider' (默认是对比) | 'split' | 'single'
    this.viewMode = this.getSavedMode();

    this.initDOM();
    this.bindEvents();
  }

  getSavedMode() {
    try {
      const saved = localStorage.getItem("bm_lightbox_view_mode");
      if (saved === "slider" || saved === "split" || saved === "single") {
        return saved;
      }
    } catch (e) {}
    return "slider"; // 默认是对比 (滑块对比)
  }

  saveMode(mode) {
    if (mode === "slider" || mode === "split" || mode === "single") {
      try {
        localStorage.setItem("bm_lightbox_view_mode", mode);
      } catch (e) {}
    }
  }

  initDOM() {
    if (document.getElementById("bm-lightbox-root")) {
      this.root = document.getElementById("bm-lightbox-root");
      return;
    }

    const html = `
      <div id="bm-lightbox-root" class="bm-lightbox-backdrop">
        <div class="bm-lightbox-header">
          <div id="bm-lb-title" class="bm-lb-title">大图效果对比</div>
          <div class="bm-lightbox-tools">
            <!-- 模式切换胶囊组 -->
            <div class="bm-mode-group">
              <button id="bm-btn-mode-slider" class="bm-lightbox-btn bm-mode-btn is-active" title="滑块卷帘对比：左右拖动喵小黑滑块比对细节 (快捷键: 1 或 C)">
                🐱 滑块对比
              </button>
              <button id="bm-btn-mode-split" class="bm-lightbox-btn bm-mode-btn" title="左右双屏对比：左右并排查看原图与结果 (快捷键: 2 或 C)">
                🔀 左右对比
              </button>
              <button id="bm-btn-mode-single" class="bm-lightbox-btn bm-mode-btn" title="单图模式：仅查看生成结果大图 (快捷键: 3 或 C)">
                🖼️ 仅看结果
              </button>
            </div>

            <!-- 缩放与比例复位 -->
            <button id="bm-lb-zoom-in" class="bm-lightbox-btn" title="放大图像 (+)">➕ 放大</button>
            <button id="bm-lb-zoom-out" class="bm-lightbox-btn" title="缩小图像 (-)">➖ 缩小</button>
            <button id="bm-lb-zoom-reset" class="bm-lightbox-btn" title="重置缩放至100% (快捷键: 0)">↺ 100%</button>
            <button id="bm-lb-download" class="bm-lightbox-btn" style="background:#10b981;" title="下载当前生成结果图">⬇️ 下载结果图</button>
            <button id="bm-lb-close" class="bm-lightbox-btn" style="background:#ef4444; border:none; font-weight:bold;" title="关闭预览 (ESC)">✕ 关闭</button>
          </div>
        </div>

        <div class="bm-lightbox-body" id="bm-lb-body">
          <button class="bm-lightbox-nav bm-lightbox-prev" id="bm-lb-prev" title="上一张 (←)">‹</button>

          <!-- 1. 滑块对比模式容器 (Figma级高清画布，两图1:1像素完美对齐) -->
          <div class="bm-lightbox-slider-container" id="bm-lb-slider-wrap">
            <div class="bm-slider-viewport" id="bm-slider-viewport">
              <!-- 底层：原始输入图 -->
              <img id="bm-slider-orig-img" class="bm-slider-img" src="" alt="原图" />
              <!-- 顶层：结果图 (带 clip-path 卷帘裁剪) -->
              <div class="bm-slider-clip-wrap" id="bm-slider-clip-wrap">
                <img id="bm-slider-result-img" class="bm-slider-img" src="" alt="结果图" />
              </div>
              <!-- 分割竖线与小猫滑块把手 -->
              <div class="bm-slider-line" id="bm-slider-line"></div>
              <div class="bm-slider-handle" id="bm-slider-handle" title="按住左右拖动对比细节">
                <img class="bm-handle-logo-img" src="${LOGO_URL}" alt="喵小黑" />
              </div>
            </div>
            <!-- 固定的角落标签 (完全脱离缩放层，绝不模糊) -->
            <span class="bm-slider-tag bm-tag-left">📷 原图 (Input)</span>
            <span class="bm-slider-tag bm-tag-right">✨ 生成结果 (Result)</span>
          </div>

          <!-- 2. 左右分屏对比模式容器 (卡片标题固定1x分辨率不缩放，内部图片同步缩放平移) -->
          <div class="bm-lightbox-compare-container" id="bm-lb-compare-wrap" style="display: none;">
            <!-- 左侧：原图卡片 -->
            <div class="bm-compare-card" id="bm-card-orig">
              <div class="bm-compare-header">
                <span class="bm-badge bm-badge-orig">📷 原图 (Input)</span>
                <span class="bm-compare-filename" id="bm-orig-name">原图</span>
              </div>
              <div class="bm-compare-img-wrap" id="bm-orig-img-wrap">
                <img id="bm-compare-orig-img" class="bm-compare-img" src="" alt="原图" />
              </div>
            </div>

            <!-- 中间 VS 徽章 -->
            <div class="bm-compare-divider">
              <span class="bm-divider-badge">VS</span>
            </div>

            <!-- 右侧：生成结果卡片 -->
            <div class="bm-compare-card" id="bm-card-result">
              <div class="bm-compare-header">
                <span class="bm-badge bm-badge-result">✨ 生成结果 (Result)</span>
                <span class="bm-compare-filename" id="bm-result-name">结果图</span>
                <button class="bm-compare-dl-btn" id="bm-dl-card-result">⬇️ 下载结果图</button>
              </div>
              <div class="bm-compare-img-wrap" id="bm-result-img-wrap">
                <img id="bm-compare-result-img" class="bm-compare-img" src="" alt="结果图" />
              </div>
            </div>
          </div>

          <!-- 3. 单图模式容器 (展示全屏生成大图) -->
          <div class="bm-lightbox-img-wrap" id="bm-lb-img-wrap" style="display: none;">
            <img id="bm-lb-main-img" class="bm-lightbox-img" src="" alt="大图预览" />
          </div>

          <button class="bm-lightbox-nav bm-lightbox-next" id="bm-lb-next" title="下一张 (→)">›</button>
        </div>
      </div>
    `;

    const div = document.createElement("div");
    div.innerHTML = html.trim();
    document.body.appendChild(div.firstChild);
    this.root = document.getElementById("bm-lightbox-root");
  }

  bindEvents() {
    const closeBtn = document.getElementById("bm-lb-close");
    const prevBtn = document.getElementById("bm-lb-prev");
    const nextBtn = document.getElementById("bm-lb-next");
    const zoomInBtn = document.getElementById("bm-lb-zoom-in");
    const zoomOutBtn = document.getElementById("bm-lb-zoom-out");
    const zoomResetBtn = document.getElementById("bm-lb-zoom-reset");
    const downloadBtn = document.getElementById("bm-lb-download");
    const dlCardResult = document.getElementById("bm-dl-card-result");

    const btnSlider = document.getElementById("bm-btn-mode-slider");
    const btnSplit = document.getElementById("bm-btn-mode-split");
    const btnSingle = document.getElementById("bm-btn-mode-single");

    const body = document.getElementById("bm-lb-body");
    const sliderWrap = document.getElementById("bm-lb-slider-wrap");
    const handle = document.getElementById("bm-slider-handle");
    const line = document.getElementById("bm-slider-line");

    closeBtn.onclick = () => this.close();
    prevBtn.onclick = (e) => { e.stopPropagation(); this.prev(); };
    nextBtn.onclick = (e) => { e.stopPropagation(); this.next(); };

    zoomInBtn.onclick = () => this.setZoom(this.scale * 1.25);
    zoomOutBtn.onclick = () => this.setZoom(this.scale / 1.25);
    zoomResetBtn.onclick = () => this.resetTransform(true);

    // 模式切换
    btnSlider.onclick = (e) => { e.stopPropagation(); this.setMode("slider"); };
    btnSplit.onclick = (e) => { e.stopPropagation(); this.setMode("split"); };
    btnSingle.onclick = (e) => { e.stopPropagation(); this.setMode("single"); };

    // 下载处理
    downloadBtn.onclick = () => this.downloadCurrentResult();
    if (dlCardResult) dlCardResult.onclick = (e) => { e.stopPropagation(); this.downloadCurrentResult(); };

    // 滑块把手与分割线拖动交互
    const onSlideMove = (e) => {
      if (!this.isSliding || !sliderWrap) return;
      const rect = sliderWrap.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.applySliderRatio(ratio);
    };

    const onSlideEnd = () => {
      if (this.isSliding) {
        this.isSliding = false;
        window.removeEventListener("pointermove", onSlideMove);
        window.removeEventListener("pointerup", onSlideEnd);
        window.removeEventListener("pointercancel", onSlideEnd);
      }
    };

    const startSlide = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isSliding = true;
      handle.setPointerCapture?.(e.pointerId);
      window.addEventListener("pointermove", onSlideMove);
      window.addEventListener("pointerup", onSlideEnd);
      window.addEventListener("pointercancel", onSlideEnd);
    };

    handle.addEventListener("pointerdown", startSlide);
    line.addEventListener("pointerdown", startSlide);

    // 记录拖拽位移，区分是平移大图还是点击空白处
    this.hasDragged = false;
    let downX = 0;
    let downY = 0;

    // 鼠标滚轮缩放 (像 Figma 一样：以鼠标当前指向的点为几何中心进行精准放大/缩小细节)
    body.addEventListener("wheel", (e) => {
      e.preventDefault();

      let zoomFactor;
      if (Math.abs(e.deltaY) < 40) {
        // 触控板平滑手势 / 细微滚轮 (对数平滑步进)
        const delta = -e.deltaY * 0.005;
        zoomFactor = Math.exp(delta);
      } else {
        // 普通鼠标滚轮步进 (每次滚轮滚动一个固定挡位约 18%)
        const step = 1.18;
        zoomFactor = e.deltaY < 0 ? step : (1 / step);
      }

      this.setZoom(this.scale * zoomFactor, { x: e.clientX, y: e.clientY });
    }, { passive: false });

    // 双击快捷缩放：双击以鼠标点为中心放大至 2.5x，再次双击还原
    body.addEventListener("dblclick", (e) => {
      if (e.target.closest(".bm-lightbox-nav") || e.target.closest(".bm-lightbox-tools") || 
          e.target.closest(".bm-slider-handle") || e.target.closest(".bm-compare-dl-btn")) return;
      if (this.scale > 1.2) {
        this.resetTransform(true);
      } else {
        this.setZoom(2.5, { x: e.clientX, y: e.clientY });
      }
    });

    // 鼠标拖拽平移画布
    body.addEventListener("mousedown", (e) => {
      if (e.target.closest(".bm-lightbox-nav") || e.target.closest(".bm-lightbox-tools") || 
          e.target.closest(".bm-slider-handle") || e.target.closest(".bm-slider-line") || 
          e.target.closest(".bm-compare-dl-btn")) return;
      if (e.button !== 0 && e.button !== 1) return;
      this.isDragging = true;
      this.hasDragged = false;
      downX = e.clientX;
      downY = e.clientY;
      this.startX = e.clientX - this.translateX;
      this.startY = e.clientY - this.translateY;
      body.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) {
        this.hasDragged = true;
      }
      this.translateX = e.clientX - this.startX;
      this.translateY = e.clientY - this.startY;
      this.updateTransform();
    });

    window.addEventListener("mouseup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        body.style.cursor = this.scale > 1.05 ? "grab" : "default";
      }
    });

    // 阻止浏览器默认图片拖拽虚影
    body.addEventListener("dragstart", (e) => {
      e.preventDefault();
    });

    // 点击空白黑色遮罩背景关闭灯箱
    this.root.addEventListener("click", (e) => {
      if (this.hasDragged || this.isSliding) {
        this.hasDragged = false;
        return;
      }
      if (e.target.closest(".bm-lightbox-slider-container") || e.target.closest(".bm-compare-card") || 
          e.target.closest("#bm-lb-main-img") || e.target.closest(".bm-lightbox-tools") || 
          e.target.closest(".bm-lightbox-nav")) {
        return;
      }
      this.close();
    });

    // 键盘快捷键监听
    window.addEventListener("keydown", (e) => {
      if (!this.root.classList.contains("active")) return;
      if (e.key === "Escape") {
        this.close();
      } else if (e.key === "ArrowLeft") {
        this.prev();
      } else if (e.key === "ArrowRight") {
        this.next();
      } else if (e.key === "c" || e.key === "C") {
        this.cycleMode();
      } else if (e.key === "1") {
        this.setMode("slider");
      } else if (e.key === "2") {
        this.setMode("split");
      } else if (e.key === "3") {
        this.setMode("single");
      } else if (e.key === "+" || e.key === "=") {
        this.setZoom(this.scale * 1.25);
      } else if (e.key === "-") {
        this.setZoom(this.scale / 1.25);
      } else if (e.key === "0") {
        this.resetTransform(true);
      }
    });
  }

  open(items, index = 0) {
    if (!items || items.length === 0) return;
    this.items = items;
    this.currentIndex = Math.max(0, Math.min(index, items.length - 1));
    this.root.classList.add("active");
    // 每次打开灯箱，读取并应用存储的模式偏好（默认滑块对比）
    this.viewMode = this.getSavedMode();
    this.resetTransform();
    this.render();
  }

  close() {
    this.root.classList.remove("active");
    this.resetTransform();
  }

  prev() {
    if (!this.items || this.items.length <= 1) return;
    this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
    this.resetTransform();
    this.render();
  }

  next() {
    if (!this.items || this.items.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.items.length;
    this.resetTransform();
    this.render();
  }

  setMode(mode) {
    if (mode !== "slider" && mode !== "split" && mode !== "single") {
      mode = "slider";
    }
    // 立即持久化存储用户的模式设置
    this.saveMode(mode);

    const current = this.items[this.currentIndex];
    const canCompare = !!(current && current.orig_url && current.orig_url !== current.url);

    if (!canCompare && (mode === "slider" || mode === "split")) {
      this.viewMode = "single";
    } else {
      this.viewMode = mode;
    }
    this.resetTransform();
    this.render();
  }

  cycleMode() {
    const current = this.items[this.currentIndex];
    const canCompare = !!(current && current.orig_url && current.orig_url !== current.url);
    if (!canCompare) return;

    if (this.viewMode === "slider") {
      this.setMode("split");
    } else if (this.viewMode === "split") {
      this.setMode("single");
    } else {
      this.setMode("slider");
    }
  }

  applySliderRatio(ratio) {
    this.sliderRatio = Math.max(0, Math.min(1, ratio));
    const percent = `${(this.sliderRatio * 100).toFixed(2)}%`;
    const clipWrap = document.getElementById("bm-slider-clip-wrap");
    const line = document.getElementById("bm-slider-line");
    const handle = document.getElementById("bm-slider-handle");

    if (clipWrap) clipWrap.style.clipPath = `inset(0 0 0 ${percent})`;
    if (line) line.style.left = percent;
    if (handle) handle.style.left = percent;
  }

  setZoom(newScale, centerPoint = null) {
    const minScale = 0.2;
    const maxScale = 10.0;
    const clampedScale = Math.max(minScale, Math.min(newScale, maxScale));
    if (Math.abs(clampedScale - this.scale) < 0.0001) return;

    const k = clampedScale / this.scale;
    const body = document.getElementById("bm-lb-body");

    let mx = 0;
    let my = 0;

    if (centerPoint && typeof centerPoint.x === "number" && typeof centerPoint.y === "number" && body) {
      const rect = body.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      mx = centerPoint.x - cx;
      my = centerPoint.y - cy;
    }

    // 以鼠标所在坐标 (mx, my) 为中心进行等比缩放的位移推导：
    this.translateX = mx - (mx - this.translateX) * k;
    this.translateY = my - (my - this.translateY) * k;
    this.scale = clampedScale;

    this.updateTransform();
  }

  resetTransform(animated = false) {
    this.scale = 1.0;
    this.translateX = 0;
    this.translateY = 0;

    const sliderWrap = document.getElementById("bm-lb-slider-wrap");
    const compareWrap = document.getElementById("bm-lb-compare-wrap");
    const singleWrap = document.getElementById("bm-lb-img-wrap");

    const sliderViewport = document.getElementById("bm-slider-viewport");
    const origImg = document.getElementById("bm-compare-orig-img");
    const resultImg = document.getElementById("bm-compare-result-img");
    const singleImg = document.getElementById("bm-lb-main-img");

    // 彻底清除内部可能残留的旧局部变换，确保图片在各自容器中保持原位自然展现
    if (sliderViewport) sliderViewport.style.transform = "none";
    if (origImg) origImg.style.transform = "none";
    if (resultImg) resultImg.style.transform = "none";
    if (singleImg) singleImg.style.transform = "none";

    let target = null;
    if (this.viewMode === "slider") target = sliderWrap;
    else if (this.viewMode === "split") target = compareWrap;
    else target = singleWrap;

    if (sliderWrap && sliderWrap !== target) sliderWrap.style.transform = "none";
    if (compareWrap && compareWrap !== target) compareWrap.style.transform = "none";
    if (singleWrap && singleWrap !== target) singleWrap.style.transform = "none";

    if (animated && target) {
      target.style.transition = "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
      this.updateTransform();
      setTimeout(() => {
        if (target) target.style.transition = "none";
      }, 200);
    } else {
      if (target) target.style.transition = "none";
      this.updateTransform();
    }
  }

  updateTransform() {
    const body = document.getElementById("bm-lb-body");
    const resetBtn = document.getElementById("bm-lb-zoom-reset");
    const sliderWrap = document.getElementById("bm-lb-slider-wrap");
    const compareWrap = document.getElementById("bm-lb-compare-wrap");
    const singleWrap = document.getElementById("bm-lb-img-wrap");

    const transformStr = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;

    // 对比模式下，移动与缩放的是一整块舞台（包括卡片、标题、分割线等全局元素），绝不只单独放缩内部图片
    if (this.viewMode === "slider" && sliderWrap) {
      sliderWrap.style.transform = transformStr;
      sliderWrap.style.transformOrigin = "center center";
    } else if (this.viewMode === "split" && compareWrap) {
      compareWrap.style.transform = transformStr;
      compareWrap.style.transformOrigin = "center center";
    } else if (singleWrap) {
      singleWrap.style.transform = transformStr;
      singleWrap.style.transformOrigin = "center center";
    }

    if (resetBtn) {
      resetBtn.innerText = `↺ ${Math.round(this.scale * 100)}%`;
      resetBtn.title = `重置缩放至 100% (当前: ${Math.round(this.scale * 100)}%, 快捷键: 0)`;
    }

    if (!this.isDragging && body) {
      body.style.cursor = this.scale > 1.05 ? "grab" : "default";
    }
  }

  render() {
    const current = this.items[this.currentIndex];
    if (!current) return;

    // 智能补全原图信息 (从输入节点按序号精准对齐)
    if (!current.orig_url) {
      const loaderNode = window.app?.graph?._nodes?.find(n => {
        const c = n.comfyClass || n.type || "";
        const t = n.title || "";
        return c === "BatchImageLoader" || c === "喵小黑批量" || c === "喵小黑批量输入" || 
               c.includes("BatchImageLoader") || t.includes("图片输入") || t.includes("Batch Loader");
      });
      if (loaderNode && loaderNode.batchState?.files) {
        const matchIdx = typeof current.index === "number" ? (current.index - 1) : this.currentIndex;
        const origFile = loaderNode.batchState.files[matchIdx];
        if (origFile) {
          current.orig_url = origFile.url;
          current.original_filename = origFile.filename;
        }
      }
    }

    const titleEl = document.getElementById("bm-lb-title");
    const btnSlider = document.getElementById("bm-btn-mode-slider");
    const btnSplit = document.getElementById("bm-btn-mode-split");
    const btnSingle = document.getElementById("bm-btn-mode-single");

    const sliderWrap = document.getElementById("bm-lb-slider-wrap");
    const compareWrap = document.getElementById("bm-lb-compare-wrap");
    const singleWrap = document.getElementById("bm-lb-img-wrap");

    const prevBtn = document.getElementById("bm-lb-prev");
    const nextBtn = document.getElementById("bm-lb-next");

    const sliderOrigImg = document.getElementById("bm-slider-orig-img");
    const sliderResultImg = document.getElementById("bm-slider-result-img");

    const origImg = document.getElementById("bm-compare-orig-img");
    const resultImg = document.getElementById("bm-compare-result-img");
    const origName = document.getElementById("bm-orig-name");
    const resultName = document.getElementById("bm-result-name");
    const singleImg = document.getElementById("bm-lb-main-img");

    const canCompare = !!(current.orig_url && current.orig_url !== current.url);
    const savedMode = this.getSavedMode();

    if (canCompare) {
      btnSlider.disabled = false;
      btnSplit.disabled = false;
      btnSingle.disabled = false;

      btnSlider.title = "滑块卷帘对比：左右拖动喵小黑滑块比对细节 (快捷键: 1 或 C)";
      btnSplit.title = "左右双屏对比：左右并排查看原图与结果 (快捷键: 2 或 C)";
      btnSingle.title = "单图模式：仅查看生成结果大图 (快捷键: 3 或 C)";

      // 若当前模式因之前无对比图被临时设为 single，而用户的存储偏好是对比，则自动还原用户偏好
      if (this.viewMode === "single" && savedMode !== "single") {
        this.viewMode = savedMode;
      } else if (this.viewMode !== "slider" && this.viewMode !== "split" && this.viewMode !== "single") {
        this.viewMode = savedMode || "slider";
      }

      btnSlider.classList.toggle("is-active", this.viewMode === "slider");
      btnSplit.classList.toggle("is-active", this.viewMode === "split");
      btnSingle.classList.toggle("is-active", this.viewMode === "single");

      if (this.viewMode === "slider") {
        sliderWrap.style.display = "block";
        compareWrap.style.display = "none";
        singleWrap.style.display = "none";

        sliderOrigImg.src = current.orig_url;
        sliderResultImg.src = current.url;
        this.applySliderRatio(this.sliderRatio);

        titleEl.innerText = `[${this.currentIndex + 1} / ${this.items.length}] 🐱 滑块卷帘对比: ${current.filename}`;
      } else if (this.viewMode === "split") {
        sliderWrap.style.display = "none";
        compareWrap.style.display = "flex";
        singleWrap.style.display = "none";

        origImg.src = current.orig_url;
        resultImg.src = current.url;

        origName.innerText = current.original_filename || "原图";
        origName.title = current.original_filename || "原图";

        resultName.innerText = current.filename || "生成结果";
        resultName.title = current.filename || "生成结果";

        titleEl.innerText = `[${this.currentIndex + 1} / ${this.items.length}] 🔀 左右双屏对比: ${current.filename}`;
      } else {
        // 单图模式
        sliderWrap.style.display = "none";
        compareWrap.style.display = "none";
        singleWrap.style.display = "flex";

        singleImg.src = current.url;
        titleEl.innerText = `[${this.currentIndex + 1} / ${this.items.length}] 🖼️ 结果大图: ${current.filename}`;
      }
    } else {
      // 仅单张图
      this.viewMode = "single";
      btnSlider.disabled = true;
      btnSplit.disabled = true;
      btnSingle.disabled = false;
      btnSlider.title = "当前仅有单张原图，暂无对比结果";
      btnSplit.title = "当前仅有单张原图，暂无对比结果";

      btnSlider.classList.remove("is-active");
      btnSplit.classList.remove("is-active");
      btnSingle.classList.add("is-active");

      sliderWrap.style.display = "none";
      compareWrap.style.display = "none";
      singleWrap.style.display = "flex";

      singleImg.src = current.url;
      titleEl.innerText = `[${this.currentIndex + 1} / ${this.items.length}] ${current.filename}`;
    }

    // 翻页导航箭头 (两张及以上图片时始终展示两侧箭头，支持循环切换)
    const hasMultiple = this.items.length > 1;
    prevBtn.style.display = hasMultiple ? "flex" : "none";
    nextBtn.style.display = hasMultiple ? "flex" : "none";
    prevBtn.title = hasMultiple ? "上一张 (支持循环切换，快捷键: ←)" : "";
    nextBtn.title = hasMultiple ? "下一张 (支持循环切换，快捷键: →)" : "";

    this.updateTransform();
  }

  downloadUrl(url, filename) {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "image.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  downloadCurrentResult() {
    const current = this.items[this.currentIndex];
    if (!current || !current.url) return;
    this.downloadUrl(current.url, current.filename || "batch_result.png");
  }

  downloadCurrentOrig() {
    const current = this.items[this.currentIndex];
    if (!current || !current.orig_url) return;
    this.downloadUrl(current.orig_url, current.original_filename || "original_input.png");
  }
}

export const lightboxInstance = new BatchLightbox();
