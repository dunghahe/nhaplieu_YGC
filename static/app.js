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
  bulkPrintOrder: null,
  bulkPrintLots: [],
  currentBlankReceiptLot: null,
  machineSaveSuppressBlur: new Set(),
  lotSearchClearOnBlur: false,
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
  blank_issue_date: "blankIssueDate",
  delivered_by: "deliveredBy",
  received_by: "receivedBy",
};
const ORDER_DATE_FIELDS = new Set(["order_receive_date", "blank_issue_date"]);
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

function formatDateTimeDisplay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (match) return `${match[3]}/${match[2]}/${match[1]} ${match[4] || "00"}:${match[5] || "00"}`;
  return raw;
}

function nowLocalDateTimeInput() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
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
  if (screenId === "warehouseScreen") showWarehouseList(false);
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
  ml.innerHTML = activeMachines().map(m => `<option value="${m.machine_code} - ${m.location || ""}"></option>`).join("");

  let wl = $("workerDatalist");
  if (!wl) { wl = document.createElement("datalist"); wl.id = "workerDatalist"; document.body.appendChild(wl); }
  wl.innerHTML = activeWorkers().map(w => `<option value="${w.worker_code} - ${w.worker_name}"></option>`).join("");
}

function getMachineDisplayName(code) {
  if (!code) return "";
  const m = state.machines.find(x => x.machine_code === code);
  return m ? `${m.machine_code} - ${m.location || ""}` : code;
}

function getWorkerDisplayName(code) {
  if (!code) return "";
  const w = state.workers.find(x => x.worker_code === code);
  return w ? `${w.worker_code} - ${w.worker_name}` : code;
}

function codeFromDisplay(value) {
  return String(value || "").trim().split(" - ")[0].trim().toUpperCase();
}

function isValidMachine(code) {
  return state.machines.some(m => m.machine_code === code);
}

function isValidWorker(code) {
  return state.workers.some(w => w.worker_code === code);
}

function wireNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showScreen(btn.dataset.screen);
    });
  });
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
          await api(`/api/machines/${encodeURIComponent(btn.dataset.deleteMachine)}`, { method: "DELETE", body: JSON.stringify({ delete_code: deleteCode }) });
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
          await api(`/api/workers/${encodeURIComponent(btn.dataset.deleteWorker)}`, { method: "DELETE", body: JSON.stringify({ delete_code: deleteCode }) });
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
  try {
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
  } catch (err) {
    toast(err.message, "error");
  }
}

