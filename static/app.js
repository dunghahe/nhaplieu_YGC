const state = {
  parts: [],
  partSummary: [],
  orders: [],
  machines: [],
  workers: [],
  currentLot: null,
  lotMode: "gia_cong",
  editingPartCode: null,
  editingOrderCode: null,
  editingMachineCode: null,
  editingWorkerCode: null,
  focusFormId: null,
  pendingDelete: null,
  currentOrderLots: [],
  currentDetailOrderCode: "",
  currentLotOrderCode: "",
  machineSaveSuppressBlur: new Set(),
};

const $ = (id) => document.getElementById(id);
const on = (id, event, handler) => {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
};

const ORDER_EXTRA_INPUTS = {
  raw_material_code: "rawMaterialCode",
  drawing_code: "drawingCode",
  drawing_rev: "drawingRev",
  material: "material",
  blank_size: "blankSize",
  order_receive_date: "orderReceiveDate",
};
const ORDER_DATE_FIELDS = new Set(["order_receive_date"]);
const DEFAULT_QC_ITEMS = [
  "Đo 100% kích thước theo tiêu chuẩn",
  "Soi ngoại quan 100%",
  "Kiểm tra đúng mã sản phẩm, chất liệu",
  "QC trong kiểm tra xác suất",
];

// Bavia dùng đúng 3 tiêu đề đầu của QC gia công.
const DEFAULT_BAVIA_ITEMS = DEFAULT_QC_ITEMS.slice(0, 3);
const DEFAULT_WAREHOUSE_ITEMS = [
  "Số lượng nhận từ QC",
  "Kiểm tra đúng mã sản phẩm, chất liệu",
  "Đóng gói",
];

function statusText(status) {
  return { todo: "Chưa nhập", partial: "Đang nhập", done: "Hoàn thành" }[status] || status;
}

function formatQty(value) {
  return String(Math.trunc(Number(value || 0)));
}

function formatDivision(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
}

function formatCycle(seconds) {
  const total = Number(seconds || 0);
  return `${total} giây`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function formatDateDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return raw;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message, type = "info") {
  const icons = { success: "OK", error: "Lỗi", warning: "Cảnh báo", info: "Info" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = `${icons[type] || "Info"}: ${message}`;
  $("toastHost").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok) {
    const detail = data?.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item?.msg || item?.message || JSON.stringify(item)).join("; ")
        : detail && typeof detail === "object"
          ? detail.message || JSON.stringify(detail)
          : "Có lỗi xảy ra khi gọi API";
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function withLoading(btn, fn) {
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang xử lý...";
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function renderQr(canvas, value, width = 120) {
  if (!canvas) return;
  const img = document.createElement("img");
  img.className = "qr-img";
  img.alt = value;
  img.width = width;
  img.height = width;
  img.src = `/api/qr?text=${encodeURIComponent(value)}&size=${width}`;
  canvas.replaceWith(img);
}

function deepLinkForLot(lotCode, formId = "") {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("lot", lotCode);
  if (formId) url.searchParams.set("form", formId);
  return url.toString();
}

function showScreen(screenId) {
  document.querySelectorAll(".nav-btn").forEach((x) => x.classList.toggle("active", x.dataset.screen === screenId));
  document.querySelectorAll(".screen").forEach((x) => x.classList.add("hidden"));
  const screen = $(screenId);
  if (!screen) return toast(`Không tìm thấy màn hình: ${screenId}`, "error");
  screen.classList.remove("hidden");
  if (screenId === "partsScreen") loadPartsSummary().catch((err) => toast(err.message, "error"));
  if (screenId === "lotScreen") {
    loadOrders().catch((err) => toast(err.message, "error")).then(() => {
      if (state.currentLot?.lot_code) refreshCurrentLot(state.currentLot.lot_code).catch((err) => toast(err.message, "error"));
    });
  }
  if (screenId === "reportScreen") loadReports();
}

function activeMachines() {
  return state.machines.filter((item) => Number(item.is_active) === 1);
}

function activeWorkers() {
  return state.workers.filter((item) => Number(item.is_active) === 1);
}

function renderDatalists() {
  let ml = $("machineDatalist");
  if (!ml) { ml = document.createElement("datalist"); ml.id = "machineDatalist"; document.body.appendChild(ml); }
  ml.innerHTML = activeMachines().map(m => `<option value="${m.machine_code} - ${m.machine_name}"></option>`).join("");

  let wl = $("workerDatalist");
  if (!wl) { wl = document.createElement("datalist"); wl.id = "workerDatalist"; document.body.appendChild(wl); }
  wl.innerHTML = activeWorkers().map(w => `<option value="${w.worker_code} - ${w.worker_name}"></option>`).join("");
}

function getMachineDisplayName(code) {
  if (!code) return "";
  const m = state.machines.find(x => x.machine_code === code);
  return m ? `${m.machine_code} - ${m.machine_name}` : code;
}

function getWorkerDisplayName(code) {
  if (!code) return "";
  const w = state.workers.find(x => x.worker_code === code);
  return w ? `${w.worker_code} - ${w.worker_name}` : code;
}

function codeFromDisplay(value) {
  return String(value || "").trim().split(" - ")[0].trim().toUpperCase();
}

function wireNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showScreen(btn.dataset.screen);
    });
  });
}

function renderPartsShell() {
  const panel = $("partsScreen")?.querySelector(".panel.mt-5");
  if (!panel) return;
  panel.innerHTML = `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="field-label">Từ ngày</label>
        <input id="partDateFrom" type="date" class="input">
      </div>
      <div>
        <label class="field-label">Đến ngày</label>
        <input id="partDateTo" type="date" class="input">
      </div>
      <button id="applyPartFilterBtn" class="btn primary">Lọc</button>
      <button id="clearPartFilterBtn" class="btn secondary">Xóa lọc</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Mã hàng</th><th>Số đơn</th><th>Tổng SL</th><th>Đã hoàn thành</th><th>OK</th><th>NG</th><th>Thao tác</th></tr>
        </thead>
        <tbody id="partsTable"></tbody>
      </table>
    </div>
  `;
}

function wireUppercase() {
  document.querySelectorAll(".uppercase-input").forEach((input) => {
    input.addEventListener("input", () => {
      const pos = input.selectionStart;
      input.value = input.value.toUpperCase();
      input.setSelectionRange(pos, pos);
    });
  });
}

function openDeleteModal({ title, message, onConfirm }) {
  state.pendingDelete = onConfirm;
  $("deleteModalTitle").textContent = title;
  $("deleteModalMessage").textContent = message;
  $("deleteCodeInput").value = "";
  $("deleteModalError").classList.add("hidden");
  $("deleteModal").classList.remove("hidden");
  $("deleteCodeInput").focus();
}

function closeDeleteModal() {
  state.pendingDelete = null;
  $("deleteModal").classList.add("hidden");
}

function wireDeleteModal() {
  on("cancelDeleteBtn", "click", closeDeleteModal);
  on("deleteModal", "click", (event) => {
    if (event.target === $("deleteModal")) closeDeleteModal();
  });
  on("confirmDeleteBtn", "click", () => withLoading($("confirmDeleteBtn"), async () => {
    if (!state.pendingDelete) return;
    const code = $("deleteCodeInput").value.trim();
    if (!code) {
      $("deleteModalError").textContent = "Vui lòng nhập mã xóa";
      $("deleteModalError").classList.remove("hidden");
      return;
    }
    try {
      await state.pendingDelete(code);
      closeDeleteModal();
    } catch (err) {
      $("deleteModalError").textContent = err.message;
      $("deleteModalError").classList.remove("hidden");
    }
  }));
}

async function loadMachines() {
  state.machines = await api("/api/machines");
  renderMachinesTable();
  renderDatalists();
  await refreshOpenLotIfVisible();
}

async function loadWorkers() {
  state.workers = await api("/api/workers");
  renderWorkersTable();
  renderDatalists();
  await refreshOpenLotIfVisible();
}

function renderMachinesTable() {
  $("machinesTable").innerHTML = state.machines.map((m) => `
    <tr class="${Number(m.is_active) ? "" : "inactive-row"}">
      <td class="mono font-bold">${m.machine_code}</td>
      <td>${state.editingMachineCode === m.machine_code ? `<input class="input mini-input" data-machine-name="${m.machine_code}" value="${m.machine_name}">` : m.machine_name}</td>
      <td>${state.editingMachineCode === m.machine_code ? `<input class="input mini-input" data-machine-location="${m.machine_code}" value="${m.location || ""}">` : (m.location || "")}</td>
      <td>${Number(m.is_active) ? "Hoạt động" : "Ngừng"}</td>
      <td class="flex flex-wrap gap-2">
        ${state.editingMachineCode === m.machine_code
          ? `<button class="btn mini primary" data-save-machine="${m.machine_code}">Lưu</button><button class="btn mini secondary" data-cancel-machine-edit>Hủy</button>`
          : `<button class="btn mini secondary" data-edit-machine="${m.machine_code}">Sửa</button>`}
        ${Number(m.is_active) ? `<button class="btn mini danger" data-delete-machine="${m.machine_code}">Xóa</button>` : `<button class="btn mini secondary" data-restore-machine="${m.machine_code}">Khôi phục</button>`}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="text-slate-500">Chưa có máy</td></tr>`;

  document.querySelectorAll("[data-save-machine]").forEach((btn) => {
    btn.addEventListener("click", () => saveMachine(btn.dataset.saveMachine));
  });
  document.querySelectorAll("[data-edit-machine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingMachineCode = btn.dataset.editMachine;
      renderMachinesTable();
    });
  });
  document.querySelectorAll("[data-cancel-machine-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingMachineCode = null;
      renderMachinesTable();
    });
  });
  document.querySelectorAll("[data-delete-machine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openDeleteModal({
        title: "Xóa máy CNC",
        message: `Nhập mã xóa để xóa máy ${btn.dataset.deleteMachine}.`,
        onConfirm: async (deleteCode) => {
          await api(`/api/machines/${encodeURIComponent(btn.dataset.deleteMachine)}`, { method: "DELETE" });
          toast("Đã xóa máy", "success");
          await loadMachines();
        },
      });
    });
  });
  document.querySelectorAll("[data-restore-machine]").forEach((btn) => {
    btn.addEventListener("click", () => toggleMachine(btn.dataset.restoreMachine, 1));
  });
}

function renderWorkersTable() {
  $("workersTable").innerHTML = state.workers.map((w) => `
    <tr class="${Number(w.is_active) ? "" : "inactive-row"}">
      <td class="mono font-bold">${w.worker_code}</td>
      <td>${state.editingWorkerCode === w.worker_code ? `<input class="input mini-input" data-worker-name="${w.worker_code}" value="${w.worker_name}">` : w.worker_name}</td>
      <td>${Number(w.is_active) ? "Hoạt động" : "Ngừng"}</td>
      <td class="flex flex-wrap gap-2">
        ${state.editingWorkerCode === w.worker_code
          ? `<button class="btn mini primary" data-save-worker="${w.worker_code}">Lưu</button><button class="btn mini secondary" data-cancel-worker-edit>Hủy</button>`
          : `<button class="btn mini secondary" data-edit-worker="${w.worker_code}">Sửa</button>`}
        ${Number(w.is_active) ? `<button class="btn mini danger" data-delete-worker="${w.worker_code}">Xóa</button>` : `<button class="btn mini secondary" data-restore-worker="${w.worker_code}">Khôi phục</button>`}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="text-slate-500">Chưa có nhân công</td></tr>`;

  document.querySelectorAll("[data-save-worker]").forEach((btn) => {
    btn.addEventListener("click", () => saveWorker(btn.dataset.saveWorker));
  });
  document.querySelectorAll("[data-edit-worker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingWorkerCode = btn.dataset.editWorker;
      renderWorkersTable();
    });
  });
  document.querySelectorAll("[data-cancel-worker-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.editingWorkerCode = null;
      renderWorkersTable();
    });
  });
  document.querySelectorAll("[data-delete-worker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openDeleteModal({
        title: "Xóa nhân công",
        message: `Nhập mã xóa để xóa nhân công ${btn.dataset.deleteWorker}.`,
        onConfirm: async (deleteCode) => {
          await api(`/api/workers/${encodeURIComponent(btn.dataset.deleteWorker)}`, { method: "DELETE" });
          toast("Đã xóa nhân công", "success");
          await loadWorkers();
        },
      });
    });
  });
  document.querySelectorAll("[data-restore-worker]").forEach((btn) => {
    btn.addEventListener("click", () => toggleWorker(btn.dataset.restoreWorker, 1));
  });
}

async function saveMachine(machineCode) {
  const machine = state.machines.find((m) => m.machine_code === machineCode);
  await api(`/api/machines/${encodeURIComponent(machineCode)}`, {
    method: "PUT",
    body: JSON.stringify({
      machine_name: document.querySelector(`[data-machine-name="${machineCode}"]`).value,
      location: document.querySelector(`[data-machine-location="${machineCode}"]`).value,
      is_active: Number(machine?.is_active ?? 1),
    }),
  });
  toast("Đã cập nhật máy", "success");
  state.editingMachineCode = null;
  await loadMachines();
}

async function toggleMachine(machineCode, isActive) {
  const machine = state.machines.find((m) => m.machine_code === machineCode);
  await api(`/api/machines/${encodeURIComponent(machineCode)}`, {
    method: "PUT",
    body: JSON.stringify({
      machine_name: machine.machine_name,
      location: machine.location || "",
      is_active: isActive,
    }),
  });
  await loadMachines();
}

async function saveWorker(workerCode) {
  const worker = state.workers.find((w) => w.worker_code === workerCode);
  await api(`/api/workers/${encodeURIComponent(workerCode)}`, {
    method: "PUT",
    body: JSON.stringify({
      worker_name: document.querySelector(`[data-worker-name="${workerCode}"]`).value,
      is_active: Number(worker?.is_active ?? 1),
    }),
  });
  toast("Đã cập nhật nhân công", "success");
  state.editingWorkerCode = null;
  await loadWorkers();
}

async function toggleWorker(workerCode, isActive) {
  const worker = state.workers.find((w) => w.worker_code === workerCode);
  await api(`/api/workers/${encodeURIComponent(workerCode)}`, {
    method: "PUT",
    body: JSON.stringify({ worker_name: worker.worker_name, is_active: isActive }),
  });
  await loadWorkers();
}

function wireMaster() {
  on("downloadTemplateBtn", "click", () => {
    const isMachine = $("machinesTab").classList.contains("hidden") === false;
    window.open(isMachine ? "/api/machines/template" : "/api/workers/template", "_blank");
  });
  on("importExcelBtn", "click", () => {
    $("excelImportInput").click();
  });
  on("excelImportInput", "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isMachine = $("machinesTab").classList.contains("hidden") === false;
    const formData = new FormData();
    formData.append("file", file);
    withLoading($("importExcelBtn"), async () => {
      const res = await fetch(isMachine ? "/api/machines/import" : "/api/workers/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Lỗi nhập Excel");
      toast(data.message, "success");
      if (data.errors && data.errors.length) {
        toast(`Có ${data.errors.length} lỗi, xem console`, "warning");
        console.error("Import errors:", data.errors);
      }
      isMachine ? await loadMachines() : await loadWorkers();
    }).catch(err => toast(err.message, "error")).finally(() => e.target.value = "");
  });

  document.querySelectorAll("[data-master-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-master-tab]").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".master-tab").forEach((x) => x.classList.add("hidden"));
      btn.classList.add("active");
      $(btn.dataset.masterTab).classList.remove("hidden");
    });
  });
  on("saveMachineBtn", "click", () => withLoading($("saveMachineBtn"), async () => {
    await api("/api/machines", {
      method: "POST",
      body: JSON.stringify({
        machine_code: $("machineCode").value,
        machine_name: $("machineName").value,
        location: $("machineLocation").value,
      }),
    });
    $("machineCode").value = "";
    $("machineName").value = "";
    $("machineLocation").value = "";
    toast("Đã thêm máy", "success");
    await loadMachines();
  }).catch((err) => toast(err.message, "error")));
  on("saveWorkerBtn", "click", () => withLoading($("saveWorkerBtn"), async () => {
    await api("/api/workers", {
      method: "POST",
      body: JSON.stringify({ worker_code: $("workerCode").value, worker_name: $("workerName").value }),
    });
    $("workerCode").value = "";
    $("workerName").value = "";
    toast("Đã thêm nhân công", "success");
    await loadWorkers();
  }).catch((err) => toast(err.message, "error")));
  ["machineCode", "machineName", "machineLocation"].forEach((id) => on(id, "keydown", (event) => {
    if (event.key === "Enter") $("saveMachineBtn")?.click();
  }));
  ["workerCode", "workerName"].forEach((id) => on(id, "keydown", (event) => {
    if (event.key === "Enter") $("saveWorkerBtn")?.click();
  }));
}

