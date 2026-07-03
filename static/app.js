const state = {
  parts: [],
  orders: [],
  machines: [],
  workers: [],
  currentLot: null,
  editingPartCode: null,
  editingOrderCode: null,
  editingMachineCode: null,
  editingWorkerCode: null,
  focusFormId: null,
  pendingDelete: null,
  currentOrderLots: [],
};

const $ = (id) => document.getElementById(id);

const ORDER_EXTRA_INPUTS = {
  raw_material_code: "rawMaterialCode",
  drawing_code: "drawingCode",
  drawing_rev: "drawingRev",
  material: "material",
  blank_size: "blankSize",
  order_receive_date: "orderReceiveDate",
};
const ORDER_DATE_FIELDS = new Set(["order_receive_date"]);

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
    const err = new Error(data?.detail || "Có lỗi xảy ra khi gọi API");
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
  $(screenId).classList.remove("hidden");
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
  $("cancelDeleteBtn").addEventListener("click", closeDeleteModal);
  $("deleteModal").addEventListener("click", (event) => {
    if (event.target === $("deleteModal")) closeDeleteModal();
  });
  $("confirmDeleteBtn").addEventListener("click", () => withLoading($("confirmDeleteBtn"), async () => {
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
}

async function loadWorkers() {
  state.workers = await api("/api/workers");
  renderWorkersTable();
  renderDatalists();
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
  $("downloadTemplateBtn").addEventListener("click", () => {
    const isMachine = $("machinesTab").classList.contains("hidden") === false;
    window.open(isMachine ? "/api/machines/template" : "/api/workers/template", "_blank");
  });
  $("importExcelBtn").addEventListener("click", () => {
    $("excelImportInput").click();
  });
  $("excelImportInput").addEventListener("change", async (e) => {
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
  $("saveMachineBtn").addEventListener("click", () => withLoading($("saveMachineBtn"), async () => {
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
  $("saveWorkerBtn").addEventListener("click", () => withLoading($("saveWorkerBtn"), async () => {
    await api("/api/workers", {
      method: "POST",
      body: JSON.stringify({ worker_code: $("workerCode").value, worker_name: $("workerName").value }),
    });
    $("workerCode").value = "";
    $("workerName").value = "";
    toast("Đã thêm nhân công", "success");
    await loadWorkers();
  }).catch((err) => toast(err.message, "error")));
  ["machineCode", "machineName", "machineLocation"].forEach((id) => $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("saveMachineBtn").click();
  }));
  ["workerCode", "workerName"].forEach((id) => $(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("saveWorkerBtn").click();
  }));
}

let newSteps = [];

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
  $("partCode").readOnly = true;
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
  $("openCreatePartModalBtn").addEventListener("click", () => {
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
  
  $("closePartModalBtn").addEventListener("click", resetPartForm);
  $("cancelPartModalBtn").addEventListener("click", resetPartForm);
  $("partModal").addEventListener("click", (e) => {
    if (e.target.id === "partModal") resetPartForm();
  });

  $("addStepBtn").addEventListener("click", () => {
    const value = $("stepName").value.trim().toUpperCase();
    const cycleSeconds = Number($("stepCycleSeconds").value || 0);
    if (!value) return toast("Vui lòng nhập tên công đoạn", "warning");
    if (cycleSeconds <= 0) return toast("Vui lòng nhập số giây lớn hơn 0", "warning");
    newSteps.push({ step_name: value, cycle_time_seconds: cycleSeconds });
    $("stepName").value = "";
    $("stepCycleSeconds").value = "";
    renderStepList();
  });
  
  ["stepName", "stepCycleSeconds"].forEach((id) => $(id)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("addStepBtn").click();
  }));

  $("savePartBtn").addEventListener("click", () => withLoading($("savePartBtn"), async () => {
    const partCode = $("partCode").value.trim().toUpperCase();
    if (!partCode || !newSteps.length) return toast("Nhập mã hàng và ít nhất 1 công đoạn", "warning");
    const stepsPayload = newSteps.map((s, idx) => ({ step_name: s.step_name, step_order: idx + 1, duration_seconds: s.cycle_time_seconds }));
    if (state.editingPartCode) {
      await api(`/api/parts/${encodeURIComponent(state.editingPartCode)}/steps`, { method: "PUT", body: JSON.stringify(stepsPayload) });
    } else {
      await api("/api/parts", { method: "POST", body: JSON.stringify({ part_code: partCode, steps: stepsPayload.map(s => ({ step_name: s.step_name, cycle_time_seconds: s.duration_seconds })) }) });
    }
    toast("Đã lưu mã hàng", "success");
    resetPartForm();
    await loadParts();
    await loadOrders();
  }).catch((err) => toast(err.message, "error")));
}

async function loadOrders() {
  state.orders = await api("/api/orders");
  $("reportOrderSelect").innerHTML = state.orders.map((o) => `<option value="${o.order_code}">${o.order_code}</option>`).join("");
  $("lotOrderSelect").innerHTML = state.orders.map((o) => `<option value="${o.order_code}">${o.order_code} · ${o.part_code}</option>`).join("");
  renderOrdersHistory();
  if ($("lotOrderSelect").value) renderLotHints($("lotOrderSelect").value);
  else $("lotHintGrid").innerHTML = `<div class="text-sm font-semibold text-slate-500">Chưa có đơn hàng</div>`;
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
              <button class="btn mini secondary" onclick="showLotQr('${lot.lot_code}')">Xem QR</button>
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
  $("printLotCodeInput").value = lotCode;
  $("printLotByCodeBtn").click();
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
  const machines = activeMachines();
  const workers = activeWorkers();

  $("exportSheetModalTitle").textContent = `In phiếu xuất kho`;
  $("exportSheetModalLotCode").textContent = `Lô: ${displayLotCode(lotCode)} · ${lot.order_code} · ${lot.part_code}`;

  const shiftOptions = ["KÍP 1", "KÍP 2", "KÍP 3", "TĂNG CA"]
    .map(s => `<option value="${s}">${s}</option>`).join("");
  const machineOptions = `<option value="">-- Chọn máy --</option>` +
    machines.map(m => `<option value="${m.machine_code}">${m.machine_code} - ${m.machine_name}</option>`).join("");
  const workerOptions = `<option value="">-- Chọn NV --</option>` +
    workers.map(w => `<option value="${w.worker_code}">${w.worker_code} - ${w.worker_name}</option>`).join("");

  $("exportStepsList").innerHTML = entries.map((entry, idx) => `
    <div class="rounded-lg border border-slate-200 bg-slate-50 p-4" data-export-form-id="${entry.form_id}">
      <div class="font-extrabold text-sm mb-3 text-slate-700">OP${idx + 1}: ${escapeHtml(entry.step_name)}</div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="field-label">Máy</label>
          <select class="input export-field" data-field="machine_code">
            ${machineOptions}
          </select>
        </div>
        <div>
          <label class="field-label">Kíp</label>
          <select class="input export-field" data-field="shift">
            ${shiftOptions}
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="field-label">Người làm</label>
          <select class="input export-field" data-field="worker_code">
            ${workerOptions}
          </select>
        </div>
        <div>
          <label class="field-label">Kỹ thuật (tùy chọn)</label>
          <select class="input export-field" data-field="tech_code">
            ${workerOptions}
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="field-label">Ngày làm</label>
          <input type="date" class="input export-field" data-field="work_date" value="${today()}">
        </div>
        <div>
          <label class="field-label">Thông số kỹ thuật</label>
          <input type="text" class="input export-field" data-field="technical_info" placeholder="Tùy chọn">
        </div>
      </div>
    </div>
  `).join("") || `<p class="text-slate-500 text-sm">Lô chưa có công đoạn nào.</p>`;

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
      const machine_code = div.querySelector('[data-field="machine_code"]').value;
      const worker_code = div.querySelector('[data-field="worker_code"]').value;
      const shift = div.querySelector('[data-field="shift"]').value;
      const tech_code = div.querySelector('[data-field="tech_code"]').value;
      const work_date = div.querySelector('[data-field="work_date"]').value || null;
      const technical_info = div.querySelector('[data-field="technical_info"]').value;

      // Skip step if machine or worker not filled
      if (!machine_code || !worker_code) continue;

      const payload = {
        machine_code,
        worker_code,
        shift,
        tech_code,
        work_date,
        technical_info,
        qty_ok: qtyPerLot,
        qty_ng: 0,
        note: "",
      };

      try {
        await api(`/api/entries/${encodeURIComponent(formId)}/machines`, { method: "POST", body: JSON.stringify(payload) });
        savedAny = true;
      } catch (err) {
        // If already exists, try PUT with line_index 1
        try {
          await api(`/api/entries/${encodeURIComponent(formId)}/machines/1`, { method: "PUT", body: JSON.stringify(payload) });
          savedAny = true;
        } catch (_) {
          // ignore
        }
      }
    }

    if (savedAny) toast("Đã lưu thông tin nhập liệu", "success");
    modal.classList.add("hidden");

    // Print the lot sheet
    await printLot(lotCode);
  }).catch(err => toast(err.message, "error"));
}

