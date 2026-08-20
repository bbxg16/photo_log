(function () {
  "use strict";

  var MAX_PHOTOS = 50;
  var JPEG_QUALITY = 0.96;
  var STITCH_TARGET_WIDTH = 2160;
  var MAX_STITCH_PIXELS = 32000000;
  var THUMB_SIZE = 360;
  var FONT_SIZE_BASE_WIDTH = 720;
  var DEFAULT_FONT_FAMILY = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  var TEXT_COLORS = [
    { name: "White", value: "#ffffff" },
    { name: "Black", value: "#000000" },
    { name: "Red", value: "#ef233c" },
    { name: "Yellow", value: "#ffd60a" },
    { name: "Blue", value: "#2563eb" },
    { name: "Green", value: "#16a34a" }
  ];
  var BG_COLORS = {
    none: "",
    white: "#ffffff",
    black: "#000000"
  };

  var state = {
    photos: [],
    selectedIds: new Set(),
    editorIds: [],
    editorIndex: 0,
    activeTextId: null,
    stitchIds: [],
    activeBatchPhotos: [],
    editorMode: "sequence",
    reviewEditReturn: false,
    draftText: {
      fontSize: 36,
      color: "#ffffff",
      background: "none",
      fontFamily: DEFAULT_FONT_FAMILY
    }
  };

  var els = {};
  var canvas = null;
  var currentPhotoId = null;
  var editorReady = false;
  var editorLoadToken = 0;
  var suppressObjectSync = false;
  var toastTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    buildColorControls();
    setupFabric();
    updateUi();
  }

  function cacheElements() {
    [
      "statusText",
      "fileInput",
      "chooseFilesBtn",
      "dropZone",
      "gallery",
      "photoCount",
      "selectedCount",
      "addMoreBtn",
      "editSelectedBtn",
      "goStitchBtn",
      "prevPhotoBtn",
      "nextPhotoBtn",
      "editorPosition",
      "addTextBtn",
      "canvasWrap",
      "photoCanvas",
      "fontSize",
      "fontFamily",
      "moreColor",
      "colorControls",
      "backgroundControls",
      "exportStitchBtn",
      "stitchCount",
      "stitchList",
      "toast",
      "rotateBtn"
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
    els.screens = Array.prototype.slice.call(document.querySelectorAll(".screen"));
  }

  function bindEvents() {
    els.chooseFilesBtn.addEventListener("click", function () {
      els.fileInput.click();
    });
    els.addMoreBtn.addEventListener("click", function () {
      els.fileInput.click();
    });
    els.fileInput.addEventListener("change", function (event) {
      addFiles(Array.prototype.slice.call(event.target.files || []));
      event.target.value = "";
    });

    els.dropZone.addEventListener("dragover", function (event) {
      event.preventDefault();
      els.dropZone.classList.add("dragover");
    });
    els.dropZone.addEventListener("dragleave", function () {
      els.dropZone.classList.remove("dragover");
    });
    els.dropZone.addEventListener("drop", function (event) {
      event.preventDefault();
      els.dropZone.classList.remove("dragover");
      addFiles(Array.prototype.slice.call(event.dataTransfer.files || []));
    });

    els.editSelectedBtn.addEventListener("click", startBatchFromSelection);
    els.goStitchBtn.addEventListener("click", goToStitch);
    els.prevPhotoBtn.addEventListener("click", function () {
      moveEditor(-1);
    });
    els.nextPhotoBtn.addEventListener("click", function () {
      moveEditor(1);
    });
    els.addTextBtn.addEventListener("click", addTextBox);
    els.exportStitchBtn.addEventListener("click", exportStitch);

    els.fontSize.addEventListener("input", function () {
      var obj = getActiveTextObject();
      var size = clampFontSize(Number(els.fontSize.value) || state.draftText.fontSize);
      if (!obj) {
        state.draftText.fontSize = size;
        return;
      }
      obj.set("fontSize", fontSizeNumberToCanvas(size));
      fitTextWidth(obj);
      state.draftText.fontSize = size;
      canvas.requestRenderAll();
      syncObjectToModel(obj);
    });
    els.fontFamily.addEventListener("change", function () {
      applyFontFamily(els.fontFamily.value);
    });
    els.moreColor.addEventListener("input", function () {
      applyTextColor(els.moreColor.value);
    });
    els.rotateBtn.addEventListener("click", rotateCurrentPhoto);
    els.backgroundControls.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-bg]");
      if (!button) return;
      applyBackground(button.dataset.bg);
    });

    window.addEventListener("resize", debounce(function () {
      if (currentPhotoId) loadEditorPhoto(getPhoto(currentPhotoId));
    }, 180));
  }

  function setupFabric() {
    canvas = new fabric.Canvas("photoCanvas", {
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false
    });
    canvas.on("selection:created", handleSelection);
    canvas.on("selection:updated", handleSelection);
    canvas.on("selection:cleared", function () {
      state.activeTextId = null;
      updateTextControls();
    });
    canvas.on("object:moving", clampAndSyncObject);
    canvas.on("object:modified", clampAndSyncObject);
    canvas.on("text:changed", function (event) {
      fitTextWidth(event.target);
      syncObjectToModel(event.target);
      updateTextControls();
    });
    canvas.on("mouse:dblclick", function (event) {
      if (!isTextObject(event.target)) return;
      canvas.setActiveObject(event.target);
      event.target.enterEditing();
      event.target.hiddenTextarea && event.target.hiddenTextarea.focus();
      state.activeTextId = event.target.textId;
      updateTextControls();
    });
    canvas.on("mouse:down", function (event) {
      els.canvasWrap.classList.add("dragging");
    });
    canvas.on("mouse:up", function () {
      els.canvasWrap.classList.remove("dragging");
    });
  }

  function buildColorControls() {
    TEXT_COLORS.forEach(function (color) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.title = color.name;
      button.dataset.color = color.value;
      button.style.background = color.value;
      if (color.value === "#ffffff") button.style.borderColor = "#9aa8b8";
      button.addEventListener("click", function () {
        applyTextColor(color.value);
      });
      els.colorControls.appendChild(button);
    });
  }

  async function addFiles(files) {
    var room = MAX_PHOTOS - getTotalLoadedPhotoCount();
    if (room <= 0) {
      showToast("The session already has 50 photos.");
      return;
    }
    var accepted = files.filter(isSupportedImage).slice(0, room);
    if (!accepted.length) {
      showToast("No supported image files found.");
      return;
    }
    showToast("Importing " + accepted.length + " photo" + (accepted.length === 1 ? "" : "s") + "...");
    for (var i = 0; i < accepted.length; i += 1) {
      try {
        var photo = await createPhotoRecord(accepted[i]);
        state.photos.push(photo);
        if (state.photos.length === 1) showScreen("galleryScreen");
      } catch (error) {
        console.error(error);
        showToast("Could not import " + accepted[i].name + ".");
      }
      renderGallery();
      updateUi();
      await pause();
    }
    if (state.photos.length || state.activeBatchPhotos.length) showScreen("galleryScreen");
    showToast("Import complete.");
  }

  function isSupportedImage(file) {
    var name = file.name.toLowerCase();
    return /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
  }

  async function createPhotoRecord(file) {
    var renderBlob = file;
    if (isHeic(file)) {
      if (!window.heic2any) throw new Error("HEIC conversion library unavailable");
      renderBlob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
      if (Array.isArray(renderBlob)) renderBlob = renderBlob[0];
    }
    var sourceUrl = URL.createObjectURL(renderBlob);
    var dimensions = await readImageDimensions(sourceUrl);
    var thumbBlob = await createThumbnailBlob(sourceUrl, dimensions.width, dimensions.height);
    return {
      id: makeId(),
      name: file.name,
      file: file,
      renderBlob: renderBlob,
      sourceUrl: sourceUrl,
      thumbUrl: URL.createObjectURL(thumbBlob),
      width: dimensions.width,
      height: dimensions.height,
      transform: defaultTransform(),
      texts: []
    };
  }

  function isHeic(file) {
    return /hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
  }

  function readImageDimensions(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function createThumbnailBlob(url, width, height) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(THUMB_SIZE / width, THUMB_SIZE / height, 1);
        var canvasEl = document.createElement("canvas");
        canvasEl.width = Math.max(1, Math.round(width * scale));
        canvasEl.height = Math.max(1, Math.round(height * scale));
        var ctx = canvasEl.getContext("2d", { alpha: false });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
        canvasEl.toBlob(function (blob) {
          canvasEl.width = 1;
          canvasEl.height = 1;
          if (blob) resolve(blob);
          else reject(new Error("Thumbnail failed"));
        }, "image/jpeg", 0.82);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function renderGallery() {
    els.gallery.innerHTML = "";
    state.photos.forEach(function (photo) {
      var item = document.createElement("div");
      item.className = "thumb" + (state.selectedIds.has(photo.id) ? " selected" : "");
      item.dataset.id = photo.id;
      item.innerHTML = '<button class="thumb-photo" type="button" aria-label="Select photo"><img alt="" src="' + photo.thumbUrl + '"><span class="thumb-check">✓</span></button><button class="thumb-remove" type="button" aria-label="Remove photo">×</button>';
      item.querySelector(".thumb-photo").addEventListener("click", function () {
        togglePhotoSelection(photo.id);
      });
      item.querySelector(".thumb-photo").addEventListener("dblclick", function () {
        state.selectedIds = new Set([photo.id]);
        startBatchFromSelection();
      });
      item.querySelector(".thumb-remove").addEventListener("click", function () {
        removeAvailablePhoto(photo.id);
      });
      els.gallery.appendChild(item);
    });
    if (!state.photos.length) {
      var empty = document.createElement("button");
      empty.type = "button";
      empty.className = "thumb empty";
      empty.disabled = true;
      empty.textContent = state.activeBatchPhotos.length ? "Batch in progress" : "Upload photos";
      els.gallery.appendChild(empty);
    }
  }

  function removeAvailablePhoto(id) {
    var photo = state.photos.find(function (item) { return item.id === id; });
    if (!photo) return;
    state.photos = state.photos.filter(function (item) { return item.id !== id; });
    state.selectedIds.delete(id);
    revokePhoto(photo);
    renderGallery();
    updateUi();
    if (!getTotalLoadedPhotoCount()) showScreen("importScreen");
  }

  function togglePhotoSelection(id) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    renderGallery();
    updateUi();
  }

  function updateUi() {
    var selected = state.selectedIds.size;
    var totalLoaded = getTotalLoadedPhotoCount();
    var batchCount = state.activeBatchPhotos.length;
    els.statusText.textContent = totalLoaded + " / 50";
    els.photoCount.textContent = state.photos.length + " available photo" + (state.photos.length === 1 ? "" : "s");
    els.selectedCount.textContent = selected + " selected" + (selected > 15 ? " - large batch may take longer" : ", recommended up to 15");
    els.editSelectedBtn.disabled = selected === 0;
    els.addMoreBtn.disabled = totalLoaded >= MAX_PHOTOS;
    els.goStitchBtn.disabled = batchCount === 0;
    els.goStitchBtn.hidden = batchCount === 0;
    els.prevPhotoBtn.disabled = !state.editorIds.length;
    els.nextPhotoBtn.disabled = !state.editorIds.length;
    els.addTextBtn.disabled = !currentPhotoId || !editorReady;
    updateEditorPosition();
    updateStitchCount();
    updateTextControls();
  }

  function showScreen(screenId) {
    els.screens.forEach(function (screen) {
      screen.classList.toggle("active", screen.id === screenId);
    });
    if (screenId === "stitchScreen") prepareStitchFromBatch();
    if (screenId === "editorScreen" && !currentPhotoId && state.editorIds.length) {
      loadEditorPhoto(getPhoto(state.editorIds[state.editorIndex]));
    }
  }

  function goToStitch() {
    if (!state.activeBatchPhotos.length) {
      showToast("Select a batch first.");
      return;
    }
    prepareStitchFromBatch();
    showScreen("stitchScreen");
  }

  function startBatchFromSelection() {
    if (state.activeBatchPhotos.length) {
      showToast("Finish or cancel the current batch first.");
      goToStitch();
      return;
    }
    var ids = Array.from(state.selectedIds);
    if (!ids.length) {
      showToast("Select at least one photo.");
      return;
    }
    state.activeBatchPhotos = state.photos.filter(function (photo) {
      return state.selectedIds.has(photo.id);
    });
    state.photos = state.photos.filter(function (photo) {
      return !state.selectedIds.has(photo.id);
    });
    state.selectedIds.clear();
    state.editorIds = state.activeBatchPhotos.map(function (photo) { return photo.id; });
    state.stitchIds = state.editorIds.slice();
    state.editorIndex = 0;
    state.editorMode = "sequence";
    state.reviewEditReturn = false;
    currentPhotoId = null;
    renderGallery();
    showScreen("editorScreen");
  }

  function moveEditor(delta) {
    if (!state.editorIds.length) return;
    if (state.reviewEditReturn) {
      goToStitch();
      return;
    }
    if (delta < 0 && state.editorIndex === 0) {
      cancelActiveBatch();
      return;
    }
    if (delta > 0 && state.editorIndex === state.editorIds.length - 1) {
      goToStitch();
      return;
    }
    state.editorIndex += delta;
    loadEditorPhoto(getPhoto(state.editorIds[state.editorIndex]));
  }

  function loadEditorPhoto(photo) {
    if (!photo) return;
    var loadToken = ++editorLoadToken;
    var previousPhoto = getPhoto(currentPhotoId);
    if (previousPhoto && previousPhoto.id !== photo.id) delete previousPhoto.editorImageElement;
    currentPhotoId = photo.id;
    editorReady = false;
    state.activeTextId = null;
    suppressObjectSync = true;
    canvas.discardActiveObject();
    canvas.clear();
    updateUi();
    var dims = getOutputDimensions(photo);
    var fitted = getFittedSize(dims.width, dims.height);
    canvas.setWidth(fitted.width);
    canvas.setHeight(fitted.height);
    refreshEditorBackground(photo, loadToken).then(function () {
      if (loadToken !== editorLoadToken) return;
      photo.texts.forEach(function (text) {
        canvas.add(createFabricText(text));
      });
      suppressObjectSync = false;
      editorReady = true;
      canvas.requestRenderAll();
      updateEditorPosition();
      updateUi();
    }).catch(function (error) {
      console.error(error);
      showToast("Could not load this photo.");
    });
  }

  async function refreshEditorBackground(photo, loadToken) {
    if (!photo || (loadToken && loadToken !== editorLoadToken)) return;
    var dataUrl = await renderPhotoFrameDataUrl(photo, canvas.getWidth(), canvas.getHeight(), 0.92);
    if (loadToken && loadToken !== editorLoadToken) return;
    return new Promise(function (resolve) {
      fabric.Image.fromURL(dataUrl, function (img) {
        img.set({ left: 0, top: 0, selectable: false, evented: false });
        canvas.setBackgroundImage(img, function () {
          canvas.requestRenderAll();
          resolve();
        });
      });
    });
  }

  function defaultTransform() {
    return { rotation: 0 };
  }

  function getTransform(photo) {
    if (!photo.transform) photo.transform = defaultTransform();
    return photo.transform;
  }

  function getRotatedDimensions(photo) {
    var rotation = normalizeRotation(getTransform(photo).rotation);
    if (rotation === 90 || rotation === 270) return { width: photo.height, height: photo.width };
    return { width: photo.width, height: photo.height };
  }

  function getOutputDimensions(photo) {
    return getRotatedDimensions(photo);
  }

  async function renderPhotoFrameDataUrl(photo, width, height, quality) {
    var canvasEl = document.createElement("canvas");
    canvasEl.width = Math.max(1, Math.round(width));
    canvasEl.height = Math.max(1, Math.round(height));
    var ctx = canvasEl.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var img = await getImageElement(photo);
    drawPhotoFrame(ctx, img, photo, canvasEl.width, canvasEl.height);
    var dataUrl = canvasEl.toDataURL("image/jpeg", quality || 0.92);
    canvasEl.width = 1;
    canvasEl.height = 1;
    return dataUrl;
  }

  function drawPhotoFrame(ctx, img, photo, width, height) {
    var transform = getTransform(photo);
    var rotated = getRotatedDimensions(photo);
    var scale = Math.min(width / rotated.width, height / rotated.height);
    var drawnW = rotated.width * scale;
    var drawnH = rotated.height * scale;
    var x = (width - drawnW) / 2;
    var y = (height - drawnH) / 2;

    ctx.save();
    ctx.translate(x + drawnW / 2, y + drawnH / 2);
    ctx.rotate((normalizeRotation(transform.rotation) * Math.PI) / 180);
    ctx.drawImage(img, -photo.width * scale / 2, -photo.height * scale / 2, photo.width * scale, photo.height * scale);
    ctx.restore();
  }

  function normalizeRotation(value) {
    return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  }

  function getImageElement(photo) {
    if (photo.editorImageElement) return Promise.resolve(photo.editorImageElement);
    return urlToImage(photo.sourceUrl).then(function (img) {
      photo.editorImageElement = img;
      return img;
    });
  }

  function rotateCurrentPhoto() {
    var photo = getPhoto(currentPhotoId);
    if (!photo) return;
    var transform = getTransform(photo);
    transform.rotation = normalizeRotation(transform.rotation + 90);
    loadEditorPhoto(photo);
  }

  function getFittedSize(width, height) {
    var wrap = els.canvasWrap.getBoundingClientRect();
    var maxWidth = Math.max(280, wrap.width - 24);
    var maxHeight = Math.max(280, window.innerHeight - 260);
    var scale = Math.min(maxWidth / width, maxHeight / height, 1);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function createFabricText(text) {
    var w = canvas.getWidth();
    var h = canvas.getHeight();
    var obj = new fabric.Textbox(text.value || "", {
      left: text.x * w,
      top: text.y * h,
      width: Math.max(40, text.widthRatio * w),
      fontSize: Math.max(8, text.fontSizeRatio * w),
      fill: text.color,
      backgroundColor: BG_COLORS[text.background] || "",
      fontFamily: text.fontFamily || DEFAULT_FONT_FAMILY,
      editable: true,
      padding: 3,
      borderColor: "#1769ff",
      cornerColor: "#11a8ff",
      editingBorderColor: "#1769ff",
      hasControls: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      lockUniScaling: true,
      splitByGrapheme: true
    });
    obj.textId = text.id;
    obj.setControlsVisibility({
      mt: false,
      mb: false,
      ml: false,
      mr: false,
      tl: false,
      tr: false,
      bl: false,
      br: false,
      mtr: false
    });
    obj.controls.deleteControl = new fabric.Control({
      x: 0.5,
      y: -0.5,
      offsetX: 12,
      offsetY: -12,
      cursorStyle: "pointer",
      mouseUpHandler: deleteTextControlHandler,
      render: renderDeleteControl,
      cornerSize: 24
    });
    return obj;
  }

  function addTextBox() {
    var photo = getPhoto(currentPhotoId);
    if (!photo) return;
    var draft = readDraftFromControls();
    var text = {
      id: makeId(),
      value: "Add text",
      x: 0.1,
      y: 0.1,
      widthRatio: 0.2,
      fontSizeRatio: fontSizeNumberToRatio(draft.fontSize),
      color: draft.color,
      background: draft.background,
      fontFamily: draft.fontFamily
    };
    photo.texts.push(text);
    var obj = createFabricText(text);
    canvas.add(obj);
    fitTextWidth(obj);
    syncObjectToModel(obj);
    canvas.setActiveObject(obj);
    obj.enterEditing();
    obj.hiddenTextarea && obj.hiddenTextarea.focus();
    obj.selectAll();
    handleSelection({ selected: [obj] });
    canvas.requestRenderAll();
  }

  function handleSelection(event) {
    var obj = event.selected && event.selected[0] ? event.selected[0] : canvas.getActiveObject();
    if (!isTextObject(obj)) return;
    state.activeTextId = obj.textId;
    updateTextControls();
  }

  function getActiveTextObject() {
    var obj = canvas && canvas.getActiveObject();
    return isTextObject(obj) ? obj : null;
  }

  function isTextObject(obj) {
    return obj && obj.type === "textbox" && obj.textId;
  }

  function updateTextControls() {
    var obj = getActiveTextObject();
    var hasPhoto = Boolean(currentPhotoId);
    var enabled = Boolean(obj);
    var controlsEnabled = hasPhoto && editorReady;
    els.fontSize.disabled = !controlsEnabled;
    els.fontFamily.disabled = !controlsEnabled;
    els.moreColor.disabled = !controlsEnabled;
    Array.prototype.forEach.call(els.colorControls.children, function (button) {
      var activeColor = enabled ? obj.fill : state.draftText.color;
      button.disabled = !controlsEnabled;
      button.classList.toggle("active", controlsEnabled && normalizeColor(activeColor) === normalizeColor(button.dataset.color));
    });
    Array.prototype.forEach.call(els.backgroundControls.querySelectorAll("button"), function (button) {
      var activeBackground = enabled ? getTextModel(obj.textId).background || "none" : state.draftText.background;
      button.disabled = !controlsEnabled;
      button.classList.toggle("active", controlsEnabled && activeBackground === button.dataset.bg);
    });
    if (!enabled) {
      els.fontSize.value = String(state.draftText.fontSize);
      els.fontFamily.value = state.draftText.fontFamily;
      els.moreColor.value = toColorInputValue(state.draftText.color);
      return;
    }
    els.fontSize.value = String(ratioToFontSizeNumber(obj.fontSize / canvas.getWidth()));
    els.fontFamily.value = obj.fontFamily || DEFAULT_FONT_FAMILY;
    els.moreColor.value = toColorInputValue(obj.fill);
  }

  function applyTextColor(color) {
    var obj = getActiveTextObject();
    if (!obj) {
      state.draftText.color = color;
      updateTextControls();
      return;
    }
    obj.set("fill", color);
    state.draftText.color = color;
    canvas.requestRenderAll();
    syncObjectToModel(obj);
    updateTextControls();
  }

  function applyFontFamily(fontFamily) {
    var obj = getActiveTextObject();
    if (!obj) {
      state.draftText.fontFamily = fontFamily;
      updateTextControls();
      return;
    }
    obj.set("fontFamily", fontFamily || DEFAULT_FONT_FAMILY);
    fitTextWidth(obj);
    state.draftText.fontFamily = fontFamily || DEFAULT_FONT_FAMILY;
    canvas.requestRenderAll();
    syncObjectToModel(obj);
    updateTextControls();
  }

  function applyBackground(bg) {
    var obj = getActiveTextObject();
    if (!obj) {
      state.draftText.background = bg;
      updateTextControls();
      return;
    }
    obj.set("backgroundColor", BG_COLORS[bg] || "");
    state.draftText.background = bg;
    canvas.requestRenderAll();
    syncObjectToModel(obj);
    getTextModel(obj.textId).background = bg;
    updateTextControls();
  }

  function fitTextWidth(obj) {
    if (!isTextObject(obj)) return;
    var maxWidth = Math.max(60, canvas.getWidth() - obj.left - 12);
    var textWidth = measureTextboxTextWidth(obj);
    var nextWidth = Math.max(18, Math.min(maxWidth, textWidth + 2));
    obj.set({
      width: nextWidth,
      scaleX: 1
    });
    obj.setCoords();
  }

  function measureTextboxTextWidth(obj) {
    var measureCanvas = document.createElement("canvas");
    var ctx = measureCanvas.getContext("2d");
    ctx.font = obj.fontSize + "px " + obj.fontFamily;
    var lines = String(obj.text || "").split(/\n/);
    var widest = 0;
    lines.forEach(function (line) {
      widest = Math.max(widest, ctx.measureText(line || " ").width);
    });
    measureCanvas.width = 1;
    measureCanvas.height = 1;
    return widest;
  }

  function readDraftFromControls() {
    return {
      fontSize: clampFontSize(Number(els.fontSize.value) || state.draftText.fontSize),
      color: state.draftText.color,
      background: state.draftText.background,
      fontFamily: els.fontFamily.value || state.draftText.fontFamily
    };
  }

  function clampFontSize(value) {
    return Math.max(10, Math.min(180, Math.round(value || 36)));
  }

  function fontSizeNumberToRatio(value) {
    return clampFontSize(value) / FONT_SIZE_BASE_WIDTH;
  }

  function fontSizeNumberToCanvas(value) {
    return Math.max(8, fontSizeNumberToRatio(value) * canvas.getWidth());
  }

  function ratioToFontSizeNumber(ratio) {
    return clampFontSize(ratio * FONT_SIZE_BASE_WIDTH);
  }

  function renderDeleteControl(ctx, left, top, styleOverride, fabricObject) {
    var size = this.cornerSize || 24;
    ctx.save();
    ctx.translate(left, top);
    ctx.fillStyle = "#e11d48";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(5, 5);
    ctx.moveTo(5, -5);
    ctx.lineTo(-5, 5);
    ctx.stroke();
    ctx.restore();
  }

  function deleteTextControlHandler(eventData, transform) {
    deleteTextObject(transform.target);
    return true;
  }

  function deleteTextObject(obj) {
    var photo = getPhoto(currentPhotoId);
    if (!obj || !photo) return;
    photo.texts = photo.texts.filter(function (text) {
      return text.id !== obj.textId;
    });
    canvas.remove(obj);
    canvas.discardActiveObject();
    state.activeTextId = null;
    canvas.requestRenderAll();
    updateTextControls();
  }

  function clampAndSyncObject(event) {
    var obj = event.target;
    if (!isTextObject(obj)) return;
    var maxLeft = Math.max(0, canvas.getWidth() - obj.getScaledWidth());
    var maxTop = Math.max(0, canvas.getHeight() - obj.getScaledHeight());
    obj.set({
      left: Math.max(0, Math.min(obj.left, maxLeft)),
      top: Math.max(0, Math.min(obj.top, maxTop))
    });
    syncObjectToModel(obj);
  }

  function syncObjectToModel(obj) {
    if (suppressObjectSync || !isTextObject(obj)) return;
    var model = getTextModel(obj.textId);
    if (!model) return;
    model.value = obj.text || "";
    model.x = obj.left / canvas.getWidth();
    model.y = obj.top / canvas.getHeight();
    model.widthRatio = obj.width / canvas.getWidth();
    model.fontSizeRatio = obj.fontSize / canvas.getWidth();
    model.color = obj.fill;
    model.fontFamily = obj.fontFamily || DEFAULT_FONT_FAMILY;
  }

  function getTextModel(textId) {
    var photo = getPhoto(currentPhotoId);
    if (!photo) return null;
    return photo.texts.find(function (text) {
      return text.id === textId;
    });
  }

  function prepareStitchFromBatch() {
    var batchIds = state.activeBatchPhotos.map(function (photo) {
      return photo.id;
    });
    var batchSet = new Set(batchIds);
    state.stitchIds = state.stitchIds.filter(function (id) {
      return batchSet.has(id);
    });
    batchIds.forEach(function (id) {
      if (state.stitchIds.indexOf(id) === -1) state.stitchIds.push(id);
    });
    renderStitchList();
    updateUi();
  }

  function renderStitchList() {
    els.stitchList.innerHTML = "";
    state.stitchIds.forEach(function (id) {
      var photo = getPhoto(id);
      if (!photo) return;
      var item = document.createElement("div");
      item.className = "stitch-item";
      item.dataset.id = id;
      item.innerHTML = '<span class="order-badge"></span><button class="stitch-photo-button" type="button" aria-label="Edit image"><img alt="" src="' + photo.thumbUrl + '"></button><button class="drag-handle" type="button" aria-label="Drag to reorder">☰</button><button class="remove-stitch-btn" type="button" aria-label="Remove image">×</button>';
      item.querySelector(".order-badge").textContent = String(state.stitchIds.indexOf(id) + 1);
      item.querySelector(".stitch-photo-button").addEventListener("click", function () {
        openBatchPhotoFromReview(id);
      });
      item.querySelector(".remove-stitch-btn").addEventListener("click", function () {
        removePhotoFromStitch(id);
      });
      els.stitchList.appendChild(item);
    });
    if (window.Sortable && !els.stitchList.sortableInstance) {
      els.stitchList.sortableInstance = Sortable.create(els.stitchList, {
        handle: ".drag-handle",
        animation: 150,
        onEnd: function () {
          state.stitchIds = Array.prototype.slice.call(els.stitchList.children).map(function (item) {
            return item.dataset.id;
          });
          refreshStitchOrderBadges();
          updateStitchCount();
        }
      });
    }
  }

  function refreshStitchOrderBadges() {
    Array.prototype.forEach.call(els.stitchList.children, function (item, index) {
      var badge = item.querySelector(".order-badge");
      if (badge) badge.textContent = String(index + 1);
    });
  }


  function removePhotoFromStitch(id) {
    var photo = getPhoto(id);
    if (!photo) return;
    state.stitchIds = state.stitchIds.filter(function (photoId) {
      return photoId !== id;
    });
    state.editorIds = state.editorIds.filter(function (photoId) {
      return photoId !== id;
    });
    state.activeBatchPhotos = state.activeBatchPhotos.filter(function (batchPhoto) {
      return batchPhoto.id !== id;
    });
    if (!state.photos.some(function (availablePhoto) { return availablePhoto.id === id; })) {
      state.photos.push(photo);
    }
    if (!state.stitchIds.length) {
      currentPhotoId = null;
      state.editorIndex = 0;
      state.editorMode = "sequence";
      state.reviewEditReturn = false;
      renderGallery();
      renderStitchList();
      updateUi();
      showScreen(state.photos.length ? "galleryScreen" : "importScreen");
      return;
    }
    refreshStitchOrderBadges();
    renderStitchList();
    updateUi();
  }

  function openBatchPhotoFromReview(id) {
    var index = state.stitchIds.indexOf(id);
    if (index === -1) return;
    state.editorIds = state.stitchIds.slice();
    state.editorIndex = index;
    state.editorMode = "review";
    state.reviewEditReturn = true;
    currentPhotoId = null;
    showScreen("editorScreen");
  }

  function cancelActiveBatch() {
    if (state.activeBatchPhotos.length) {
      state.photos = state.activeBatchPhotos.concat(state.photos);
    }
    state.activeBatchPhotos = [];
    state.editorIds = [];
    state.stitchIds = [];
    state.editorIndex = 0;
    state.editorMode = "sequence";
    state.reviewEditReturn = false;
    currentPhotoId = null;
    canvas.clear();
    renderGallery();
    renderStitchList();
    updateUi();
    showScreen(state.photos.length ? "galleryScreen" : "importScreen");
  }

  function completeActiveBatch() {
    state.activeBatchPhotos.forEach(revokePhoto);
    state.activeBatchPhotos = [];
    state.editorIds = [];
    state.stitchIds = [];
    state.editorIndex = 0;
    state.editorMode = "sequence";
    state.reviewEditReturn = false;
    currentPhotoId = null;
    canvas.clear();
    renderGallery();
    renderStitchList();
    updateUi();
    showScreen(state.photos.length ? "galleryScreen" : "importScreen");
  }

  async function exportStitch() {
    prepareStitchFromBatch();
    if (!state.stitchIds.length) {
      showToast("Select a batch first.");
      return;
    }
    var photos = state.stitchIds.map(getPhoto).filter(Boolean);
    var width = getSafeStitchWidth(photos);
    var height = photos.reduce(function (sum, photo) {
      var dims = getOutputDimensions(photo);
      return sum + Math.round(width * (dims.height / dims.width));
    }, 0);
    showToast("Rendering stitched image...");
    var canvasEl = document.createElement("canvas");
    canvasEl.width = width;
    canvasEl.height = height;
    var ctx = canvasEl.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var y = 0;
    for (var i = 0; i < photos.length; i += 1) {
      var photo = photos[i];
      var dims = getOutputDimensions(photo);
      var partHeight = Math.round(width * (dims.height / dims.width));
      var blob = await renderPhotoToBlob(photo, width);
      var img = await blobToImage(blob);
      ctx.drawImage(img, 0, y, width, partHeight);
      y += partHeight;
      await pause();
    }
    canvasEl.toBlob(function (blob) {
      canvasEl.width = 1;
      canvasEl.height = 1;
      if (!blob) {
        showToast("Stitch export failed.");
        return;
      }
      downloadBlob(blob, "photo-log-stitched.jpg");
      completeActiveBatch();
      showToast("Exported stitched image.");
    }, "image/jpeg", JPEG_QUALITY);
  }

  function getSafeStitchWidth(photos) {
    var aspectTotal = photos.reduce(function (sum, photo) {
      var dims = getOutputDimensions(photo);
      return sum + dims.height / dims.width;
    }, 0);
    var width = STITCH_TARGET_WIDTH;
    while (width * Math.round(width * aspectTotal) > MAX_STITCH_PIXELS && width > 720) {
      width = Math.floor(width * 0.9);
    }
    return width;
  }

  async function renderPhotoToBlob(photo, outputWidth) {
    var dims = getOutputDimensions(photo);
    var scale = outputWidth / dims.width;
    var outputHeight = Math.max(1, Math.round(dims.height * scale));
    var canvasEl = document.createElement("canvas");
    canvasEl.width = Math.max(1, Math.round(outputWidth));
    canvasEl.height = outputHeight;
    var ctx = canvasEl.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var img = await getImageElement(photo);
    drawPhotoFrame(ctx, img, photo, canvasEl.width, canvasEl.height);
    drawTextModels(ctx, photo, canvasEl.width, canvasEl.height);
    if (photo.id !== currentPhotoId) delete photo.editorImageElement;
    return new Promise(function (resolve, reject) {
      canvasEl.toBlob(function (blob) {
        canvasEl.width = 1;
        canvasEl.height = 1;
        if (blob) resolve(blob);
        else reject(new Error("Export failed"));
      }, "image/jpeg", JPEG_QUALITY);
    });
  }

  function drawTextModels(ctx, photo, width, height) {
    photo.texts.forEach(function (text) {
      var fontSize = Math.max(8, text.fontSizeRatio * width);
      var x = text.x * width;
      var y = text.y * height;
      var textWidth = Math.max(20, text.widthRatio * width);
      ctx.font = fontSize + "px " + (text.fontFamily || DEFAULT_FONT_FAMILY);
      var lines = wrapText(ctx, text.value || "", textWidth, fontSize, text.fontFamily);
      ctx.textBaseline = "top";
      ctx.fillStyle = text.color || "#ffffff";
      var lineHeight = fontSize * 1.22;
      var padding = fontSize * 0.18;
      if (text.background && text.background !== "none") {
        ctx.fillStyle = BG_COLORS[text.background];
        ctx.fillRect(x, y, textWidth + padding * 2, lines.length * lineHeight + padding * 2);
        ctx.fillStyle = text.color || "#ffffff";
      }
      lines.forEach(function (line, index) {
        ctx.fillText(line, x + padding, y + padding + index * lineHeight, textWidth);
      });
    });
  }

  function wrapText(ctx, value, maxWidth, fontSize, fontFamily) {
    ctx.font = fontSize + "px " + (fontFamily || DEFAULT_FONT_FAMILY);
    var rawLines = String(value).split(/\n/);
    var lines = [];
    rawLines.forEach(function (raw) {
      var current = "";
      Array.from(raw).forEach(function (char) {
        var test = current + char;
        if (current && ctx.measureText(test).width > maxWidth) {
          lines.push(current);
          current = char;
        } else {
          current = test;
        }
      });
      lines.push(current);
    });
    return lines.length ? lines : [""];
  }

  function clearSession() {
    if (!getTotalLoadedPhotoCount()) return;
    if (!window.confirm("Clear all imported photos and edits from this session?")) return;
    state.photos.forEach(revokePhoto);
    state.activeBatchPhotos.forEach(revokePhoto);
    state.photos = [];
    state.activeBatchPhotos = [];
    state.selectedIds.clear();
    state.editorIds = [];
    state.stitchIds = [];
    state.editorIndex = 0;
    state.editorMode = "sequence";
    state.reviewEditReturn = false;
    currentPhotoId = null;
    canvas.clear();
    renderGallery();
    renderStitchList();
    updateUi();
    showScreen("importScreen");
  }

  function revokePhoto(photo) {
    URL.revokeObjectURL(photo.sourceUrl);
    URL.revokeObjectURL(photo.thumbUrl);
  }

  function updateEditorPosition() {
    var total = state.editorIds.length;
    var current = total ? state.editorIndex + 1 : 0;
    els.editorPosition.textContent = current + " / " + total;
    if (total && state.reviewEditReturn) {
      els.nextPhotoBtn.textContent = "Review Order";
    } else if (total && state.editorIndex === total - 1) {
      els.nextPhotoBtn.textContent = "Review Order";
    } else {
      els.nextPhotoBtn.textContent = "Next";
    }
  }

  function updateStitchCount() {
    els.stitchCount.textContent = state.stitchIds.length + " image" + (state.stitchIds.length === 1 ? "" : "s");
    els.exportStitchBtn.disabled = state.stitchIds.length === 0;
  }

  function getPhoto(id) {
    return state.photos.concat(state.activeBatchPhotos).find(function (photo) {
      return photo.id === id;
    });
  }

  function getTotalLoadedPhotoCount() {
    return state.photos.length + state.activeBatchPhotos.length;
  }


  function toColorInputValue(value) {
    var normalized = normalizeColor(value);
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#ffffff";
  }

  function normalizeColor(value) {
    var ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = value;
    return ctx.fillStyle.toLowerCase();
  }

  function urlToImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function (error) {
        URL.revokeObjectURL(url);
        reject(error);
      };
      img.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function makeId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2600);
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      clearTimeout(timer);
      var args = arguments;
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, delay);
    };
  }

  function pause() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }
})();