let newSteps = [];

function collectStepsFromForm() {
  return Array.from($("stepList")?.querySelectorAll(".draggable-item") || []).map((item, index) => ({
    step_name: item.querySelector(`[data-step-name="${index}"]`)?.value?.trim().toUpperCase() || "",
    cycle_time_seconds: Number(item.querySelector(`[data-step-cycle="${index}"]`)?.value || 0),
  }));
}

function renderStepList() {
  $("stepList").innerHTML = newSteps.map((step, index) => `
    <div class="draggable-item flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2" draggable="true" data-index="${index}">
      <div class="flex items-center gap-2">
        <button class="text-slate-400 hover:text-slate-700" data-move-up="${index}" ${index === 0 ? 'disabled style="opacity: 0.2"' : ''}>▲</button>
        <button class="text-slate-400 hover:text-slate-700" data-move-down="${index}" ${index === newSteps.length - 1 ? 'disabled style="opacity: 0.2"' : ''}>▼</button>
        <span class="font-bold">${index + 1}. ${step.step_name}</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm font-bold text-slate-500">${step.cycle_time_seconds} giây</span>
        <button class="text-sm font-bold text-red-600 hover:text-red-800" data-remove-step="${index}">Xóa</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".draggable-item").forEach((item) => {
    const index = Number(item.dataset.index);
    const label = item.querySelector(".font-bold");
    const timeLabel = item.querySelector(".text-slate-500");
    if (label && !item.querySelector(`[data-step-name="${index}"]`)) {
      const currentName = newSteps[index]?.step_name || label.textContent.replace(/^\d+\.\s*/, "");
      label.outerHTML = `<input class="input mini-input" data-step-name="${index}" value="${escapeHtml(currentName)}" placeholder="Tên công đoạn">`;
    }
    if (timeLabel && !item.querySelector(`[data-step-cycle="${index}"]`)) {
      const currentCycle = newSteps[index]?.cycle_time_seconds ?? Number(timeLabel.textContent);
      timeLabel.outerHTML = `<input class="input mini-input" data-step-cycle="${index}" type="number" min="1" step="1" value="${formatQty(currentCycle)}" placeholder="Giây">`;
    }
  });
  
  document.querySelectorAll("[data-remove-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      newSteps.splice(Number(btn.dataset.removeStep), 1);
      renderStepList();
    });
  });
  document.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.moveUp);
      if (idx > 0) {
        [newSteps[idx - 1], newSteps[idx]] = [newSteps[idx], newSteps[idx - 1]];
        renderStepList();
      }
    });
  });
  document.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.moveDown);
      if (idx < newSteps.length - 1) {
        [newSteps[idx + 1], newSteps[idx]] = [newSteps[idx], newSteps[idx + 1]];
        renderStepList();
      }
    });
  });

  let draggedIdx = null;
  document.querySelectorAll(".draggable-item").forEach(item => {
    item.addEventListener("dragstart", (e) => {
      draggedIdx = Number(item.dataset.index);
      setTimeout(() => item.classList.add("dragging"), 0);
    });
    item.addEventListener("dragend", (e) => {
      item.classList.remove("dragging");
      document.querySelectorAll(".draggable-item").forEach(el => el.classList.remove("drag-over"));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", (e) => {
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetIdx = Number(item.dataset.index);
      if (draggedIdx !== null && draggedIdx !== targetIdx) {
        const [removed] = newSteps.splice(draggedIdx, 1);
        newSteps.splice(targetIdx, 0, removed);
        renderStepList();
      }
    });
  });
}

async function loadParts() {
  state.parts = await api("/api/parts");
  $("partsTable").innerHTML = state.parts.map((part) => `
    <tr>
      <td class="mono font-bold">${part.part_code}</td>
      <td>${part.steps.map((s, i) => `<span class="badge todo mr-1 mb-1">${i + 1}. ${s.step_name} · ${formatCycle(s.cycle_time_seconds)}</span>`).join("")}</td>
      <td>${part.created_at || ""}</td>
      <td><div class="flex flex-wrap gap-2"><button class="btn mini secondary" data-edit-part="${part.part_code}">Sửa</button><button class="btn mini danger" data-delete-part="${part.part_code}">Xóa</button></div></td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="text-slate-500">Chưa có mã hàng</td></tr>`;
  document.querySelectorAll("[data-edit-part]").forEach((btn) => btn.addEventListener("click", () => startEditPart(btn.dataset.editPart)));
  document.querySelectorAll("[data-delete-part]").forEach((btn) => btn.addEventListener("click", () => requestDeletePart(btn.dataset.deletePart)));
  $("orderPartCode").innerHTML = `<option value="">Chọn mã hàng</option>${state.parts.map((p) => `<option value="${p.part_code}">${p.part_code}</option>`).join("")}`;
}

function startEditPart(partCode) {
  const part = state.parts.find((item) => item.part_code === partCode);
  if (!part) return;
  state.editingPartCode = part.part_code;
  $("partCode").value = part.part_code;
  $("partCode").readOnly = false;
  $("partModalTitle").textContent = `Sửa mã hàng: ${part.part_code}`;
  newSteps = part.steps.map((step) => ({ step_name: step.step_name, cycle_time_seconds: Number(step.cycle_time_seconds || 1) }));
  renderStepList();
  $("partModal").classList.remove("hidden");
}

function resetPartForm() {
  $("partModal").classList.add("hidden");
}

function collectOrderExtra() {
  return Object.fromEntries(Object.entries(ORDER_EXTRA_INPUTS).map(([field, id]) => {
    const val = $(id)?.value?.trim() || "";
    return [field, ORDER_DATE_FIELDS.has(field) ? (val || null) : val];
  }));
}

function fillOrderExtra(order = {}) {
  Object.entries(ORDER_EXTRA_INPUTS).forEach(([field, id]) => {
    if ($(id)) $(id).value = order[field] || "";
  });
}

function resetOrderExtra() {
  fillOrderExtra({});
}

function requestDeletePart(partCode) {
  openDeleteModal({
    title: "Xóa mã hàng",
    message: `Nhập mã xóa để xóa mã hàng ${partCode}.`,
    onConfirm: async (deleteCode) => {
      await api(`/api/parts/${encodeURIComponent(partCode)}`, { method: "DELETE", body: JSON.stringify({ delete_code: deleteCode }) });
      toast("Đã xóa mã hàng", "success");
      await loadParts();
    },
  });
}

function wireParts() {
  renderPartsShell();
  $("openCreatePartModalBtn")?.addEventListener("click", () => {
    state.editingPartCode = null;
    $("partCode").value = "";
    $("partCode").readOnly = false;
    $("partModalTitle").textContent = "Tạo mã hàng mới";
    $("stepName").value = "";
    $("stepCycleSeconds").value = "";
    newSteps = [];
    renderStepList();
    $("partModal").classList.remove("hidden");
  });
  
  $("closePartModalBtn")?.addEventListener("click", resetPartForm);
  $("cancelPartModalBtn")?.addEventListener("click", resetPartForm);
  $("partModal")?.addEventListener("click", (e) => {
    if (e.target.id === "partModal") resetPartForm();
  });

  $("addStepBtn")?.addEventListener("click", () => {
    const value = $("stepName").value.trim().toUpperCase();
    const cycleSeconds = Number($("stepCycleSeconds").value || 0);
    if (!value) return toast("Vui lòng nhập tên công đoạn", "warning");
    if (cycleSeconds <= 0) return toast("Vui lòng nhập số giây lớn hơn 0", "warning");
    newSteps.push({ step_name: value, cycle_time_seconds: cycleSeconds });
    $("stepName").value = "";
    $("stepCycleSeconds").value = "";
    renderStepList();
  });
  
  ["stepName", "stepCycleSeconds"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("addStepBtn")?.click();
    });
  });

  $("savePartBtn")?.addEventListener("click", () => withLoading($("savePartBtn"), async () => {
    const partCode = $("partCode").value.trim().toUpperCase();
    const stepsPayload = collectStepsFromForm();
    if (!partCode || !stepsPayload.length) return toast("Nhập mã hàng và ít nhất 1 công đoạn", "warning");
    if (stepsPayload.some((step) => !step.step_name || step.cycle_time_seconds <= 0)) return toast("Vui lòng nhập đúng tên công đoạn và số giây lớn hơn 0", "warning");
    if (state.editingPartCode) {
      await api(`/api/parts/${encodeURIComponent(state.editingPartCode)}`, {
        method: "PUT",
        body: JSON.stringify({
          part_code: partCode,
          steps: stepsPayload.map((s) => ({
            step_name: s.step_name,
            cycle_time_seconds: s.cycle_time_seconds,
          })),
        }),
      });
    } else {
      await api("/api/parts", { method: "POST", body: JSON.stringify({ part_code: partCode, steps: stepsPayload.map(s => ({ step_name: s.step_name, cycle_time_seconds: s.cycle_time_seconds })) }) });
    }
    toast("Đã lưu mã hàng", "success");
    resetPartForm();
    await loadParts();
    const filters = getPartSummaryFilters();
    if (filters) await loadPartsSummary(filters);
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));

  $("applyPartFilterBtn")?.addEventListener("click", () => {
    const filters = getPartSummaryFilters();
    if (!filters) return;
    loadPartsSummary(filters).catch((err) => toast(err.message, "error"));
  });
  $("clearPartFilterBtn")?.addEventListener("click", () => {
    if ($("partDateFrom")) $("partDateFrom").value = "";
    if ($("partDateTo")) $("partDateTo").value = "";
    loadPartsSummary().catch((err) => toast(err.message, "error"));
  });
  ["partDateFrom", "partDateTo"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("applyPartFilterBtn")?.click();
    });
  });
}

async function loadOrders() {
  state.orders = await api("/api/orders");
  const previousLotOrder = state.currentLotOrderCode || "";
  $("reportOrderSelect").innerHTML = state.orders.map((o) => `<option value="${o.order_code}">${o.order_code}</option>`).join("");
  $("lotOrderSelect").innerHTML = state.orders.map((o) => `<option value="${o.order_code}">${o.order_code} · ${o.part_code}</option>`).join("");
  renderOrdersHistory();
  const selectedLotOrder = state.orders.some((o) => o.order_code === previousLotOrder)
    ? previousLotOrder
    : state.orders[0]?.order_code || "";
  if (selectedLotOrder) {
    $("lotOrderSelect").value = selectedLotOrder;
    state.currentLotOrderCode = selectedLotOrder;
    await renderLotHints(selectedLotOrder);
  } else {
    $("lotHintGrid").innerHTML = `<div class="text-sm font-semibold text-slate-500">Chưa có đơn hàng</div>`;
  }
}

function updateLotPreview() {
  const total = Number($("totalQty").value || 0);
  const plannedLots = Number($("qtyPerLot").value || 0);
  if (total > 0 && plannedLots > 0) {
    if (!Number.isInteger(total) || !Number.isInteger(plannedLots)) return $("lotCountPreview").textContent = "Tổng SL và số PCS / lô phải là số nguyên";
    if (plannedLots > total) return $("lotCountPreview").textContent = "Số PCS / lô không được lớn hơn tổng số lượng";
    const baseQty = plannedLots;
    const actualLots = Math.floor(total / baseQty);
    const remainder = total % baseQty;
    const totalLots = actualLots + (remainder ? 1 : 0);
    $("lotCountPreview").textContent = remainder
      ? `${totalLots} lô (${actualLots} lô x ${baseQty} pcs + 1 lô dư ${remainder} pcs)`
      : `${totalLots} lô (${actualLots} lô x ${baseQty} pcs)`;
  } else {
    $("lotCountPreview").textContent = "0";
  }
}

async function showOrderDetails(orderCode) {
  const order = state.orders.find(o => o.order_code === orderCode);
  if (!order) return;
  state.currentDetailOrderCode = orderCode;
  
  $("detailOrderTitle").textContent = order.order_code;
  $("detailPartCode").textContent = order.part_code;
  $("detailTotalQty").textContent = formatQty(order.total_qty);
  $("detailTotalLots").textContent = order.total_lots;
  $("detailProgress").textContent = (order.progress_percent || 0) + "%";
  
  $("ordersListSection").classList.add("hidden");
  $("orderDetailSection").classList.remove("hidden");
  
  try {
    const reportData = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
    // Group by lot_code
    const lotsMap = {};
    for (const row of reportData) {
      if (!lotsMap[row.lot_code]) {
        lotsMap[row.lot_code] = {
          lot_code: row.lot_code,
          qty: row.qty_per_lot,
          steps: []
        };
      }
      lotsMap[row.lot_code].steps.push(row);
    }
    
    const sortedLots = Object.values(lotsMap).sort((a, b) => a.lot_code.localeCompare(b.lot_code));
    $("detailLotsTable").innerHTML = sortedLots.map(lot => {
      const stepsHtml = lot.steps.map((s, i) => {
        let badgeClass = s.status === 'done' ? 'done' : (s.status === 'partial' ? 'partial' : 'todo');
        return `<span class="badge ${badgeClass} mr-1 mb-1" title="${escapeHtml(s.machines_used || '')}">${i + 1}. ${s.step_name}</span>`;
      }).join("");
      
      return `
        <tr>
          <td class="mono font-bold">${lot.lot_code}</td>
          <td>${formatQty(lot.qty)}</td>
          <td>${stepsHtml}</td>
          <td>
            <div class="flex gap-2">
              <button class="btn mini primary" onclick="printExportSheet('${lot.lot_code}')">In phiếu xuất kho</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    toast("Lỗi tải chi tiết đơn hàng", "error");
  }
}

function showLotQr(lotCode) {
  // Navigate to lot screen and load it (printLotCodeInput may not exist anymore)
  const input = $("printLotCodeInput");
  if (input) {
    input.value = displayLotCode(lotCode);
    const btn = $("printLotByCodeBtn");
    if (btn) btn.click();
  } else {
    // Fallback: just print directly
    printLot(lotInputToInternalCode(lotCode)).catch(err => toast(err.message, 'error'));
  }
}

async function showOrderQrs(orderCode) {
  return openOrderQrs(orderCode);
}

// JS slugify matching the Python version in database.py
function slugify(text) {
  // Normalize NFD and remove combining diacritics (Mn category)
  text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  text = text.replace(/\s+/g, "").toUpperCase();
  text = text.replace(/[^A-Z0-9_-]/g, "");
  return text;
}

function buildFormId(lotCode, stepName) {
  return `FORM-${lotCode}-${slugify(stepName)}`;
}