function wireExportSheet() {
  $("closeExportSheetModalBtn").addEventListener("click", () => $("exportSheetModal").classList.add("hidden"));
  $("cancelExportSheetBtn").addEventListener("click", () => $("exportSheetModal").classList.add("hidden"));
  $("exportSheetModal").addEventListener("click", (e) => {
    if (e.target.id === "exportSheetModal") $("exportSheetModal").classList.add("hidden");
  });
  $("saveAndPrintBtn").addEventListener("click", saveAndPrint);
}

function renderOrdersHistory() {
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

function renderLotQrs(lots) {
  setPrintLotOptions(lots);
  $("lotBarcodeGrid").innerHTML = lots.map((lot) => {
    const visibleCode = displayLotCode(lot.lot_code);
    const canvasId = lot.lot_code.replaceAll(/[^A-Z0-9]/g, "");
    return `
      <div class="barcode-card">
        <canvas id="bc-${canvasId}"></canvas>
        <p class="code">${visibleCode}</p>
        <div class="text-sm font-bold text-slate-600">SL: ${formatQty(lot.qty_per_lot)} c&aacute;i</div>
      </div>
    `;
  }).join("");
  lots.forEach((lot) => renderQr($(`bc-${lot.lot_code.replaceAll(/[^A-Z0-9]/g, "")}`), displayLotCode(lot.lot_code), 300));
}

async function showOrderQrs(orderCode) {
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
  renderLotQrs(lots);
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
  $("saveOrderBtn").textContent = "C\u1eadp nh\u1eadt \u0111\u01a1n h\u00e0ng";
  $("cancelOrderEditBtn").classList.remove("hidden");
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
  $("orderCode").value = "";
  $("orderCode").disabled = false;
  $("totalQty").value = "";
  $("qtyPerLot").value = "";
  resetOrderExtra();
  updateLotPreview();
  $("saveOrderBtn").textContent = "Phát hành";
  $("cancelOrderEditBtn").classList.add("hidden");
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
  $("openCreateOrderModalBtn").addEventListener("click", () => {
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

  $("closeOrderModalBtn").addEventListener("click", () => $("orderModal").classList.add("hidden"));
  $("cancelOrderModalBtn").addEventListener("click", () => $("orderModal").classList.add("hidden"));
  $("orderModal").addEventListener("click", (e) => {
    if (e.target.id === "orderModal") $("orderModal").classList.add("hidden");
  });

  // Back button: hide detail, show list
  $("backToOrdersBtn").addEventListener("click", () => {
    $("orderDetailSection").classList.add("hidden");
    $("ordersListSection").classList.remove("hidden");
    loadOrders();
  });

  [("totalQty", "qtyPerLot")].forEach((id) => $(id) && $(id).addEventListener("input", updateLotPreview));
  $("totalQty").addEventListener("input", updateLotPreview);
  $("qtyPerLot").addEventListener("input", updateLotPreview);

  $("saveOrderBtn").addEventListener("click", () => withLoading($("saveOrderBtn"), async () => {
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
  const rows = await api(`/api/reports/order/${encodeURIComponent(orderCode)}`);
  const lots = new Map();
  rows.forEach((row) => {
    if (!lots.has(row.lot_code)) lots.set(row.lot_code, []);
    lots.get(row.lot_code).push(row);
  });
  $("lotHintGrid").innerHTML = Array.from(lots.entries()).map(([lotCode, lotRows]) => {
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
  }).join("") || `<div class="text-sm font-semibold text-slate-500">&#272;&#417;n h&agrave;ng n&agrave;y ch&#432;a c&oacute; l&ocirc;</div>`;
  document.querySelectorAll("[data-lot-code]").forEach((btn) => btn.addEventListener("click", () => {
    $("scanLotCode").value = displayLotCode(btn.dataset.lotCode);
    loadLot(btn.dataset.lotCode);
  }));
}

async function renderLot(lot) {
  const done = lot.entries.filter((e) => e.status === "done").length;
  $("lotHeader").classList.remove("hidden");
  $("lotHeader").innerHTML = `
    <div>
      <div>${displayLotCode(lot.lot_code)} &middot; ${lot.part_code} &middot; SL: ${formatQty(lot.qty_per_lot)} c&aacute;i &middot; ${done}/${lot.entries.length} c&ocirc;ng &#273;o&#7841;n ho&agrave;n th&agrave;nh</div>
    </div>
    <button class="btn secondary" id="printLotSheetBtn">In bi&#7875;u l&ocirc;</button>
  `;
  $("printLotSheetBtn").addEventListener("click", () => printLot(lot.lot_code));
  $("entryCards").innerHTML = lot.entries.map((entry, index) => entryCardHtml(entry, lot.qty_per_lot, index + 1)).join("");
  await Promise.all(lot.entries.map((entry) => loadMachineRows(entry.form_id, lot.qty_per_lot)));
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

function printValue(value) {
  return escapeHtml(value || "");
}
function displayLotCode(lotCode) {
  return String(lotCode || "").replace(/^LOT-/, "");
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


function renderPrintArea(lot) {
  const order = lot.order || {};
  const steps = lot.entries || [];
  const visibleLotCode = displayLotCode(lot.lot_code);
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
          <td colspan="2">Ng&#432;&#7901;i giao:<br><b>${printValue(order.delivered_by)}</b></td>
          <td colspan="2">Ng&#432;&#7901;i nh&#7853;n:<br><b>${printValue(order.received_by)}</b></td>
          <td colspan="2" class="lot-qr-cell">
            <div>S&#7889; l&#432;&#7907;ng: <b>${formatQty(lot.qty_per_lot)}</b></div>
            <img class="print-qr lot-print-qr" src="/api/qr?text=${encodeURIComponent(visibleLotCode)}&size=120" alt="${escapeHtml(visibleLotCode)}">
            <div class="mono">${escapeHtml(visibleLotCode)}</div>
          </td>
        </tr>
      </table>

      <table class="print-table process-print-table">
        <tr><th colspan="8" class="section-title">II. GIA C&Ocirc;NG</th></tr>
        ${steps.map((entry, index) => `
          <tr><td colspan="8" class="op-title">${index + 1}. OP${index + 1}: ${printValue(entry.step_name)}</td></tr>
          <tr class="process-head">
            <th>Ng&agrave;y</th><th>K&iacute;p</th><th>M&aacute;y</th><th>K&#7929; thu&#7853;t</th><th>Ng&#432;&#7901;i l&agrave;m</th><th>OK</th><th>NG</th><th>Ghi ch&uacute;</th>
          </tr>
          <tr class="process-write-row">
            <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
          </tr>
        `).join("")}
      </table>
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
  const override = currentOrderFormOverride(lot.order_code);
  if (override) lot.order = { ...(lot.order || {}), ...override };
  renderPrintArea(lot);
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
  const workDate = entry.work_date || today();
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
      <div class="grid gap-2 grid-cols-2 mb-2">
        <div><label class="field-label !mb-1 !text-[11px]">Ngày</label><input class="input entry-header-field !min-h-[30px] !p-1 text-sm" data-name="work_date" type="date" value="${workDate}"></div>
        <div><label class="field-label !mb-1 !text-[11px]">Kíp</label><select class="input entry-header-field !min-h-[30px] !p-1 text-sm" data-name="shift">${["KÍP 1","KÍP 2","KÍP 3","TĂNG CA"].map(s => `<option ${s === entry.shift ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="machine-log-box">
        <div class="mb-2 flex items-center justify-between gap-2"><div class="font-extrabold text-sm">Máy thực hiện / Chuyển máy</div><button class="btn mini secondary" data-add-machine-row="${entry.form_id}">+ Chuyển máy</button></div>
        <div id="machineRows-${entry.form_id}" class="machine-card-grid"></div>
        <div class="calc-line mt-2 font-bold"></div><div class="error-text hidden"></div>
      </div>
      <div class="save-state mt-3 text-sm font-bold text-slate-500">Đã lưu</div>
    </div>
  `;
}

function emptyMachineRow(formId) {
  return { form_id: formId, line_index: "", machine_code: "", worker_code: "", qty_ok: 0, qty_ng: 0, technical_info: "", note: "", _temp: true };
}

function renderMachineRows(formId, rows, qtyPerLot) {
  const container = $(`machineRows-${formId}`);
  container.dataset.rows = JSON.stringify(rows);
  container.innerHTML = rows.map((row, index) => `
    <div class="machine-row" data-machine-line="${row.line_index || ""}" data-temp="${row._temp ? 1 : 0}">
      <div class="machine-row-head">
        <span class="badge ${index ? "partial" : "todo"}">${index ? `Chuyển máy ${index + 1}` : "Máy chính"}</span>
        ${rows.length > 1 ? `<button class="btn mini danger" data-delete-machine-row>Xóa</button>` : ""}
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex gap-2">
          <div class="machine-field flex-1">
            <label class="field-label">Máy</label>
            <input list="machineDatalist" class="input mini-input machine-log-field w-full" data-name="machine_code" placeholder="Chọn máy" value="${getMachineDisplayName(row.machine_code)}">
          </div>
          <div class="machine-field flex-1">
            <label class="field-label">Nhân công</label>
            <input list="workerDatalist" class="input mini-input machine-log-field w-full" data-name="worker_code" placeholder="Chọn NV" value="${getWorkerDisplayName(row.worker_code)}">
          </div>
        </div>
        <div class="flex gap-2">
          <div class="machine-field w-16 sm:w-20">
            <label class="field-label">OK</label>
            <input class="input mini-input machine-log-field w-full !font-bold !text-green-700" data-name="qty_ok" type="number" min="0" step="1" value="${row.qty_ok || 0}">
          </div>
          <div class="machine-field w-16 sm:w-20">
            <label class="field-label">NG</label>
            <input class="input mini-input machine-log-field w-full !font-bold !text-red-700" data-name="qty_ng" type="number" min="0" step="1" value="${row.qty_ng || 0}">
          </div>
          <div class="machine-field w-1/4 sm:w-32">
            <label class="field-label">Kỹ thuật</label>
            <input class="input mini-input machine-log-field w-full" data-name="technical_info" placeholder="Thông số" value="${row.technical_info || ""}">
          </div>
          <div class="machine-field flex-1">
            <label class="field-label">Ghi chú</label>
            <input class="input mini-input machine-log-field w-full" data-name="note" placeholder="${index ? "Lý do" : "Ghi chú"}" value="${row.note || ""}">
          </div>
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
        val = String(val || "").split(" - ")[0].trim();
      }
      row[field.dataset.name] = val;
    });
    return row;
  });
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
    field.addEventListener("blur", () => saveMachineRow(formId, field.closest(".machine-row"), qtyPerLot));
    field.addEventListener("change", () => saveMachineRow(formId, field.closest(".machine-row"), qtyPerLot));
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
}

async function saveMachineRow(formId, tr, qtyPerLot) {
  if (!updateMachineTotal(formId, qtyPerLot)) return;
  const row = collectMachineRows(formId)[Array.from(tr.parentElement.querySelectorAll(".machine-row")).indexOf(tr)];
  if (!row.machine_code || !row.worker_code) return;
  if (Number(row.qty_ok || 0) + Number(row.qty_ng || 0) <= 0) return;
  const card = document.querySelector(`[data-form-id="${formId}"]`);
  const payload = {
    machine_code: row.machine_code,
    worker_code: row.worker_code,
    work_date: card.querySelector('[data-name="work_date"]').value || null,
    shift: card.querySelector('[data-name="shift"]').value || "KÍP 1",
    qty_ok: row.qty_ok,
    qty_ng: row.qty_ng,
    technical_info: row.technical_info || "",
    note: row.note || "",
  };
  if (row.line_index) await api(`/api/entries/${encodeURIComponent(formId)}/machines/${row.line_index}`, { method: "PUT", body: JSON.stringify(payload) });
  else await api(`/api/entries/${encodeURIComponent(formId)}/machines`, { method: "POST", body: JSON.stringify(payload) });
  const lotCode = state.currentLot?.lot_code;
  if (lotCode) {
    state.currentLot = await api(`/api/lots/${encodeURIComponent(lotCode)}`);
    await renderLot(state.currentLot);
  }
}

async function deleteMachineRow(formId, tr, qtyPerLot) {
  const lineIndex = tr.dataset.machineLine;
  if (lineIndex) await api(`/api/entries/${encodeURIComponent(formId)}/machines/${lineIndex}`, { method: "DELETE" });
  const rows = collectMachineRows(formId).filter((_, index) => index !== Array.from(tr.parentElement.querySelectorAll(".machine-row")).indexOf(tr));
  renderMachineRows(formId, rows.length ? rows : [emptyMachineRow(formId)], qtyPerLot);
  const lotCode = state.currentLot?.lot_code;
  if (lotCode) state.currentLot = await api(`/api/lots/${encodeURIComponent(lotCode)}`);
}

function wireLots() {
  $("loadLotBtn").addEventListener("click", () => loadLot());
  $("scanLotCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadLot();
  });
  $("lotOrderSelect").addEventListener("change", (e) => renderLotHints(e.target.value));
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
  $("refreshReportBtn").addEventListener("click", () => loadReports().catch((err) => toast(err.message, "error")));
  $("reportOrderSelect").addEventListener("change", (e) => loadOrderDetail(e.target.value));
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".report-tab").forEach((x) => x.classList.add("hidden"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.remove("hidden");
    });
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
  updateLotPreview();
  const params = new URLSearchParams(window.location.search);
  const lotCode = params.get("lot");
  if (lotCode) {
    showScreen("lotScreen");
    await loadLot(lotCode, params.get("form") || "");
  }
}

boot().catch((err) => toast(err.message, "error"));