async function toggleMachine(machineCode, isActive) {
  const machine = state.machines.find((m) => m.machine_code === machineCode);
  try {
    await api(`/api/machines/${encodeURIComponent(machineCode)}`, {
      method: "PUT",
      body: JSON.stringify({
        machine_name: machine.machine_name,
        location: machine.location || "",
        is_active: isActive,
      }),
    });
    await loadMachines();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveWorker(workerCode) {
  const worker = state.workers.find((w) => w.worker_code === workerCode);
  try {
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
  } catch (err) {
    toast(err.message, "error");
  }
}

async function toggleWorker(workerCode, isActive) {
  const worker = state.workers.find((w) => w.worker_code === workerCode);
  try {
    await api(`/api/workers/${encodeURIComponent(workerCode)}`, {
      method: "PUT",
      body: JSON.stringify({ worker_name: worker.worker_name, is_active: isActive }),
    });
    await loadWorkers();
  } catch (err) {
    toast(err.message, "error");
  }
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
    await loadPartsSummary();
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));

  $("clearPartFilterBtn")?.addEventListener("click", () => {
    if ($("partSearchKeyword")) $("partSearchKeyword").value = "";
    renderPartsTable();
  });
  // Lọc mã hàng động — dùng delegation vì input được render sau bởi renderPartsShell
  $("partsScreen")?.addEventListener("input", (e) => {
    if (e.target.id === "partSearchKeyword") renderPartsTable();
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
  const order = await api(`/api/orders/${encodeURIComponent(orderCode)}`).catch(() => null);
  if (!order) return;
  const cachedIndex = state.orders.findIndex((o) => o.order_code === order.order_code);
  if (cachedIndex >= 0) state.orders[cachedIndex] = { ...state.orders[cachedIndex], ...order };
  else state.orders.unshift(order);
  state.currentDetailOrderCode = orderCode;
  
  $("detailOrderTitle").textContent = order.order_code;
  $("detailPartCode").textContent = order.part_code;
  $("detailTotalQty").textContent = formatQty(order.total_qty);
  $("detailTotalLots").textContent = order.total_lots;
  $("detailProgress").textContent = (order.progress_percent || 0) + "%";
  const lots = order.lots || [];
  const printedCount = lots.filter(l => Number(l.printed) === 1).length;
  if ($("detailPrintedLots")) $("detailPrintedLots").textContent = printedCount;
  if ($("detailUnprintedLots")) $("detailUnprintedLots").textContent = lots.length - printedCount;
  const receivedCount = lots.filter(l => l.blank_received_by || l.blank_received_at).length;
  if ($("detailReceivedLots")) $("detailReceivedLots").textContent = receivedCount;
  if ($("detailUnreceivedLots")) $("detailUnreceivedLots").textContent = lots.length - receivedCount;
  
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
      const lotInfo = order.lots?.find((item) => item.lot_code === lot.lot_code);
      const printedHtml = lotInfo?.printed
        ? `<span class="badge done">Đã in</span>`
        : `<span class="badge todo">Chưa in</span>`;
      const receiptStatusHtml = lotInfo?.blank_received_at || lotInfo?.blank_received_by
        ? `<span class="badge done">Đã nhận</span>`
        : `<span class="badge todo">Chưa nhận</span>`;
      const receivedByHtml = lotInfo?.blank_received_by
        ? `<span class="font-semibold">${escapeHtml(lotInfo.blank_received_by)}</span>`
        : `<span class="text-slate-400">-</span>`;
      const receivedAtHtml = lotInfo?.blank_received_at
        ? `<span class="font-semibold">${escapeHtml(formatDateTimeDisplay(lotInfo.blank_received_at))}</span>`
        : `<span class="text-slate-400">-</span>`;
      
      return `
        <tr>
          <td class="mono font-bold">${lot.lot_code}</td>
          <td>${formatQty(lot.qty)}</td>
          <td>${stepsHtml}</td>
          <td>${printedHtml}</td>
          <td>${receivedByHtml}</td>
          <td>${receivedAtHtml}</td>
          <td>${receiptStatusHtml}</td>
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
  return openBulkPrintLotsModal(orderCode);
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
  await printLot(lotCode).catch((err) => toast(err.message, "error"));
  return;

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
        if (!s) return `<option value="" ${!existing?.shift ? "selected" : ""}> </option>`;
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
  const lotCode = modal?.dataset.lotCode;

  if (!lotCode) return;
  await printLot(lotCode).catch((err) => toast(err.message, "error"));
  return;
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
  const keyword = ($("orderSearchKeyword")?.value || "").trim().toUpperCase();
  const dateFrom = $("orderSearchDateFrom")?.value || "";
  const dateTo = $("orderSearchDateTo")?.value || "";

  const filtered = state.orders.filter((order) => {
    if (keyword) {
      const matchPo = order.order_code.toUpperCase().includes(keyword);
      const matchPart = order.part_code.toUpperCase().includes(keyword);
      if (!matchPo && !matchPart) return false;
    }
    if (dateFrom || dateTo) {
      const createdDate = (order.created_at || "").slice(0, 10);
      if (dateFrom && createdDate < dateFrom) return false;
      if (dateTo && createdDate > dateTo) return false;
    }
    return true;
  });

  $("ordersHistoryTable").innerHTML = filtered.map((order) => `
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
  `).join("") || `<tr><td colspan="8" class="text-slate-500">Không tìm thấy đơn hàng nào</td></tr>`;
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

function syncOrderLotsCache(order) {
  const index = state.orders.findIndex((item) => item.order_code === order.order_code);
  if (index >= 0) state.orders[index] = { ...state.orders[index], ...order };
  else state.orders.unshift(order);
}

function getBulkPrintStats(lots) {
  const total = lots.length;
  const printed = lots.filter((lot) => Number(lot.printed || 0) === 1).length;
  return { total, printed, unprinted: total - printed };
}

function updateBulkPrintPreview() {
  if (!state.bulkPrintOrder) return;
  const lots = state.bulkPrintLots || [];
  const stats = getBulkPrintStats(lots);
  const startIndex = Number($("bulkPrintStartLot")?.value || 0);
  const endIndex = Number($("bulkPrintEndLot")?.value || 0);
  const selected = startIndex > 0 && endIndex > 0 && startIndex <= endIndex
    ? lots.filter((lot) => lot.lot_index >= startIndex && lot.lot_index <= endIndex).length
    : 0;
  if ($("bulkPrintTotalLots")) $("bulkPrintTotalLots").textContent = String(stats.total);
  if ($("bulkPrintPrintedLots")) $("bulkPrintPrintedLots").textContent = String(stats.printed);
  if ($("bulkPrintUnprintedLots")) $("bulkPrintUnprintedLots").textContent = String(stats.unprinted);
  if ($("bulkPrintSelectedLots")) $("bulkPrintSelectedLots").textContent = String(selected);
  if ($("bulkPrintLotsPreview")) {
    if (!startIndex || !endIndex) {
      $("bulkPrintLotsPreview").textContent = "Nhập khoảng lô để xem số lượng sẽ in.";
    } else if (startIndex > endIndex) {
      $("bulkPrintLotsPreview").textContent = "Lô bắt đầu phải nhỏ hơn hoặc bằng lô kết thúc.";
    } else if (endIndex > stats.total) {
      $("bulkPrintLotsPreview").textContent = `Lô kết thúc không được vượt quá tổng số lô (${stats.total}).`;
    } else {
      $("bulkPrintLotsPreview").textContent = `Sẽ in ${selected} lô, từ lô ${startIndex} đến lô ${endIndex}.`;
    }
  }
}

function renderBulkPrintModal(order, lots) {
  state.bulkPrintOrder = order;
  state.bulkPrintLots = lots || [];
  $("bulkPrintLotsModalOrderCode").textContent = `${order.order_code} · ${order.part_code}`;
  $("bulkPrintStartLot").value = "1";
  $("bulkPrintEndLot").value = String((lots || []).length || 1);
  updateBulkPrintPreview();
  $("bulkPrintLotsModal").classList.remove("hidden");
}

async function openBulkPrintLotsModal(orderCode) {
  const order = await api(`/api/orders/${encodeURIComponent(orderCode)}`);
  syncOrderLotsCache(order);
  renderBulkPrintModal(order, order.lots || []);
}

async function fetchLotPrintData(lotCode) {
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
  return { lot, forms: { qc: qcForm, bavia: baviaForm, baviaWork, warehouse: warehouseForm } };
}

async function printBulkLots() {
  const order = state.bulkPrintOrder;
  if (!order) return;
  const startIndex = Number($("bulkPrintStartLot")?.value || 0);
  const endIndex = Number($("bulkPrintEndLot")?.value || 0);
  const stats = getBulkPrintStats(state.bulkPrintLots || []);
  if (!startIndex || !endIndex) return toast("Vui lòng nhập khoảng lô cần in", "warning");
  if (startIndex > endIndex) return toast("Lô bắt đầu phải nhỏ hơn hoặc bằng lô kết thúc", "warning");
  if (endIndex > stats.total) return toast(`Lô kết thúc không được vượt quá tổng số lô (${stats.total})`, "warning");

  const lotsToPrint = (state.bulkPrintLots || [])
    .filter((lot) => lot.lot_index >= startIndex && lot.lot_index <= endIndex)
    .sort((a, b) => a.lot_index - b.lot_index);
  if (!lotsToPrint.length) return toast("Không có lô nào trong khoảng đã chọn", "warning");

  const printArea = $("print-area");
  const sheets = [];
  await withLoading($("printBulkPrintLotsBtn"), async () => {
    for (const lotRef of lotsToPrint) {
      const { lot, forms } = await fetchLotPrintData(lotRef.lot_code);
      renderPrintArea(lot, forms);
      sheets.push(printArea.innerHTML);
    }

    printArea.innerHTML = sheets.join("");
    printArea.classList.remove("hidden");
    await waitForPrintImages();
    await api(`/api/orders/${encodeURIComponent(order.order_code)}/print-range`, {
      method: "POST",
      body: JSON.stringify({ start_index: startIndex, end_index: endIndex }),
    });
    state.bulkPrintLots = (state.bulkPrintLots || []).map((lot) => (
      lot.lot_index >= startIndex && lot.lot_index <= endIndex
        ? { ...lot, printed: 1 }
        : lot
    ));
    syncOrderLotsCache({ ...order, lots: state.bulkPrintLots });
    if (state.currentDetailOrderCode === order.order_code) {
      showOrderDetails(order.order_code).catch(() => {});
    }
    document.body.classList.add("printing-lot-sheet");
    window.print();
    setTimeout(() => {
      document.body.classList.remove("printing-lot-sheet");
      printArea.classList.add("hidden");
    }, 600);
    updateBulkPrintPreview();
  });
}


function formatBlankReceiptStatus(lot) {
  if (lot.blank_received_at || lot.blank_received_by) {
    const by = lot.blank_received_by ? ` · ${escapeHtml(lot.blank_received_by)}` : "";
    const at = lot.blank_received_at ? ` · ${escapeHtml(formatDateTimeDisplay(lot.blank_received_at))}` : "";
    return `<span class="badge done">Đã nhận${by}${at}</span>`;
  }
  return `<span class="badge todo">Chưa nhận</span>`;
}

function renderBlankReceiptInfo(lot) {
  if (!$("blankReceiptLotInfo")) return;
  if (!lot) {
    $("blankReceiptLotInfo").innerHTML = 'Quét hoặc nhập mã lot rồi bấm <b>Tải lot</b>.';
    return;
  }
  const receivedBy = lot.blank_received_by ? escapeHtml(lot.blank_received_by) : '<span class="text-slate-400">Chưa có</span>';
  const receivedAt = lot.blank_received_at ? escapeHtml(formatDateTimeDisplay(lot.blank_received_at)) : '<span class="text-slate-400">Chưa có</span>';
  $("blankReceiptLotInfo").innerHTML = `
    <div class="space-y-1">
      <div><b>${escapeHtml(displayLotCode(lot.lot_code))}</b> · ${escapeHtml(lot.order_code || "")} · ${escapeHtml(lot.part_code || "")}</div>
      <div>SL: ${formatQty(lot.qty_per_lot)} pcs · Trạng thái: ${formatBlankReceiptStatus(lot)}</div>
      <div>Người nhận: ${receivedBy}</div>
      <div>Thời gian: ${receivedAt}</div>
    </div>
  `;
}

function openBlankReceiptModal(defaultLotCode = "") {
  state.currentBlankReceiptLot = null;
  $("blankReceiptModalLotCode").textContent = "";
  $("blankReceiptLotInput").value = defaultLotCode ? displayLotCode(defaultLotCode) : "";
  $("blankReceiptReceiver").value = "";
  $("blankReceiptAt").value = nowLocalDateTimeInput();
  renderBlankReceiptInfo(null);
  $("blankReceiptModal").classList.remove("hidden");
  setTimeout(() => $("blankReceiptLotInput")?.focus(), 50);
}

async function loadBlankReceiptLot() {
  const inputValue = $("blankReceiptLotInput")?.value?.trim();
  if (!inputValue) return toast("Vui lòng nhập hoặc quét mã lot", "warning");
  const lotCode = lotInputToInternalCode(inputValue);
  const lot = await api(`/api/lots/${encodeURIComponent(lotCode)}`).catch(() => null);
  if (!lot) return toast("Không tìm thấy lô", "error");
  state.currentBlankReceiptLot = lot;
  $("blankReceiptModalLotCode").textContent = `${displayLotCode(lot.lot_code)} · ${lot.order_code} · ${lot.part_code}`;
  $("blankReceiptReceiver").value = lot.blank_received_by || "";
  $("blankReceiptAt").value = lot.blank_received_at ? String(lot.blank_received_at).replace(" ", "T").slice(0, 16) : nowLocalDateTimeInput();
  renderBlankReceiptInfo(lot);
}

async function saveBlankReceipt() {
  if (!state.currentBlankReceiptLot) {
    await loadBlankReceiptLot();
    if (!state.currentBlankReceiptLot) return;
  }
  const lot = state.currentBlankReceiptLot;
  const receivedBy = $("blankReceiptReceiver")?.value?.trim();
  const receivedAt = $("blankReceiptAt")?.value;
  await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/blank-receipt`, {
    method: "PUT",
    body: JSON.stringify({
      received_by: receivedBy,
      received_at: receivedAt,
    }),
  });
  toast("Đã lưu nhận phôi", "success");
  $("blankReceiptModal").classList.add("hidden");
  state.currentBlankReceiptLot = null;
  if (state.currentDetailOrderCode === lot.order_code) {
    await showOrderDetails(lot.order_code);
  } else {
    await loadOrders();
  }
}
function applyOrderToForm(order) {
  if (!order) return;
  state.editingOrderCode = order.order_code;
  $("orderCode").value = order.order_code;
  $("orderCode").readOnly = true;
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
  if ($("orderCode")) { $("orderCode").value = ""; $("orderCode").disabled = false; $("orderCode").readOnly = false; }
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

  // Tìm kiếm đơn hàng realtime
  on("orderSearchKeyword", "input", () => renderOrdersHistory());
  on("orderSearchDateFrom", "change", () => renderOrdersHistory());
  on("orderSearchDateTo", "change", () => renderOrdersHistory());
  on("clearOrderSearchBtn", "click", () => {
    if ($("orderSearchKeyword")) $("orderSearchKeyword").value = "";
    if ($("orderSearchDateFrom")) $("orderSearchDateFrom").value = "";
    if ($("orderSearchDateTo")) $("orderSearchDateTo").value = "";
    renderOrdersHistory();
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
  on("openBlankReceiptListBtn", "click", () => openBlankReceiptModal());
  on("openBlankReceiptDetailBtn", "click", () => openBlankReceiptModal());
  on("openBulkPrintLotsBtn", "click", () => {
    if (!state.currentDetailOrderCode) return toast("Chưa chọn đơn hàng", "warning");
    openBulkPrintLotsModal(state.currentDetailOrderCode).catch((err) => toast(err.message, "error"));
  });
  on("closeBlankReceiptModalBtn", "click", () => $("blankReceiptModal")?.classList.add("hidden"));
  on("cancelBlankReceiptBtn", "click", () => $("blankReceiptModal")?.classList.add("hidden"));
  on("blankReceiptModal", "click", (e) => {
    if (e.target.id === "blankReceiptModal") $("blankReceiptModal").classList.add("hidden");
  });
  on("loadBlankReceiptLotBtn", "click", () => loadBlankReceiptLot().catch((err) => toast(err.message, "error")));
  on("saveBlankReceiptBtn", "click", () => withLoading($("saveBlankReceiptBtn"), async () => {
    await saveBlankReceipt();
  }).catch((err) => toast(err.message, "error")));
  on("blankReceiptLotInput", "keydown", (e) => {
    if (e.key === "Enter") loadBlankReceiptLot().catch((err) => toast(err.message, "error"));
  });
  on("closeBulkPrintLotsModalBtn", "click", () => $("bulkPrintLotsModal")?.classList.add("hidden"));
  on("cancelBulkPrintLotsBtn", "click", () => $("bulkPrintLotsModal")?.classList.add("hidden"));
  on("bulkPrintLotsModal", "click", (e) => {
    if (e.target.id === "bulkPrintLotsModal") $("bulkPrintLotsModal").classList.add("hidden");
  });
  on("bulkPrintStartLot", "input", updateBulkPrintPreview);
  on("bulkPrintEndLot", "input", updateBulkPrintPreview);
  on("printBulkPrintLotsBtn", "click", () => {
    if (!state.currentDetailOrderCode) return toast("Chưa chọn đơn hàng", "warning");
    printBulkLots().catch((err) => toast(err.message, "error"));
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

function getQualityRowTotal(rowEl) {
  const ok = Number(rowEl.querySelector('[data-name="qty_ok"]')?.value || 0);
  const ng = Number(rowEl.querySelector('[data-name="qty_ng"]')?.value || 0);
  return ok + ng;
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

function buildLotPrintLayoutStyle(opCount) {
  const ops = Math.max(1, Number(opCount || 0));
  const processRowHeight = Math.max(8.4, Math.min(15.5, 15.5 - ((ops - 1) * 0.8)));
  const processHeadHeight = Math.max(5.8, Math.min(6.5, 6.5 - ((ops - 1) * 0.12)));
  const compactRowHeight = Math.max(8.5, Math.min(11.2, 11.2 - ((ops - 1) * 0.28)));
  const compactFontSize = ops <= 2 ? 9.2 : 9;
  const compactPadY = ops <= 2 ? 5 : 4;
  const compactPadX = ops <= 2 ? 6 : 5;
  const sectionPadY = ops <= 2 ? 0.75 : 0.5;
  return [
    `--process-row-height:${processRowHeight.toFixed(2)}mm`,
    `--process-head-height:${processHeadHeight.toFixed(2)}mm`,
    `--compact-row-height:${compactRowHeight.toFixed(2)}mm`,
    `--compact-font-size:${compactFontSize}px`,
    `--compact-pad-y:${compactPadY}px`,
    `--compact-pad-x:${compactPadX}px`,
    `--section-title-pad-y:${sectionPadY}px`,
  ].join(";");
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
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
        </tr>
      `).join("")}
    </table>
  `;
}

function renderPrintBaviaWorkSection(lot, work) {
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
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
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
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
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
  const layoutStyle = buildLotPrintLayoutStyle(steps.length);
  const qcForm = printForms.qc || {};
  const baviaWork = printForms.baviaWork || {};
  const baviaForm = printForms.bavia || {};
  const warehouseForm = printForms.warehouse || {};
  $("print-area").innerHTML = `
    <div class="lot-sheet" style="${layoutStyle}">
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
          <td class="lot-qr-cell" rowspan="5">
            <div class="material-qr-block">
              <div class="material-qr-top">S&#7889; l&#432;&#7907;ng: <b>${formatQty(lot.qty_per_lot)}</b></div>
              <div class="material-qr-main">
                <img class="print-qr lot-print-qr" src="/api/qr?text=${encodeURIComponent(visibleLotCode)}&size=120" alt="${escapeHtml(visibleLotCode)}">
                <div class="mono">${escapeHtml(visibleLotCode)}</div>
              </div>
            </div>
          </td>
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
          <td colspan="2">Ng&agrave;y xu&#7845;t ph&ocirc;i:<br><b>&nbsp;</b></td>
          <td colspan="2">S&#7889; bi&#7875;u:<br><b>${lot.lot_index}/${order.total_lots || ""}</b></td>
        </tr>
        <tr>
  <td colspan="2">Ng&#432;&#7901;i giao:<br><b>${printValue(order.delivered_by || "Kho NVL")}</b></td>
  <td colspan="2">Ng&#432;&#7901;i nh&#7853;n:<br><b></b></td>
  <td colspan="2">S&#7889; l&#432;&#7907;ng: <b>${formatQty(lot.qty_per_lot)}</b></td>
        </tr>
      </table>

      <table class="print-table process-print-table">
        <tr><th colspan="8" class="section-title">II. GIA C&Ocirc;NG</th></tr>
        ${steps.map((entry, index) => {
          const logs = Array.isArray(entry.machine_logs) && entry.machine_logs.length ? entry.machine_logs : [null];
          return `
          <tbody class="step-block">
            <tr><td colspan="8" class="op-title">${index + 1}. OP${index + 1}:</td></tr>
            <tr class="process-head">
              <th>Ng&agrave;y</th><th>K&iacute;p</th><th>M&aacute;y</th><th>K&#7929; thu&#7853;t</th><th>Ng&#432;&#7901;i l&agrave;m</th><th>OK</th><th>NG</th><th>Ghi ch&uacute;</th>
            </tr>
            ${logs.map(() => `
                <tr class="process-write-row">
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                </tr>
              `).join("")}
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
          <button class="btn mini secondary" data-add-machine-row="${entry.form_id}">+ Chuyển máy/ Kíp</button>
        </div>
        <div id="machineRows-${entry.form_id}" class="machine-card-grid"></div>
        <div class="calc-line mt-1 font-bold"></div><div class="error-text hidden"></div>
        <div class="mt-1 flex items-center justify-between gap-2">
          <div class="save-state text-sm font-bold text-slate-500">Đã lưu</div>
          <button class="btn primary" data-save-machine-form="${entry.form_id}">Lưu sản lượng</button>
        </div>
      </div>
    </div>
  `;
}

function emptyMachineRow(formId) {
  return { form_id: formId, line_index: "", machine_code: "", tech_code: "", worker_code: "", work_date: "", shift: "", qty_ok: 0, qty_ng: 0, note: "", _temp: true };
}

function renderMachineRows(formId, rows, qtyPerLot) {
  const container = $(`machineRows-${formId}`);
  container.dataset.rows = JSON.stringify(rows);
  container.innerHTML = rows.map((row, index) => `
    <div class="machine-row" data-machine-line="${row.line_index || ""}" data-temp="${row._temp ? 1 : 0}">
      <div class="machine-row-head">
        <span class="badge ${index ? "partial" : "todo"}">${index ? `Chuyển máy ${index + 1}` : "Máy chính"}</span>
        <button class="btn mini danger machine-delete-btn" data-delete-machine-row>Xóa</button>
      </div>
      <div class="machine-row-grid">
        <div class="machine-field">
          <label class="field-label">Ngày</label>
          <input class="input mini-input machine-log-field w-full" data-name="work_date" type="date" value="${row.work_date || ""}">
        </div>
        <div class="machine-field">
          <label class="field-label">Kíp</label>
          <select class="input mini-input machine-log-field w-full" data-name="shift">
            ${["", "KÍP 1", "KÍP 2","TĂNG CA"].map((s) => s ? `<option value="${s}" ${row.shift === s ? "selected" : ""}>${s}</option>` : `<option value="" disabled hidden ${!row.shift ? "selected" : ""}>Kíp</option>`).join("")}
          </select>
        </div>
        <div class="machine-field">
          <label class="field-label">Máy</label>
          <input list="machineDatalist" class="input mini-input machine-log-field w-full" data-name="machine_code" placeholder="Chọn máy" value="${getMachineDisplayName(row.machine_code)}">
        </div>
        <div class="machine-field">
          <label class="field-label">Kỹ thuật</label>
          <input list="workerDatalist" class="input mini-input machine-log-field w-full" data-name="tech_code" placeholder="Chọn NV" value="${getWorkerDisplayName(row.tech_code)}">
        </div>
        <div class="machine-field">
          <label class="field-label">Người làm</label>
          <input list="workerDatalist" class="input mini-input machine-log-field w-full" data-name="worker_code" placeholder="Chọn NV" value="${getWorkerDisplayName(row.worker_code)}">
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
          <textarea class="input mini-input machine-log-field machine-note-input w-full" data-name="note" rows="2" placeholder="Nhập ghi chú...">${escapeHtml(row.note || "")}</textarea>
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
      if (field.dataset.name === "machine_code" || field.dataset.name === "worker_code" || field.dataset.name === "tech_code") {
        val = codeFromDisplay(val);
      }
      row[field.dataset.name] = val;
    });
    return row;
  });
}

async function persistMachineRow(formId, row, qtyPerLot) {
  if (!row.machine_code || !row.worker_code) return false;
  if (!isValidMachine(row.machine_code) || !isValidWorker(row.worker_code)) return false;
  if (row.tech_code && !isValidWorker(row.tech_code)) return false;
  const total = collectMachineRows(formId).reduce((sum, item) => sum + Number(item.qty_ok || 0) + Number(item.qty_ng || 0), 0);
  if (total > qtyPerLot) {
    throw new Error(`Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)`);
  }
  const payload = {
    machine_code: row.machine_code,
    tech_code: row.tech_code || "",
    worker_code: row.worker_code,
    work_date: row.work_date || null,
    shift: row.shift || "",
    qty_ok: row.qty_ok,
    qty_ng: row.qty_ng,
    note: row.note || "",
    technical_info: row.technical_info || "",
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
  card.querySelector(".calc-line").textContent = `OK: ${totalOk} + NG: ${totalNg} = ${total} / ${formatQty(qtyPerLot)} · Còn thiếu ${Math.max(qtyPerLot - total, 0)}`;
  const error = total > qtyPerLot ? `Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)` : "";
  card.querySelector(".error-text").textContent = error;
  card.querySelector(".error-text").classList.toggle("hidden", !error);

  const saveStateEl = card.querySelector(".save-state");
  if (saveStateEl && saveStateEl.textContent === "Đã lưu") {
    saveStateEl.textContent = "Chưa lưu...";
    saveStateEl.className = "save-state text-sm font-bold text-orange-500";
  }

  return !error;
}

function wireMachineRowEvents(formId, qtyPerLot) {
  const container = $(`machineRows-${formId}`);
  container.querySelectorAll(".machine-log-field").forEach((field) => {
    field.addEventListener("input", () => updateMachineTotal(formId, qtyPerLot));
    field.addEventListener("change", () => {
      syncNextMachineOps(formId);
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
    rows.push({ ...emptyMachineRow(formId) });
    renderMachineRows(formId, rows, qtyPerLot);
    syncNextMachineOps(formId);
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

function syncNextMachineOps(sourceFormId) {
  if (!state.currentLot || !state.currentLot.entries) return;
  const entries = state.currentLot.entries;
  const sourceIndex = entries.findIndex((e) => e.form_id === sourceFormId);
  if (sourceIndex === -1) return;

  const sourceContainer = $(`machineRows-${sourceFormId}`);
  if (!sourceContainer) return;

  const fields = ["work_date", "shift", "tech_code", "worker_code"];

  for (let j = sourceIndex + 1; j < entries.length; j++) {
    const targetFormId = entries[j].form_id;
    const targetContainer = $(`machineRows-${targetFormId}`);
    if (!targetContainer) continue;

    const targetRows = collectMachineRows(targetFormId);
    if (targetRows.length === 1 && targetRows[0]._temp && !targetRows[0].qty_ok && !targetRows[0].qty_ng) {
      fields.forEach((field) => {
        const input = targetContainer.querySelector(`.machine-row:first-child .machine-log-field[data-name="${field}"]`);
        const sourceInput = sourceContainer.querySelector(`.machine-row:last-child .machine-log-field[data-name="${field}"]`);
        if (input && sourceInput && sourceInput.value) {
          input.value = sourceInput.value;
        }
      });
    } else {
      break;
    }
  }
}

function setSaveStateSuccess(formId) {
  const saveStateEl = document.querySelector(`[data-form-id="${formId}"] .save-state`);
  if (saveStateEl) {
    saveStateEl.textContent = "Đã lưu";
    saveStateEl.className = "save-state text-sm font-bold text-green-600";
  }
}

function updateOpStatus(formId, qtyPerLot) {
  const rows = collectMachineRows(formId);
  const total = rows.reduce((sum, row) => sum + Number(row.qty_ok || 0) + Number(row.qty_ng || 0), 0);
  const hasSavedRow = rows.some(r => r.line_index || r.machine_code || r.worker_code);
  let status = "todo";
  if (total > 0 || hasSavedRow) status = "partial";
  if (total >= qtyPerLot) status = "done";

  const card = document.querySelector(`[data-form-id="${formId}"]`);
  if (card) {
    card.classList.remove("card-todo", "card-partial", "card-done");
    card.classList.add(`card-${status}`);
    const badge = card.querySelector(".badge");
    if (badge) {
      badge.classList.remove("todo", "partial", "done");
      badge.classList.add(status);
      badge.textContent = badge.textContent.replace(/·.*/, `· ${statusText(status)}`);
    }
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
  setSaveStateSuccess(formId);
  updateOpStatus(formId, qtyPerLot);
  if (state.currentLot?.lot_code) {
    loadOrders().catch(console.error);
    // Cập nhật lại QC gia công để hiển thị max_qty mới nhất
    renderLotQcPanel(state.currentLot, "qc").catch(console.error);
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
  setSaveStateSuccess(formId);
  updateOpStatus(formId, qtyPerLot);
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
  setSaveStateSuccess(formId);
  updateOpStatus(formId, qtyPerLot);
  if (state.currentLot?.lot_code) {
    loadOrders().catch(console.error);
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
  ].map(([value, label]) => `<button class="lot-mode-btn ${mode === value ? "active" : ""}" data-lot-mode="${value}">${label}</button>`).join("");
}

function setLotMode(mode) {
  const nextMode = ["gia_cong", "bavia"].includes(mode) ? mode : "gia_cong";
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

function emptyBaviaMachineRow(lotCode) {
  return { lot_code: lotCode, line_index: "", machine_code: "", tech_code: "", worker_code: "", work_date: "", shift: "", qty_ok: 0, qty_ng: 0, note: "", _temp: true };
}

function renderBaviaMachineRows(lotCode, rows, qtyPerLot) {
  const container = $("baviaMachineRows");
  if (!container) return;
  container.dataset.rows = JSON.stringify(rows);
  container.innerHTML = rows.map((row, index) => `
    <div class="machine-row" data-machine-line="${row.line_index || ""}" data-temp="${row._temp ? 1 : 0}">
      <div class="machine-row-head">
        <span class="badge ${index ? "partial" : "todo"}">${index ? `Chuyển máy ${index + 1}` : "Máy chính"}</span>
        <button class="btn mini danger machine-delete-btn" data-delete-bavia-machine-row>Xóa</button>
      </div>
      <div class="machine-row-grid">
        <div class="machine-field">
          <label class="field-label">Ngày</label>
          <input class="input mini-input bavia-machine-field w-full" data-name="work_date" type="date" value="${row.work_date || ""}">
        </div>
        <div class="machine-field">
          <label class="field-label">Kíp</label>
          <select class="input mini-input bavia-machine-field w-full" data-name="shift">
            ${["", "KÍP 1", "KÍP 2", "TĂNG CA"].map((s) => s ? `<option value="${s}" ${row.shift === s ? "selected" : ""}>${s}</option>` : `<option value="" disabled hidden ${!row.shift ? "selected" : ""}>Kíp</option>`).join("")}
          </select>
        </div>
        <div class="machine-field">
          <label class="field-label">Máy</label>
          <input list="machineDatalist" class="input mini-input bavia-machine-field w-full" data-name="machine_code" placeholder="Chọn máy" value="${getMachineDisplayName(row.machine_code)}">
        </div>
        <div class="machine-field">
          <label class="field-label">Kỹ thuật</label>
          <input list="workerDatalist" class="input mini-input bavia-machine-field w-full" data-name="tech_code" placeholder="Chọn NV" value="${getWorkerDisplayName(row.tech_code)}">
        </div>
        <div class="machine-field">
          <label class="field-label">Người làm</label>
          <input list="workerDatalist" class="input mini-input bavia-machine-field w-full" data-name="worker_code" placeholder="Chọn NV" value="${getWorkerDisplayName(row.worker_code)}">
        </div>
        <div class="machine-field machine-num-field">
          <label class="field-label">OK</label>
          <input class="input mini-input bavia-machine-field ok-input w-full" data-name="qty_ok" type="number" min="0" step="1" value="${row.qty_ok || 0}">
        </div>
        <div class="machine-field machine-num-field">
          <label class="field-label">NG</label>
          <input class="input mini-input bavia-machine-field ng-input w-full" data-name="qty_ng" type="number" min="0" step="1" value="${row.qty_ng || 0}">
        </div>
        <div class="machine-field machine-note-field">
          <label class="field-label">Ghi chú</label>
          <textarea class="input mini-input bavia-machine-field machine-note-input w-full" data-name="note" rows="2" placeholder="Nhập ghi chú...">${escapeHtml(row.note || "")}</textarea>
        </div>
      </div>
    </div>
  `).join("");
  wireBaviaMachineRowEvents(lotCode, qtyPerLot);
  updateBaviaMachineTotal(lotCode, qtyPerLot);
}

function collectBaviaMachineRows(lotCode) {
  const container = $("baviaMachineRows");
  if (!container) return [];
  return Array.from(container.querySelectorAll(".machine-row")).map((el) => {
    const row = { lot_code: lotCode, line_index: el.dataset.machineLine ? Number(el.dataset.machineLine) : "", _temp: el.dataset.temp === "1" };
    el.querySelectorAll(".bavia-machine-field").forEach((field) => {
      let val = ["qty_ok", "qty_ng"].includes(field.dataset.name) ? Number(field.value || 0) : field.value;
      if (field.dataset.name === "machine_code" || field.dataset.name === "worker_code" || field.dataset.name === "tech_code") {
        val = codeFromDisplay(val);
      }
      row[field.dataset.name] = val;
    });
    return row;
  });
}

async function persistBaviaMachineRow(lotCode, row, qtyPerLot) {
  if (!row.machine_code || !row.worker_code) return false;
  if (!isValidMachine(row.machine_code) || !isValidWorker(row.worker_code)) return false;
  if (row.tech_code && !isValidWorker(row.tech_code)) return false;

  const total = collectBaviaMachineRows(lotCode).reduce((sum, item) => sum + Number(item.qty_ok || 0) + Number(item.qty_ng || 0), 0);
  if (total > qtyPerLot) {
    throw new Error(`Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)`);
  }
  const payload = {
    machine_code: row.machine_code,
    tech_code: row.tech_code || "",
    worker_code: row.worker_code,
    work_date: row.work_date || null,
    shift: row.shift || "",
    qty_ok: row.qty_ok,
    qty_ng: row.qty_ng,
    note: row.note || "",
  };
  const saved = row.line_index
    ? await api(`/api/lots/${encodeURIComponent(lotCode)}/bavia-work/rows/${row.line_index}`, { method: "PUT", body: JSON.stringify(payload) })
    : await api(`/api/lots/${encodeURIComponent(lotCode)}/bavia-work/rows`, { method: "POST", body: JSON.stringify(payload) });
  return saved;
}

function updateBaviaMachineTotal(lotCode, qtyPerLot) {
  const rows = collectBaviaMachineRows(lotCode);
  const totalOk = rows.reduce((sum, row) => sum + Number(row.qty_ok || 0), 0);
  const totalNg = rows.reduce((sum, row) => sum + Number(row.qty_ng || 0), 0);
  const total = totalOk + totalNg;
  const panel = $("lotBaviaPanel");
  if (!panel) return true;
  const calcLine = panel.querySelector(".calc-line");
  const errorText = panel.querySelector(".error-text");
  if (calcLine) calcLine.textContent = `OK: ${totalOk} + NG: ${totalNg} = ${total} / ${formatQty(qtyPerLot)} · Còn thiếu ${Math.max(qtyPerLot - total, 0)}`;
  const error = total > qtyPerLot ? `Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)` : "";
  if (errorText) {
    errorText.textContent = error;
    errorText.classList.toggle("hidden", !error);
  }

  const saveStateEl = panel.querySelector(".save-state");
  if (saveStateEl && saveStateEl.textContent === "Đã lưu") {
    saveStateEl.textContent = "Chưa lưu...";
    saveStateEl.className = "save-state text-sm font-bold text-orange-500";
  }

  return !error;
}

function wireBaviaMachineRowEvents(lotCode, qtyPerLot) {
  const container = $("baviaMachineRows");
  if (!container) return;
  const suppressKey = `bavia:${lotCode}`;
  container.querySelectorAll(".bavia-machine-field").forEach((field) => {
    field.addEventListener("input", () => updateBaviaMachineTotal(lotCode, qtyPerLot));
    field.addEventListener("change", () => {
      if (state.machineSaveSuppressBlur.has(suppressKey)) return;
      saveBaviaMachineRow(lotCode, field.closest(".machine-row"), qtyPerLot).catch((err) => toast(err.message, "error"));
    });
  });
  container.querySelectorAll("[data-delete-bavia-machine-row]").forEach((btn) => {
    btn.addEventListener("click", () => deleteBaviaMachineRow(lotCode, btn.closest(".machine-row"), qtyPerLot));
  });
  const addBtn = $("addBaviaMachineRow");
  if (addBtn) {
    addBtn.onclick = () => {
      if (!updateBaviaMachineTotal(lotCode, qtyPerLot)) return;
      const rows = collectBaviaMachineRows(lotCode);
      const total = rows.reduce((sum, row) => sum + Number(row.qty_ok || 0) + Number(row.qty_ng || 0), 0);
      if (total >= qtyPerLot) return toast("Lô đã đủ số lượng, không cần thêm máy", "info");
      rows.push({ ...emptyBaviaMachineRow(lotCode) });
      renderBaviaMachineRows(lotCode, rows, qtyPerLot);
    };
  }
  const saveAllBtn = $("saveBaviaMachineForm");
  if (saveAllBtn) {
    saveAllBtn.addEventListener("pointerdown", () => state.machineSaveSuppressBlur.add(suppressKey));
    saveAllBtn.onclick = () => withLoading(saveAllBtn, async () => {
      try {
        await saveAllBaviaMachineRows(lotCode, qtyPerLot);
        toast("Đã lưu sản lượng", "success");
      } finally {
        state.machineSaveSuppressBlur.delete(suppressKey);
      }
    }).catch((err) => toast(err.message, "error"));
  }
}

async function saveAllBaviaMachineRows(lotCode, qtyPerLot) {
  if (!updateBaviaMachineTotal(lotCode, qtyPerLot)) {
    throw new Error($("lotBaviaPanel")?.querySelector(".error-text")?.textContent?.trim() || `Tổng OK + NG vượt quá số lượng lô (${qtyPerLot} cái)`);
  }
  const rowEls = Array.from($("baviaMachineRows")?.querySelectorAll(".machine-row") || []);
  const rows = collectBaviaMachineRows(lotCode);
  for (let index = 0; index < rows.length; index += 1) {
    const saved = await persistBaviaMachineRow(lotCode, rows[index], qtyPerLot);
    if (saved?.line_index && rowEls[index]) {
      rowEls[index].dataset.machineLine = String(saved.line_index);
      rowEls[index].dataset.temp = "0";
    }
  }
  const saveStateEl = $("lotBaviaPanel")?.querySelector(".save-state");
  if (saveStateEl) {
    saveStateEl.textContent = "Đã lưu";
    saveStateEl.className = "save-state text-sm font-bold text-green-600";
  }
  loadOrders().catch(console.error);
  // Cập nhật lại QC Bavia để hiển thị max_qty mới nhất
  const lot = state.currentLot;
  if (lot) {
    renderLotQcPanel(lot, "bavia").catch(console.error);
  }
}

async function saveBaviaMachineRow(lotCode, tr, qtyPerLot) {
  if (!updateBaviaMachineTotal(lotCode, qtyPerLot)) return;
  const rows = collectBaviaMachineRows(lotCode);
  const index = Array.from(tr.parentElement.querySelectorAll(".machine-row")).indexOf(tr);
  const row = rows[index];
  const saved = await persistBaviaMachineRow(lotCode, row, qtyPerLot);
  if (saved?.line_index) {
    tr.dataset.machineLine = String(saved.line_index);
    tr.dataset.temp = "0";
  }
  const saveStateEl = $("lotBaviaPanel")?.querySelector(".save-state");
  if (saveStateEl) {
    saveStateEl.textContent = "Đã lưu";
    saveStateEl.className = "save-state text-sm font-bold text-green-600";
  }
}

async function deleteBaviaMachineRow(lotCode, tr, qtyPerLot) {
  const lineIndex = tr.dataset.machineLine;
  if (lineIndex) await api(`/api/lots/${encodeURIComponent(lotCode)}/bavia-work/rows/${lineIndex}`, { method: "DELETE" });
  const rows = collectBaviaMachineRows(lotCode).filter((_, index) => index !== Array.from(tr.parentElement.querySelectorAll(".machine-row")).indexOf(tr));
  renderBaviaMachineRows(lotCode, rows.length ? rows : [emptyBaviaMachineRow(lotCode)], qtyPerLot);
  const saveStateEl = $("lotBaviaPanel")?.querySelector(".save-state");
  if (saveStateEl) {
    saveStateEl.textContent = "Đã lưu";
    saveStateEl.className = "save-state text-sm font-bold text-green-600";
  }
  loadOrders().catch(console.error);
}

async function renderLotBaviaWorkPanel(lot) {
  const panel = $("lotBaviaPanel");
  if (!panel || !lot) return;
  const work = await api(`/api/lots/${encodeURIComponent(lot.lot_code)}/bavia-work`).catch(() => ({}));
  const rows = work.rows || [];
  panel.className = "lot-bavia-panel";
  panel.innerHTML = `
    <div class="panel">
      <div class="lot-bavia-title">Bavia</div>
      <div class="lot-bavia-meta">Lô: ${displayLotCode(lot.lot_code)} · ${lot.part_code}</div>
      <div class="machine-log-box">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="font-extrabold text-sm">Máy thực hiện / Chuyển máy</div>
          <button id="addBaviaMachineRow" class="btn mini secondary">+ Chuyển máy/ Kíp</button>
        </div>
        <div id="baviaMachineRows" class="machine-card-grid"></div>
        <div class="calc-line mt-1 font-bold"></div><div class="error-text hidden"></div>
        <div class="mt-1 flex items-center justify-between gap-2">
          <div class="save-state text-sm font-bold text-slate-500">Đã lưu</div>
          <button id="saveBaviaMachineForm" class="btn primary">Lưu sản lượng</button>
        </div>
      </div>
    </div>
  `;
  renderBaviaMachineRows(lot.lot_code, rows.length ? rows : [emptyBaviaMachineRow(lot.lot_code)], lot.qty_per_lot);
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
  return `<input list="workerDatalist" class="input quality-field w-full" data-name="inspector" placeholder="Chọn NV" value="${getWorkerDisplayName(selectedValue)}" required>`;
}

function workerSelectHtml(selectedValue = "", dataName = "performer") {
  return `<input list="workerDatalist" class="input warehouse-field w-full" data-name="${dataName}" placeholder="Chọn NV" value="${getWorkerDisplayName(selectedValue)}" required>`;
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
      let value = field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng"
        ? Number(field.value || 0)
        : field.value;
      if (field.dataset.name === "inspector") {
        value = codeFromDisplay(value);
      }
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
      <span>${kind === "bavia" ? "Bavia" : "Công đoạn cuối: " + escapeHtml(form.last_step_name || "Chưa có")}</span>
      <span>${kind === "bavia" ? "Sản lượng Bavia" : "KQ cuối"}: ${formatQty(form.last_step_ok || 0)} OK + ${formatQty(form.last_step_ng || 0)} NG</span>
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
    // Kiểm tra: tổng OK+NG bước sau không được vượt số lượng OK bước trước
    const activeRows = rows.filter((r) => Number(r.qty_ok || 0) + Number(r.qty_ng || 0) > 0);
    for (let i = 1; i < activeRows.length; i++) {
      const prevOk = Number(activeRows[i - 1].qty_ok || 0);
      const currTotal = Number(activeRows[i].qty_ok || 0) + Number(activeRows[i].qty_ng || 0);
      if (currTotal > prevOk) {
        throw new Error(`Bước ${i + 1}: tổng OK+NG (${currTotal}) không được vượt quá số lượng OK bước trước (${prevOk})`);
      }
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
      let value = field.dataset.name === "qty_ok" || field.dataset.name === "qty_ng"
        ? Number(field.value || 0)
        : field.value;
      if (field.dataset.name === "performer") {
        value = codeFromDisplay(value);
      }
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
  `;
  const showGiaCong = mode === "gia_cong";
  const showBavia = mode === "bavia";

  $("entryCards").classList.toggle("hidden", !showGiaCong);
  $("lotBaviaPanel").classList.toggle("hidden", !showBavia);
  $("lotQcPanel").classList.toggle("hidden", false);

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
  on("loadLotBtn", "click", () => {
    state.lotSearchClearOnBlur = true;
    loadLot();
  });
  on("scanLotCode", "keydown", (e) => {
    if (e.key === "Enter") {
      state.lotSearchClearOnBlur = true;
      loadLot();
    }
  });
  $("lotSearchBox")?.addEventListener("focusout", (e) => {
    if (!state.lotSearchClearOnBlur) return;
    if (e.relatedTarget && $("lotSearchBox")?.contains(e.relatedTarget)) return;
    const input = $("scanLotCode");
    if (input) input.value = "";
    state.lotSearchClearOnBlur = false;
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
  setupReportTables();
  const qs = reportQueryString();
  const [summaryRes, machinesRes] = await Promise.all([
    api(`/api/reports/summary${qs ? `?${qs}` : ""}`),
    api(`/api/reports/machines${qs ? `?${qs}` : ""}`),
  ].map((p) => p.catch((err) => ({ __error: err }))));
  const summary = summaryRes.__error ? [] : summaryRes;
  const machines = machinesRes.__error ? [] : machinesRes;
  if (summaryRes.__error) toast(summaryRes.__error.message, "error");
  if (machinesRes.__error) toast(machinesRes.__error.message, "error");
  renderReportCards(summary, machines);
  const select = $("reportOrderSelect");
  if (select) {
    const current = select.value;
    select.innerHTML = summary.length
      ? summary.map((row) => `<option value="${row.order_code}">${row.order_code} · ${row.part_code}</option>`).join("")
      : `<option value="">Chưa có đơn hàng</option>`;
    const nextValue = current && summary.some((row) => row.order_code === current) ? current : (summary[0]?.order_code || "");
    select.value = nextValue;
  }
  $("summaryTable").innerHTML = summary.map((row) => `
    <tr class="${row.ng_rate > 5 ? "ng-high" : ""}">
      <td class="mono font-bold">${escapeHtml(row.order_code || "")}</td>
      <td>${escapeHtml(row.part_code || "")}</td>
      <td class="text-center">${formatQty(row.total_qty)}</td>
      <td class="text-center">${formatQty(row.total_lots)}</td>
      <td class="text-center">${formatQty(row.lots_done)}/${formatQty(row.total_lots)}</td>
      <td class="text-center font-bold text-green-700">${formatQty(row.total_ok)}</td>
      <td class="text-center font-bold text-red-700">${formatQty(row.total_ng)}</td>
      <td class="text-center font-bold text-blue-700">${formatQty(row.total_receipted)}</td>
      <td class="text-center">${row.ng_rate}%</td>
      <td class="text-center">${row.ng_rate > 5 ? `<span class="badge error">Cảnh báo NG cao</span>` : `<span class="badge done">Bình thường</span>`}</td>
    </tr>
  `).join("") || `<tr><td colspan="10" class="text-slate-500">Chưa có dữ liệu</td></tr>`;
  renderMachineReport(machines);
  if (select?.value) await loadOrderDetail(select.value);
}

async function loadOrderDetail(orderCode) {
  if (!orderCode) {
    $("detailTable").innerHTML = `<tr><td colspan="10" class="text-slate-500">Chưa có đơn hàng</td></tr>`;
    return;
  }
  const qs = reportQueryString();
  const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}${qs ? `?${qs}` : ""}`);
  $("detailTable").innerHTML = rows.map((row) => `
    <tr class="${row.status || "todo"}">
      <td class="mono font-bold">${displayLotCode(row.lot_code)}</td>
      <td>${row.step_name || "Chưa khởi tạo"}</td>
      <td><span class="badge ${row.status || "todo"}">${statusText(row.status || "todo")}</span></td>
      <td>${escapeHtml(row.worker_name || "")}</td>
      <td>${escapeHtml(row.tech_name || "")}</td>
      <td>${row.machines_used || ""}</td>
      <td class="font-bold text-green-700">${formatQty(row.qty_ok)}</td>
      <td class="font-bold text-red-700">${formatQty(row.qty_ng)}</td>
      <td>${escapeHtml(row.work_date || "")}</td>
      <td>${escapeHtml(row.shift || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="10" class="text-slate-500">Không có dữ liệu trong khoảng thời gian này</td></tr>`;
}

async function loadMachineReport() {
  setupReportTables();
  const qs = reportQueryString();
  const rows = await api(`/api/reports/machines${qs ? `?${qs}` : ""}`);
  renderMachineReport(rows);
}

function wireReports() {
  ensureReportMachineTab();
  setupReportTables();
  on("refreshReportBtn", "click", () => loadReports().catch((err) => toast(err.message, "error")));
  on("applyReportFilterBtn", "click", () => loadReports().catch((err) => toast(err.message, "error")));
  on("clearReportFilterBtn", "click", () => {
    setReportDateRange("", "");
    loadReports().catch((err) => toast(err.message, "error"));
  });
  on("reportTodayBtn", "click", () => {
    reportTodayRange();
    loadReports().catch((err) => toast(err.message, "error"));
  });
  on("reportMonthBtn", "click", () => {
    reportMonthRange();
    loadReports().catch((err) => toast(err.message, "error"));
  });
  on("reportYearBtn", "click", () => {
    reportYearRange();
    loadReports().catch((err) => toast(err.message, "error"));
  });
  on("reportOrderSelect", "change", (e) => loadOrderDetail(e.target.value));
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".report-tab").forEach((x) => x.classList.add("hidden"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.remove("hidden");
      if (btn.dataset.tab === "machineTab") loadMachineReport().catch((err) => toast(err.message, "error"));
    });
  });
}

function getPartSummaryFilters() {
  return {};
}

function reportFilters() {
  return {
    date_from: $("reportDateFrom")?.value || "",
    date_to: $("reportDateTo")?.value || "",
  };
}

function reportQueryString() {
  const params = new URLSearchParams();
  const { date_from, date_to } = reportFilters();
  if (date_from) params.set("date_from", date_from);
  if (date_to) params.set("date_to", date_to);
  return params.toString();
}

function setReportDateRange(dateFrom, dateTo) {
  if ($("reportDateFrom")) $("reportDateFrom").value = dateFrom || "";
  if ($("reportDateTo")) $("reportDateTo").value = dateTo || "";
}

function reportTodayRange() {
  const d = today();
  setReportDateRange(d, d);
}

function reportMonthRange() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toText = `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`;
  setReportDateRange(from, toText);
}

function reportYearRange() {
  const now = new Date();
  const year = now.getFullYear();
  setReportDateRange(`${year}-01-01`, `${year}-12-31`);
}

function ensureReportMachineTab() {
  if ($("machineTab")) return;
  const detailTab = $("detailTab");
  if (!detailTab) return;
  detailTab.insertAdjacentHTML("afterend", `
    <div id="machineTab" class="report-tab hidden">
      <div class="legend-box mb-4">
        <span class="legend-chip bg-blue-100 text-blue-800 border-blue-200">Hiệu suất máy</span>
        <span>Tính theo tổng cycle time quy đổi chia cho 11 tiếng.</span>
      </div>
      <div class="table-wrap">
        <table class="data-table warehouse-table">
          <thead>
            <tr><th class="text-center">Máy</th><th class="text-center">Tên máy</th><th class="text-center">Số log</th><th class="text-center">Số lô</th><th class="text-center">Số đơn</th><th class="text-center">Sản lượng</th><th class="text-center">Cycle time quy đổi</th><th class="text-center">Hiệu suất</th></tr>
          </thead>
          <tbody id="machineTable"></tbody>
        </table>
      </div>
    </div>
  `);
  const detailButton = document.querySelector('[data-tab="detailTab"]');
  if (detailButton && !document.querySelector('[data-tab="machineTab"]')) {
    detailButton.insertAdjacentHTML("afterend", '<button class="tab-btn" data-tab="machineTab">Hiệu suất máy</button>');
  }
}

function setupReportTables() {
  const summaryHead = document.querySelector("#summaryTab table thead");
  if (summaryHead && !summaryHead.dataset.ready) {
    summaryHead.innerHTML = `
      <tr>
        <th class="text-center">Mã PO</th>
        <th class="text-center">Mã hàng</th>
        <th class="text-center">Tổng SL</th>
        <th class="text-center">Số lô</th>
        <th class="text-center">Hoàn thành</th>
        <th class="text-center">OK</th>
        <th class="text-center">NG</th>
        <th class="text-center">Đã vào kho</th>
        <th class="text-center">Tỷ lệ NG</th>
        <th class="text-center">Đánh giá</th>
      </tr>
    `;
    summaryHead.dataset.ready = "1";
  }
  const detailHead = document.querySelector("#detailTab table thead");
  if (detailHead && !detailHead.dataset.ready) {
    detailHead.innerHTML = `
      <tr>
        <th class="text-center">Lô</th>
        <th class="text-center">Công đoạn</th>
        <th class="text-center">Trạng thái</th>
        <th class="text-center">Người làm</th>
        <th class="text-center">Kỹ thuật</th>
        <th class="text-center">Máy thực hiện</th>
        <th class="text-center">OK</th>
        <th class="text-center">NG</th>
        <th class="text-center">Ngày</th>
        <th class="text-center">Kíp</th>
      </tr>
    `;
    detailHead.dataset.ready = "1";
  }
}

function renderReportCards(summary, machines) {
  const el = $("reportCards");
  if (!el) return;
  const totalOrders = summary.length;
  const totalQty = summary.reduce((sum, row) => sum + Number(row.total_qty || 0), 0);
  const totalOk = summary.reduce((sum, row) => sum + Number(row.total_ok || 0), 0);
  const totalNg = summary.reduce((sum, row) => sum + Number(row.total_ng || 0), 0);
  const totalWarehoused = summary.reduce((sum, row) => sum + Number(row.total_receipted || 0), 0);
  const ngRate = totalOk + totalNg ? Math.round((totalNg * 10000) / (totalOk + totalNg)) / 100 : 0;
  const topNg = summary.reduce((best, row) => (!best || Number(row.total_ng || 0) > Number(best.total_ng || 0) ? row : best), null);
  const avgMachineEff = machines.length
    ? Math.round((machines.reduce((sum, row) => sum + Number(row.efficiency_percent || 0), 0) / machines.length) * 100) / 100
    : 0;
  el.innerHTML = `
    <div class="report-card"><div class="report-card-label">Số đơn hàng</div><div class="report-card-value">${formatQty(totalOrders)}</div><div class="report-card-note">Theo bộ lọc hiện tại</div></div>
    <div class="report-card"><div class="report-card-label">Tổng sản lượng</div><div class="report-card-value">${formatQty(totalQty)}</div><div class="report-card-note">Tổng số lượng của các đơn</div></div>
    <div class="report-card"><div class="report-card-label">Tổng OK</div><div class="report-card-value text-green-700">${formatQty(totalOk)}</div><div class="report-card-note">Theo QC sản xuất</div></div>
    <div class="report-card"><div class="report-card-label">Tổng NG</div><div class="report-card-value text-red-700">${formatQty(totalNg)}</div><div class="report-card-note">Theo QC sản xuất</div></div>
    <div class="report-card"><div class="report-card-label">Đã vào kho</div><div class="report-card-value text-blue-700">${formatQty(totalWarehoused)}</div><div class="report-card-note">Phiếu nhập kho thành phẩm</div></div>
    <div class="report-card"><div class="report-card-label">Đơn NG nhiều nhất</div><div class="report-card-value">${escapeHtml(topNg ? topNg.order_code : "—")}</div><div class="report-card-note">${topNg ? `${topNg.total_ng} NG · ${topNg.ng_rate}%` : "Chưa có dữ liệu"}</div></div>
    <div class="report-card"><div class="report-card-label">Tỷ lệ NG TB</div><div class="report-card-value">${ngRate}%</div><div class="report-card-note">Tổng NG / (OK + NG)</div></div>
    <div class="report-card"><div class="report-card-label">Hiệu suất máy TB</div><div class="report-card-value">${avgMachineEff}%</div><div class="report-card-note">Theo cycle time quy đổi</div></div>
  `;
}

function renderMachineReport(rows) {
  const tbody = $("machineTable");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-slate-500">Chưa có dữ liệu máy</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td class="mono font-bold">${escapeHtml(row.machine_code || "")}</td>
      <td>${escapeHtml(row.machine_name || "")}</td>
      <td class="text-center">${formatQty(row.log_count)}</td>
      <td class="text-center">${formatQty(row.lot_count)}</td>
      <td class="text-center">${formatQty(row.order_count)}</td>
      <td class="text-center font-semibold">${formatQty(row.total_qty)}</td>
      <td class="text-center">${Math.round(Number(row.total_cycle_seconds || 0))}s</td>
      <td class="text-center font-bold ${Number(row.efficiency_percent || 0) >= 100 ? "text-green-700" : "text-blue-700"}">${Number(row.efficiency_percent || 0)}%</td>
    </tr>
  `).join("");
}

async function loadPartsSummary(filters = {}) {
  state.partSummary = await api("/api/parts/summary");
  renderPartsTable();
}

function renderPartsTable() {
  const keyword = ($("partSearchKeyword")?.value || "").trim().toUpperCase();
  const rows = keyword
    ? state.partSummary.filter((row) => row.part_code.toUpperCase().includes(keyword))
    : state.partSummary;
  $("partsTable").innerHTML = rows.map((row) => `
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
  `).join("") || `<tr><td colspan="7" class="text-slate-500">Không tìm thấy mã hàng</td></tr>`;
  document.querySelectorAll("[data-edit-part]").forEach((btn) => btn.addEventListener("click", () => startEditPart(btn.dataset.editPart)));
  document.querySelectorAll("[data-delete-part]").forEach((btn) => btn.addEventListener("click", () => requestDeletePart(btn.dataset.deletePart)));
}

function renderPartsShell() {
  const panel = $("partsScreen")?.querySelector(".panel.mt-5");
  if (!panel) return;
  panel.innerHTML = `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="field-label">Tìm mã hàng</label>
        <input id="partSearchKeyword" class="input" placeholder="Nhập mã hàng...">
      </div>
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
  wireWarehouseScreen();
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

// ═══════════════════════════════════════════════════════════════
// MÀN KHO THÀNH PHẨM
// ═══════════════════════════════════════════════════════════════

const warehouseState = { currentOrderCode: null };

function warehouseProgressPercent(receipted, totalQty) {
  const cap = Number(totalQty || 0);
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((Number(receipted || 0) / cap) * 100));
}

function warehouseReceiptStatusBadge(totalReceipted, eligibleQty) {
  const eligible = Number(eligibleQty || 0);
  const receipted = Number(totalReceipted || 0);
  if (eligible <= 0) return `<span class="badge todo">Chưa có SL SX</span>`;
  if (receipted <= 0) return `<span class="badge todo">Chưa nhập</span>`;
  if (receipted >= eligible) return `<span class="badge done">Đủ ✓</span>`;
  return `<span class="badge partial">Một phần</span>`;
}

function showWarehouseList(resetSearch = false) {
  if (resetSearch && $("warehouseSearchInput")) $("warehouseSearchInput").value = "";
  $("warehouseListSection")?.classList.remove("hidden");
  $("warehouseDetailSection")?.classList.add("hidden");
  warehouseState.currentOrderCode = null;
  loadWarehouseOrders($("warehouseSearchInput")?.value.trim() || "");
}

function renderWarehouseDetailMeta(detail) {
  const el = $("warehouseDetailMeta");
  if (!el) return;
  const totalQty = Number(detail.total_qty || 0);
  const totalReceipted = Number(detail.total_receipted || 0);
  const progress = warehouseProgressPercent(totalReceipted, totalQty);
  el.innerHTML = `
    <span class="badge todo">Mã PO: ${escapeHtml(detail.order_code || "")}</span>
    <span class="badge todo">Mã hàng: ${escapeHtml(detail.part_code || "")}</span>
    <span class="badge todo">SL đơn: ${formatQty(totalQty)}</span>
    <span class="badge done">Đã nhập: ${formatQty(totalReceipted)}</span>
    <span class="badge partial">${progress}% hoàn thành</span>
  `;
}

function renderWarehouseLots(lots) {
  const tbody = $("warehouseLotsTbody");
  if (!tbody) return;
  if (!lots.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-slate-500">Đơn hàng chưa có lô nào</td></tr>`;
    return;
  }
  tbody.innerHTML = lots.map((lot) => {
    const eligible = Number(lot.eligible_qty || 0);
    const receipted = Number(lot.total_receipted || 0);
    const remaining = Math.max(eligible - receipted, 0);
    const receipts = Array.isArray(lot.receipts) ? lot.receipts : [];
    const lotCode = String(lot.lot_code || "");
    const receiptRows = receipts.map((r, i) => {
      const receiptMoment = r.created_at ? formatDateTimeDisplay(r.created_at) : formatDateTimeDisplay(r.receipt_date);
      return `
        <tr class="wh-receipt-row">
          <td colspan="2" class="text-slate-500">Phiếu #${i + 1}</td>
          <td class="text-slate-500">${escapeHtml(formatDateDisplay(r.receipt_date) || "—")}</td>
          <td colspan="2" class="text-slate-500">${escapeHtml(receiptMoment || "—")}</td>
          <td class="font-semibold text-green-700">${formatQty(r.qty)}</td>
          <td colspan="2">
            <button class="btn mini danger" data-delete-receipt="${r.id}" data-receipt-lot="${escapeHtml(lotCode)}">Xóa</button>
          </td>
        </tr>
      `;
    }).join("");
    return `
      <tr class="wh-lot-row" data-wh-add-receipt="${escapeHtml(lotCode)}">
        <td class="mono font-bold text-blue-600 cursor-pointer hover:underline">${displayLotCode(lot.lot_code)}</td>
        <td>${escapeHtml(lot.part_code || "")}</td>
        <td class="text-center">${formatQty(lot.qty_per_lot)}</td>
        <td class="text-center font-semibold">${eligible > 0 ? formatQty(eligible) : "—"}</td>
        <td class="text-center font-bold text-green-700">${formatQty(receipted)}</td>
        <td class="text-center">${remaining > 0 ? formatQty(remaining) : "—"}</td>
        <td class="text-center">${warehouseReceiptStatusBadge(receipted, eligible)}</td>
        <td>
          <button class="btn mini primary" data-wh-add-receipt="${escapeHtml(lotCode)}" ${eligible <= 0 ? "disabled" : ""}>Nhập kho</button>
        </td>
      </tr>
      ${receiptRows}
    `;
  }).join("");

  tbody.querySelectorAll("[data-wh-add-receipt]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const lotCode = el.dataset.whAddReceipt;
      if (lotCode) openWarehouseReceiptModal(lotCode);
    });
  });
  tbody.querySelectorAll("[data-delete-receipt]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lotCode = btn.dataset.receiptLot;
      const receiptId = btn.dataset.deleteReceipt;
      openDeleteModal({
        title: "Xóa phiếu nhập kho",
        message: `Xóa phiếu nhập kho của lô ${displayLotCode(lotCode)}? Thao tác không thể hoàn tác.`,
        onConfirm: async (deleteCode) => {
          await api(`/api/lots/${encodeURIComponent(lotCode)}/warehouse-receipts/${receiptId}`, {
            method: "DELETE",
            body: JSON.stringify({ delete_code: deleteCode }),
          });
          toast("Đã xóa phiếu nhập kho", "success");
          await loadWarehouseOrderDetail(warehouseState.currentOrderCode);
          await loadWarehouseOrders($("warehouseSearchInput")?.value.trim() || "");
        },
      });
    });
  });
}

async function loadWarehouseOrders(search = "") {
  const tbody = $("warehouseOrdersTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="text-center text-slate-400 py-6">Đang tải...</td></tr>`;
  try {
    const orders = await api(`/api/warehouse/orders?search=${encodeURIComponent(search)}`);
    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-slate-500">Không tìm thấy đơn hàng nào</td></tr>`;
      return;
    }
    tbody.innerHTML = orders.map((o) => {
      const totalQty = Number(o.total_qty || 0);
      const receipted = Number(o.total_receipted || 0);
      const pct = warehouseProgressPercent(receipted, totalQty);
      const orderCode = escapeHtml(o.order_code);
      return `
        <tr>
          <td class="mono font-bold text-blue-600 cursor-pointer hover:underline" data-wh-order="${orderCode}">${orderCode}</td>
          <td>${escapeHtml(o.part_code || "")}</td>
          <td class="text-center font-semibold">${formatQty(totalQty)}</td>
          <td class="text-center font-bold text-green-700">${formatQty(receipted)}</td>
          <td>
            <div class="progress-cell">
              <div class="progress-bar"><span style="width:${pct}%"></span></div>
              <span>${pct}%</span>
            </div>
          </td>
          <td><button class="btn mini secondary" data-wh-detail="${orderCode}">Chi tiết</button></td>
        </tr>
      `;
    }).join("");
    tbody.querySelectorAll("[data-wh-order], [data-wh-detail]").forEach((el) => {
      el.addEventListener("click", () => loadWarehouseOrderDetail(el.dataset.whOrder || el.dataset.whDetail));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-red-500 py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadWarehouseOrderDetail(orderCode) {
  warehouseState.currentOrderCode = orderCode;
  const section = $("warehouseDetailSection");
  if (!section) return;
  section.classList.remove("hidden");
  $("warehouseDetailTitle").textContent = orderCode;
  $("warehouseDetailMeta").innerHTML = `<span class="badge todo">Đang tải chi tiết...</span>`;
  $("warehouseLotsTbody").innerHTML = `<tr><td colspan="7" class="text-center text-slate-400 py-6">Đang tải...</td></tr>`;
  try {
    const detail = await api(`/api/warehouse/orders/${encodeURIComponent(orderCode)}/detail`);
    renderWarehouseDetailMeta(detail);
    renderWarehouseLots(detail.lots || []);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    $("warehouseDetailMeta").innerHTML = `<span class="badge error">${escapeHtml(err.message)}</span>`;
    $("warehouseLotsTbody").innerHTML = `<tr><td colspan="7" class="text-center text-red-500 py-4">${escapeHtml(err.message)}</td></tr>`;
  }
}

function openWarehouseReceiptModal(prefillLotCode = "") {
  const displayCode = prefillLotCode ? displayLotCode(prefillLotCode) : "";
  $("warehouseReceiptLotCode").value = displayCode;
  $("warehouseReceiptLotCode").readOnly = Boolean(prefillLotCode);
  $("warehouseReceiptQty").value = "";
  $("warehouseReceiptDate").value = today();
  $("warehouseReceiptError").classList.add("hidden");
  $("warehouseReceiptError").textContent = "";
  $("warehouseReceiptModal").classList.remove("hidden");
  (prefillLotCode ? $("warehouseReceiptQty") : $("warehouseReceiptLotCode")).focus();
}

function closeWarehouseReceiptModal() {
  $("warehouseReceiptModal").classList.add("hidden");
  if ($("warehouseReceiptLotCode")) $("warehouseReceiptLotCode").readOnly = false;
}

async function saveWarehouseReceipt() {
  const lotCode = lotInputToInternalCode($("warehouseReceiptLotCode").value);
  const qty = parseInt($("warehouseReceiptQty").value || "0", 10);
  const receiptDate = $("warehouseReceiptDate").value || today();
  const errEl = $("warehouseReceiptError");

  if (!lotCode) { errEl.textContent = "Vui lòng nhập mã lô"; errEl.classList.remove("hidden"); return; }
  if (!qty || qty <= 0) { errEl.textContent = "Số lượng phải lớn hơn 0"; errEl.classList.remove("hidden"); return; }
  errEl.classList.add("hidden");

  await withLoading($("saveWarehouseReceiptBtn"), async () => {
    await api(`/api/lots/${encodeURIComponent(lotCode)}/warehouse-receipts`, {
      method: "POST",
      body: JSON.stringify({ qty, receipt_date: receiptDate }),
    });
    toast("Đã lưu phiếu nhập kho", "success");
    closeWarehouseReceiptModal();
    await loadWarehouseOrders($("warehouseSearchInput")?.value.trim() || "");
    if (warehouseState.currentOrderCode) {
      await loadWarehouseOrderDetail(warehouseState.currentOrderCode);
    }
  }).catch((err) => {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  });
}

function wireWarehouseScreen() {
  on("warehouseSearchBtn", "click", () => showWarehouseList(false));
  on("warehouseClearSearchBtn", "click", () => showWarehouseList(true));
  $("warehouseSearchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") showWarehouseList(false);
  });

  on("openWarehouseReceiptModalBtn", "click", () => openWarehouseReceiptModal());

  on("closeWarehouseReceiptModalBtn", "click", closeWarehouseReceiptModal);
  on("cancelWarehouseReceiptBtn", "click", closeWarehouseReceiptModal);
  on("saveWarehouseReceiptBtn", "click", () => saveWarehouseReceipt().catch(() => {}));
  on("closeWarehouseDetailBtn", "click", () => {
    $("warehouseDetailSection")?.classList.add("hidden");
    warehouseState.currentOrderCode = null;
  });
  $("warehouseReceiptModal")?.addEventListener("click", (e) => {
    if (e.target === $("warehouseReceiptModal")) closeWarehouseReceiptModal();
  });
}