async function printExportSheet(lotCode) {
  const lot = await api(`/api/lots/${encodeURIComponent(lotCode)}`).catch(() => null);
  if (!lot) return toast("Không tìm thấy lô", "error");

  // Ensure steps are initialized
  let lotData = lot;
  if (!lotData.entries || !lotData.entries.length) {
    lotData = await api(`/api/lots/${encodeURIComponent(lotCode)}/init-steps`, { method: "POST" }).catch(() => lot);
  }

  const entries = lotData.entries || [];
  const stepStates = await Promise.all(entries.map(async (entry, idx) => {
    const existingRows = await api(`/api/entries/${encodeURIComponent(entry.form_id)}/machines`).catch(() => []);
    return { entry, idx, existing: existingRows[0] || null };
  }));

  $("exportSheetModalTitle").textContent = `In phiếu xuất kho`;
  $("exportSheetModalLotCode").textContent = `Lô: ${displayLotCode(lotCode)} · ${lot.order_code} · ${lot.part_code}`;

  $("exportStepsList").innerHTML = stepStates.map(({ entry, idx, existing }) => {
    const machineValue = existing
      ? escapeHtml(existing.machine_name ? `${existing.machine_code} - ${existing.machine_name}` : getMachineDisplayName(existing.machine_code))
      : "";
    const workerValue = existing
      ? escapeHtml(existing.worker_name ? `${existing.worker_code} - ${existing.worker_name}` : getWorkerDisplayName(existing.worker_code))
      : "";
    const techValue = existing
      ? escapeHtml(existing.tech_name ? `${existing.tech_code} - ${existing.tech_name}` : getWorkerDisplayName(existing.tech_code))
      : "";
    const shiftOptions = ["", "KÍP 1", "KÍP 2", "TĂNG CA"]
      .map((s) => {
        if (!s) return `<option value="" ${!existing?.shift ? "selected" : ""}>-- Trống --</option>`;
        return `<option value="${s}" ${existing?.shift === s ? "selected" : ""}>${s}</option>`;
      }).join("");
    return `
    <div class="rounded-lg border border-slate-200 bg-slate-50 p-4" data-export-form-id="${entry.form_id}">
      <div class="font-extrabold text-sm mb-3 text-slate-700">OP${idx + 1}: ${escapeHtml(entry.step_name)}</div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="field-label">Máy</label>
          <input class="input export-field" data-field="machine_code" list="machineDatalist" placeholder="Chọn máy" value="${machineValue}">
        </div>
        <div>
          <label class="field-label">Kíp</label>
          <select class="input export-field" data-field="shift">${shiftOptions}</select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="field-label">Người làm</label>
          <input class="input export-field" data-field="worker_code" list="workerDatalist" placeholder="Chọn NV" value="${workerValue}">
        </div>
        <div>
          <label class="field-label">Kỹ thuật (tùy chọn)</label>
          <input class="input export-field" data-field="tech_code" list="workerDatalist" placeholder="Chọn NV" value="${techValue}">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label">Ngày làm</label>
          <input type="date" class="input export-field" data-field="work_date" value="${existing?.work_date || today()}">
        </div>
        <div>
          <label class="field-label">Thông số kỹ thuật</label>
          <input type="text" class="input export-field" data-field="technical_info" placeholder="Tùy chọn" value="${escapeHtml(existing?.technical_info || "")}">
        </div>
      </div>
    </div>
  `;}).join("") || `<p class="text-slate-500 text-sm">Lô chưa có công đoạn nào.</p>`;

  // Store lot data for save
  $("exportSheetModal").dataset.lotCode = lotCode;
  $("exportSheetModal").dataset.qtyPerLot = lot.qty_per_lot;
  $("exportSheetModal").classList.remove("hidden");
}

