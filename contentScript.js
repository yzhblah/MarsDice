// contentScript.js
(() => {
    const DEFAULT_ASSETS = [
      chrome.runtime.getURL("assets/album1.png"),
      chrome.runtime.getURL("assets/album2.png"),
      chrome.runtime.getURL("assets/album3.png"),
      chrome.runtime.getURL("assets/album4.png"),
      chrome.runtime.getURL("assets/album5.png"),
      chrome.runtime.getURL("assets/album6.png")
    ];
    const DEFAULT_LOGO = chrome.runtime.getURL("assets/logo.png");
    const STORAGE_KEY = "mars_dice_images_v1";
    const POSITION_KEY = "mars_dice_position_v1";
  
    // Create container
    const container = document.createElement("div");
    container.id = "mars-dice-container";
    container.innerHTML = `
      <div id="mars-dice">
        <div id="mars-cube" class="cube" aria-hidden="true">
          <div class="face face-1"><img alt="面1" draggable="false" /></div>
          <div class="face face-2"><img alt="面2" draggable="false" /></div>
          <div class="face face-3"><img alt="面3" draggable="false" /></div>
          <div class="face face-4"><img alt="面4" draggable="false" /></div>
          <div class="face face-5"><img alt="面5" draggable="false" /></div>
          <div class="face face-6"><img alt="面6" draggable="false" /></div>
        </div>
        <img id="dice-logo" alt="火星骰子" draggable="false" />
      </div>
      <div id="dice-face-label"></div>
      <div id="mars-dice-menu" class="hidden">
        <ul class="cm-list" role="menu">
          <li class="cm-item" role="menuitem" data-action="open-customize">自定义骰面</li>
          <li class="cm-sep" role="separator"></li>
          <li class="cm-item" role="menuitem" data-action="restore-defaults">恢复默认骰面</li>
        </ul>
      </div>
  
      <div id="mars-dice-modal" class="hidden" aria-hidden="true">
        <div class="modal-box">
          <div class="modal-header">
            <span>自定义骰面</span>
            <button id="modal-close">✕</button>
          </div>
          <div class="modal-content">
            <div id="upload-grid"></div>
            <div class="modal-actions">
              <input id="file-input" type="file" accept="image/*" multiple style="display:none" />
              <button id="choose-files">上传多张图片</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);
  
    // Styles will be injected from styles.css (content script includes CSS file)
  
    const dice = document.getElementById("mars-dice");
    const cube = container.querySelector("#mars-cube");
    const cubeFaces = Array.from(container.querySelectorAll("#mars-cube .face img"));
    const diceLogo = container.querySelector("#dice-logo");
    const faceLabel = container.querySelector("#dice-face-label");
    const menu = document.getElementById("mars-dice-menu");
    const modal = document.getElementById("mars-dice-modal");
    const uploadGrid = document.getElementById("upload-grid");
    const fileInput = document.getElementById("file-input");
    const chooseFilesBtn = document.getElementById("choose-files");
    const modalClose = document.getElementById("modal-close");
    // menu actions will be handled via delegation on menu
  
    // state
    let currentFaces = [...DEFAULT_ASSETS]; // array of 6 image URLs (or data URLs)
    let isRolling = false;
    let rotX = 0, rotY = 0; // accumulated cube rotation
    let slotElements = []; // for modal previews
    let hasRolled = false; // control idle logo visibility
    let faceLabelTimer = null; // timer to auto-hide face label

    // Validation & processing config
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per image
    const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"]; // keep common types
    const OUTPUT_SIZE = 512; // square output size to normalize assets
    const OUTPUT_TYPE = "image/png"; // unify encoding to reduce quota usage and ensure alpha

    // Validate file type and size
    function validateFile(file) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error("仅支持 PNG/JPEG/WEBP 图片。");
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("图片过大哦，请控制在 2MB 以内。");
      }
    }

    // Read file to ImageBitmap or HTMLImageElement
    async function readToBitmap(file) {
      try {
        return await createImageBitmap(file);
      } catch {
        // Fallback for older engines
        const dataUrl = await fileToDataUrl(file);
        return await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = (e) => reject(e);
          img.src = dataUrl;
        });
      }
    }

    // Center-crop to square and resize to OUTPUT_SIZE
    async function processFile(file) {
      validateFile(file);
      const bmp = await readToBitmap(file);
      const sw = bmp.width || bmp.naturalWidth;
      const sh = bmp.height || bmp.naturalHeight;
      const side = Math.min(sw, sh);
      const sx = Math.floor((sw - side) / 2);
      const sy = Math.floor((sh - side) / 2);

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      return canvas.toDataURL(OUTPUT_TYPE);
    }

    // Unified storage save with error handling and retry advice
    function saveFacesArray(nextFaces, onSuccess, successMsg) {
      chrome.storage.local.set({ [STORAGE_KEY]: nextFaces }, () => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) {
          const msg = String(err.message || err);
          const quota = /QUOTA|quota|Bytes|bytes/.test(msg);
          const advice = quota
            ? "存储空间可能不足。建议：1) 使用更小的图片（2MB 以下、512×512）、2) 清理部分浏览器本地存储、3) 减少自定义面数量再重试。"
            : "请检查网络/浏览器状态后重试。";
          const retry = confirm("保存失败：" + msg + "\n" + advice + "\n是否重试？");
          if (retry) {
            // 简单重试一次
            chrome.storage.local.set({ [STORAGE_KEY]: nextFaces }, () => {
              const err2 = chrome.runtime && chrome.runtime.lastError;
              if (err2) {
                alert("重试仍失败：" + (err2.message || err2));
              } else {
                currentFaces = nextFaces.slice();
                updateCubeFaces();
                if (typeof onSuccess === 'function') onSuccess();
                if (successMsg) alert(successMsg);
              }
            });
          }
          return;
        }
        currentFaces = nextFaces.slice();
        updateCubeFaces();
        if (typeof onSuccess === 'function') onSuccess();
        if (successMsg) alert(successMsg);
      });
    }
  
    // Load saved images from storage
    function loadSaved() {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const saved = res[STORAGE_KEY];
        if (saved && Array.isArray(saved) && saved.length === 6) {
          currentFaces = saved.slice();
        } else {
          currentFaces = DEFAULT_ASSETS.slice();
        }
        updateCubeFaces();
        // show logo on initial idle state if not rolled yet
        if (diceLogo && !hasRolled) {
          diceLogo.src = DEFAULT_LOGO;
          diceLogo.style.display = "block";
          if (cube) cube.style.visibility = "hidden"; // avoid overlap: hide cube while showing logo
        } else {
          if (cube) cube.style.visibility = "visible"; // ensure cube visible when not showing logo
        }
        if (faceLabel) faceLabel.style.display = "none";
      });
    }
    loadSaved();
  
  // Prevent default context menu and show custom menu
  dice.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    toggleMenuAt(e.clientX, e.clientY);
  });

  // Drag & click discrimination (support left-button drag to move)
  let isDragging = false, isMouseDown = false, dragMoved = false, startX=0, startY=0, startLeft=0, startTop=0, lastPointerX=0;
  // runtime peek state: 'right' or null
  let peekState = null;
  const DRAG_THRESHOLD_PX = 4; // movement to treat as drag instead of click

  dice.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return; // only left button for drag/click
    ev.preventDefault();
    isMouseDown = true;
    dragMoved = false;
    const rect = container.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);
  });

  function clampToViewport(left, top) {
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = container.offsetWidth || 80; // fallback size
    const ch = container.offsetHeight || 80;
    const minLeft = margin;
    const minTop = margin;
    const maxLeft = Math.max(margin, vw - cw - margin);
    const maxTop = Math.max(margin, vh - ch - margin);
    return {
      left: Math.max(minLeft, Math.min(left, maxLeft)),
      top: Math.max(minTop, Math.min(top, maxTop))
    };
  }

  // Apply position without clamping (used for edge peeking)
  function applyPositionRaw(left, top) {
    container.style.left = `${Math.round(left)}px`;
    container.style.top = `${Math.round(top)}px`;
    container.style.right = "auto";
    container.style.bottom = "auto";
  }

  // Clamp only vertical position (keep left as-is for peeking)
  function clampTopOnly(top) {
    const margin = 8;
    const vh = window.innerHeight;
    const ch = container.offsetHeight || 80;
    const minTop = margin;
    const maxTop = Math.max(margin, vh - ch - margin);
    return Math.max(minTop, Math.min(top, maxTop));
  }

  function applyPosition(left, top) {
    const clamped = clampToViewport(left, top);
    container.style.left = clamped.left + "px";
    container.style.top = clamped.top + "px";
    container.style.right = "auto";
    container.style.bottom = "auto";
  }

  function savePosition(left, top) {
    const clamped = clampToViewport(left, top);
    chrome.storage.local.set({ [POSITION_KEY]: clamped });
  }

  // Save with peek meta
  function savePositionWithPeek(left, top, peek) {
    chrome.storage.local.set({ [POSITION_KEY]: { left: Math.round(left), top: Math.round(top), peek } });
  }

  function restorePosition() {
    chrome.storage.local.get([POSITION_KEY], (res) => {
      const pos = res[POSITION_KEY];
      if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
        // Handle peek state if present
        if (pos.peek === 'left' || pos.peek === 'right') {
          const cw = container.offsetWidth || 80;
          const vh = window.innerHeight;
          const vw = window.innerWidth;
          const top = Math.max(8, Math.min(pos.top, vh - (container.offsetHeight || 80) - 8));
          if (pos.peek === 'left') {
            applyPositionRaw(-cw / 2, top);
          } else {
            applyPositionRaw(vw - cw / 2, top);
          }
          // 在半隐藏状态保持骰子可见，不强制显示 logo
          if (diceLogo) diceLogo.style.display = 'none';
          if (cube) cube.style.visibility = 'visible';
          // set runtime peek flag so click-to-unpeek works
          peekState = pos.peek;
        } else {
          applyPosition(pos.left, pos.top);
        }
      }
    });
  }

  function dragMove(e) {
    if (!isMouseDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    lastPointerX = e.clientX; // track latest pointer X for edge-exit detection
    if (!dragMoved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
      dragMoved = true;
      isDragging = true;
    }
    if (isDragging) {
      const nextLeft = startLeft + dx;
      const nextTop = startTop + dy;
      const vw = window.innerWidth;
      const cw = container.offsetWidth || 80;
      const clampedTop = clampTopOnly(nextTop);
      // 左侧半隐藏：向左拖动超过半宽
      if (nextLeft <= -cw / 2) {
        applyPositionRaw(-cw / 2, clampedTop);
        peekState = 'left';
      }
      // 右侧半隐藏：向右拖动超过半宽
      else if (nextLeft >= vw - cw / 2) {
        applyPositionRaw(vw - cw / 2, clampedTop);
        peekState = 'right';
      } else {
        applyPosition(nextLeft, nextTop);
        // 退出半隐藏
        if (peekState) peekState = null;
      }
    }
  }
  function dragEnd() {
    document.removeEventListener("mousemove", dragMove);
    document.removeEventListener("mouseup", dragEnd);
    isMouseDown = false;
    if (isDragging) {
      const rect = container.getBoundingClientRect();
      const vw = window.innerWidth;
      const cw = rect.width;
      const clampedTop = clampTopOnly(rect.top);
      if (peekState === 'right') {
        const targetLeft = vw - cw / 2;
        applyPositionRaw(targetLeft, clampedTop);
        savePositionWithPeek(targetLeft, clampedTop, 'right');
      } else if (peekState === 'left') {
        const targetLeft = -cw / 2;
        applyPositionRaw(targetLeft, clampedTop);
        savePositionWithPeek(targetLeft, clampedTop, 'left');
      } else {
        // normal save inside viewport
        savePosition(rect.left, clampedTop);
      }
    }
    isDragging = false;
  }

  // Left-click -> roll (only if not dragged)
  dice.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (dragMoved) { dragMoved = false; return; }
    if (isRolling) return;
    // 若处于半隐藏，先完全显现到可见区域，再投掷
    if (peekState === 'right' || peekState === 'left') {
      const rect = container.getBoundingClientRect();
      const vw = window.innerWidth;
      const cw = rect.width;
      const clampedTop = clampTopOnly(rect.top);
      // 右侧从 (vw - cw/2) 滑回到 (vw - cw - 8)
      // 左侧从 (-cw/2) 滑回到 (8)
      const targetLeft = (peekState === 'right') ? (vw - cw - 8) : 8;
      applyPosition(targetLeft, clampedTop);
      savePosition(targetLeft, clampedTop);
      peekState = null;
      if (diceLogo) diceLogo.style.display = 'none';
      if (cube) cube.style.visibility = 'visible';
    }
    rollDice();
  });
  
    // Toggle menu at position
  function toggleMenuAt(x, y) {
    if (menu.classList.contains("hidden")) {
      // show invisibly to measure size
      menu.classList.remove("hidden");
      const prevVisibility = menu.style.visibility;
      menu.style.visibility = "hidden";
      // initial position near cursor, then resolve overlap with dice and clamp
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const margin = 8;
      const diceRect = dice.getBoundingClientRect();

      // preferred positions to avoid overlap: right, left, bottom, top of dice
      const candidates = [
        { left: diceRect.right + margin, top: y },
        { left: diceRect.left - mw - margin, top: y },
        { left: x, top: diceRect.bottom + margin },
        { left: x, top: diceRect.top - mh - margin },
        { left: x, top: y } // fallback: cursor
      ];

      function clamp(pos) {
        return {
          left: Math.max(margin, Math.min(pos.left, vw - mw - margin)),
          top: Math.max(margin, Math.min(pos.top, vh - mh - margin))
        };
      }
      function overlapsDice(pos) {
        const r = { left: pos.left, top: pos.top, right: pos.left + mw, bottom: pos.top + mh };
        return !(r.right <= diceRect.left || r.left >= diceRect.right || r.bottom <= diceRect.top || r.top >= diceRect.bottom);
      }

      let placed = clamp(candidates[0]);
      for (let i = 0; i < candidates.length; i++) {
        const c = clamp(candidates[i]);
        if (!overlapsDice(c)) { placed = c; break; }
      }

      menu.style.left = `${placed.left}px`;
      menu.style.top = `${placed.top}px`;
      // make visible
      menu.style.visibility = prevVisibility || "";
      // Close on outside click
      setTimeout(() => {
        const closeHandler = (ev) => {
          if (!menu.contains(ev.target)) {
            menu.classList.add("hidden");
            document.removeEventListener("mousedown", closeHandler);
          }
        };
        document.addEventListener("mousedown", closeHandler);
      }, 0);
    } else {
      menu.classList.add("hidden");
    }
  }
  
    // Update cube faces images to match currentFaces
    function updateCubeFaces() {
      if (!cubeFaces || cubeFaces.length !== 6) return;
      for (let i = 0; i < 6; i++) {
        cubeFaces[i].src = currentFaces[i] || DEFAULT_LOGO;
      }
    }

    // Canonical upright orientation for each face (idx 0..5)
    function getFaceOrientation(idx) {
      switch (idx) {
        case 0: return { x: 0, y: 0 };     // face-1 front
        case 1: return { x: 0, y: -90 };   // face-2 right -> front
        case 2: return { x: 0, y: 180 };   // face-3 back -> front
        case 3: return { x: 0, y: 90 };    // face-4 left -> front
        case 4: return { x: -90, y: 0 };   // face-5 top -> front
        case 5: return { x: 90, y: 0 };    // face-6 bottom -> front
        default: return { x: 0, y: 0 };
      }
    }

    // Unbiased random int in [0, n)
    function randInt(n) {
      const maxUint32 = 0x100000000; // 2^32
      const threshold = Math.floor(maxUint32 / n) * n; // largest multiple of n <= 2^32
      const buf = new Uint32Array(1);
      while (true) {
        crypto.getRandomValues(buf);
        const v = buf[0];
        if (v < threshold) return v % n;
      }
    }

    // Roll animation: realistic 3D rotation to a random face
    function rollDice() {
      isRolling = true;
      // hide idle logo during rolling
      if (diceLogo) diceLogo.style.display = "none";
      if (cube) cube.style.visibility = "visible"; // ensure cube visible when rolling starts
      if (faceLabel) {
        faceLabel.style.display = "none";
        if (faceLabelTimer) { clearTimeout(faceLabelTimer); faceLabelTimer = null; }
      }
      const duration = 2500; // 3s roll duration

      // target face (0..5)
      const idx = randInt(6);
      const { x: targetX, y: targetY } = getFaceOrientation(idx);

      // add some extra random full spins on each axis for realism
      const extraTurnsX = 360 * (2 + Math.floor(Math.random() * 3)); // 2-4 turns
      const extraTurnsY = 360 * (2 + Math.floor(Math.random() * 3));

      // randomly flip spin direction
      const sx = Math.random() < 0.5 ? -1 : 1;
      const sy = Math.random() < 0.5 ? -1 : 1;

      // Use absolute canonical orientation to keep images upright (no cumulative drift)
      rotX = targetX + sx * extraTurnsX;
      rotY = targetY + sy * extraTurnsY;

      // apply transform with easing
      cube.style.transition = `transform ${duration}ms cubic-bezier(0.19, 1, 0.22, 1)`; // easeOutExpo-like
      cube.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;

      const onEnd = () => {
        cube.removeEventListener('transitionend', onEnd);
        dice.classList.add("dice-result");
        setTimeout(() => dice.classList.remove("dice-result"), 200);
        // cleanup transition to allow immediate style updates later
        cube.style.transition = "";
        // snap to canonical orientation to guarantee upright final image
        rotX = targetX;
        rotY = targetY;
        cube.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
        // 投掷结束后，按新需求：保持骰子可见，不强制显示 logo
        if (cube) cube.style.visibility = 'visible';
        if (diceLogo) diceLogo.style.display = 'none';
        isRolling = false;
        hasRolled = true; // keep logo hidden after first result
        // show face label
        if (faceLabel) {
          faceLabel.textContent = String(idx + 1);
          faceLabel.style.display = "inline-flex";
          if (faceLabelTimer) { clearTimeout(faceLabelTimer); }
          faceLabelTimer = setTimeout(() => {
            faceLabel.style.display = "none";
            faceLabelTimer = null;
          }, 2000);
        }
      };
      cube.addEventListener('transitionend', onEnd, { once: true });
    }
  
    // Modal & customization logic
    function openModal() {
      menu.classList.add("hidden");
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      // 占位文案，下一帧再渲染，避免空白闪烁
      if (uploadGrid) uploadGrid.textContent = "加载中…";
      requestAnimationFrame(() => renderUploadGrid());
    }
  
    function closeModal() {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
  
    // context menu delegation
    menu.addEventListener("click", (ev) => {
      const item = ev.target.closest('.cm-item');
      if (!item) return;
      const action = item.getAttribute('data-action');
      if (action === 'open-customize') {
        openModal();
      } else if (action === 'restore-defaults') {
        if (confirm('火火确认要恢复默认骰面吗？此操作将覆盖当前自定义图片。')) {
          chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_ASSETS }, () => {
            currentFaces = DEFAULT_ASSETS.slice();
            updateCubeFaces();
            alert("已恢复为默认骰面啦。");
            closeModal();
          });
        }
        menu.classList.add("hidden");
      }
    });
    modalClose.addEventListener("click", closeModal);
  
    // Restore defaults handled in menu delegation above
  
    // Render six preview slots
    function renderUploadGrid() {
      if (!uploadGrid) return;
      uploadGrid.textContent = "加载中…";
      slotElements = [];
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const lastErr = chrome.runtime && chrome.runtime.lastError;
        if (lastErr) {
          console.debug("[mars-dice] storage.get error:", lastErr);
          uploadGrid.textContent = "加载失败，请稍后重试";
          return;
        }
        uploadGrid.innerHTML = "";
        const saved = res[STORAGE_KEY];
        const faces = (saved && Array.isArray(saved) && saved.length === 6) ? saved : DEFAULT_ASSETS;
        for (let i = 0; i < 6; i++) {
          const slot = document.createElement("div");
          slot.className = "upload-slot";
          slot.innerHTML = `
            <div class="slot-index">面 ${i + 1}</div>
            <img class="slot-img" src="${faces[i]}" alt="面 ${i + 1}" />
            <div class="slot-actions">
              <button class="replace-btn" data-index="${i}">替换</button>
              <button class="clear-btn" data-index="${i}">恢复默认</button>
            </div>
          `;
          uploadGrid.appendChild(slot);
          slotElements.push(slot);
        }
      });
    }
  
    // choose files button opens hidden file input
    chooseFilesBtn.addEventListener("click", () => fileInput.click());
  
    // file input can select multiple images; assign them sequentially to slots starting at first empty or replace in order
    fileInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files).slice(0, 6); // limit to 6
      if (!files.length) return;
      // validate and process with center-crop
      const processed = [];
      for (const f of files) {
        try {
          const url = await processFile(f);
          processed.push(url);
        } catch (err) {
          alert("文件跳过：" + (err.message || err));
        }
      }
      if (!processed.length) { fileInput.value = ""; return; }
      // load existing then replace first N slots with uploaded
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const saved = (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY]) && res[STORAGE_KEY].length === 6) ? res[STORAGE_KEY] : DEFAULT_ASSETS.slice();
        for (let i = 0; i < processed.length; i++) {
          saved[i] = processed[i];
        }
        saveFacesArray(saved, () => {
          renderUploadGrid();
        }, "上传并保存成功（已覆盖前 " + processed.length + " 个面）。");
      });
      // reset input to allow same files later
      fileInput.value = "";
    });
  
    // helper: file->dataURL
    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (err) => reject(err);
        fr.readAsDataURL(file);
      });
    }
  
    // Delegated click handlers in uploadGrid for replace / clear
    uploadGrid.addEventListener("click", (e) => {
      const replaceBtn = e.target.closest(".replace-btn");
      const clearBtn = e.target.closest(".clear-btn");
      if (replaceBtn) {
        const idx = Number(replaceBtn.dataset.index);
        // prompt file and replace that idx
        const singleInput = document.createElement("input");
        singleInput.type = "file";
        singleInput.accept = "image/*";
        singleInput.onchange = async (ev) => {
          if (!singleInput.files || !singleInput.files[0]) return;
          try {
            const url = await processFile(singleInput.files[0]);
            chrome.storage.local.get([STORAGE_KEY], (res) => {
              const saved = (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY]) && res[STORAGE_KEY].length === 6) ? res[STORAGE_KEY] : DEFAULT_ASSETS.slice();
              saved[idx] = url;
              saveFacesArray(saved, () => {
                renderUploadGrid();
              });
            });
          } catch (err) {
            alert("替换失败：" + (err.message || err));
          }
        };
        singleInput.click();
      } else if (clearBtn) {
        const idx = Number(clearBtn.dataset.index);
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          const saved = (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY]) && res[STORAGE_KEY].length === 6) ? res[STORAGE_KEY] : DEFAULT_ASSETS.slice();
          saved[idx] = DEFAULT_ASSETS[idx];
          saveFacesArray(saved, () => {
            renderUploadGrid();
          });
        });
      }
    });
  
    // Save button removed; uploads and per-slot actions auto-save immediately.
  
    // Re-render if storage changed elsewhere
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        const val = changes[STORAGE_KEY].newValue;
        if (Array.isArray(val) && val.length === 6) {
          currentFaces = val.slice();
          updateCubeFaces();
        }
      }
    });
  
  // replaced basic drag logic above with left-button drag & click discrimination
  
    // Initial position
    container.style.position = "fixed";
  container.style.right = "20px";
  container.style.bottom = "20px";
    container.style.zIndex = 2147483647; // very top

  // Try restore persisted position after initial attach
  // Use a microtask to ensure offsetWidth/Height available
  setTimeout(() => {
    restorePosition();
    // Ensure on resize we keep it inside viewport
    window.addEventListener("resize", () => {
      const rect = container.getBoundingClientRect();
      applyPosition(rect.left, rect.top);
      savePosition(rect.left, rect.top);
    });
  }, 0);
  
    // small helper to reset storage if needed (commented out)
    // chrome.storage.local.remove(STORAGE_KEY);
  
    // Load saved on init
    loadSaved();
    // Ensure faces set even if storage retrieval is delayed
    updateCubeFaces();
  })();
  