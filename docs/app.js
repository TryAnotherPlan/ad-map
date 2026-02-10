const IMG_W = 3734;
const IMG_H = 5600;
const bounds = [[0, 0], [IMG_H, IMG_W]];

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -2,
  maxZoom: 4,
  zoomControl: true,
  preferCanvas: true
});


document.addEventListener("DOMContentLoaded", () => {

  const xyCursorEl = document.getElementById("xyCursor");
  const xyClickEl = document.getElementById("xyClick");
  const copyClickBtn = document.getElementById("copyClickBtn");

  console.log("HUD elements:", { xyCursorEl, xyClickEl, copyClickBtn });

  let lastClick = null;

  map.on("mousemove", (e) => {
    const x = e.latlng.lng;
    const y = e.latlng.lat;

    if (xyCursorEl)
      xyCursorEl.textContent = `X=${x.toFixed(2)} Y=${y.toFixed(2)}`;
  });

  map.on("click", (e) => {
    const x = e.latlng.lng;
    const y = e.latlng.lat;

    lastClick = { x, y };

    if (xyClickEl)
      xyClickEl.textContent = `X=${x.toFixed(2)} Y=${y.toFixed(2)}`;
  });

  if (copyClickBtn) {
    copyClickBtn.addEventListener("click", async () => {
      if (!lastClick) return;

      const text = `X=${lastClick.x.toFixed(2)} Y=${lastClick.y.toFixed(2)}`;

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        console.log(text);
      }
    });
  }

});

map.getContainer().style.background = "#0b0e16";

L.imageOverlay("map.webp", bounds, { interactive: false }).addTo(map);
map.fitBounds(bounds);

map.setMaxBounds(bounds);
map.options.maxBoundsViscosity = 1.0;

const $categories = document.getElementById("categories");
const $search = document.getElementById("search");
const $stats = document.getElementById("stats");

const $clearCatsBtn = document.getElementById("clearCatsBtn");
const $checkCatsBtn = document.getElementById("checkCatsBtn");

$clearCatsBtn?.addEventListener("click", disableAllCategories);
$checkCatsBtn?.addEventListener("click", enableAllCategories);

const $adminToggle = document.getElementById("adminToggle");
const $addCategoryBtn = document.getElementById("addCategoryBtn");
const $addPointBtn = document.getElementById("addPointBtn");
const $exportBtn = document.getElementById("exportBtn");
const $resetLocalBtn = document.getElementById("resetLocalBtn");
const $adminBar = document.querySelector(".adminBar");

const $modal = document.getElementById("adminModal");
const $modalBody = document.getElementById("adminModalBody");
const $modalTitle = document.getElementById("adminModalTitle");

const STORAGE_POINTS = "admap_points_v1";
const STORAGE_CAT_ORDER = "admap_cat_order_v1";
const STORAGE_CAT_META = "admap_cat_meta_v1";
const STORAGE_ADMIN = "admap_admin_v1";

const ASSET_VERSION = "2026-02-10-2";
const POINTS_URL = `points.json?v=${ASSET_VERSION}`;
const CAT_META_URL = `categoryMeta.json?v=${ASSET_VERSION}`;
const CAT_ORDER_URL = `categoryOrder.json?v=${ASSET_VERSION}`;
let isAdmin = localStorage.getItem(STORAGE_ADMIN) === "1";
let isAddPointArmed = false;
let categoryOrder = [];
let categoryMeta = {};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}
function inBounds(p) {
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= 0 && x <= IMG_W && y >= 0 && y <= IMG_H;
}
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
}

function setAllCategoryCheckboxes(checked) {
  $categories?.querySelectorAll("input[type=checkbox][data-cat]").forEach(cb => {
    cb.checked = !!checked;
  });
}

function disableAllCategories() {
  userForcedNone = true;
  enabledCategories.clear();
  setAllCategoryCheckboxes(false);
  applyFiltersAndRender();
}