async function saveAndPrint() {
  const modal = $("exportSheetModal");
  const lotCode = modal.dataset.lotCode;
  const qtyPerLot = Number(modal.dataset.qtyPerLot || 0);
  const btn = $("saveAndPrintBtn");

  if (!lotCode) return;

  const stepDivs = modal.querySelectorAll("[data-export-form-id]");
  let savedAny = false;

  await withLoading(btn, async () => {
    for (const div of stepDivs) {
      const formId = div.dataset.exportFormId;
      const existingRows = await api(`/api/entries/${encodeURIComponent(formId)}/machines`).catch(() => []);
      const existing = existingRows[0] || {};
      const machine_code = codeFromDisplay(div.querySelector('[data-field="machine_code"]').value);
      const worker_code = codeFromDisplay(div.querySelector('[data-field="worker_code"]').value);
      const shift = div.querySelector('[data-field="shift"]').value;
      const tech_code = codeFromDisplay(div.querySelector('[data-field="tech_code"]').value);
      const work_date = div.querySelector('[data-field="work_date"]').value || null;
      const technical_info = div.querySelector('[data-field="technical_info"]').value;

      const resolvedMachine = machine_code || String(existing.machine_code || "").trim().toUpperCase();
      const resolvedWorker = worker_code || String(existing.worker_code || "").trim().toUpperCase();
      const resolvedTech = tech_code || String(existing.tech_code || "").trim().toUpperCase();
      const resolvedShift = shift || existing.shift || "";
      const resolvedWorkDate = work_date || existing.work_date || null;
      const resolvedTechnicalInfo = technical_info || existing.technical_info || "";
      const resolvedQtyOk = Number(existing.qty_ok || 0);
      const resolvedQtyNg = Number(existing.qty_ng || 0);

      // Skip step only when nothing can be saved at all
      if (!resolvedMachine || !resolvedWorker) continue;

      const payload = {
        machine_code: resolvedMachine,
        worker_code: resolvedWorker,
        shift: resolvedShift,
        tech_code: resolvedTech,
        work_date: resolvedWorkDate,
        technical_info: resolvedTechnicalInfo,
        qty_ok: resolvedQtyOk,
        qty_ng: resolvedQtyNg,
        note: existing.note || "",
      };

      try {
        if (existingRows.length) {
          await api(`/api/entries/${encodeURIComponent(formId)}/machines/${existingRows[0].line_index}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        } else {
          await api(`/api/entries/${encodeURIComponent(formId)}/machines`, { method: "POST", body: JSON.stringify(payload) });
        }
        savedAny = true;
      } catch (err) {
        // keep going so one bad step does not block the rest
      }
    }

    if (savedAny) toast("Đã lưu thông tin nhập liệu", "success");
    modal.classList.add("hidden");

    if (state.currentLot?.lot_code === lotCode) {
      state.currentLot = await api(`/api/lots/${encodeURIComponent(lotCode)}`);
      await renderLot(state.currentLot);
    }

    // Print the lot sheet
    await printLot(lotCode);
  }).catch(err => toast(err.message, "error"));
}

function wireExportSheet() {
  on("closeExportSheetModalBtn", "click", () => $("exportSheetModal")?.classList.add("hidden"));
  on("cancelExportSheetBtn", "click", () => $("exportSheetModal")?.classList.add("hidden"));
  on("exportSheetModal", "click", (e) => {
    if (e.target.id === "exportSheetModal") $("exportSheetModal").classList.add("hidden");
  });
  on("saveAndPrintBtn", "click", saveAndPrint);
}

function renderOrdersHistory() {
  if (!$("ordersHistoryTable")) return;
  $("ordersHistoryTable").innerHTML = state.orders.map((order) => `
    <tr>
      <td class="mono font-bold text-blue-600 cursor-pointer hover:underline" onclick="showOrderDetails('${order.order_code}')">${order.order_code}</td>
      <td>${order.part_code}</td><td>${formatQty(order.total_qty)}</td>
      <td>${formatQty(order.qty_per_lot)}</td><td>${order.total_lots}</td>
      <td><div class="progress-cell"><div class="progress-bar"><span style="width:${order.progress_percent || 0}%"></span></div><span>${order.progress_percent || 0}%</span></div></td>
      <td>${order.created_at || ""}</td>
      <td>
        <div class="flex flex-wrap gap-2">
          <button class="btn mini secondary" onclick="startEditOrder('${order.order_code}')">Sửa</button>
          <button class="btn mini danger" onclick="requestDeleteOrder('${order.order_code}')">Xóa</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="8" class="text-slate-500">Chưa có đơn hàng</td></tr>`;
}

function lotInputToInternalCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return "";
  return code.startsWith("LOT-") ? code : `LOT-${code}`;
}

function setPrintLotOptions(lots) {
  state.currentOrderLots = lots || [];
  const options = state.currentOrderLots.map((lot) => {
    const shortCode = displayLotCode(lot.lot_code);
    return `<option value="${escapeHtml(shortCode)}">${escapeHtml(shortCode)}</option>`;
  }).join("");
  if ($("printLotOptions")) $("printLotOptions").innerHTML = options;
  if ($("printLotCodeInput") && state.currentOrderLots.length) {
    $("printLotCodeInput").value = displayLotCode(state.currentOrderLots[0].lot_code);
  }
}

function buildOrderQrs(lots, prefix = "order-qr") {
  return lots.map((lot) => {
    const visibleCode = displayLotCode(lot.lot_code);
    const canvasId = `${prefix}-${lot.lot_code.replaceAll(/[^A-Z0-9]/g, "")}`;
    return `
      <div class="order-qr-card rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="font-extrabold text-slate-800">${visibleCode}</div>
          <div class="badge done">SL: ${formatQty(lot.qty_per_lot)} pcs</div>
        </div>
        <div class="flex justify-center">
          <canvas id="${canvasId}"></canvas>
        </div>
      </div>
    `;
  }).join("");
}

function renderOrderQrModal(order, lots) {
  setPrintLotOptions(lots);
  $("orderQrModal").dataset.orderCode = order.order_code;
  $("orderQrModalOrderCode").textContent = `${order.order_code} · ${order.part_code}`;
  $("orderQrGrid").innerHTML = lots.length
    ? buildOrderQrs(lots, "qr-modal")
    : `<div class="text-slate-500 text-sm">Đơn này chưa có lô nào.</div>`;
  lots.forEach((lot) => renderQr($(`qr-modal-${lot.lot_code.replaceAll(/[^A-Z0-9]/g, "")}`), displayLotCode(lot.lot_code), 220));
  $("orderQrModal").classList.remove("hidden");
}

async function openOrderQrs(orderCode) {
  const order = await api(`/api/orders/${encodeURIComponent(orderCode)}`);
  const index = state.orders.findIndex((item) => item.order_code === order.order_code);
  if (index >= 0) state.orders[index] = { ...state.orders[index], ...order };
  else state.orders.unshift(order);
  applyOrderToForm(order);
  const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
  const seen = new Set();
  const lots = [];
  rows.forEach((row) => {
    if (!seen.has(row.lot_code)) {
      seen.add(row.lot_code);
      lots.push({ lot_code: row.lot_code, qty_per_lot: row.qty_per_lot });
    }
  });
  renderOrderQrModal(order, lots);
}

function renderOrderQrPrintArea(order, lots) {
  $("print-area").innerHTML = `
    <div class="lot-sheet qr-sheet order-qr-sheet">
      <table class="print-table sheet-head">
        <tr>
          <td class="sheet-logo">
            <div class="logo-main">YAMAGUCHI</div>
            <div>Manufacturing</div>
          </td>
          <td class="sheet-title">QR TOÀN BỘ LÔ - ${escapeHtml(order.order_code)}</td>
          <td class="sheet-meta">
            <div>Mã hàng: ${escapeHtml(order.part_code)}</div>
            <div>Số lô: ${lots.length}</div>
          </td>
        </tr>
      </table>
      <div class="order-qr-grid mt-4">
        ${buildOrderQrs(lots, "qr-print")}
      </div>
    </div>
  `;
  lots.forEach((lot) => renderQr($(`qr-print-${lot.lot_code.replaceAll(/[^A-Z0-9]/g, "")}`), displayLotCode(lot.lot_code), 220));
}

async function printOrderQrs(orderCode) {
  const order = await api(`/api/orders/${encodeURIComponent(orderCode)}`);
  const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
  const seen = new Set();
  const lots = [];
  rows.forEach((row) => {
    if (!seen.has(row.lot_code)) {
      seen.add(row.lot_code);
      lots.push({ lot_code: row.lot_code, qty_per_lot: row.qty_per_lot });
    }
  });
  renderOrderQrPrintArea(order, lots);
  $("print-area").classList.remove("hidden");
  await waitForPrintImages();
  document.body.classList.add("printing-order-qr-sheet");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing-order-qr-sheet");
    $("print-area").classList.add("hidden");
  }, 600);
}

function applyOrderToForm(order) {
  if (!order) return;
  state.editingOrderCode = order.order_code;
  $("orderCode").value = order.order_code;
  $("orderCode").disabled = true;
  $("orderPartCode").value = order.part_code;
  $("totalQty").value = formatQty(order.total_qty);
  $("qtyPerLot").value = order.planned_lots || order.total_lots;
  fillOrderExtra(order);
  updateLotPreview();
  $('saveOrderBtn').textContent = 'Cập nhật đơn hàng';
  if ($('cancelOrderEditBtn')) $('cancelOrderEditBtn').classList.remove('hidden');
}
function startEditOrder(orderCode) {
  api(`/api/orders/${encodeURIComponent(orderCode)}`).then((order) => {
    state.editingOrderCode = order.order_code;
    $("orderCode").value = order.order_code;
    $("orderCode").readOnly = true;
    $("orderPartCode").value = order.part_code;
    $("totalQty").value = order.total_qty;
    $("qtyPerLot").value = order.qty_per_lot;
    fillOrderExtra(order);
    updateLotPreview();
    $("orderModalTitle").textContent = `Sửa đơn hàng: ${order.order_code}`;
    $("saveOrderBtn").textContent = "Cập nhật đơn hàng";
    $("orderModal").classList.remove("hidden");
  }).catch(err => toast(err.message, "error"));
}

function resetOrderForm() {
  state.editingOrderCode = null;
  if ($("orderCode")) { $("orderCode").value = ""; $("orderCode").disabled = false; }
  if ($("totalQty")) $("totalQty").value = "";
  if ($("qtyPerLot")) $("qtyPerLot").value = "";
  resetOrderExtra();
  updateLotPreview();
  if ($("saveOrderBtn")) $("saveOrderBtn").textContent = "Phát hành";
  if ($("cancelOrderEditBtn")) $("cancelOrderEditBtn").classList.add("hidden");
}

function requestDeleteOrder(orderCode) {
  openDeleteModal({
    title: "Xóa đơn hàng",
    message: `Nhập mã xóa để xóa ${orderCode}. Toàn bộ lô và dữ liệu nhập liệu bên trong cũng sẽ bị xóa.`,
    onConfirm: async (deleteCode) => {
      await api(`/api/orders/${encodeURIComponent(orderCode)}`, { method: "DELETE", body: JSON.stringify({ delete_code: deleteCode }) });
      toast("Đã xóa đơn hàng", "success");
      await loadOrders();
      await loadReports();
    },
  });
}

function wireOrders() {
  // "Tạo đơn hàng" button opens modal
  on("openCreateOrderModalBtn", "click", () => {
    state.editingOrderCode = null;
    $("orderCode").value = "";
    $("orderCode").readOnly = false;
    $("orderPartCode").value = "";
    $("totalQty").value = "";
    $("qtyPerLot").value = "";
    $("lotCountPreview").textContent = "0";
    $("orderModalTitle").textContent = "Tạo đơn hàng mới";
    $("saveOrderBtn").textContent = "Phát hành đơn hàng";
    resetOrderExtra();
    $("orderModal").classList.remove("hidden");
  });

  on("closeOrderModalBtn", "click", () => $("orderModal")?.classList.add("hidden"));
  on("cancelOrderModalBtn", "click", () => $("orderModal")?.classList.add("hidden"));
  on("orderModal", "click", (e) => {
    if (e.target.id === "orderModal") $("orderModal").classList.add("hidden");
  });

  // Back button: hide detail, show list
  on("backToOrdersBtn", "click", () => {
    $("orderDetailSection").classList.add("hidden");
    $("ordersListSection").classList.remove("hidden");
    loadOrders();
  });
  on("openOrderQrsBtn", "click", () => {
    if (!state.currentDetailOrderCode) return toast("Chưa chọn đơn hàng", "warning");
    openOrderQrs(state.currentDetailOrderCode).catch((err) => toast(err.message, "error"));
  });
  on("closeOrderQrModalBtn", "click", () => $("orderQrModal")?.classList.add("hidden"));
  on("cancelOrderQrBtn", "click", () => $("orderQrModal")?.classList.add("hidden"));
  on("orderQrModal", "click", (e) => {
    if (e.target.id === "orderQrModal") $("orderQrModal").classList.add("hidden");
  });
  on("printOrderQrBtn", "click", () => {
    if (!state.currentDetailOrderCode) return toast("Chưa chọn đơn hàng", "warning");
    printOrderQrs(state.currentDetailOrderCode).catch((err) => toast(err.message, "error"));
  });

  on("totalQty", "input", updateLotPreview);
  on("qtyPerLot", "input", updateLotPreview);

  on("saveOrderBtn", "click", () => withLoading($("saveOrderBtn"), async () => {
    const payload = {
      order_code: $("orderCode").value.trim().toUpperCase(),
      part_code: $("orderPartCode").value,
      total_qty: Number($("totalQty").value),
      qty_per_lot: Number($("qtyPerLot").value),
      ...collectOrderExtra(),
    };
    if (!payload.order_code || !payload.part_code || payload.total_qty <= 0 || payload.qty_per_lot <= 0) return toast("Vui lòng nhập đủ thông tin đơn hàng", "warning");
    if (!Number.isInteger(payload.total_qty) || !Number.isInteger(payload.qty_per_lot)) return toast("Tổng SL và số PCS/lô phải là số nguyên", "warning");
    if (payload.qty_per_lot > payload.total_qty) return toast("Số PCS/lô không được lớn hơn tổng số lượng", "warning");
    const created = state.editingOrderCode
      ? await api(`/api/orders/${encodeURIComponent(state.editingOrderCode)}`, { method: "PUT", body: JSON.stringify(payload) })
      : await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
    toast(state.editingOrderCode ? "Đã cập nhật đơn hàng" : "Đã phát hành đơn hàng và sinh QR lô", "success");
    $("orderModal").classList.add("hidden");
    await loadOrders();
    await loadReports();
  }).catch((err) => toast(err.message, "error")));
}

async function loadLot(lotCodeOverride = "", formId = "") {
  const input = $("scanLotCode");
  const lotCode = lotInputToInternalCode(lotCodeOverride || input.value);
  if (!lotCode) return toast("Vui lòng quét hoặc nhập mã lô", "warning");
  try {
    input.value = displayLotCode(lotCode);
    state.focusFormId = formId || null;
    await Promise.all([loadMachines(), loadWorkers()]);
    let lot = await api(`/api/lots/${encodeURIComponent(lotCode)}`);
    if (!lot.entries.length) lot = await api(`/api/lots/${encodeURIComponent(lotCode)}/init-steps`, { method: "POST" });
    state.currentLot = lot;
    renderLot(lot);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    input.focus();
    input.select();
  }
}

function lotOverallStatus(rows) {
  const statuses = rows.map((row) => row.status).filter(Boolean);
  if (!statuses.length) return "todo";
  if (statuses.every((status) => status === "done")) return "done";
  if (statuses.some((status) => status === "done" || status === "partial")) return "partial";
  return "todo";
}

async function renderLotHints(orderCode) {
  if (!orderCode) return;
  try {
    const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
    const lots = new Map();
    rows.forEach((row) => {
      if (!row?.lot_code) return;
      if (!lots.has(row.lot_code)) lots.set(row.lot_code, []);
      lots.get(row.lot_code).push(row);
    });
    $("lotHintGrid").innerHTML = lots.size ? Array.from(lots.entries()).map(([lotCode, lotRows]) => {
      const first = lotRows[0] || {};
      const status = lotOverallStatus(lotRows);
      const doneCount = lotRows.filter((row) => row.status === "done").length;
      const totalSteps = lotRows.filter((row) => row.step_name).length;

      return `
      <button class="lot-hint ${status} w-full text-left" data-lot-code="${lotCode}">
        <div class="flex justify-between items-center w-full">
          <span class="font-extrabold text-slate-800 text-sm">${displayLotCode(lotCode)}</span>
          <span class="badge ${status} text-[10px] py-0.5 px-2">${statusText(status)}</span>
        </div>
        <div class="text-xs text-slate-500 mt-1">SL: ${formatQty(first.qty_per_lot || 0)} cái · ${totalSteps ? `${doneCount}/${totalSteps} CĐ` : "Chưa mở lô"}</div>
      </button>
      `;
    }).join("") : `<div class="text-sm font-semibold text-slate-500">Đơn hàng này chưa có lô</div>`;
    document.querySelectorAll("[data-lot-code]").forEach((btn) => btn.addEventListener("click", () => {
      $("scanLotCode").value = displayLotCode(btn.dataset.lotCode);
      loadLot(btn.dataset.lotCode);
    }));
  } catch (err) {
    $("lotHintGrid").innerHTML = `<div class="text-sm font-semibold text-red-600">Không tải được danh sách lô: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderLot(lot) {
  const done = lot.entries.filter((e) => e.status === "done").length;
  state.currentLot = lot;
  const mode = state.lotMode || "gia_cong";
  renderLotModeBar();
  $("lotHeader").classList.remove("hidden");
  $("lotHeader").innerHTML = `
    <div>
      <div>${displayLotCode(lot.lot_code)} &middot; ${lot.part_code} &middot; SL: ${formatQty(lot.qty_per_lot)} c?i &middot; ${done}/${lot.entries.length} c?ng ?o?n ho?n th?nh</div>
    </div>
    <button class="btn secondary" id="printLotSheetBtn">In bi?u l?</button>
  `;
  on("printLotSheetBtn", "click", () => printLot(lot.lot_code));
  const showGiaCong = mode === "gia_cong";
  const showBavia = mode === "bavia";
  const showKho = mode === "kho";

  $("entryCards").classList.toggle("hidden", !showGiaCong);
  $("lotBaviaPanel").classList.toggle("hidden", !showBavia);
  $("lotKhoPanel").classList.toggle("hidden", !showKho);
  $("lotQcPanel").classList.toggle("hidden", showKho);

  if (showGiaCong) {
    $("entryCards").innerHTML = lot.entries.map((entry, index) => entryCardHtml(entry, lot.qty_per_lot, index + 1)).join("");
    await Promise.all(lot.entries.map((entry) => loadMachineRows(entry.form_id, lot.qty_per_lot)));
    await renderLotQcPanel(lot, "qc");
  } else {
    $("entryCards").innerHTML = "";
  }

  if (showBavia) {
    await renderLotBaviaWorkPanel(lot);
    await renderLotQcPanel(lot, "bavia");
  } else {
    $("lotBaviaPanel").innerHTML = "";
  }

  if (showKho) {
    await renderLotWarehousePanel(lot);
  } else {
    $("lotKhoPanel").innerHTML = "";
  }

  if (state.focusFormId) {
    const target = document.querySelector(`[data-form-id="${state.focusFormId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("focus-flash");
      setTimeout(() => target.classList.remove("focus-flash"), 2200);
    }
    state.focusFormId = null;
  }
}

function renderLotModeBar() {
  const bar = $("lotModeBar");
  if (!bar) return;
  const mode = state.lotMode || "gia_cong";
  bar.classList.remove("hidden");
  bar.innerHTML = [
    ["gia_cong", "Gia c?ng"],
    ["bavia", "Bavia"],
  ].map(([value, label]) => `<button class="lot-mode-btn ${mode === value ? "active" : ""}" data-lot-mode="${value}">${label}</button>`).join("");
}

async function renderLotBaviaWorkPanel(lot) {
  const panel = $("lotBaviaPanel");
  if (!panel || !lot) return;
  const work = await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/bavia-work`);
  const row = work.row || {};
  panel.className = "lot-bavia-panel";
  panel.innerHTML = `
    <div class="panel">
      <div class="lot-bavia-title">Bavia</div>
      <div class="lot-bavia-meta">L?: ${displayLotCode(lot.lot_code)} &middot; ${lot.part_code}</div>
      <div class="lot-work-box">
        <div class="lot-work-grid">
          <div class="machine-field">
            <label class="field-label">M?y</label>
            <input list="machineDatalist" id="baviaMachine" class="input mini-input w-full" placeholder="Ch?n m?y" value="${escapeHtml(getMachineDisplayName(row.machine_code || ""))}">
          </div>
          <div class="machine-field">
            <label class="field-label">Ng??i l?m</label>
            <input list="workerDatalist" id="baviaWorker" class="input mini-input w-full" placeholder="Ch?n NV" value="${escapeHtml(getWorkerDisplayName(row.worker_code || ""))}">
          </div>
          <div class="machine-field">
            <label class="field-label">Ng?y</label>
            <input id="baviaWorkDate" type="date" class="input mini-input w-full" value="${escapeHtml(work.work_date || row.work_date || today())}">
          </div>
          <div class="machine-field">
            <label class="field-label">K?p</label>
            <select id="baviaShift" class="input mini-input w-full">
              ${["", "K?P 1", "K?P 2", "K?P 3", "T?NG CA"].map((s) => s ? `<option value="${s}" ${row.shift === s ? "selected" : ""}>${s}</option>` : `<option value="" ${!row.shift ? "selected" : ""}>-- Tr?ng --</option>`).join("")}
            </select>
          </div>
          <div class="machine-field machine-num-field">
            <label class="field-label">OK</label>
            <input id="baviaOk" class="input mini-input ok-input w-full" type="number" min="0" step="1" value="${Number(row.qty_ok || 0)}">
          </div>
          <div class="machine-field machine-num-field">
            <label class="field-label">NG</label>
            <input id="baviaNg" class="input mini-input ng-input w-full" type="number" min="0" step="1" value="${Number(row.qty_ng || 0)}">
          </div>
          <div class="machine-field machine-note-field" style="min-width: 220px; flex: 1 1 220px;">
            <label class="field-label">Ghi ch?</label>
            <input id="baviaNote" class="input mini-input w-full" placeholder="Ghi ch?" value="${escapeHtml(row.note || "")}">
          </div>
        </div>
        <div class="lot-work-footer">
          <div class="save-state mt-3 text-sm font-bold text-slate-500">${row.machine_code ? "?? l?u" : "Ch?a l?u"}</div>
          <button id="saveBaviaWorkBtn" class="btn primary">L?u s?n l??ng</button>
        </div>
      </div>
    </div>
  `;
  on("saveBaviaWorkBtn", "click", () => withLoading($("saveBaviaWorkBtn"), async () => {
    await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/bavia-work`, {
      method: "PUT",
      body: JSON.stringify({
        work_date: $("baviaWorkDate")?.value || today(),
        row: {
          machine_code: codeFromDisplay($("baviaMachine")?.value || ""),
          worker_code: codeFromDisplay($("baviaWorker")?.value || ""),
          work_date: $("baviaWorkDate")?.value || today(),
          shift: $("baviaShift")?.value || "",
          qty_ok: Number($("baviaOk")?.value || 0),
          qty_ng: Number($("baviaNg")?.value || 0),
          note: $("baviaNote")?.value || "",
        },
      }),
    });
    toast("?? l?u Bavia", "success");
    await refreshCurrentLot(lot.lot_code);
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));
}

function qualityConfig(kind = "qc") {
  if (kind === "bavia") {
    return {
      kind: "bavia",
      title: "Bavia",
      panelId: "lotQcPanel",
      rowsId: "lotBaviaRows",
      summaryId: "baviaSummaryRow",
      maxId: "baviaMaxQty",
      dateId: "baviaDate",
      dateLabel: "Ng?y Bavia",
      dateKey: "bavia_date",
      saveBtnId: "saveBaviaBtn",
      saveLabel: "L?u Bavia",
      apiSuffix: "bavia",
      defaults: DEFAULT_BAVIA_ITEMS,
      rowLimit: 3,
    };
  }
  return {
    kind: "qc",
    title: "QC",
    panelId: "lotQcPanel",
    rowsId: "lotQcRows",
    summaryId: "qcSummaryRow",
    maxId: "qcMaxQty",
    dateId: "qcDate",
    dateLabel: "Ng?y QC",
    dateKey: "qc_date",
    saveBtnId: "saveQcBtn",
    saveLabel: "L?u QC",
    apiSuffix: "qc",
    defaults: DEFAULT_QC_ITEMS,
    rowLimit: 4,
  };
}

function qualitySelectHtml(selectedValue = "") {
  const selected = String(selectedValue || "").trim();
  const options = [`<option value="">-- Ch?n NV --</option>`].concat(activeWorkers().map((worker) => {
    const label = `${worker.worker_code} - ${worker.worker_name}`;
    const match = [worker.worker_code, label, worker.worker_name].includes(selected);
    return `<option value="${worker.worker_code}" ${match ? "selected" : ""}>${label}</option>`;
  }));
  return `<select class="input quality-field" data-name="inspector">${options.join("")}</select>`;
}

function normalizeQualityRows(rows = [], kind = "qc") {
  const cfg = qualityConfig(kind);
  const baseRows = (rows || []).slice(0, cfg.rowLimit).map((row, index) => ({
    line_index: index + 1,
    check_name: row.check_name || cfg.defaults[index] || "",
    qty_ok: Number(row.qty_ok || 0),
    qty_ng: Number(row.qty_ng || 0),
    defect_content: row.defect_content || "",
    inspector: row.inspector || "",
  }));
  while (baseRows.length < cfg.rowLimit) {
    const index = baseRows.length;
    baseRows.push({
      line_index: index + 1,
      check_name: cfg.defaults[index] || "",
      qty_ok: 0,
      qty_ng: 0,
      defect_content: "",
      inspector: "",
    });
  }
  return baseRows;
}

function qualityRowHtml(row, index, rowMax) {
  return `
    <tr data-quality-row data-line-index="${row.line_index || index + 1}" data-row-max="${Number(rowMax || 0)}">
      <td class="qc-check-cell">
        <span class="qc-check-order">${index + 1}.</span>
        <span class="qc-check-name">${escapeHtml(row.check_name || "")}</span>
      </td>
      <td><input class="input quality-field" data-name="qty_ok" type="number" min="0" max="${rowMax || ""}" step="1" value="${Number(row.qty_ok || 0)}"></td>
      <td><input class="input quality-field" data-name="qty_ng" type="number" min="0" max="${rowMax || ""}" step="1" value="${Number(row.qty_ng || 0)}"></td>
      <td><input class="input quality-field" data-name="defect_content" placeholder="N?i dung l?i" value="${escapeHtml(row.defect_content || "")}"></td>
      <td>${qualitySelectHtml(row.inspector || "")}</td>
      <td class="lot-qc-row-action"><span class="text-xs font-bold text-slate-400">B??c ${index + 1}</span></td>
    </tr>
  `;
}

function collectQualityRows(rowsId) {
  return Array.from($(rowsId)?.querySelectorAll("[data-quality-row]") || []).map((row, index) => {
    const item = { line_index: Number(row.dataset.lineIndex || index + 1) };
    row.querySelectorAll(".quality-field").forEach((field) => {
      const value = field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng"
        ? Number(field.value || 0)
        : field.value;
      item[field.dataset.name] = value;
    });
    item.check_name = row.querySelector(".qc-check-name")?.textContent?.replace(/^\d+\.\s*/, "").trim() || "";
    return item;
  });
}

function getQualityRowTotal(rowEl) {
  const ok = Number(rowEl.querySelector('[data-name="qty_ok"]')?.value || 0);
  const ng = Number(rowEl.querySelector('[data-name="qty_ng"]')?.value || 0);
  return ok + ng;
}

function updateQualityChain(kind = "qc") {
  const cfg = qualityConfig(kind);
  const rows = Array.from($(cfg.rowsId)?.querySelectorAll("[data-quality-row]") || []);
  const maxQty = Number($(cfg.maxId)?.dataset.maxQty || 0);
  let previousTotal = maxQty;
  let latestTotal = 0;
  let activeRows = 0;
  rows.forEach((rowEl, index) => {
    const rowMax = index === 0 ? maxQty : previousTotal;
    rowEl.dataset.rowMax = String(rowMax || 0);
    const inputs = rowEl.querySelectorAll(".quality-field");
    inputs.forEach((field) => {
      if (field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng") {
        field.max = rowMax || "";
        field.disabled = index > 0 && previousTotal <= 0;
      }
    });
    const total = getQualityRowTotal(rowEl);
    if (total > 0) {
      latestTotal = total;
      activeRows = index + 1;
    }
    previousTotal = total;
  });
  const summaryOk = latestTotal ? Number(rows[activeRows - 1]?.querySelector('[data-name="qty_ok"]')?.value || 0) : 0;
  const summaryNg = latestTotal ? Number(rows[activeRows - 1]?.querySelector('[data-name="qty_ng"]')?.value || 0) : 0;
  if ($(cfg.summaryId)) {
    $(cfg.summaryId).querySelector('[data-summary="ok"]').textContent = formatQty(summaryOk);
    $(cfg.summaryId).querySelector('[data-summary="ng"]').textContent = formatQty(summaryNg);
    $(cfg.summaryId).querySelector('[data-summary="total"]').textContent = formatQty(latestTotal);
    $(cfg.summaryId).querySelector('[data-summary="step"]').textContent = activeRows ? `B??c ${activeRows}` : "Ch?a c? d? li?u";
  }
}

function wireQualityRowEvents(kind = "qc") {
  const cfg = qualityConfig(kind);
  $(cfg.rowsId)?.querySelectorAll(".quality-field").forEach((field) => {
    field.addEventListener("input", () => updateQualityChain(kind));
    field.addEventListener("change", () => updateQualityChain(kind));
  });
}

async function loadLotQuality(lotCode, kind = "qc") {
  const cfg = qualityConfig(kind);
  return api(`/api/lots/${encodeURIComponent(lotCode)}/${cfg.apiSuffix}`);
}

async function renderLotQualityPanel(lot, kind = "qc") {
  const cfg = qualityConfig(kind);
  const panel = $(cfg.panelId);
  if (!panel || !lot) return;
  const form = await loadLotQuality(lot.lot_code, kind);
  const maxQty = Number(form.max_qty || 0);
  const qualityRows = normalizeQualityRows(form.rows || [], kind);
  panel.classList.remove("hidden");
  panel.className = kind === "bavia" ? "lot-bavia-panel" : "lot-qc-panel";
  const content = `
    <div class="lot-qc-title">${cfg.title}</div>
    <div class="lot-qc-meta">
      <span>${cfg.title} l?: ${displayLotCode(lot.lot_code)}</span>
      <span>C?ng ?o?n cu?i: ${escapeHtml(form.last_step_name || "Ch?a c?")}</span>
      <span>KQ cu?i: ${formatQty(form.last_step_ok || 0)} OK + ${formatQty(form.last_step_ng || 0)} NG</span>
      <span id="${cfg.maxId}" class="qc-max-chip" data-max-qty="${maxQty}">S? l??ng max: ${formatQty(maxQty)}</span>
      <label class="qc-date-chip">
        <span>${cfg.dateLabel}</span>
        <input id="${cfg.dateId}" type="date" class="input qc-date-input" value="${escapeHtml(form[cfg.dateKey] || today())}">
      </label>
    </div>
    ${maxQty <= 0 ? `<div class="error-text mb-3">Ch?a c? s? l??ng c?ng ?o?n cu?i, ${cfg.title} s? l?y max khi c?ng ?o?n cu?i c? OK/NG.</div>` : ""}
    <div class="table-wrap">
      <table class="lot-qc-table">
        <thead>
          <tr>
            <th>N?i dung ki?m tra</th>
            <th>S? l??ng OK</th>
            <th>S? l??ng NG</th>
            <th>N?i dung l?i</th>
            <th>Ng??i ki?m tra</th>
            <th>Th? t?</th>
          </tr>
        </thead>
        <tbody id="${cfg.rowsId}">
          ${qualityRows.map((row, index) => {
            let rowMax = maxQty;
            if (index > 0) {
              const prev = qualityRows[index - 1];
              rowMax = Number(prev.qty_ok || 0) + Number(prev.qty_ng || 0);
            }
            return qualityRowHtml(row, index, rowMax);
          }).join("")}
        </tbody>
      </table>
    </div>
    <div id="${cfg.summaryId}" class="qc-summary-row">
      <div class="qc-summary-title">T?NG</div>
      <div class="qc-summary-chip">B??c: <span data-summary="step">Ch?a c? d? li?u</span></div>
      <div class="qc-summary-chip">OK: <span data-summary="ok">0</span></div>
      <div class="qc-summary-chip">NG: <span data-summary="ng">0</span></div>
      <div class="qc-summary-chip qc-summary-final">K?t qu?: <span data-summary="total">0</span></div>
    </div>
    <div class="lot-qc-footer">
      <div></div>
      <button id="${cfg.saveBtnId}" class="btn primary">${cfg.saveLabel}</button>
    </div>
  `;
  if (kind === "bavia") {
    panel.innerHTML = `<div class="panel">${content}</div>`;
  } else {
    panel.innerHTML = content;
  }
  on(cfg.saveBtnId, "click", () => withLoading($(cfg.saveBtnId), async () => {
    const payload = {
      [cfg.dateKey]: $(cfg.dateId)?.value || today(),
      rows: collectQualityRows(cfg.rowsId),
    };
    await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/${cfg.apiSuffix}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    toast(`?? l?u ${cfg.title}`, "success");
    await refreshCurrentLot(lot.lot_code);
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));
  wireQualityRowEvents(kind);
  updateQualityChain(kind);
}

async function renderLotQcPanel(lot, kind = "qc") {
  return renderLotQualityPanel(lot, kind);
}

async function refreshCurrentLot(lotCode = "") {

  const code = lotInputToInternalCode(lotCode || state.currentLot?.lot_code || "");
  if (!code) return;
  const lot = await api(`/api/lots/${encodeURIComponent(code)}`);
  if (lot.entries.length) {
    state.currentLot = lot;
    await renderLot(lot);
    return;
  }
  const initLot = await api(`/api/lots/${encodeURIComponent(code)}/init-steps`, { method: "POST" });
  state.currentLot = initLot;
  await renderLot(initLot);
}

async function refreshOpenLotIfVisible() {
  const lotCode = state.currentLot?.lot_code;
  if (!lotCode) return;
  if ($("lotScreen")?.classList.contains("hidden")) return;
  await refreshCurrentLot(lotCode);
  await loadOrders();
}

function printValue(value) {
  return escapeHtml(value || "");
}

function printBlankZero(value) {
  const num = Number(value);
  if (!value && value !== 0) return "";
  if (Number.isFinite(num) && num === 0) return "";
  return printValue(value);
}

function displayLotCode(lotCode) {
  return String(lotCode || "").replace(/^LOT-/, "");
}

function summarizePrintRows(rows = []) {
  let activeIndex = 0;
  let latest = null;
  rows.forEach((row, index) => {
    const total = Number(row?.qty_ok || 0) + Number(row?.qty_ng || 0);
    if (total > 0) {
      latest = row;
      activeIndex = index + 1;
    }
  });
  if (!latest) {
    return { step: "Chưa có dữ liệu", ok: 0, ng: 0, total: 0 };
  }
  const ok = Number(latest.qty_ok || 0);
  const ng = Number(latest.qty_ng || 0);
  return { step: `Bước ${activeIndex}`, ok, ng, total: ok + ng };
}

function renderPrintKeyValue(label, value) {
  return `<td>${label}:<br><b>${printValue(value)}</b></td>`;
}

function renderCompactQualitySection(lot, form, kind, sectionTitle, sectionCode) {
  const cfg = qualityConfig(kind);
  const rows = normalizeQualityRows(form?.rows || [], kind);
  return `
    <table class="print-table compact-print-table">
      <tr><th colspan="5" class="section-title">${sectionCode}. ${sectionTitle}</th></tr>
      <tr class="print-head-row">
        <th>Nội dung kiểm tra</th>
        <th>Số lượng OK</th>
        <th>Số lượng NG</th>
        <th>Nội dung lỗi</th>
        <th>Người kiểm tra</th>
      </tr>
      ${rows.map((row, index) => `
        <tr class="print-data-row">
          <td class="print-check-cell"><span class="print-order">${index + 1}.</span> <span>${printValue(row.check_name)}</span></td>
          <td>${printBlankZero(row.qty_ok)}</td>
          <td>${printBlankZero(row.qty_ng)}</td>
          <td>${printValue(row.defect_content)}</td>
          <td>${printValue(row.inspector)}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function renderPrintBaviaWorkSection(lot, work) {
  const row = work?.row || {};
  return `
    <table class="print-table compact-print-table">
      <tr><th colspan="7" class="section-title">IV. BAVIA</th></tr>
      <tr class="print-head-row">
        <th>Máy</th>
        <th>Người làm</th>
        <th>Ngày</th>
        <th>Kíp</th>
        <th>OK</th>
        <th>NG</th>
        <th>Ghi chú</th>
      </tr>
      <tr class="print-data-row">
        <td>${printValue(getMachineDisplayName(row.machine_code))}</td>
        <td>${printValue(getWorkerDisplayName(row.worker_code))}</td>
        <td>${printValue(formatDateDisplay(row.work_date || work?.work_date || ""))}</td>
        <td>${printValue(row.shift || "")}</td>
        <td>${printBlankZero(row.qty_ok)}</td>
        <td>${printBlankZero(row.qty_ng)}</td>
        <td>${printValue(row.note)}</td>
      </tr>
    </table>
  `;
}

function renderPrintWarehouseSection(lot, form) {
  const rows = normalizeWarehouseRows(form?.rows || []);
  return `
    <table class="print-table compact-print-table">
      <tr><th colspan="5" class="section-title">VI. KHO TP</th></tr>
      <tr class="print-head-row">
        <th>Nội dung kiểm tra</th>
        <th>Số lượng OK</th>
        <th>Số lượng NG</th>
        <th>Nội dung lỗi</th>
        <th>Người thực hiện</th>
      </tr>
      ${rows.map((row, index) => `
        <tr class="print-data-row">
          <td class="print-check-cell"><span class="print-order">${index + 1}.</span> <span>${printValue(row.check_name)}</span></td>
          <td>${printBlankZero(row.qty_ok)}</td>
          <td>${index === 1 ? printBlankZero(row.qty_ng) : '<span class="warehouse-slash-cell">/</span>'}</td>
          <td>${index === 1 ? printValue(row.defect_content) : '<span class="warehouse-slash-cell">/</span>'}</td>
          <td>${printValue(getWorkerDisplayName(row.performer))}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function currentOrderFormOverride(orderCode) {
  const currentCode = ($("orderCode")?.value || "").trim().toUpperCase();
  if (!currentCode || currentCode !== orderCode) return null;
  return {
    order_code: orderCode,
    part_code: $("orderPartCode")?.value || "",
    total_qty: Number($("totalQty")?.value || 0),
    planned_lots: Number($("qtyPerLot")?.value || 0),
    ...collectOrderExtra(),
  };
}


function renderPrintArea(lot, printForms = {}) {
  const order = lot.order || {};
  const steps = lot.entries || [];
  const visibleLotCode = displayLotCode(lot.lot_code);
  const qcForm = printForms.qc || {};
  const baviaWork = printForms.baviaWork || {};
  const baviaForm = printForms.bavia || {};
  const warehouseForm = printForms.warehouse || {};
  $("print-area").innerHTML = `
    <div class="lot-sheet">
      <table class="print-table sheet-head">
        <tr>
          <td class="sheet-logo">
            <div class="logo-main">YAMAGUCHI</div>
            <div>Manufacturing</div>
          </td>
          <td class="sheet-title">BI&#7874;U THEO D&Otilde;I C&Ocirc;NG &#272;O&#7840;N S&#7842;N XU&#7844;T</td>
          <td class="sheet-meta">
            <div>M&atilde; hi&#7879;u: BM/HD.17.2</div>
            <div>Ng&agrave;y BH: 12/07/2019</div>
            <div>L&#7847;n BH: 03</div>
          </td>
        </tr>
      </table>

      <table class="print-table material-print-table">
        <tr><th colspan="6" class="section-title">I. KHO V&#7852;T LI&#7878;U</th></tr>
        <tr>
          <td>M&atilde; s&#7843;n ph&#7849;m:<br><b>${printValue(lot.part_code)}</b></td>
          <td colspan="3">T&ecirc;n s&#7843;n ph&#7849;m:<br><b>${printValue(lot.part_code)}</b></td>
          <td>M&atilde; b&#7843;n v&#7869;:<br><b>${printValue(order.drawing_code)}</b></td>
          <td>REV:<br><b>${printValue(order.drawing_rev)}</b></td>
        </tr>
        <tr>
          <td colspan="2">M&atilde; nguy&ecirc;n v&#7853;t li&#7879;u:<br><b>${printValue(order.raw_material_code)}</b></td>
          <td colspan="4">Ch&#7845;t li&#7879;u:<br><b>${printValue(order.material)}</b></td>
        </tr>
        <tr>
          <td colspan="2">Ng&agrave;y nh&#7853;n &#273;&#417;n h&agrave;ng:<br><b>${printValue(order.order_receive_date)}</b></td>
          <td colspan="2">M&atilde; &#273;&#417;n h&agrave;ng:<br><b>${printValue(order.order_code)}</b></td>
          <td colspan="2">S&#7889; l&#432;&#7907;ng m&#7895;i l&ocirc;:<br><b>${formatQty(lot.qty_per_lot)}</b></td>
        </tr>
        <tr>
          <td colspan="2">K&iacute;ch c&#7905; ph&ocirc;i:<br><b>${printValue(order.blank_size)}</b></td>
          <td colspan="2">Ng&agrave;y xu&#7845;t ph&ocirc;i:<br><b>${(() => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })()}</b></td>
          <td colspan="2">S&#7889; bi&#7875;u:<br><b>${lot.lot_index}/${order.total_lots || ""}</b></td>
        </tr>
        <tr>
  <td colspan="2">Ng&#432;&#7901;i giao:<br><b>${printValue(order.delivered_by || "Kho NVL")}</b></td>
  <td colspan="2">Ng&#432;&#7901;i nh&#7853;n:<br><b></b></td>
  <td colspan="2" class="lot-qr-cell">
            <div>S&#7889; l&#432;&#7907;ng: <b>${formatQty(lot.qty_per_lot)}</b></div>
            <img class="print-qr lot-print-qr" src="/api/qr?text=${encodeURIComponent(visibleLotCode)}&size=120" alt="${escapeHtml(visibleLotCode)}">
            <div class="mono">${escapeHtml(visibleLotCode)}</div>
          </td>
        </tr>
      </table>

      <table class="print-table process-print-table">
        <tr><th colspan="8" class="section-title">II. GIA C&Ocirc;NG</th></tr>
        ${steps.map((entry, index) => {
          const logs = Array.isArray(entry.machine_logs) && entry.machine_logs.length ? entry.machine_logs : [null];
          return `
          <tbody class="step-block">
            <tr><td colspan="8" class="op-title">${index + 1}. OP${index + 1}: ${printValue(entry.step_name)}</td></tr>
            <tr class="process-head">
              <th>Ng&agrave;y</th><th>K&iacute;p</th><th>M&aacute;y</th><th>K&#7929; thu&#7853;t</th><th>Ng&#432;&#7901;i l&agrave;m</th><th>OK</th><th>NG</th><th>Ghi ch&uacute;</th>
            </tr>
            ${logs.map((log) => {
              const machineText = log ? printValue(log.machine_name ? `${log.machine_code} - ${log.machine_name}` : log.machine_code) : "";
              const techText = log ? printValue(log.tech_name ? `${log.tech_code} - ${log.tech_name}` : log.tech_code) : "";
              const workerText = log ? printValue(log.worker_name ? `${log.worker_code} - ${log.worker_name}` : log.worker_code) : "";
              return `
                <tr class="process-write-row">
                  <td>${printValue(formatDateDisplay(log?.work_date || ""))}</td>
                  <td>${printValue(log?.shift || "")}</td>
                  <td>${machineText}</td>
                  <td>${techText}</td>
                  <td>${workerText}</td>
                  <td>${printBlankZero(log?.qty_ok)}</td>
                  <td>${printBlankZero(log?.qty_ng)}</td>
                  <td>${printValue(log?.note || "")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
          `;
        }).join("")}
      </table>

      ${renderCompactQualitySection(lot, qcForm, "qc", "QC GIA CÔNG", "III")}
      ${renderPrintBaviaWorkSection(lot, baviaWork)}
      ${renderCompactQualitySection(lot, baviaForm, "bavia", "QC BAVIA", "V")}
      ${renderPrintWarehouseSection(lot, warehouseForm)}
    </div>
  `;
}

function waitForPrintImages() {
  const images = Array.from(document.querySelectorAll("#print-area img"));
  return Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }));
}

async function printLot(lotCode) {
  lotCode = lotInputToInternalCode(lotCode);
  let lot = await api(`/api/lots/${encodeURIComponent(lotCode)}`);
  if (!lot.entries.length) lot = await api(`/api/lots/${encodeURIComponent(lotCode)}/init-steps`, { method: "POST" });
  lot.entries = await Promise.all(lot.entries.map(async (entry) => ({
    ...entry,
    machine_logs: await api(`/api/entries/${encodeURIComponent(entry.form_id)}/machines`).catch(() => []),
  })));
  const [qcForm, baviaForm, baviaWork, warehouseForm] = await Promise.all([
    api(`/api/lots/${encodeURIComponent(lotCode)}/qc`).catch(() => ({ rows: [] })),
    api(`/api/lots/${encodeURIComponent(lotCode)}/bavia`).catch(() => ({ rows: [] })),
    api(`/api/lots/${encodeURIComponent(lotCode)}/bavia-work`).catch(() => ({})),
    api(`/api/lots/${encodeURIComponent(lotCode)}/warehouse`).catch(() => ({ rows: [] })),
  ]);
  const override = currentOrderFormOverride(lot.order_code);
  if (override) lot.order = { ...(lot.order || {}), ...override };
  renderPrintArea(lot, { qc: qcForm, bavia: baviaForm, baviaWork, warehouse: warehouseForm });
  $("print-area").classList.remove("hidden");
  await waitForPrintImages();
  document.body.classList.add("printing-lot-sheet");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing-lot-sheet");
    $("print-area").classList.add("hidden");
  }, 600);
}

function entryCardHtml(entry, qtyPerLot, opIndex = 1) {
  const missingMaster = !activeMachines().length || !activeWorkers().length;
  return `
    <div class="entry-card card-${entry.status}" data-form-id="${entry.form_id}" data-qty="${qtyPerLot}">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="badge ${entry.status} text-[10px] py-0.5 px-2">OP ${opIndex} · ${statusText(entry.status)}</span>
          <h3 class="text-lg font-extrabold leading-none">${entry.step_name}</h3>
        </div>
        <p class="mono text-[10px] font-bold text-slate-400">${entry.form_id}</p>
      </div>
      ${missingMaster ? `<div class="error-text mb-2 text-xs">Cần khai báo ít nhất 1 máy CNC và 1 nhân công.</div>` : ""}
      <div class="machine-log-box">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="font-extrabold text-sm">Máy thực hiện / Chuyển máy</div>
          <div class="flex items-center gap-2">
            <button class="btn mini secondary" data-add-machine-row="${entry.form_id}">+ Chuyển máy</button>
            <button class="btn mini primary" data-save-machine-form="${entry.form_id}">Lưu sản lượng</button>
          </div>
        </div>
        <div id="machineRows-${entry.form_id}" class="machine-card-grid"></div>
        <div class="calc-line mt-2 font-bold"></div><div class="error-text hidden"></div>
      </div>
      <div class="save-state mt-3 text-sm font-bold text-slate-500">Đã lưu</div>
    </div>
  `;
}

function emptyMachineRow(formId) {
  return { form_id: formId, line_index: "", machine_code: "", worker_code: "", work_date: "", shift: "", qty_ok: 0, qty_ng: 0, note: "", _temp: true };
}

function renderMachineRows(formId, rows, qtyPerLot) {
  const container = $(`machineRows-${formId}`);
  container.dataset.rows = JSON.stringify(rows);
  container.innerHTML = rows.map((row, index) => `
    <div class="machine-row" data-machine-line="${row.line_index || ""}" data-temp="${row._temp ? 1 : 0}">
      <div class="machine-row-head">
        <span class="badge ${index ? "partial" : "todo"}">${index ? `Chuyển máy ${index + 1}` : "Máy chính"}</span>
      </div>
      <div class="machine-row-grid">
        <div class="machine-field">
          <label class="field-label">Máy</label>
          <input list="machineDatalist" class="input mini-input machine-log-field w-full" data-name="machine_code" placeholder="Chọn máy" value="${getMachineDisplayName(row.machine_code)}">
        </div>
        <div class="machine-field">
          <label class="field-label">Nhân công</label>
          <input list="workerDatalist" class="input mini-input machine-log-field w-full" data-name="worker_code" placeholder="Chọn NV" value="${getWorkerDisplayName(row.worker_code)}">
        </div>
        <div class="machine-field">
          <label class="field-label">Ngày</label>
          <input class="input mini-input machine-log-field w-full" data-name="work_date" type="date" value="${row.work_date || ""}">
        </div>
        <div class="machine-field">
          <label class="field-label">Kíp</label>
          <select class="input mini-input machine-log-field w-full" data-name="shift">
            ${["", "KÍP 1", "KÍP 2", "KÍP 3", "TĂNG CA"].map((s) => s ? `<option value="${s}" ${row.shift === s ? "selected" : ""}>${s}</option>` : `<option value="" ${!row.shift ? "selected" : ""}>-- Trống --</option>`).join("")}
          </select>
        </div>
        <div class="machine-field machine-num-field">
          <label class="field-label">OK</label>
          <input class="input mini-input machine-log-field ok-input w-full" data-name="qty_ok" type="number" min="0" step="1" value="${row.qty_ok || 0}">
        </div>
        <div class="machine-field machine-num-field">
          <label class="field-label">NG</label>
          <input class="input mini-input machine-log-field ng-input w-full" data-name="qty_ng" type="number" min="0" step="1" value="${row.qty_ng || 0}">
        </div>
        <div class="machine-field machine-note-field">
          <label class="field-label">Ghi chú</label>
          <input class="input mini-input machine-log-field w-full" data-name="note" placeholder="${index ? "Lý do" : "Ghi chú"}" value="${row.note || ""}">
        </div>
        <div class="machine-row-actions">
          <button class="btn mini danger" data-delete-machine-row>Xóa</button>
        </div>
      </div>
    </div>
  `).join("");
  wireMachineRowEvents(formId, qtyPerLot);
  updateMachineTotal(formId, qtyPerLot);
}

async function loadMachineRows(formId, qtyPerLot) {
  const rows = await api(`/api/entries/${encodeURIComponent(formId)}/machines`);
  renderMachineRows(formId, rows.length ? rows : [emptyMachineRow(formId)], qtyPerLot);
}

function collectMachineRows(formId) {
  return Array.from($(`machineRows-${formId}`).querySelectorAll(".machine-row")).map((el) => {
    const row = { line_index: el.dataset.machineLine ? Number(el.dataset.machineLine) : "", _temp: el.dataset.temp === "1" };
    el.querySelectorAll(".machine-log-field").forEach((field) => {
      let val = ["qty_ok", "qty_ng"].includes(field.dataset.name) ? Number(field.value || 0) : field.value;
      if (field.dataset.name === "machine_code" || field.dataset.name === "worker_code") {
        val = codeFromDisplay(val);
      }
      row[field.dataset.name] = val;
    });
    return row;
  });
}

async function persistMachineRow(formId, row, qtyPerLot) {
  if (!row.machine_code || !row.worker_code) return false;
  if (Number(row.qty_ok || 0) + Number(row.qty_ng || 0) <= 0) return false;
  const total = collectMachineRows(formId).reduce((sum, item) => sum + Number(item.qty_ok || 0) + Number(item.qty_ng || 0), 0);
  if (total > qtyPerLot) {
    throw new Error(`Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)`);
  }
  const payload = {
    machine_code: row.machine_code,
    worker_code: row.worker_code,
    work_date: row.work_date || null,
    shift: row.shift || "",
    qty_ok: row.qty_ok,
    qty_ng: row.qty_ng,
    note: row.note || "",
  };
  const saved = row.line_index
    ? await api(`/api/entries/${encodeURIComponent(formId)}/machines/${row.line_index}`, { method: "PUT", body: JSON.stringify(payload) })
    : await api(`/api/entries/${encodeURIComponent(formId)}/machines`, { method: "POST", body: JSON.stringify(payload) });
  return saved;
}

function updateMachineTotal(formId, qtyPerLot) {
  const rows = collectMachineRows(formId);
  const totalOk = rows.reduce((sum, row) => sum + Number(row.qty_ok || 0), 0);
  const totalNg = rows.reduce((sum, row) => sum + Number(row.qty_ng || 0), 0);
  const total = totalOk + totalNg;
  const card = document.querySelector(`[data-form-id="${formId}"]`);
  card.querySelector(".calc-line").textContent = `Tổng: OK ${totalOk} + NG ${totalNg} = ${total} / ${formatQty(qtyPerLot)} · Còn thiếu ${Math.max(qtyPerLot - total, 0)}`;
  const error = total > qtyPerLot ? `Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)` : "";
  card.querySelector(".error-text").textContent = error;
  card.querySelector(".error-text").classList.toggle("hidden", !error);
  return !error;
}

function wireMachineRowEvents(formId, qtyPerLot) {
  const container = $(`machineRows-${formId}`);
  container.querySelectorAll(".machine-log-field").forEach((field) => {
    field.addEventListener("input", () => updateMachineTotal(formId, qtyPerLot));
    field.addEventListener("blur", () => {
      if (state.machineSaveSuppressBlur.has(formId)) return;
      saveMachineRow(formId, field.closest(".machine-row"), qtyPerLot, false).catch((err) => toast(err.message, "error"));
    });
    field.addEventListener("change", () => {
      if (state.machineSaveSuppressBlur.has(formId)) return;
      saveMachineRow(formId, field.closest(".machine-row"), qtyPerLot, false).catch((err) => toast(err.message, "error"));
    });
  });
  container.querySelectorAll("[data-delete-machine-row]").forEach((btn) => {
    btn.addEventListener("click", () => deleteMachineRow(formId, btn.closest(".machine-row"), qtyPerLot));
  });
  document.querySelectorAll(`[data-form-id="${formId}"] .entry-header-field`).forEach((field) => {
    field.addEventListener("change", async () => {
      const rows = Array.from(container.querySelectorAll(".machine-row"));
      for (const row of rows) await saveMachineRow(formId, row, qtyPerLot);
    });
  });
  document.querySelector(`[data-add-machine-row="${formId}"]`).onclick = () => {
    if (!updateMachineTotal(formId, qtyPerLot)) return;
    const rows = collectMachineRows(formId);
    const total = rows.reduce((sum, row) => sum + Number(row.qty_ok || 0) + Number(row.qty_ng || 0), 0);
    if (total >= qtyPerLot) return toast("Lô đã đủ số lượng, không cần thêm máy", "info");
    rows.push({ ...emptyMachineRow(formId), note: "Chuyển máy" });
    renderMachineRows(formId, rows, qtyPerLot);
  };
  const saveAllBtn = document.querySelector(`[data-save-machine-form="${formId}"]`);
  if (saveAllBtn) {
    saveAllBtn.addEventListener("pointerdown", () => state.machineSaveSuppressBlur.add(formId));
    saveAllBtn.onclick = () => withLoading(saveAllBtn, async () => {
      try {
        await saveAllMachineRows(formId, qtyPerLot);
        toast("Đã lưu sản lượng", "success");
      } finally {
        state.machineSaveSuppressBlur.delete(formId);
      }
    }).catch((err) => toast(err.message, "error"));
  }
}

async function saveAllMachineRows(formId, qtyPerLot) {
  if (!updateMachineTotal(formId, qtyPerLot)) {
    throw new Error(document.querySelector(`[data-form-id="${formId}"] .error-text`)?.textContent?.trim() || `Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)`);
  }
  const rowEls = Array.from($(`machineRows-${formId}`)?.querySelectorAll(".machine-row") || []);
  const rows = collectMachineRows(formId);
  for (let index = 0; index < rows.length; index += 1) {
    const saved = await persistMachineRow(formId, rows[index], qtyPerLot);
    if (saved?.line_index && rowEls[index]) {
      rowEls[index].dataset.machineLine = String(saved.line_index);
      rowEls[index].dataset.temp = "0";
    }
  }
  const lotCode = state.currentLot?.lot_code;
  if (lotCode) {
    await refreshCurrentLot(lotCode);
    await loadOrders();
  }
}

async function saveMachineRow(formId, tr, qtyPerLot, refreshAfterSave = false) {
  if (!updateMachineTotal(formId, qtyPerLot)) return;
  const rows = collectMachineRows(formId);
  const index = Array.from(tr.parentElement.querySelectorAll(".machine-row")).indexOf(tr);
  const row = rows[index];
  const saved = await persistMachineRow(formId, row, qtyPerLot);
  if (saved?.line_index) {
    tr.dataset.machineLine = String(saved.line_index);
    tr.dataset.temp = "0";
  }
  if (refreshAfterSave) {
    const lotCode = state.currentLot?.lot_code;
    if (lotCode) {
      await refreshCurrentLot(lotCode);
      await loadOrders();
    }
  }
}

async function deleteMachineRow(formId, tr, qtyPerLot) {
  const lineIndex = tr.dataset.machineLine;
  if (lineIndex) await api(`/api/entries/${encodeURIComponent(formId)}/machines/${lineIndex}`, { method: "DELETE" });
  const rows = collectMachineRows(formId).filter((_, index) => index !== Array.from(tr.parentElement.querySelectorAll(".machine-row")).indexOf(tr));
  renderMachineRows(formId, rows.length ? rows : [emptyMachineRow(formId)], qtyPerLot);
  const lotCode = state.currentLot?.lot_code;
  if (lotCode) {
    await refreshCurrentLot(lotCode);
    await loadOrders();
  }
}

// Override các hàm render để sửa lỗi mode Bavia và chữ Việt bị lỗi encoding ở UI.
function statusText(status) {
  return { todo: "Chưa nhập", partial: "Đang nhập", done: "Hoàn thành" }[status] || status || "";
}

function renderLotModeBar() {
  const bar = $("lotModeBar");
  if (!bar) return;
  const mode = state.lotMode || "gia_cong";
  bar.classList.remove("hidden");
  bar.innerHTML = [
    ["gia_cong", "Gia công"],
    ["bavia", "Bavia"],
    ["kho", "Nhập kho"],
  ].map(([value, label]) => `<button class="lot-mode-btn ${mode === value ? "active" : ""}" data-lot-mode="${value}">${label}</button>`).join("");
}

function setLotMode(mode) {
  const nextMode = ["gia_cong", "bavia", "kho"].includes(mode) ? mode : "gia_cong";
  state.lotMode = nextMode;
  renderLotModeBar();
  if (state.currentLot) renderLot(state.currentLot);
}

async function renderLotHints(orderCode) {
  if (!orderCode) return;
  try {
    const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
    const lots = new Map();
    rows.forEach((row) => {
      if (!row?.lot_code) return;
      if (!lots.has(row.lot_code)) lots.set(row.lot_code, []);
      lots.get(row.lot_code).push(row);
    });
    $("lotHintGrid").innerHTML = lots.size ? Array.from(lots.entries()).map(([lotCode, lotRows]) => {
      const first = lotRows[0] || {};
      const status = lotOverallStatus(lotRows);
      const doneCount = lotRows.filter((row) => row.status === "done").length;
      const totalSteps = lotRows.filter((row) => row.step_name).length;
      return `
        <button class="lot-hint ${status} w-full text-left" data-lot-code="${lotCode}">
          <div class="flex justify-between items-center w-full">
            <span class="font-extrabold text-slate-800 text-sm">${displayLotCode(lotCode)}</span>
            <span class="badge ${status} text-[10px] py-0.5 px-2">${statusText(status)}</span>
          </div>
          <div class="text-xs text-slate-500 mt-1">SL: ${formatQty(first.qty_per_lot || 0)} cái · ${totalSteps ? `${doneCount}/${totalSteps} CĐ` : "Chưa mở lô"}</div>
        </button>
      `;
    }).join("") : `<div class="text-sm font-semibold text-slate-500">Đơn hàng này chưa có lô</div>`;
    document.querySelectorAll("[data-lot-code]").forEach((btn) => btn.addEventListener("click", () => {
      $("scanLotCode").value = displayLotCode(btn.dataset.lotCode);
      loadLot(btn.dataset.lotCode);
    }));
  } catch (err) {
    $("lotHintGrid").innerHTML = `<div class="text-sm font-semibold text-red-600">Không tải được danh sách lô: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderLotBaviaWorkPanel(lot) {
  const panel = $("lotBaviaPanel");
  if (!panel || !lot) return;
  const work = await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/bavia-work`).catch(() => ({}));
  const row = work.row || {};
  panel.className = "lot-bavia-panel";
  panel.innerHTML = `
    <div class="panel">
      <div class="lot-bavia-title">Bavia</div>
      <div class="lot-bavia-meta">Lô: ${displayLotCode(lot.lot_code)} · ${lot.part_code}</div>
      <div class="lot-work-box">
        <div class="lot-work-grid">
          <div class="machine-field">
            <label class="field-label">Máy</label>
            <input list="machineDatalist" id="baviaMachine" class="input mini-input w-full" placeholder="Chọn máy" value="${escapeHtml(getMachineDisplayName(row.machine_code || ""))}">
          </div>
          <div class="machine-field">
            <label class="field-label">Người làm</label>
            <input list="workerDatalist" id="baviaWorker" class="input mini-input w-full" placeholder="Chọn NV" value="${escapeHtml(getWorkerDisplayName(row.worker_code || ""))}">
          </div>
          <div class="machine-field">
            <label class="field-label">Ngày</label>
            <input id="baviaWorkDate" type="date" class="input mini-input w-full" value="${escapeHtml(work.work_date || row.work_date || today())}">
          </div>
          <div class="machine-field">
            <label class="field-label">Kíp</label>
            <select id="baviaShift" class="input mini-input w-full">
              ${["", "KÍP 1", "KÍP 2", "KÍP 3", "TĂNG CA"].map((s) => s ? `<option value="${s}" ${row.shift === s ? "selected" : ""}>${s}</option>` : `<option value="" ${!row.shift ? "selected" : ""}>-- Trống --</option>`).join("")}
            </select>
          </div>
          <div class="machine-field machine-num-field">
            <label class="field-label">OK</label>
            <input id="baviaOk" class="input mini-input ok-input w-full" type="number" min="0" step="1" value="${Number(row.qty_ok || 0)}">
          </div>
          <div class="machine-field machine-num-field">
            <label class="field-label">NG</label>
            <input id="baviaNg" class="input mini-input ng-input w-full" type="number" min="0" step="1" value="${Number(row.qty_ng || 0)}">
          </div>
          <div class="machine-field machine-note-field" style="min-width: 220px; flex: 1 1 220px;">
            <label class="field-label">Ghi chú</label>
            <input id="baviaNote" class="input mini-input w-full" placeholder="Ghi chú" value="${escapeHtml(row.note || "")}">
          </div>
        </div>
        <div class="lot-work-footer">
          <div class="save-state mt-3 text-sm font-bold text-slate-500">${row.machine_code ? "Đã lưu" : "Chưa lưu"}</div>
          <button id="saveBaviaWorkBtn" class="btn primary">Lưu sản lượng</button>
        </div>
      </div>
    </div>
  `;
  on("saveBaviaWorkBtn", "click", () => withLoading($("saveBaviaWorkBtn"), async () => {
    await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/bavia-work`, {
      method: "PUT",
      body: JSON.stringify({
        work_date: $("baviaWorkDate")?.value || today(),
        row: {
          machine_code: codeFromDisplay($("baviaMachine")?.value || ""),
          worker_code: codeFromDisplay($("baviaWorker")?.value || ""),
          work_date: $("baviaWorkDate")?.value || today(),
          shift: $("baviaShift")?.value || "",
          qty_ok: Number($("baviaOk")?.value || 0),
          qty_ng: Number($("baviaNg")?.value || 0),
          note: $("baviaNote")?.value || "",
        },
      }),
    });
    toast("Đã lưu Bavia", "success");
    await refreshCurrentLot(lot.lot_code);
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));
}
function qualityConfig(kind = "qc") {
  if (kind === "bavia") {
    return {
      kind: "bavia",
      title: "QC Bavia",
      panelId: "lotQcPanel",
      rowsId: "lotBaviaRows",
      summaryId: "baviaSummaryRow",
      maxId: "baviaMaxQty",
      dateId: "baviaDate",
      dateLabel: "Ngày QC Bavia",
      dateKey: "bavia_date",
      saveBtnId: "saveBaviaBtn",
      saveLabel: "Lưu QC Bavia",
      apiSuffix: "bavia",
      defaults: DEFAULT_BAVIA_ITEMS,
      rowLimit: 3,
    };
  }
  return {
    kind: "qc",
    title: "QC",
    panelId: "lotQcPanel",
    rowsId: "lotQcRows",
    summaryId: "qcSummaryRow",
    maxId: "qcMaxQty",
    dateId: "qcDate",
    dateLabel: "Ngày QC",
    dateKey: "qc_date",
    saveBtnId: "saveQcBtn",
    saveLabel: "Lưu QC",
    apiSuffix: "qc",
    defaults: DEFAULT_QC_ITEMS,
    rowLimit: 4,
  };
}

function qualitySelectHtml(selectedValue = "") {
  const selected = String(selectedValue || "").trim();
  const options = [`<option value="">-- Chọn NV --</option>`].concat(activeWorkers().map((worker) => {
    const label = `${worker.worker_code} - ${worker.worker_name}`;
    const match = [worker.worker_code, label, worker.worker_name].includes(selected);
    return `<option value="${worker.worker_code}" ${match ? "selected" : ""}>${label}</option>`;
  }));
  return `<select class="input quality-field" data-name="inspector" required>${options.join("")}</select>`;
}

function workerSelectHtml(selectedValue = "", dataName = "performer") {
  const selected = String(selectedValue || "").trim();
  const options = [`<option value="">-- Chọn NV --</option>`].concat(activeWorkers().map((worker) => {
    const label = `${worker.worker_code} - ${worker.worker_name}`;
    const match = [worker.worker_code, label, worker.worker_name].includes(selected);
    return `<option value="${worker.worker_code}" ${match ? "selected" : ""}>${label}</option>`;
  }));
  return `<select class="input warehouse-field" data-name="${dataName}" required>${options.join("")}</select>`;
}

function normalizeQualityRows(rows = [], kind = "qc") {
  const cfg = qualityConfig(kind);
  const baseRows = (rows || []).slice(0, cfg.rowLimit).map((row, index) => ({
    line_index: index + 1,
    check_name: cfg.defaults[index] || row.check_name || "",
    qty_ok: Number(row.qty_ok || 0),
    qty_ng: Number(row.qty_ng || 0),
    defect_content: row.defect_content || "",
    inspector: row.inspector || "",
  }));
  while (baseRows.length < cfg.rowLimit) {
    const index = baseRows.length;
    baseRows.push({
      line_index: index + 1,
      check_name: cfg.defaults[index] || "",
      qty_ok: 0,
      qty_ng: 0,
      defect_content: "",
      inspector: "",
    });
  }
  return baseRows;
}

function qualityRowHtml(row, index, rowMax) {
  return `
    <tr data-quality-row data-line-index="${row.line_index || index + 1}" data-row-max="${Number(rowMax || 0)}">
      <td class="qc-check-cell">
        <span class="qc-check-order">${index + 1}.</span>
        <span class="qc-check-name">${escapeHtml(row.check_name || "")}</span>
      </td>
      <td><input class="input quality-field" data-name="qty_ok" type="number" min="0" max="${rowMax || ""}" step="1" value="${Number(row.qty_ok || 0)}"></td>
      <td><input class="input quality-field" data-name="qty_ng" type="number" min="0" max="${rowMax || ""}" step="1" value="${Number(row.qty_ng || 0)}"></td>
      <td><input class="input quality-field" data-name="defect_content" placeholder="Nội dung lỗi" value="${escapeHtml(row.defect_content || "")}"></td>
      <td>${qualitySelectHtml(row.inspector || "")}</td>
      <td class="lot-qc-row-action"><span class="text-xs font-bold text-slate-400">Bước ${index + 1}</span></td>
    </tr>
  `;
}

function collectQualityRows(rowsId, kind = "qc") {
  const cfg = qualityConfig(kind);
  return Array.from($(rowsId)?.querySelectorAll("[data-quality-row]") || []).map((row, index) => {
    const item = { line_index: Number(row.dataset.lineIndex || index + 1) };
    row.querySelectorAll(".quality-field").forEach((field) => {
      const value = field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng"
        ? Number(field.value || 0)
        : field.value;
      item[field.dataset.name] = value;
    });
    item.check_name = cfg.defaults[index] || row.querySelector(".qc-check-name")?.textContent?.replace(/^\d+\.\s*/, "").trim() || "";
    return item;
  });
}

function updateQualityChain(kind = "qc") {
  const cfg = qualityConfig(kind);
  const rows = Array.from($(cfg.rowsId)?.querySelectorAll("[data-quality-row]") || []);
  const maxQty = Number($(cfg.maxId)?.dataset.maxQty || 0);
  let previousTotal = maxQty;
  let latestTotal = 0;
  let activeRows = 0;
  rows.forEach((rowEl, index) => {
    const rowMax = index === 0 ? maxQty : previousTotal;
    rowEl.dataset.rowMax = String(rowMax || 0);
    const inputs = rowEl.querySelectorAll(".quality-field");
    inputs.forEach((field) => {
      if (field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng") {
        field.max = rowMax || "";
        field.disabled = index > 0 && previousTotal <= 0;
      }
    });
    const total = Number(rowEl.querySelector('[data-name="qty_ok"]')?.value || 0) + Number(rowEl.querySelector('[data-name="qty_ng"]')?.value || 0);
    if (total > 0) {
      latestTotal = total;
      activeRows = index + 1;
    }
    previousTotal = total;
  });
  const summaryOk = latestTotal ? Number(rows[activeRows - 1]?.querySelector('[data-name="qty_ok"]')?.value || 0) : 0;
  const summaryNg = latestTotal ? Number(rows[activeRows - 1]?.querySelector('[data-name="qty_ng"]')?.value || 0) : 0;
  if ($(cfg.summaryId)) {
    $(cfg.summaryId).querySelector('[data-summary="ok"]').textContent = formatQty(summaryOk);
    $(cfg.summaryId).querySelector('[data-summary="ng"]').textContent = formatQty(summaryNg);
    $(cfg.summaryId).querySelector('[data-summary="total"]').textContent = formatQty(latestTotal);
    $(cfg.summaryId).querySelector('[data-summary="step"]').textContent = activeRows ? `Bước ${activeRows}` : "Chưa có dữ liệu";
  }
}

function wireQualityRowEvents(kind = "qc") {
  const cfg = qualityConfig(kind);
  $(cfg.rowsId)?.querySelectorAll(".quality-field").forEach((field) => {
    field.addEventListener("input", () => updateQualityChain(kind));
    field.addEventListener("change", () => updateQualityChain(kind));
  });
}

async function loadLotQuality(lotCode, kind = "qc") {
  const cfg = qualityConfig(kind);
  return api(`/api/lots/${encodeURIComponent(lotCode)}/${cfg.apiSuffix}`);
}

async function renderLotQualityPanel(lot, kind = "qc") {
  const cfg = qualityConfig(kind);
  const panel = $(cfg.panelId);
  if (!panel || !lot) return;
  const form = await loadLotQuality(lot.lot_code, kind).catch(() => ({ rows: [] }));
  const maxQty = Number(form.max_qty || 0);
  const qualityRows = normalizeQualityRows(form.rows || [], kind);
  panel.classList.remove("hidden");
  panel.className = kind === "bavia" ? "lot-bavia-panel" : "lot-qc-panel";
  const content = `
    <div class="lot-qc-title">${cfg.title}</div>
    <div class="lot-qc-meta">
      <span>${cfg.title} lô: ${displayLotCode(lot.lot_code)}</span>
      <span>Công đoạn cuối: ${escapeHtml(form.last_step_name || "Chưa có")}</span>
      <span>KQ cuối: ${formatQty(form.last_step_ok || 0)} OK + ${formatQty(form.last_step_ng || 0)} NG</span>
      <span id="${cfg.maxId}" class="qc-max-chip" data-max-qty="${maxQty}">Số lượng max: ${formatQty(maxQty)}</span>
      <label class="qc-date-chip">
        <span>${cfg.dateLabel}</span>
        <input id="${cfg.dateId}" type="date" class="input qc-date-input" value="${escapeHtml(form[cfg.dateKey] || today())}">
      </label>
    </div>
    ${maxQty <= 0 ? `<div class="error-text mb-3">Chưa có số lượng công đoạn cuối, ${cfg.title} sẽ lấy max khi công đoạn cuối có OK/NG.</div>` : ""}
    <div class="table-wrap">
      <table class="lot-qc-table">
        <thead>
          <tr>
            <th>Nội dung kiểm tra</th>
            <th>Số lượng OK</th>
            <th>Số lượng NG</th>
            <th>Nội dung lỗi</th>
            <th>Người kiểm tra</th>
            <th>Thứ tự</th>
          </tr>
        </thead>
        <tbody id="${cfg.rowsId}">
          ${qualityRows.map((row, index) => {
            let rowMax = maxQty;
            if (index > 0) {
              const prev = qualityRows[index - 1];
              rowMax = Number(prev.qty_ok || 0) + Number(prev.qty_ng || 0);
            }
            return qualityRowHtml(row, index, rowMax);
          }).join("")}
        </tbody>
      </table>
    </div>
    <div id="${cfg.summaryId}" class="qc-summary-row">
      <div class="qc-summary-title">TỔNG</div>
      <div class="qc-summary-chip">Bước: <span data-summary="step">Chưa có dữ liệu</span></div>
      <div class="qc-summary-chip">OK: <span data-summary="ok">0</span></div>
      <div class="qc-summary-chip">NG: <span data-summary="ng">0</span></div>
      <div class="qc-summary-chip qc-summary-final">Kết quả: <span data-summary="total">0</span></div>
    </div>
    <div class="lot-qc-footer">
      <div></div>
      <button id="${cfg.saveBtnId}" class="btn primary">${cfg.saveLabel}</button>
    </div>
  `;
  if (kind === "bavia") {
    panel.innerHTML = `<div class="panel">${content}</div>`;
  } else {
    panel.innerHTML = content;
  }
  on(cfg.saveBtnId, "click", () => withLoading($(cfg.saveBtnId), async () => {
    const rows = collectQualityRows(cfg.rowsId, kind);
    const missingInspector = rows.some((row) => (Number(row.qty_ok || 0) + Number(row.qty_ng || 0)) > 0 && !String(row.inspector || "").trim());
    if (missingInspector) {
      throw new Error("Vui lòng chọn người kiểm tra cho tất cả các dòng có dữ liệu");
    }
    const payload = {
      [cfg.dateKey]: $(cfg.dateId)?.value || today(),
      rows,
    };
    await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/${cfg.apiSuffix}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    toast(`Đã lưu ${cfg.title}`, "success");
    await refreshCurrentLot(lot.lot_code);
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));
  wireQualityRowEvents(kind);
  updateQualityChain(kind);
}

async function renderLotQcPanel(lot, kind = "qc") {
  return renderLotQualityPanel(lot, kind);
}

function normalizeWarehouseRows(rows = []) {
  const baseRows = (rows || []).slice(0, 3).map((row, index) => ({
    line_index: index + 1,
    check_name: DEFAULT_WAREHOUSE_ITEMS[index] || row.check_name || "",
    qty_ok: Number(row.qty_ok || 0),
    qty_ng: Number(row.qty_ng || 0),
    defect_content: row.defect_content || "",
    performer: row.performer || "",
  }));
  while (baseRows.length < 3) {
    const index = baseRows.length;
    baseRows.push({
      line_index: index + 1,
      check_name: DEFAULT_WAREHOUSE_ITEMS[index] || "",
      qty_ok: 0,
      qty_ng: 0,
      defect_content: "",
      performer: "",
    });
  }
  return baseRows;
}

function warehouseRowHtml(row, index, rowMax) {
  const fullRow = index === 1;
  return `
    <tr data-warehouse-row data-line-index="${row.line_index || index + 1}" data-row-max="${Number(rowMax || 0)}">
      <td class="qc-check-cell">
        <span class="qc-check-order">${index + 1}.</span>
        <span class="qc-check-name">${escapeHtml(row.check_name || "")}</span>
      </td>
      <td><input class="input warehouse-field" data-name="qty_ok" type="number" min="0" max="${rowMax || ""}" step="1" value="${Number(row.qty_ok || 0)}"></td>
      <td>${fullRow ? `<input class="input warehouse-field" data-name="qty_ng" type="number" min="0" max="${rowMax || ""}" step="1" value="${Number(row.qty_ng || 0)}">` : `<span class="warehouse-slash-cell">/</span>`}</td>
      <td>${fullRow ? `<input class="input warehouse-field" data-name="defect_content" placeholder="Nội dung lỗi" value="${escapeHtml(row.defect_content || "")}">` : `<span class="warehouse-slash-cell">/</span>`}</td>
      <td>${workerSelectHtml(row.performer || "")}</td>
      <td class="lot-qc-row-action"><span class="text-xs font-bold text-slate-400">Bước ${index + 1}</span></td>
    </tr>
  `;
}

function collectWarehouseRows(rowsId) {
  return Array.from($(rowsId)?.querySelectorAll("[data-warehouse-row]") || []).map((row, index) => {
    const item = { line_index: Number(row.dataset.lineIndex || index + 1) };
    row.querySelectorAll(".warehouse-field").forEach((field) => {
      const value = field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng"
        ? Number(field.value || 0)
        : field.value;
      item[field.dataset.name] = value;
    });
    item.check_name = DEFAULT_WAREHOUSE_ITEMS[index] || row.querySelector(".qc-check-name")?.textContent?.replace(/^\d+\.\s*/, "").trim() || "";
    if (index !== 1) {
      item.qty_ng = 0;
      item.defect_content = "";
    }
    return item;
  });
}

function updateWarehouseChain() {
  const rows = Array.from($("lotWarehouseRows")?.querySelectorAll("[data-warehouse-row]") || []);
  const maxQty = Number($("warehouseMaxQty")?.dataset.maxQty || 0);
  let previousTotal = maxQty;
  let latestTotal = 0;
  let activeRows = 0;
  rows.forEach((rowEl, index) => {
    const rowMax = index === 0 ? maxQty : previousTotal;
    rowEl.dataset.rowMax = String(rowMax || 0);
    rowEl.querySelectorAll(".warehouse-field").forEach((field) => {
      if (field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng") {
        field.max = rowMax || "";
        if ((index === 0 || index === 2) && field.dataset.name === "qty_ng") {
          field.disabled = true;
        }
      }
    });
    const total = Number(rowEl.querySelector('[data-name="qty_ok"]')?.value || 0) + Number(rowEl.querySelector('[data-name="qty_ng"]')?.value || 0);
    if (total > 0) {
      latestTotal = total;
      activeRows = index + 1;
    }
    previousTotal = total;
  });
  const summaryOk = latestTotal ? Number(rows[activeRows - 1]?.querySelector('[data-name="qty_ok"]')?.value || 0) : 0;
  const summaryNg = latestTotal ? Number(rows[activeRows - 1]?.querySelector('[data-name="qty_ng"]')?.value || 0) : 0;
  if ($("warehouseSummaryRow")) {
    $("warehouseSummaryRow").querySelector('[data-summary="ok"]').textContent = formatQty(summaryOk);
    $("warehouseSummaryRow").querySelector('[data-summary="ng"]').textContent = formatQty(summaryNg);
    $("warehouseSummaryRow").querySelector('[data-summary="total"]').textContent = formatQty(latestTotal);
    $("warehouseSummaryRow").querySelector('[data-summary="step"]').textContent = activeRows ? `Bước ${activeRows}` : "Chưa có dữ liệu";
  }
}

function wireWarehouseRowEvents() {
  $("lotWarehouseRows")?.querySelectorAll(".warehouse-field").forEach((field) => {
    field.addEventListener("input", () => updateWarehouseChain());
    field.addEventListener("change", () => updateWarehouseChain());
  });
}

async function renderLotWarehousePanel(lot) {
  const panel = $("lotKhoPanel");
  if (!panel || !lot) return;
  const form = await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/warehouse`).catch(() => ({ rows: [] }));
  const rows = normalizeWarehouseRows(form.rows || []);
  const maxQty = Number(form.max_qty || 0);
  panel.className = "lot-warehouse-panel";
  panel.innerHTML = `
    <div class="panel">
      <div class="lot-qc-title">KHO TP</div>
      <div class="lot-qc-meta">
        <span>Lô: ${displayLotCode(lot.lot_code)}</span>
        <span>Nguồn QC: ${formatQty(form.last_step_ok || 0)} OK + ${formatQty(form.last_step_ng || 0)} NG</span>
        <span id="warehouseMaxQty" class="qc-max-chip" data-max-qty="${maxQty}">Số lượng max: ${formatQty(maxQty)}</span>
        <label class="qc-date-chip">
          <span>Ngày kho</span>
          <input id="warehouseDate" type="date" class="input qc-date-input" value="${escapeHtml(form.warehouse_date || today())}">
        </label>
      </div>
      <div class="table-wrap">
        <table class="lot-qc-table">
          <thead>
            <tr>
              <th>Nội dung kiểm tra</th>
              <th>Số lượng OK</th>
              <th>Số lượng NG</th>
              <th>Nội dung lỗi</th>
              <th>Người thực hiện</th>
              <th>Thứ tự</th>
            </tr>
          </thead>
          <tbody id="lotWarehouseRows">
            ${rows.map((row, index) => {
              const rowMax = index === 0 ? maxQty : Number(rows[index - 1].qty_ok || 0) + Number(rows[index - 1].qty_ng || 0);
              return warehouseRowHtml(row, index, rowMax);
            }).join("")}
          </tbody>
        </table>
      </div>
      <div id="warehouseSummaryRow" class="qc-summary-row">
        <div class="qc-summary-title">TỔNG</div>
        <div class="qc-summary-chip">Bước: <span data-summary="step">Chưa có dữ liệu</span></div>
        <div class="qc-summary-chip">OK: <span data-summary="ok">0</span></div>
        <div class="qc-summary-chip">NG: <span data-summary="ng">0</span></div>
        <div class="qc-summary-chip qc-summary-final">Kết quả: <span data-summary="total">0</span></div>
      </div>
      <div class="lot-qc-footer">
        <div></div>
        <button id="saveWarehouseBtn" class="btn primary">Lưu kho</button>
      </div>
    </div>
  `;
  on("saveWarehouseBtn", "click", () => withLoading($("saveWarehouseBtn"), async () => {
    const rowsPayload = collectWarehouseRows("lotWarehouseRows");
    const missingPerformer = rowsPayload.some((row) => (Number(row.qty_ok || 0) + Number(row.qty_ng || 0)) > 0 && !String(row.performer || "").trim());
    if (missingPerformer) {
      throw new Error("Vui lòng chọn người thực hiện cho tất cả các dòng có dữ liệu");
    }
    await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/warehouse`, {
      method: "PUT",
      body: JSON.stringify({
        warehouse_date: $("warehouseDate")?.value || today(),
        rows: rowsPayload,
      }),
    });
    toast("Đã lưu kho", "success");
    await refreshCurrentLot(lot.lot_code);
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));
  wireWarehouseRowEvents();
  updateWarehouseChain();
}
async function renderLot(lot) {
  const done = lot.entries.filter((e) => e.status === "done").length;
  state.currentLot = lot;
  const mode = state.lotMode || "gia_cong";
  renderLotModeBar();
  $("lotHeader").classList.remove("hidden");
  $("lotHeader").innerHTML = `
    <div>
      <div>${displayLotCode(lot.lot_code)} · ${lot.part_code} · SL: ${formatQty(lot.qty_per_lot)} cái · ${done}/${lot.entries.length} công đoạn hoàn thành</div>
    </div>
  <button class="btn secondary" id="printLotSheetBtn">In biểu lô</button>
  `;
  on("printLotSheetBtn", "click", () => printLot(lot.lot_code));
  const showGiaCong = mode === "gia_cong";
  const showBavia = mode === "bavia";
  const showKho = mode === "kho";

  $("entryCards").classList.toggle("hidden", !showGiaCong);
  $("lotBaviaPanel").classList.toggle("hidden", !showBavia);
  $("lotKhoPanel").classList.toggle("hidden", !showKho);
  $("lotQcPanel").classList.toggle("hidden", showKho);

  if (showGiaCong) {
    $("entryCards").innerHTML = lot.entries.map((entry, index) => entryCardHtml(entry, lot.qty_per_lot, index + 1)).join("");
    await Promise.all(lot.entries.map((entry) => loadMachineRows(entry.form_id, lot.qty_per_lot)));
    await renderLotQcPanel(lot, "qc");
  } else {
    $("entryCards").innerHTML = "";
  }

  if (showBavia) {
    await renderLotBaviaWorkPanel(lot);
    await renderLotQcPanel(lot, "bavia");
  } else {
    $("lotBaviaPanel").innerHTML = "";
  }

  if (showKho) {
    await renderLotWarehousePanel(lot);
  } else {
    $("lotKhoPanel").innerHTML = "";
  }

  if (state.focusFormId) {
    const target = document.querySelector(`[data-form-id="${state.focusFormId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("focus-flash");
      setTimeout(() => target.classList.remove("focus-flash"), 2200);
    }
    state.focusFormId = null;
  }
}

function wireLots() {
  on("loadLotBtn", "click", () => loadLot());
  on("scanLotCode", "keydown", (e) => {
    if (e.key === "Enter") loadLot();
  });
  on("lotModeBar", "click", (e) => {
    const btn = e.target.closest("[data-lot-mode]");
    if (!btn) return;
    setLotMode(btn.dataset.lotMode);
  });
  on("lotOrderSelect", "change", (e) => {
    state.currentLotOrderCode = e.target.value;
    renderLotHints(e.target.value);
  });
}

async function loadReports() {
  const summary = await api("/api/reports/summary");
  $("summaryTable").innerHTML = summary.map((row) => `
    <tr class="${row.ng_rate > 5 ? "ng-high" : ""}">
      <td class="mono font-bold">${row.order_code}</td><td>${row.part_code}</td><td>${formatQty(row.total_qty)}</td>
      <td>${row.total_lots}</td><td>${row.lots_done}/${row.total_lots}</td><td>${row.total_ok}</td><td>${row.total_ng}</td><td>${row.ng_rate}%</td>
      <td>${row.ng_rate > 5 ? `<span class="badge error">Cảnh báo NG cao</span>` : `<span class="badge done">Bình thường</span>`}</td>
    </tr>
  `).join("") || `<tr><td colspan="9" class="text-slate-500">Chưa có dữ liệu</td></tr>`;
  await loadOrders();
  if ($("reportOrderSelect").value) await loadOrderDetail($("reportOrderSelect").value);
}

async function loadOrderDetail(orderCode) {
  if (!orderCode) {
    $("detailTable").innerHTML = `<tr><td colspan="8" class="text-slate-500">Chưa có đơn hàng</td></tr>`;
    return;
  }
  const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
  $("detailTable").innerHTML = rows.map((row) => `
    <tr class="${row.status || "todo"}">
      <td class="mono font-bold">${displayLotCode(row.lot_code)}</td><td>${row.step_name || "Chưa khởi tạo"}</td>
      <td><span class="badge ${row.status || "todo"}">${statusText(row.status || "todo")}</span></td>
      <td>${row.machines_used || ""}</td><td>${row.qty_ok || 0}</td><td>${row.qty_ng || 0}</td><td>${row.work_date || ""}</td><td>${row.shift || ""}</td>
    </tr>
  `).join("");
}

function wireReports() {
  on("refreshReportBtn", "click", () => loadReports().catch((err) => toast(err.message, "error")));
  on("reportOrderSelect", "change", (e) => loadOrderDetail(e.target.value));
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".report-tab").forEach((x) => x.classList.add("hidden"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.remove("hidden");
    });
  });
}

function getPartSummaryFilters() {
  const dateFrom = $("partDateFrom")?.value || "";
  const dateTo = $("partDateTo")?.value || "";
  if (dateFrom && dateTo && dateFrom > dateTo) {
    toast("Ngày bắt đầu không được lớn hơn ngày kết thúc", "warning");
    return null;
  }
  return { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
}

async function loadPartsSummary(filters = {}) {
  const end = today();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  const defaultFrom = start.toISOString().slice(0, 10);
  const dateFrom = filters.dateFrom || defaultFrom;
  const dateTo = filters.dateTo || end;
  const params = new URLSearchParams();
  params.set("date_from", dateFrom);
  params.set("date_to", dateTo);
  if ($("partDateFrom")) $("partDateFrom").value = dateFrom;
  if ($("partDateTo")) $("partDateTo").value = dateTo;
  state.partSummary = await api(`/api/parts/summary${params.toString() ? `?${params.toString()}` : ""}`);
  $("partsTable").innerHTML = state.partSummary.map((row) => `
    <tr>
      <td class="mono font-bold">${row.part_code}</td>
      <td>${formatQty(row.order_count)}</td>
      <td>${formatQty(row.total_qty)}</td>
      <td>${formatQty(row.completed_orders)}</td>
      <td>${formatQty(row.total_ok)}</td>
      <td>${formatQty(row.total_ng)}</td>
      <td>
        <div class="flex flex-wrap gap-2">
          <button class="btn mini secondary" data-edit-part="${row.part_code}">Sửa</button>
          <button class="btn mini danger" data-delete-part="${row.part_code}">Xóa</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="text-slate-500">Chưa có mã hàng</td></tr>`;
  document.querySelectorAll("[data-edit-part]").forEach((btn) => btn.addEventListener("click", () => startEditPart(btn.dataset.editPart)));
  document.querySelectorAll("[data-delete-part]").forEach((btn) => btn.addEventListener("click", () => requestDeletePart(btn.dataset.deletePart)));
}

function renderPartsShell() {
  const panel = $("partsScreen")?.querySelector(".panel.mt-5");
  if (!panel) return;
  panel.innerHTML = `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="field-label">Từ ngày</label>
        <input id="partDateFrom" type="date" class="input">
      </div>
      <div>
        <label class="field-label">Đến ngày</label>
        <input id="partDateTo" type="date" class="input">
      </div>
      <button id="applyPartFilterBtn" class="btn primary">Lọc</button>
      <button id="clearPartFilterBtn" class="btn secondary">Xóa lọc</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Mã hàng</th><th>Số đơn</th><th>Tổng SL</th><th>Đã hoàn thành</th><th>OK</th><th>NG</th><th>Thao tác</th></tr>
        </thead>
        <tbody id="partsTable"></tbody>
      </table>
    </div>
  `;
}

async function loadParts() {
  state.parts = await api("/api/parts");
  $("orderPartCode").innerHTML = `<option value="">Chọn mã hàng</option>${state.parts.map((p) => `<option value="${p.part_code}">${p.part_code}</option>`).join("")}`;
}

function requestDeletePart(partCode) {
  openDeleteModal({
    title: "Xóa mã hàng",
    message: `Nhập mã xóa để xóa mã hàng ${partCode}.`,
    onConfirm: async (deleteCode) => {
      await api(`/api/parts/${encodeURIComponent(partCode)}`, { method: "DELETE", body: JSON.stringify({ delete_code: deleteCode }) });
      toast("Đã xóa mã hàng", "success");
      await loadParts();
      await loadPartsSummary(getPartSummaryFilters() || {});
    },
  });
}

async function boot() {
  wireNavigation();
  wireUppercase();
  wireMaster();
  wireParts();
  wireOrders();
  wireLots();
  wireDeleteModal();
  wireReports();
  wireExportSheet();
  await Promise.all([loadMachines(), loadWorkers(), loadParts(), loadOrders()]);
  await loadPartsSummary();
  updateLotPreview();
  const params = new URLSearchParams(window.location.search);
  const lotCode = params.get("lot");
  if (lotCode) {
    showScreen("lotScreen");
    await loadLot(lotCode, params.get("form") || "");
  }
}

boot().catch((err) => toast(err.message, "error"));
