from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


ShiftName = Literal["KÍP 1", "KÍP 2", "KÍP 3", "TĂNG CA"]


class PartStepInput(BaseModel):
    """Một công đoạn sản xuất của mã hàng, gồm tên và cycle time tiêu chuẩn."""

    step_name: str = Field(..., min_length=1, max_length=120)
    cycle_time_seconds: int = Field(..., gt=0)

    @field_validator("step_name")
    @classmethod
    def clean_step_name(cls, value: str) -> str:
        return value.strip().upper()


class PartCreate(BaseModel):
    """Payload tạo/cập nhật mã hàng và danh sách công đoạn theo thứ tự."""

    part_code: str = Field(..., min_length=1, max_length=80)
    steps: list[PartStepInput] = Field(..., min_length=1)

    @model_validator(mode="before")
    @classmethod
    def support_old_step_shape(cls, data):
        if isinstance(data, dict) and isinstance(data.get("steps"), list):
            data = data.copy()
            data["steps"] = [
                {"step_name": step, "cycle_time_seconds": 1} if isinstance(step, str) else step
                for step in data["steps"]
            ]
        return data

    @field_validator("part_code")
    @classmethod
    def normalize_part_code(cls, value: str) -> str:
        return value.strip().upper()


class OrderCreate(BaseModel):
    """Payload tạo/cập nhật đơn hàng và thông tin chia lô."""

    order_code: str = Field(..., min_length=1, max_length=80)
    part_code: str = Field(..., min_length=1, max_length=80)
    total_qty: int = Field(..., gt=0)
    qty_per_lot: int = Field(..., gt=0)
    raw_material_code: str = ""
    drawing_code: str = ""
    drawing_rev: str = ""
    material: str = ""
    internal_code: str = ""
    blank_size: str = ""
    order_receive_date: date | None = None
    blank_issue_date: date | None = None
    delivered_by: str = ""
    received_by: str = ""

    @field_validator("order_code", "part_code")
    @classmethod
    def normalize_codes(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator(
        "raw_material_code",
        "drawing_code",
        "drawing_rev",
        "material",
        "internal_code",
        "blank_size",
        "delivered_by",
        "received_by",
    )
    @classmethod
    def clean_optional_text(cls, value: str) -> str:
        return value.strip()


class EntryUpdate(BaseModel):
    """Payload nhập OK/NG của một biểu mẫu công đoạn trong lô."""

    work_date: date | None = None
    shift: ShiftName = "KÍP 1"
    qty_ok: int = Field(0, ge=0)
    qty_ng: int = Field(0, ge=0)
    tech_name: str = ""
    worker_name: str = ""

    @field_validator("tech_name", "worker_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return value.strip()


class MachineCreate(BaseModel):
    """Payload tạo máy CNC trong master data."""

    machine_code: str = Field(..., min_length=1, max_length=80)
    machine_name: str = Field(..., min_length=1, max_length=160)
    location: str = ""

    @field_validator("machine_code")
    @classmethod
    def normalize_machine_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("machine_name", "location")
    @classmethod
    def clean_machine_text(cls, value: str) -> str:
        return value.strip()


class MachineUpdate(BaseModel):
    """Payload cập nhật máy CNC, bao gồm trạng thái active."""

    machine_name: str = Field(..., min_length=1, max_length=160)
    location: str = ""
    is_active: int = Field(1, ge=0, le=1)

    @field_validator("machine_name", "location")
    @classmethod
    def clean_machine_update_text(cls, value: str) -> str:
        return value.strip()


class WorkerCreate(BaseModel):
    """Payload tạo nhân công trong master data."""

    worker_code: str = Field(..., min_length=1, max_length=80)
    worker_name: str = Field(..., min_length=1, max_length=160)

    @field_validator("worker_code")
    @classmethod
    def normalize_worker_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("worker_name")
    @classmethod
    def clean_worker_name(cls, value: str) -> str:
        return value.strip()


class WorkerUpdate(BaseModel):
    """Payload cập nhật nhân công, bao gồm trạng thái active."""

    worker_name: str = Field(..., min_length=1, max_length=160)
    is_active: int = Field(1, ge=0, le=1)

    @field_validator("worker_name")
    @classmethod
    def clean_worker_update_name(cls, value: str) -> str:
        return value.strip()


class StepMachineLogInput(BaseModel):
    """Payload một dòng máy thực hiện trong một form công đoạn."""

    machine_code: str = Field(..., min_length=1, max_length=80)
    worker_code: str = Field(..., min_length=1, max_length=80)
    work_date: date | None = None
    shift: ShiftName = "KÍP 1"
    qty_ok: int = Field(0, ge=0)
    qty_ng: int = Field(0, ge=0)
    note: str = ""

    @field_validator("machine_code", "worker_code")
    @classmethod
    def normalize_log_codes(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str) -> str:
        return value.strip()


class ApiMessage(BaseModel):
    """Response đơn giản cho các API chỉ cần trả thông báo."""

    message: str


class DeleteRequest(BaseModel):
    """Payload xác thực thao tác xóa dữ liệu nhạy cảm."""

    delete_code: str = Field(..., min_length=1)