function enableAllCategories() {
  userForcedNone = false;
  enabledCategories.clear();
  $categories?.querySelectorAll("input[type=checkbox][data-cat]").forEach(cb => {
    const c = cb.getAttribute("data-cat");
    if (c) enabledCategories.add(c);
    cb.checked = true;
  });
  applyFiltersAndRender();
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function loadRemoteCategoryConfig() {
  try {
    const [metaR, orderR] = await Promise.all([
      fetch(CAT_META_URL, { cache: "no-store" }),
      fetch(CAT_ORDER_URL, { cache: "no-store" })
    ]);
    if (metaR.ok) {
      const meta = await metaR.json();
      if (meta && typeof meta === "object") categoryMeta = meta;
    }
    if (orderR.ok) {
      const ord = await orderR.json();
      if (Array.isArray(ord)) categoryOrder = ord;
    }
  } catch (e) {
    console.warn("Category config load failed (using defaults/local):", e);
  }
}

function loadLocalState() {
  const localOrder = safeJsonParse(localStorage.getItem(STORAGE_CAT_ORDER) || "[]", []);
  const localMeta = safeJsonParse(localStorage.getItem(STORAGE_CAT_META) || "{}", {});

  if (Array.isArray(localOrder) && localOrder.length) categoryOrder = localOrder;

  if (localMeta && typeof localMeta === "object" && Object.keys(localMeta).length) {
    categoryMeta = { ...(categoryMeta || {}), ...localMeta };
  }
}
function saveLocalState() {
  localStorage.setItem(STORAGE_ADMIN, isAdmin ? "1" : "0");
  localStorage.setItem(STORAGE_CAT_ORDER, JSON.stringify(categoryOrder));
  localStorage.setItem(STORAGE_CAT_META, JSON.stringify(categoryMeta));
  localStorage.setItem(STORAGE_POINTS, JSON.stringify(rawPoints));
}

function clearLocalState() {
  localStorage.removeItem(STORAGE_POINTS);
  localStorage.removeItem(STORAGE_CAT_ORDER);
  localStorage.removeItem(STORAGE_CAT_META);
}

let rawPoints = [];
let visiblePoints = [];
let droppedOutOfBounds = 0;

let userForcedNone = false;

const enabledCategories = new Set();
let searchQuery = "";

const iconCache = new Map();
function getLeafletIcon(iconPath) {
  if (!iconPath) return null;
  if (iconCache.has(iconPath)) return iconCache.get(iconPath);

  const icon = L.icon({
    iconUrl: iconPath,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12]
  });

  iconCache.set(iconPath, icon);
  return icon;
}

function getCategoryTitle(cat) {
  return (categoryMeta?.[cat]?.title) || cat;
}

function getDotDivIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div class="marker" style="background:${color}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10]
  });
}

const markersLayer = L.layerGroup().addTo(map);

function preparePoints(points) {
  droppedOutOfBounds = 0;

  const cleaned = [];
  for (const p of points) {
    if (!inBounds(p)) {
      droppedOutOfBounds++;
      continue;
    }
    cleaned.push({
      id: p.id ?? crypto.randomUUID(),
      name: p.name ?? "",
      desc: p.desc ?? "",
      category: p.category ?? "other",
      icon: p.icon ?? null,
      x: Number(p.x),
      y: Number(p.y)
    });
  }
  return cleaned;
}

function buildCategories(points) {
  const counts = new Map();
  for (const p of points) {
    const c = p.category || "other";
    counts.set(c, (counts.get(c) || 0) + 1);
  }

  if (enabledCategories.size === 0 && !userForcedNone) {
    for (const c of counts.keys()) enabledCategories.add(c);
  }

  const catsNow = [...new Set([
    ...counts.keys(),
    ...(Array.isArray(categoryOrder) ? categoryOrder : []),
    ...Object.keys(categoryMeta || {})
  ])];
  if (!Array.isArray(categoryOrder) || categoryOrder.length === 0) {
    categoryOrder = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  } else {
    for (const c of catsNow) if (!categoryOrder.includes(c)) categoryOrder.push(c);
    categoryOrder = categoryOrder.filter(c => catsNow.includes(c));
  }

  const items = categoryOrder.map(c => [c, counts.get(c) || 0]);
  $categories.innerHTML = "";

  for (const [cat, count] of items) {
    const color = hashColor(cat);
    const checked = enabledCategories.has(cat) ? "checked" : "";

    const row = document.createElement("div");
    row.className = "cat" + (isAdmin ? " cat--draggable" : "");
    row.setAttribute("data-cat", cat);
    row.draggable = !!isAdmin;

    const title = getCategoryTitle(cat);

    row.innerHTML = `
      ${isAdmin ? `<div class="cat__drag" title="Перетащить">⠿</div>` : ""}
      <div class="cat__left">
        <div class="dot" style="background:${color}"></div>
        <div class="cat__name">${esc(title)}</div>
      </div>
      <div class="cat__count">${count}</div>
      <label class="cat__toggle" title="Показать/скрыть категорию">
        <input type="checkbox" data-cat="${esc(cat)}" ${checked}/>
      </label>
      ${isAdmin ? `
        <div class="cat__actions">
          <button class="iconBtn" type="button" data-act="edit" title="Переименовать">✎</button>
          <button class="iconBtn iconBtn--danger" type="button" data-act="del" title="Удалить (точки перейдут в other)">🗑</button>
        </div>
      ` : ""}
    `;

    if (isAdmin) {
      row.addEventListener("dragstart", (e) => {
        row.classList.add("cat--dragging");
        e.dataTransfer.setData("text/plain", cat);
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => row.classList.remove("cat--dragging"));
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData("text/plain");
        const to = cat;
        if (!from || !to || from === to) return;
        const a = categoryOrder.indexOf(from);
        const b = categoryOrder.indexOf(to);
        if (a < 0 || b < 0) return;
        categoryOrder.splice(a, 1);
        categoryOrder.splice(b, 0, from);
        saveLocalState();
        buildCategories(rawPoints);
      });

      row.querySelectorAll("button[data-act]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.getAttribute("data-act");
          if (act === "edit") openCategoryEditor(cat);
          if (act === "del") deleteCategory(cat);
        });
      });
    }

    $categories.appendChild(row);
  }

  $categories.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const c = e.target.getAttribute("data-cat");
      if (!c) return;
      userForcedNone = false;
      if (e.target.checked) enabledCategories.add(c);
      else enabledCategories.delete(c);
      applyFiltersAndRender();
    });
  });
}

