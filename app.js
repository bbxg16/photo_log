(function () {
  "use strict";

  var MAX_PHOTOS = 9;
  var JPEG_QUALITY = 0.96;
  var STITCH_TARGET_WIDTH = 2160;
  var MAX_STITCH_PIXELS = 32000000;
  var THUMB_SIZE = 360;
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
    draftText: {
      value: "",
      fontSizePercent: 5,
      color: "#ffffff",
      background: "none"
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
      "removeSelectedBtn",
      "clearBtn",
      "prevPhotoBtn",
      "nextPhotoBtn",
      "editorPosition",
      "addTextBtn",
      "finishEditingBtn",
      "canvasWrap",
      "photoCanvas",
      "textValue",
      "fontSize",
      "fontSizeValue",
      "colorControls",
      "backgroundControls",
      "deleteTextBtn",
      "exportStitchBtn",
      "stitchCount",
      "stitchList",
      "toast"
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
    els.tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
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

    els.tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        showScreen(tab.dataset.screen);
      });
    });

    els.editSelectedBtn.addEventListener("click", openEditorForSelection);
    els.goStitchBtn.addEventListener("click", goToStitch);
    els.removeSelectedBtn.addEventListener("click", removeSelectedPhotos);
    els.clearBtn.addEventListener("click", clearSession);
    els.prevPhotoBtn.addEventListener("click", function () {
      moveEditor(-1);
    });
    els.nextPhotoBtn.addEventListener("click", function () {
      moveEditor(1);
    });
    els.addTextBtn.addEventListener("click", addTextBox);
    els.deleteTextBtn.addEventListener("click", deleteActiveText);
    els.finishEditingBtn.addEventListener("click", goToStitch);
    els.exportStitchBtn.addEventListener("click", exportStitch);

    els.textValue.addEventListener("input", function () {
      var obj = getActiveTextObject();
      if (!obj) {
        state.draftText.value = els.textValue.value;
        return;
      }
      obj.set("text", els.textValue.value);
      if (shouldAutoFit(obj)) fitTextWidth(obj);
      canvas.requestRenderAll();
      syncObjectToModel(obj);
    });
    els.fontSize.addEventListener("input", function () {
      var obj = getActiveTextObject();
      var percent = Number(els.fontSize.value);
      els.fontSizeValue.textContent = percent.toFixed(1).replace(".0", "") + "%";
      if (!obj) {
        state.draftText.fontSizePercent = percent;
        return;
      }
      obj.set("fontSize", canvas.getWidth() * (percent / 100));
      if (shouldAutoFit(obj)) fitTextWidth(obj);
      state.draftText.fontSizePercent = percent;
      canvas.requestRenderAll();
      syncObjectToModel(obj);
    });
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
    canvas.on("object:scaling", function (event) {
      var obj = event.target;
      if (!isTextObject(obj)) return;
      var model = getTextModel(obj.textId);
      if (model) model.autoFit = false;
      clampAndSyncObject(event);
    });
    canvas.on("text:changed", function (event) {
      var model = getTextModel(event.target.textId);
      if (!model || model.autoFit !== false) fitTextWidth(event.target);
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
    canvas.on("mouse:down", function () {
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
    var room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) {
      showToast("The session already has 9 photos.");
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
    if (state.photos.length) showScreen("galleryScreen");
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
      var button = document.createElement("button");
      button.type = "button";
      button.className = "thumb" + (state.selectedIds.has(photo.id) ? " selected" : "");
      button.dataset.id = photo.id;
      button.innerHTML = '<img alt="" src="' + photo.thumbUrl + '"><span class="thumb-check">✓</span><span class="thumb-name"></span>';
      button.querySelector(".thumb-name").textContent = photo.name;
      button.addEventListener("click", function () {
        togglePhotoSelection(photo.id);
      });
      button.addEventListener("dblclick", function () {
        state.selectedIds = new Set([photo.id]);
        openEditorForSelection();
      });
      els.gallery.appendChild(button);
    });
    for (var slot = state.photos.length; slot < MAX_PHOTOS; slot += 1) {
      var empty = document.createElement("button");
      empty.type = "button";
      empty.className = "thumb empty";
      empty.disabled = true;
      empty.textContent = "Slot " + (slot + 1);
      els.gallery.appendChild(empty);
    }
  }

  function togglePhotoSelection(id) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    renderGallery();
    updateUi();
  }

  function updateUi() {
    var selected = state.selectedIds.size;
    els.statusText.textContent = state.photos.length + " / 9 photos imported";
    els.photoCount.textContent = state.photos.length + " photo" + (state.photos.length === 1 ? "" : "s");
    els.selectedCount.textContent = selected + " selected for text";
    els.editSelectedBtn.disabled = selected === 0;
    els.removeSelectedBtn.disabled = selected === 0;
    els.addMoreBtn.disabled = state.photos.length >= MAX_PHOTOS;
    els.goStitchBtn.disabled = state.photos.length === 0;
    els.prevPhotoBtn.disabled = state.editorIds.length < 2;
    els.nextPhotoBtn.disabled = state.editorIds.length < 2;
    els.addTextBtn.disabled = !currentPhotoId || !editorReady;
    els.finishEditingBtn.disabled = state.photos.length === 0;
    els.clearBtn.disabled = state.photos.length === 0;
    updateEditorPosition();
    updateStitchCount();
    updateTextControls();
  }

  function showScreen(screenId) {
    els.screens.forEach(function (screen) {
      screen.classList.toggle("active", screen.id === screenId);
    });
    els.tabs.forEach(function (tab) {
      tab.classList.toggle("active", tab.dataset.screen === screenId);
    });
    if (screenId === "stitchScreen") prepareStitchFromUploaded();
    if (screenId === "editorScreen" && !currentPhotoId && state.editorIds.length) {
      loadEditorPhoto(getPhoto(state.editorIds[state.editorIndex]));
    }
  }

  function goToStitch() {
    if (!state.photos.length) {
      showToast("Upload at least one photo first.");
      return;
    }
    showScreen("stitchScreen");
  }

  function openEditorForSelection() {
    var ids = Array.from(state.selectedIds);
    if (!ids.length && state.photos.length) ids = [state.photos[0].id];
    if (!ids.length) {
      showToast("Select at least one photo.");
      return;
    }
    state.editorIds = ids;
    state.editorIndex = 0;
    currentPhotoId = null;
    showScreen("editorScreen");
  }

  function moveEditor(delta) {
    if (!state.editorIds.length) return;
    state.editorIndex = (state.editorIndex + delta + state.editorIds.length) % state.editorIds.length;
    loadEditorPhoto(getPhoto(state.editorIds[state.editorIndex]));
  }

  function loadEditorPhoto(photo) {
    if (!photo) return;
    var loadToken = ++editorLoadToken;
    var isDifferentPhoto = currentPhotoId !== photo.id;
    currentPhotoId = photo.id;
    editorReady = false;
    state.activeTextId = null;
    if (isDifferentPhoto) resetDraftText();
    suppressObjectSync = true;
    canvas.discardActiveObject();
    canvas.clear();
    updateUi();
    var fitted = getFittedSize(photo.width, photo.height);
    canvas.setWidth(fitted.width);
    canvas.setHeight(fitted.height);
    fabric.Image.fromURL(photo.sourceUrl, function (img) {
      if (loadToken !== editorLoadToken) return;
      img.set({
        left: 0,
        top: 0,
        selectable: false,
        evented: false,
        scaleX: fitted.width / photo.width,
        scaleY: fitted.height / photo.height
      });
      canvas.setBackgroundImage(img, function () {
        photo.texts.forEach(function (text) {
          canvas.add(createFabricText(text));
        });
        suppressObjectSync = false;
        editorReady = true;
        canvas.requestRenderAll();
        updateEditorPosition();
        updateUi();
      });
    }, { crossOrigin: "anonymous" });
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
      fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
      editable: true,
      padding: 6,
      borderColor: "#1769ff",
      cornerColor: "#11a8ff",
      editingBorderColor: "#1769ff",
      hasControls: true,
      lockScalingX: false,
      lockScalingY: true,
      lockRotation: true,
      lockUniScaling: true,
      splitByGrapheme: true
    });
    obj.textId = text.id;
    obj.setControlsVisibility({
      mt: false,
      mb: false,
      ml: true,
      mr: true,
      tl: false,
      tr: false,
      bl: false,
      br: false,
      mtr: false
    });
    return obj;
  }

  function addTextBox() {
    var photo = getPhoto(currentPhotoId);
    if (!photo) return;
    var draft = readDraftFromControls();
    var text = {
      id: makeId(),
      value: draft.value || "Add text",
      x: 0.1,
      y: 0.1,
      widthRatio: 0.2,
      fontSizeRatio: draft.fontSizePercent / 100,
      color: draft.color,
      background: draft.background,
      autoFit: true
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
    els.textValue.disabled = !controlsEnabled;
    els.fontSize.disabled = !controlsEnabled;
    els.deleteTextBtn.disabled = !enabled;
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
      els.textValue.value = state.draftText.value;
      els.fontSize.value = String(state.draftText.fontSizePercent);
      els.fontSizeValue.textContent = formatPercent(state.draftText.fontSizePercent);
      els.textValue.placeholder = hasPhoto ? "Type text to add" : "Open a photo to add text";
      return;
    }
    var sizePercent = (obj.fontSize / canvas.getWidth()) * 100;
    els.textValue.value = obj.text || "";
    els.textValue.placeholder = "Edit selected text";
    els.fontSize.value = String(Math.max(2, Math.min(12, sizePercent)));
    els.fontSizeValue.textContent = formatPercent(sizePercent);
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
    var nextWidth = Math.max(32, Math.min(maxWidth, textWidth + obj.padding * 2 + 8));
    obj.set({
      width: nextWidth,
      scaleX: 1
    });
    obj.setCoords();
  }

  function shouldAutoFit(obj) {
    var model = getTextModel(obj.textId);
    return !model || model.autoFit !== false;
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
      value: els.textValue.value.trim(),
      fontSizePercent: Number(els.fontSize.value) || state.draftText.fontSizePercent,
      color: state.draftText.color,
      background: state.draftText.background
    };
  }

  function formatPercent(value) {
    return Number(value).toFixed(1).replace(".0", "") + "%";
  }

  function resetDraftText() {
    state.draftText.value = "";
  }

  function deleteActiveText() {
    var obj = getActiveTextObject();
    var photo = getPhoto(currentPhotoId);
    if (!obj || !photo) return;
    photo.texts = photo.texts.filter(function (text) {
      return text.id !== obj.textId;
    });
    canvas.remove(obj);
    state.activeTextId = null;
    updateTextControls();
  }

  function clampAndSyncObject(event) {
    var obj = event.target;
    if (!isTextObject(obj)) return;
    if (obj.scaleX !== 1) {
      obj.set({
        width: Math.max(20, obj.width * obj.scaleX),
        scaleX: 1
      });
    }
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
  }

  function getTextModel(textId) {
    var photo = getPhoto(currentPhotoId);
    if (!photo) return null;
    return photo.texts.find(function (text) {
      return text.id === textId;
    });
  }

  function prepareStitchFromUploaded() {
    var uploadedIds = state.photos.map(function (photo) {
      return photo.id;
    });
    var uploadedSet = new Set(uploadedIds);
    state.stitchIds = state.stitchIds.filter(function (id) {
      return uploadedSet.has(id);
    });
    uploadedIds.forEach(function (id) {
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
      item.innerHTML = '<img alt="" src="' + photo.thumbUrl + '"><strong></strong><span class="drag-handle">☰</span>';
      item.querySelector("strong").textContent = photo.name;
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
          updateStitchCount();
        }
      });
    }
  }

  async function exportStitch() {
    prepareStitchFromUploaded();
    if (!state.stitchIds.length) {
      showToast("Upload at least one photo first.");
      return;
    }
    var photos = state.stitchIds.map(getPhoto).filter(Boolean);
    var width = getSafeStitchWidth(photos);
    var height = photos.reduce(function (sum, photo) {
      return sum + Math.round(width * (photo.height / photo.width));
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
      var partHeight = Math.round(width * (photo.height / photo.width));
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
      showToast("Exported stitched image.");
    }, "image/jpeg", JPEG_QUALITY);
  }

  function getSafeStitchWidth(photos) {
    var aspectTotal = photos.reduce(function (sum, photo) {
      return sum + photo.height / photo.width;
    }, 0);
    var width = STITCH_TARGET_WIDTH;
    while (width * Math.round(width * aspectTotal) > MAX_STITCH_PIXELS && width > 720) {
      width = Math.floor(width * 0.9);
    }
    return width;
  }

  async function renderPhotoToBlob(photo, outputWidth) {
    var scale = outputWidth / photo.width;
    var outputHeight = Math.max(1, Math.round(photo.height * scale));
    var canvasEl = document.createElement("canvas");
    canvasEl.width = Math.max(1, Math.round(outputWidth));
    canvasEl.height = outputHeight;
    var ctx = canvasEl.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    var img = await urlToImage(photo.sourceUrl);
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
    drawTextModels(ctx, photo, canvasEl.width, canvasEl.height);
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
      ctx.font = fontSize + 'px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      var lines = wrapText(ctx, text.value || "", textWidth, fontSize);
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

  function wrapText(ctx, value, maxWidth, fontSize) {
    ctx.font = fontSize + 'px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
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

  function removeSelectedPhotos() {
    var ids = new Set(state.selectedIds);
    state.photos = state.photos.filter(function (photo) {
      if (!ids.has(photo.id)) return true;
      revokePhoto(photo);
      return false;
    });
    state.selectedIds.clear();
    state.editorIds = state.editorIds.filter(function (id) {
      return !ids.has(id);
    });
    state.stitchIds = state.stitchIds.filter(function (id) {
      return !ids.has(id);
    });
    if (ids.has(currentPhotoId)) {
      currentPhotoId = null;
      canvas.clear();
    }
    renderGallery();
    renderStitchList();
    updateUi();
    if (!state.photos.length) showScreen("importScreen");
  }

  function clearSession() {
    if (!state.photos.length) return;
    if (!window.confirm("Clear all imported photos and edits from this session?")) return;
    state.photos.forEach(revokePhoto);
    state.photos = [];
    state.selectedIds.clear();
    state.editorIds = [];
    state.stitchIds = [];
    state.editorIndex = 0;
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
  }

  function updateStitchCount() {
    els.stitchCount.textContent = state.stitchIds.length + " image" + (state.stitchIds.length === 1 ? "" : "s");
    els.exportStitchBtn.disabled = state.stitchIds.length === 0;
  }

  function getPhoto(id) {
    return state.photos.find(function (photo) {
      return photo.id === id;
    });
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