function pointMatches(p) {
  if (!enabledCategories.has(p.category)) return false;
  if (!searchQuery) return true;

  const q = searchQuery;
  return (
    norm(p.name).includes(q) ||
    norm(p.desc).includes(q) ||
    norm(p.category).includes(q)
  );
}

function applyFiltersAndRender() {
  visiblePoints = rawPoints.filter(pointMatches);

  const total = rawPoints.length;
  const visible = visiblePoints.length;
  $stats.textContent =
    `Точек: ${total}. Видимо: ${visible}` +
    (droppedOutOfBounds ? `. Отброшено вне карты: ${droppedOutOfBounds}` : "");

  markersLayer.clearLayers();

  for (const p of visiblePoints) {
    const latlng = [p.y, p.x];
    const color = hashColor(p.category || "other");
    const icon = p.icon ? getLeafletIcon(p.icon) : getDotDivIcon(color);

    const m = L.marker(latlng, {
      icon,
      draggable: !!isAdmin,
      keyboard: false
    }).addTo(markersLayer);

    const title = p.name || getCategoryTitle(p.category) || p.category;
    const popupHtml = `
      <b>${esc(title)}</b><br>
      ${p.desc ? esc(p.desc) + "<br>" : ""}
      <span style="opacity:.7">cat: ${esc(p.category)}<br>X: ${p.x.toFixed(1)} Y: ${p.y.toFixed(1)}</span>
      ${isAdmin ? `<hr style="opacity:.2"><button data-edit-point="${esc(p.id)}" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;">Редактировать</button>` : ""}
    `;
    m.bindPopup(popupHtml);

    if (isAdmin) {
      m.on("dragend", () => {
        const ll = m.getLatLng();
        p.x = Number(ll.lng.toFixed(2));
        p.y = Number(ll.lat.toFixed(2));
        saveLocalState();
        applyFiltersAndRender();
      });
      m.on("popupopen", (e) => {
        const btn = e.popup.getElement()?.querySelector("button[data-edit-point]");
        if (btn) {
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            openPointEditor(p.id);
          });
        }
      });
    }
  }
}

async function init() {
  await loadRemoteCategoryConfig();
  loadLocalState();

  if ($adminToggle) $adminToggle.classList.toggle("btn--active", isAdmin);
  if ($adminBar) {$adminBar.style.display = isAdmin ? "flex" : "none";}
  if ($addPointBtn) $addPointBtn.disabled = !isAdmin;
  if ($addCategoryBtn) $addCategoryBtn.disabled = !isAdmin;
  if ($exportBtn) $exportBtn.disabled = !isAdmin;

  const local = localStorage.getItem(STORAGE_POINTS);
  if (local) {
    const arr = safeJsonParse(local, []);
    rawPoints = preparePoints(Array.isArray(arr) ? arr : (arr.points || []));
    buildCategories(rawPoints);
    applyFiltersAndRender();
    return;
  }

  try {
    const r = await fetch(POINTS_URL, { cache: "no-store" });
    const data = await r.json();
    const points = Array.isArray(data) ? data : (data.points || []);
    rawPoints = preparePoints(points);
    buildCategories(rawPoints);
    applyFiltersAndRender();
  } catch (err) {
    console.error("Points load error", err);
    $stats.textContent = "Ошибка загрузки points.json";
  }
}

$search?.addEventListener("input", (e) => {
  searchQuery = norm(e.target.value);
  applyFiltersAndRender();
});

function openModal(title, html) {
  if (!$modal || !$modalBody || !$modalTitle) return;
  $modalTitle.textContent = title;
  $modalBody.innerHTML = html;
  $modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  if (!$modal) return;
  $modal.setAttribute("aria-hidden", "true");
  if ($modalBody) $modalBody.innerHTML = "";
}

$modal?.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.hasAttribute("data-close")) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

function openCategoryEditor(cat) {
  const currentTitle = getCategoryTitle(cat);
  openModal("Метка / Категория", `
    <div class="helpText">Категория (техническое имя): <span class="kbd">${esc(cat)}</span></div>
    <div class="formRow">
      <label>Отображаемое имя</label>
      <input class="field" id="catTitle" value="${esc(currentTitle)}" />
    </div>
    <div class="formActions">
      <button class="btn" type="button" id="catSaveBtn">Сохранить</button>
      <button class="btn btn--ghost" type="button" data-close>Отмена</button>
    </div>
  `);

  const $save = document.getElementById("catSaveBtn");
  $save?.addEventListener("click", () => {
    const title = String(document.getElementById("catTitle")?.value || "").trim();
    categoryMeta[cat] = { ...(categoryMeta[cat] || {}), title: title || cat };
    saveLocalState();
    buildCategories(rawPoints);
    applyFiltersAndRender();
    closeModal();
  });
}

function deleteCategory(cat) {
  if (cat === "other") {
    alert("Категорию 'other' удалять нельзя.");
    return;
  }
  const ok = confirm(`Удалить категорию '${cat}'? Все точки этой категории будут перенесены в 'other'.`);
  if (!ok) return;

  for (const p of rawPoints) {
    if (p.category === cat) p.category = "other";
  }
  delete categoryMeta[cat];
  categoryOrder = categoryOrder.filter(c => c !== cat);
  enabledCategories.add("other");
  saveLocalState();
  buildCategories(rawPoints);
  applyFiltersAndRender();
}

function createCategoryFlow() {
  openModal("Создать метку", `
    <div class="helpText">Категория — это строка, которая используется в поле <span class="kbd">category</span> у точек.</div>
    <div class="formRow">
      <label>Техническое имя (латиница/цифры/_) *</label>
      <input class="field" id="newCatId" placeholder="например: bunker" />
    </div>
    <div class="formRow">
      <label>Отображаемое имя</label>
      <input class="field" id="newCatTitle" placeholder="например: Бункер" />
    </div>
    <div class="formActions">
      <button class="btn" type="button" id="newCatCreateBtn">Создать</button>
      <button class="btn btn--ghost" type="button" data-close>Отмена</button>
    </div>
  `);

  const $btn = document.getElementById("newCatCreateBtn");
  $btn?.addEventListener("click", () => {
    const id = String(document.getElementById("newCatId")?.value || "").trim();
    const title = String(document.getElementById("newCatTitle")?.value || "").trim();
    if (!id) {
      alert("Укажи техническое имя категории.");
      return;
    }
    if (!/^[a-z0-9_\-]+$/i.test(id)) {
      alert("Техническое имя: только латиница/цифры/_/-");
      return;
    }
    if (!categoryOrder.includes(id)) categoryOrder.push(id);
    categoryMeta[id] = { ...(categoryMeta[id] || {}), title: title || id };
    enabledCategories.add(id);
    saveLocalState();
    buildCategories(rawPoints);
    applyFiltersAndRender();
    closeModal();
  });
}

function openPointEditor(pointId) {
  const p = rawPoints.find(x => x.id === pointId);
  if (!p) return;

  const cats = [...new Set([
    ...rawPoints.map(x => x.category),
    ...(Array.isArray(categoryOrder) ? categoryOrder : []),
    ...Object.keys(categoryMeta || {})
  ])].filter(Boolean).sort();
  const catOptions = cats.map(c => `<option value="${esc(c)}" ${c === p.category ? "selected" : ""}>${esc(getCategoryTitle(c))}</option>`).join("");

  openModal("Точка", `
    <div class="formRow">
      <label>Название</label>
      <input class="field" id="pName" value="${esc(p.name)}" placeholder="например: Улей" />
    </div>
    <div class="formRow">
      <label>Описание</label>
      <textarea class="field" id="pDesc" placeholder="...">${esc(p.desc)}</textarea>
    </div>
    <div class="formRow">
      <label>Категория</label>
      <select class="field" id="pCategory">${catOptions}</select>
      <div class="helpText">Нужна новая метка? Нажми <b>+ Метка</b> сверху или просто введи новый id в JSON после экспорта.</div>
    </div>
    <div class="formRow">
      <label>Иконка (путь, опционально)</label>
      <input class="field" id="pIcon" value="${esc(p.icon || "")}" placeholder="icons/...png" />
    </div>
    <div class="helpText">Координаты: <span class="kbd">X=${p.x.toFixed(2)} Y=${p.y.toFixed(2)}</span> (в админ-режиме можно перетащить маркер)</div>
    <div class="formActions">
      <button class="btn" type="button" id="pSaveBtn">Сохранить</button>
      <button class="btn btn--ghost" type="button" data-close>Отмена</button>
      <button class="btn danger" type="button" id="pDeleteBtn">Удалить</button>
    </div>
  `);

  document.getElementById("pSaveBtn")?.addEventListener("click", () => {
    p.name = String(document.getElementById("pName")?.value || "").trim();
    p.desc = String(document.getElementById("pDesc")?.value || "").trim();
    p.category = String(document.getElementById("pCategory")?.value || "other").trim() || "other";
    p.icon = String(document.getElementById("pIcon")?.value || "").trim() || null;
    enabledCategories.add(p.category);
    saveLocalState();
    buildCategories(rawPoints);
    applyFiltersAndRender();
    closeModal();
  });

  document.getElementById("pDeleteBtn")?.addEventListener("click", () => {
    if (!confirm("Удалить точку?")) return;
    rawPoints = rawPoints.filter(x => x.id !== p.id);
    saveLocalState();
    buildCategories(rawPoints);
    applyFiltersAndRender();
    closeModal();
  });
}

function createPointAt(x, y) {
  const p = {
    id: crypto.randomUUID(),
    name: "",
    desc: "",
    category: "other",
    icon: null,
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2))
  };
  rawPoints.push(p);
  enabledCategories.add(p.category);
  saveLocalState();
  buildCategories(rawPoints);
  applyFiltersAndRender();
  openPointEditor(p.id);
}

function setAdmin(on) {
  isAdmin = !!on;

  if ($adminBar) {
    $adminBar.style.display = isAdmin ? "flex" : "none";
  }

  if ($adminToggle) $adminToggle.classList.toggle("btn--active", isAdmin);
  if ($addPointBtn) $addPointBtn.disabled = !isAdmin;
  if ($addCategoryBtn) $addCategoryBtn.disabled = !isAdmin;
  if ($exportBtn) $exportBtn.disabled = !isAdmin;

  isAddPointArmed = false;
  if ($addPointBtn) $addPointBtn.classList.remove("btn--active");

  saveLocalState();
  buildCategories(rawPoints);
  applyFiltersAndRender();
}


$adminToggle?.addEventListener("click", () => setAdmin(!isAdmin));

$addCategoryBtn?.addEventListener("click", () => {
  if (!isAdmin) return;
  createCategoryFlow();
});

$addPointBtn?.addEventListener("click", () => {
  if (!isAdmin) return;
  isAddPointArmed = !isAddPointArmed;
  $addPointBtn.classList.toggle("btn--active", isAddPointArmed);
});

map.on("click", (e) => {
  if (!isAdmin || !isAddPointArmed) return;
  isAddPointArmed = false;
  $addPointBtn?.classList.remove("btn--active");
  createPointAt(e.latlng.lng, e.latlng.lat);
});

function downloadJson(filename, obj) {
  const payload = JSON.stringify(obj, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$exportBtn?.addEventListener("click", () => {
  if (!isAdmin) return;
  downloadJson("points.json", rawPoints);
  setTimeout(() => downloadJson("categoryMeta.json", categoryMeta), 150);
  setTimeout(() => downloadJson("categoryOrder.json", categoryOrder), 300);
});
$resetLocalBtn?.addEventListener("click", () => {
  if (!confirm("Сбросить локальные правки? Страница перезагрузится и снова будет использовать points.json.")) return;
  clearLocalState();
  location.reload();
});

// старт
init();

const titleEl = document.querySelector(".title");

if (titleEl) {
  let clicks = 0;

  titleEl.addEventListener("click", () => {
    clicks++;

    if (clicks >= 5) {
      clicks = 0;
      setAdmin(!isAdmin);
      console.log("Admin:", isAdmin);
    }
  });
}
