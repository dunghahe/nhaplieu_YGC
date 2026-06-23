from __future__ import annotations

import math
import re
import sqlite3
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "mes.db"

def dict_factory(cursor: sqlite3.Cursor, row: sqlite3.Row) -> dict[str, Any]:
    """Chuyển row SQLite thành dict để API trả JSON dễ đọc."""
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Tạo connection SQLite ngắn hạn, luôn bật foreign key."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def slugify(text: str) -> str:
    """Bỏ dấu/khoảng trắng để tạo form_id ổn định từ tên công đoạn."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"\s+", "", text).upper()
    text = re.sub(r"[^A-Z0-9_-]", "", text)
    return text


def split_lot_quantities(total_qty: int, planned_lots: int) -> list[int]:
    """Chia theo số lô người dùng nhập; nếu dư thì tạo thêm lô cuối."""
    if planned_lots > total_qty:
        raise ValueError("Số lô không được lớn hơn tổng số lượng")
    base_qty = total_qty // planned_lots
    remainder = total_qty % planned_lots
    lots = [base_qty for _ in range(planned_lots)]
    if remainder:
        lots.append(remainder)
    return lots


def init_db() -> None:
    """Khởi tạo schema và chạy migration nhẹ khi app start."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS parts (
              id        INTEGER PRIMARY KEY AUTOINCREMENT,
              part_code TEXT UNIQUE NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS part_steps (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              part_id    INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
              step_name  TEXT NOT NULL,
              step_order INTEGER NOT NULL,
              cycle_time_seconds INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS orders (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code  TEXT UNIQUE NOT NULL,
              part_code   TEXT NOT NULL,
              total_qty   REAL NOT NULL,
              qty_per_lot REAL NOT NULL,
              planned_lots INTEGER NOT NULL DEFAULT 1,
              total_lots  INTEGER NOT NULL,
              raw_material_code TEXT DEFAULT '',
              drawing_code       TEXT DEFAULT '',
              drawing_rev        TEXT DEFAULT '',
              material           TEXT DEFAULT '',
              internal_code      TEXT DEFAULT '',
              blank_size         TEXT DEFAULT '',
              order_receive_date DATE,
              blank_issue_date   DATE,
              delivered_by       TEXT DEFAULT '',
              received_by        TEXT DEFAULT '',
              created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lots (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              lot_code    TEXT UNIQUE NOT NULL,
              order_code  TEXT NOT NULL,
              part_code   TEXT NOT NULL,
              qty_per_lot REAL NOT NULL,
              lot_index   INTEGER NOT NULL,
              created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS step_entries (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              form_id     TEXT UNIQUE NOT NULL,
              lot_code    TEXT NOT NULL,
              step_name   TEXT NOT NULL,
              work_date   DATE,
              shift       TEXT DEFAULT 'KÍP 1'
                            CHECK(shift IN ('KÍP 1','KÍP 2','KÍP 3','TĂNG CA')),
              qty_ok      INTEGER DEFAULT 0,
              qty_ng      INTEGER DEFAULT 0,
              tech_name   TEXT DEFAULT '',
              worker_name TEXT DEFAULT '',
              status      TEXT DEFAULT 'todo'
                            CHECK(status IN ('todo','partial','done')),
              updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS machines (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              machine_code TEXT UNIQUE NOT NULL,
              machine_name TEXT NOT NULL,
              location     TEXT DEFAULT '',
              is_active    INTEGER DEFAULT 1,
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS workers (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              worker_code  TEXT UNIQUE NOT NULL,
              worker_name  TEXT NOT NULL,
              is_active    INTEGER DEFAULT 1,
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS step_machine_logs (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              form_id      TEXT NOT NULL REFERENCES step_entries(form_id) ON DELETE CASCADE,
              line_index   INTEGER NOT NULL,
              machine_code TEXT NOT NULL REFERENCES machines(machine_code),
              worker_code  TEXT NOT NULL REFERENCES workers(worker_code),
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              note         TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(form_id, line_index)
            );
            """
        )
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(part_steps)").fetchall()
        }
        if "cycle_time_seconds" not in columns:
            conn.execute(
                "ALTER TABLE part_steps ADD COLUMN cycle_time_seconds INTEGER NOT NULL DEFAULT 1"
            )
        order_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(orders)").fetchall()
        }
        if "planned_lots" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN planned_lots INTEGER NOT NULL DEFAULT 1")
            conn.execute("UPDATE orders SET planned_lots = total_lots WHERE planned_lots = 1")
        order_extra_columns = {
            "raw_material_code": "TEXT DEFAULT ''",
            "drawing_code": "TEXT DEFAULT ''",
            "drawing_rev": "TEXT DEFAULT ''",
            "material": "TEXT DEFAULT ''",
            "internal_code": "TEXT DEFAULT ''",
            "blank_size": "TEXT DEFAULT ''",
            "order_receive_date": "DATE",
            "blank_issue_date": "DATE",
            "delivered_by": "TEXT DEFAULT ''",
            "received_by": "TEXT DEFAULT ''",
        }
        order_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(orders)").fetchall()
        }
        for column_name, column_type in order_extra_columns.items():
            if column_name not in order_columns:
                conn.execute(f"ALTER TABLE orders ADD COLUMN {column_name} {column_type}")


def get_machines(include_inactive: bool = True) -> list[dict[str, Any]]:
    """Lấy danh sách máy CNC; master screen cần cả active/inactive."""
    with connect() as conn:
        where = "" if include_inactive else "WHERE is_active = 1"
        return conn.execute(
            f"SELECT * FROM machines {where} ORDER BY is_active DESC, machine_code"
        ).fetchall()


def create_machine(machine_code: str, machine_name: str, location: str) -> dict[str, Any]:
    """Tạo máy CNC mới."""
    with connect() as conn:
        try:
            conn.execute(
                "INSERT INTO machines(machine_code, machine_name, location) VALUES (?, ?, ?)",
                (machine_code, machine_name, location),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Mã máy đã tồn tại") from exc
    return {"machine_code": machine_code, "machine_name": machine_name, "location": location, "is_active": 1}


def update_machine(machine_code: str, machine_name: str, location: str, is_active: int) -> dict[str, Any]:
    """Cập nhật thông tin và trạng thái máy CNC."""
    with connect() as conn:
        cur = conn.execute(
            """
            UPDATE machines
            SET machine_name = ?, location = ?, is_active = ?
            WHERE machine_code = ?
            """,
            (machine_name, location, is_active, machine_code),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy máy")
    return {"machine_code": machine_code, "machine_name": machine_name, "location": location, "is_active": is_active}


def set_machine_active(machine_code: str, is_active: int) -> None:
    """Soft delete/kích hoạt lại máy CNC."""
    with connect() as conn:
        cur = conn.execute("UPDATE machines SET is_active = ? WHERE machine_code = ?", (is_active, machine_code))
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy máy")


def get_workers(include_inactive: bool = True) -> list[dict[str, Any]]:
    """Lấy danh sách nhân công; master screen cần cả active/inactive."""
    with connect() as conn:
        where = "" if include_inactive else "WHERE is_active = 1"
        return conn.execute(
            f"SELECT * FROM workers {where} ORDER BY is_active DESC, worker_code"
        ).fetchall()


def create_worker(worker_code: str, worker_name: str) -> dict[str, Any]:
    """Tạo nhân công mới."""
    with connect() as conn:
        try:
            conn.execute(
                "INSERT INTO workers(worker_code, worker_name) VALUES (?, ?)",
                (worker_code, worker_name),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Mã nhân công đã tồn tại") from exc
    return {"worker_code": worker_code, "worker_name": worker_name, "is_active": 1}


def update_worker(worker_code: str, worker_name: str, is_active: int) -> dict[str, Any]:
    """Cập nhật tên và trạng thái nhân công."""
    with connect() as conn:
        cur = conn.execute(
            "UPDATE workers SET worker_name = ?, is_active = ? WHERE worker_code = ?",
            (worker_name, is_active, worker_code),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy nhân công")
    return {"worker_code": worker_code, "worker_name": worker_name, "is_active": is_active}


def set_worker_active(worker_code: str, is_active: int) -> None:
    """Soft delete/kích hoạt lại nhân công."""
    with connect() as conn:
        cur = conn.execute("UPDATE workers SET is_active = ? WHERE worker_code = ?", (is_active, worker_code))
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy nhân công")


def get_parts() -> list[dict[str, Any]]:
    """Lấy danh sách mã hàng kèm công đoạn và cycle time."""
    with connect() as conn:
        parts = conn.execute("SELECT * FROM parts ORDER BY created_at DESC, id DESC").fetchall()
        for part in parts:
            part["steps"] = conn.execute(
                """
                SELECT step_name, step_order, cycle_time_seconds
                FROM part_steps
                WHERE part_id = ?
                ORDER BY step_order
                """,
                (part["id"],),
            ).fetchall()
        return parts


def get_part(part_code: str) -> dict[str, Any] | None:
    """Tìm một mã hàng theo part_code."""
    with connect() as conn:
        return conn.execute("SELECT * FROM parts WHERE part_code = ?", (part_code,)).fetchone()


def create_part(part_code: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Tạo mã hàng mới và insert toàn bộ công đoạn."""
    with connect() as conn:
        try:
            cur = conn.execute("INSERT INTO parts(part_code) VALUES (?)", (part_code,))
        except sqlite3.IntegrityError as exc:
            raise ValueError("Mã hàng đã tồn tại") from exc
        part_id = cur.lastrowid
        conn.executemany(
            """
            INSERT INTO part_steps(part_id, step_name, step_order, cycle_time_seconds)
            VALUES (?, ?, ?, ?)
            """,
            [
                (part_id, step["step_name"], idx + 1, step["cycle_time_seconds"])
                for idx, step in enumerate(steps)
            ],
        )
    return {"part_code": part_code, "steps": steps}


def update_part(old_part_code: str, new_part_code: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Cập nhật mã hàng và khai báo công đoạn; đồng bộ part_code ở order/lot liên quan."""
    with connect() as conn:
        part = conn.execute("SELECT * FROM parts WHERE part_code = ?", (old_part_code,)).fetchone()
        if not part:
            raise LookupError("Không tìm thấy mã hàng")
        duplicate = conn.execute(
            "SELECT id FROM parts WHERE part_code = ? AND part_code != ?",
            (new_part_code, old_part_code),
        ).fetchone()
        if duplicate:
            raise ValueError("Mã hàng đã tồn tại")

        conn.execute("UPDATE parts SET part_code = ? WHERE id = ?", (new_part_code, part["id"]))
        conn.execute("UPDATE orders SET part_code = ? WHERE part_code = ?", (new_part_code, old_part_code))
        conn.execute("UPDATE lots SET part_code = ? WHERE part_code = ?", (new_part_code, old_part_code))
        conn.execute("DELETE FROM part_steps WHERE part_id = ?", (part["id"],))
        conn.executemany(
            """
            INSERT INTO part_steps(part_id, step_name, step_order, cycle_time_seconds)
            VALUES (?, ?, ?, ?)
            """,
            [
                (part["id"], step["step_name"], idx + 1, step["cycle_time_seconds"])
                for idx, step in enumerate(steps)
            ],
        )
    return {"part_code": new_part_code, "steps": steps}


def delete_part(part_code: str) -> None:
    """Xóa mã hàng khi chưa có đơn hàng nào sử dụng mã đó."""
    with connect() as conn:
        part = conn.execute("SELECT * FROM parts WHERE part_code = ?", (part_code,)).fetchone()
        if not part:
            raise LookupError("Không tìm thấy mã hàng")
        used = conn.execute("SELECT COUNT(*) AS count_rows FROM orders WHERE part_code = ?", (part_code,)).fetchone()
        if used and used["count_rows"]:
            raise ValueError("Mã hàng đã được dùng trong đơn hàng, cần xóa đơn hàng liên quan trước")
        conn.execute("DELETE FROM parts WHERE part_code = ?", (part_code,))


def get_part_steps(part_code: str) -> list[dict[str, Any]]:
    """Lấy công đoạn của một mã hàng theo đúng thứ tự khai báo."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT ps.step_name, ps.step_order, ps.cycle_time_seconds
            FROM part_steps ps
            JOIN parts p ON p.id = ps.part_id
            WHERE p.part_code = ?
            ORDER BY ps.step_order
            """,
            (part_code,),
        ).fetchall()


def get_orders() -> list[dict[str, Any]]:
    """Lấy đơn hàng kèm phần trăm hoàn thành dựa trên step_entries đã done."""
    with connect() as conn:
        orders = conn.execute("SELECT * FROM orders ORDER BY created_at DESC, id DESC").fetchall()
        for order in orders:
            total_entries = conn.execute(
                """
                SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
                FROM step_entries se
                JOIN lots l ON l.lot_code = se.lot_code
                WHERE l.order_code = ?
                """,
                (order["order_code"],),
            ).fetchone()
            total = total_entries["total"] or 0
            done = total_entries["done"] or 0
            order["progress_percent"] = round(done * 100 / total, 1) if total else 0
        return orders


def get_order(order_code: str) -> dict[str, Any] | None:
    """Lay day du mot don hang theo ma PO, gom ca thong tin Phan I."""
    with connect() as conn:
        return conn.execute("SELECT * FROM orders WHERE order_code = ?", (order_code,)).fetchone()


ORDER_EXTRA_FIELDS = (
    "raw_material_code",
    "drawing_code",
    "drawing_rev",
    "material",
    "internal_code",
    "blank_size",
    "order_receive_date",
    "blank_issue_date",
    "delivered_by",
    "received_by",
)


def normalize_order_extra(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Chuẩn hóa các field Phần I của đơn hàng trước khi lưu."""
    extra = extra or {}
    normalized: dict[str, Any] = {}
    for field in ORDER_EXTRA_FIELDS:
        value = extra.get(field)
        if field.endswith("_date"):
            normalized[field] = value.isoformat() if hasattr(value, "isoformat") else (value or None)
        else:
            normalized[field] = value or ""
    return normalized


def create_order(order_code: str, part_code: str, total_qty: int, planned_lots: int, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Tạo đơn hàng, tự tính pcs/lô chuẩn từ số lô người dùng nhập."""
    if not get_part(part_code):
        raise LookupError("Mã hàng không tồn tại")

    lot_quantities = split_lot_quantities(total_qty, planned_lots)
    total_lots = len(lot_quantities)
    qty_per_lot = lot_quantities[0]
    order_extra = normalize_order_extra(extra)
    with connect() as conn:
        try:
            conn.execute(
                """
                INSERT INTO orders(
                    order_code, part_code, total_qty, qty_per_lot, planned_lots, total_lots,
                    raw_material_code, drawing_code, drawing_rev, material, internal_code,
                    blank_size, order_receive_date, blank_issue_date, delivered_by, received_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_code, part_code, total_qty, qty_per_lot, planned_lots, total_lots,
                    order_extra["raw_material_code"], order_extra["drawing_code"], order_extra["drawing_rev"],
                    order_extra["material"], order_extra["internal_code"], order_extra["blank_size"],
                    order_extra["order_receive_date"], order_extra["blank_issue_date"],
                    order_extra["delivered_by"], order_extra["received_by"],
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Mã PO đã tồn tại") from exc

        lots = []
        for index, lot_qty in enumerate(lot_quantities, start=1):
            lot_code = f"LOT-{order_code}-{index:02d}"
            conn.execute(
                """
                INSERT INTO lots(lot_code, order_code, part_code, qty_per_lot, lot_index)
                VALUES (?, ?, ?, ?, ?)
                """,
                (lot_code, order_code, part_code, lot_qty, index),
            )
            lots.append({"lot_code": lot_code, "qty_per_lot": lot_qty, "lot_index": index})
    return {
        "order_code": order_code,
        "part_code": part_code,
        "total_qty": total_qty,
        "qty_per_lot": qty_per_lot,
        "planned_lots": planned_lots,
        "total_lots": total_lots,
        "lots": lots,
        **order_extra,
    }


def order_has_entries(conn: sqlite3.Connection, order_code: str) -> bool:
    """Kiểm tra đơn hàng đã có dữ liệu nhập liệu ở bất kỳ công đoạn nào chưa."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS count_rows
        FROM step_entries se
        JOIN lots l ON l.lot_code = se.lot_code
        WHERE l.order_code = ?
          AND (se.qty_ok > 0 OR se.qty_ng > 0 OR se.tech_name != '' OR se.worker_name != '')
        """,
        (order_code,),
    ).fetchone()
    return bool(row and row["count_rows"])


def update_order(order_code: str, part_code: str, total_qty: int, planned_lots: int, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Cập nhật dữ liệu đơn hàng; chỉ chia lại lô khi đơn chưa phát sinh nhập liệu."""
    if not get_part(part_code):
        raise LookupError("Mã hàng không tồn tại")

    with connect() as conn:
        order = conn.execute("SELECT * FROM orders WHERE order_code = ?", (order_code,)).fetchone()
        if not order:
            raise LookupError("Không tìm thấy đơn hàng")

        old_planned_lots = int(order.get("planned_lots") or order["total_lots"])
        lots_changed = total_qty != int(order["total_qty"]) or planned_lots != old_planned_lots
        if lots_changed and order_has_entries(conn, order_code):
            raise ValueError("Đơn hàng đã có dữ liệu nhập liệu, không thể đổi tổng SL hoặc số lô")

        lot_quantities = split_lot_quantities(total_qty, planned_lots)
        total_lots = len(lot_quantities)
        qty_per_lot = lot_quantities[0]
        order_extra = normalize_order_extra(extra)
        conn.execute(
            """
            UPDATE orders
            SET part_code = ?, total_qty = ?, qty_per_lot = ?, planned_lots = ?, total_lots = ?,
                raw_material_code = ?, drawing_code = ?, drawing_rev = ?, material = ?,
                internal_code = ?, blank_size = ?, order_receive_date = ?, blank_issue_date = ?,
                delivered_by = ?, received_by = ?
            WHERE order_code = ?
            """,
            (
                part_code, total_qty, qty_per_lot, planned_lots, total_lots,
                order_extra["raw_material_code"], order_extra["drawing_code"], order_extra["drawing_rev"],
                order_extra["material"], order_extra["internal_code"], order_extra["blank_size"],
                order_extra["order_receive_date"], order_extra["blank_issue_date"],
                order_extra["delivered_by"], order_extra["received_by"], order_code,
            ),
        )

        if lots_changed:
            conn.execute("DELETE FROM step_entries WHERE lot_code IN (SELECT lot_code FROM lots WHERE order_code = ?)", (order_code,))
            conn.execute("DELETE FROM lots WHERE order_code = ?", (order_code,))
            for index, lot_qty in enumerate(lot_quantities, start=1):
                conn.execute(
                    """
                    INSERT INTO lots(lot_code, order_code, part_code, qty_per_lot, lot_index)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (f"LOT-{order_code}-{index:02d}", order_code, part_code, lot_qty, index),
                )
        else:
            conn.execute("UPDATE lots SET part_code = ? WHERE order_code = ?", (part_code, order_code))

    return get_order_with_lots(order_code)


def get_order_with_lots(order_code: str) -> dict[str, Any]:
    """Trả một đơn hàng kèm danh sách lô để frontend render lại barcode."""
    with connect() as conn:
        order = conn.execute("SELECT * FROM orders WHERE order_code = ?", (order_code,)).fetchone()
        if not order:
            raise LookupError("Không tìm thấy đơn hàng")
        order["lots"] = conn.execute(
            "SELECT lot_code, qty_per_lot, lot_index FROM lots WHERE order_code = ? ORDER BY lot_index",
            (order_code,),
        ).fetchall()
        return order


def delete_order(order_code: str) -> None:
    """Xóa đơn hàng và toàn bộ lots/step_entries thuộc đơn hàng đó."""
    with connect() as conn:
        order = conn.execute("SELECT * FROM orders WHERE order_code = ?", (order_code,)).fetchone()
        if not order:
            raise LookupError("Không tìm thấy đơn hàng")
        conn.execute(
            "DELETE FROM step_entries WHERE lot_code IN (SELECT lot_code FROM lots WHERE order_code = ?)",
            (order_code,),
        )
        conn.execute("DELETE FROM lots WHERE order_code = ?", (order_code,))
        conn.execute("DELETE FROM orders WHERE order_code = ?", (order_code,))


def get_lot(lot_code: str) -> dict[str, Any] | None:
    """Lấy thông tin lô và các entry công đoạn đã khởi tạo."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            return None
        lot["order"] = conn.execute(
            "SELECT * FROM orders WHERE order_code = ?",
            (lot["order_code"],),
        ).fetchone()
        lot["entries"] = conn.execute(
            "SELECT * FROM step_entries WHERE lot_code = ? ORDER BY id",
            (lot_code,),
        ).fetchall()
        return lot


def init_lot_steps(lot_code: str) -> dict[str, Any]:
    """Khởi tạo step_entries cho lô ở lần quét đầu, có tính idempotent."""
    lot = get_lot(lot_code)
    if not lot:
        raise LookupError("Không tìm thấy lô")

    steps = get_part_steps(lot["part_code"])
    with connect() as conn:
        for step in steps:
            form_id = f"FORM-{lot_code}-{slugify(step['step_name'])}"
            conn.execute(
                """
                INSERT OR IGNORE INTO step_entries(form_id, lot_code, step_name)
                VALUES (?, ?, ?)
                """,
                (form_id, lot_code, step["step_name"]),
            )
    return get_lot(lot_code) or lot


def get_entry(form_id: str) -> dict[str, Any] | None:
    """Lấy một biểu mẫu công đoạn theo form_id."""
    with connect() as conn:
        entry = conn.execute("SELECT * FROM step_entries WHERE form_id = ?", (form_id,)).fetchone()
        if not entry:
            return None
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (entry["lot_code"],)).fetchone()
        entry["lot"] = lot
        entry["qty_per_lot"] = lot["qty_per_lot"] if lot else 0
        return entry


def get_machine_logs(form_id: str) -> list[dict[str, Any]]:
    """Lấy các dòng máy thực hiện của một form công đoạn."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT sml.*, m.machine_name, w.worker_name
            FROM step_machine_logs sml
            LEFT JOIN machines m ON m.machine_code = sml.machine_code
            LEFT JOIN workers w ON w.worker_code = sml.worker_code
            WHERE sml.form_id = ?
            ORDER BY sml.line_index
            """,
            (form_id,),
        ).fetchall()


def recalc_entry_from_machine_logs(conn: sqlite3.Connection, form_id: str) -> dict[str, Any]:
    """Tính tổng OK/NG từ step_machine_logs và cập nhật step_entries."""
    entry = conn.execute("SELECT * FROM step_entries WHERE form_id = ?", (form_id,)).fetchone()
    if not entry:
        raise LookupError("Không tìm thấy biểu mẫu")
    lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (entry["lot_code"],)).fetchone()
    if not lot:
        raise LookupError("Không tìm thấy lô")
    totals = conn.execute(
        """
        SELECT COALESCE(SUM(qty_ok), 0) AS qty_ok,
               COALESCE(SUM(qty_ng), 0) AS qty_ng
        FROM step_machine_logs
        WHERE form_id = ?
        """,
        (form_id,),
    ).fetchone()
    qty_ok = int(totals["qty_ok"] or 0)
    qty_ng = int(totals["qty_ng"] or 0)
    qty_per_lot = int(lot["qty_per_lot"])
    total = qty_ok + qty_ng
    if total > qty_per_lot:
        raise ValueError(f"Tổng OK + NG vượt quá số lượng lô ({qty_per_lot} cái)")
    status = "todo" if total == 0 else "partial" if total < qty_per_lot else "done"
    conn.execute(
        """
        UPDATE step_entries
        SET qty_ok = ?, qty_ng = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE form_id = ?
        """,
        (qty_ok, qty_ng, status, form_id),
    )
    updated = conn.execute("SELECT * FROM step_entries WHERE form_id = ?", (form_id,)).fetchone()
    updated["qty_per_lot"] = qty_per_lot
    return updated


def validate_machine_log_refs(conn: sqlite3.Connection, machine_code: str, worker_code: str) -> None:
    """Đảm bảo máy và nhân công active trước khi ghi log."""
    machine = conn.execute(
        "SELECT * FROM machines WHERE machine_code = ? AND is_active = 1",
        (machine_code,),
    ).fetchone()
    if not machine:
        raise LookupError("Không tìm thấy máy đang hoạt động")
    worker = conn.execute(
        "SELECT * FROM workers WHERE worker_code = ? AND is_active = 1",
        (worker_code,),
    ).fetchone()
    if not worker:
        raise LookupError("Không tìm thấy nhân công đang hoạt động")


def create_machine_log(form_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Thêm một dòng máy mới và cập nhật lại status form."""
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM step_entries WHERE form_id = ?", (form_id,)).fetchone():
            raise LookupError("Không tìm thấy biểu mẫu")
        validate_machine_log_refs(conn, payload["machine_code"], payload["worker_code"])
        conn.execute(
            "UPDATE step_entries SET work_date = ?, shift = ? WHERE form_id = ?",
            (payload.get("work_date"), payload.get("shift") or "KÍP 1", form_id),
        )
        next_index = conn.execute(
            "SELECT COALESCE(MAX(line_index), 0) + 1 AS next_index FROM step_machine_logs WHERE form_id = ?",
            (form_id,),
        ).fetchone()["next_index"]
        conn.execute(
            """
            INSERT INTO step_machine_logs(form_id, line_index, machine_code, worker_code, qty_ok, qty_ng, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                form_id,
                next_index,
                payload["machine_code"],
                payload["worker_code"],
                int(payload.get("qty_ok") or 0),
                int(payload.get("qty_ng") or 0),
                payload.get("note") or "",
            ),
        )
        recalc_entry_from_machine_logs(conn, form_id)
    return {"line_index": next_index, **payload}


def update_machine_log(form_id: str, line_index: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Cập nhật một dòng máy và cập nhật lại status form."""
    with connect() as conn:
        validate_machine_log_refs(conn, payload["machine_code"], payload["worker_code"])
        conn.execute(
            "UPDATE step_entries SET work_date = ?, shift = ? WHERE form_id = ?",
            (payload.get("work_date"), payload.get("shift") or "KÍP 1", form_id),
        )
        cur = conn.execute(
            """
            UPDATE step_machine_logs
            SET machine_code = ?, worker_code = ?, qty_ok = ?, qty_ng = ?, note = ?
            WHERE form_id = ? AND line_index = ?
            """,
            (
                payload["machine_code"],
                payload["worker_code"],
                int(payload.get("qty_ok") or 0),
                int(payload.get("qty_ng") or 0),
                payload.get("note") or "",
                form_id,
                line_index,
            ),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy dòng máy")
        recalc_entry_from_machine_logs(conn, form_id)
    return {"line_index": line_index, **payload}


def delete_machine_log(form_id: str, line_index: int) -> None:
    """Xóa một dòng máy và cập nhật lại status form."""
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM step_machine_logs WHERE form_id = ? AND line_index = ?",
            (form_id, line_index),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy dòng máy")
        recalc_entry_from_machine_logs(conn, form_id)


def update_entry(form_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Lưu OK/NG và tự tính status của một biểu mẫu công đoạn."""
    entry = get_entry(form_id)
    if not entry:
        raise LookupError("Không tìm thấy biểu mẫu")

    qty_ok = int(payload.get("qty_ok") or 0)
    qty_ng = int(payload.get("qty_ng") or 0)
    qty_per_lot = int(entry["qty_per_lot"])
    total = qty_ok + qty_ng
    if total > qty_per_lot:
        raise ValueError(f"Tổng OK + NG vượt quá số lượng lô ({qty_per_lot} cái)")

    if total == 0:
        status = "todo"
    elif total < qty_per_lot:
        status = "partial"
    else:
        status = "done"

    with connect() as conn:
        conn.execute(
            """
            UPDATE step_entries
            SET work_date = ?, shift = ?, qty_ok = ?, qty_ng = ?,
                tech_name = ?, worker_name = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE form_id = ?
            """,
            (
                payload.get("work_date"),
                payload.get("shift") or "KÍP 1",
                qty_ok,
                qty_ng,
                payload.get("tech_name") or "",
                payload.get("worker_name") or "",
                status,
                form_id,
            ),
        )
    return get_entry(form_id) or entry


def get_summary_report() -> list[dict[str, Any]]:
    """Báo cáo tổng quan theo đơn hàng: hoàn thành, OK/NG và tỷ lệ NG."""
    with connect() as conn:
        orders = conn.execute("SELECT * FROM orders ORDER BY created_at DESC, id DESC").fetchall()
        for order in orders:
            totals = conn.execute(
                """
                SELECT COALESCE(SUM(se.qty_ok), 0) AS total_ok,
                       COALESCE(SUM(se.qty_ng), 0) AS total_ng
                FROM step_entries se
                JOIN lots l ON l.lot_code = se.lot_code
                WHERE l.order_code = ?
                """,
                (order["order_code"],),
            ).fetchone()
            lots_done = conn.execute(
                """
                SELECT COUNT(*) AS count_done
                FROM lots l
                WHERE l.order_code = ?
                  AND EXISTS (SELECT 1 FROM step_entries se WHERE se.lot_code = l.lot_code)
                  AND NOT EXISTS (
                    SELECT 1 FROM step_entries se
                    WHERE se.lot_code = l.lot_code AND se.status != 'done'
                  )
                """,
                (order["order_code"],),
            ).fetchone()
            total_ok = totals["total_ok"] or 0
            total_ng = totals["total_ng"] or 0
            inspected = total_ok + total_ng
            order["lots_done"] = lots_done["count_done"] or 0
            order["total_ok"] = total_ok
            order["total_ng"] = total_ng
            order["ng_rate"] = round(total_ng * 100 / inspected, 2) if inspected else 0
        return orders


def get_order_report(order_code: str) -> list[dict[str, Any]]:
    """Báo cáo chi tiết từng lô/công đoạn của một đơn hàng."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT l.lot_code, l.qty_per_lot, l.lot_index, se.step_name, se.form_id,
                   se.status, se.qty_ok, se.qty_ng, se.worker_name, se.tech_name,
                   se.work_date, se.shift,
                   COALESCE((
                     SELECT GROUP_CONCAT(machine_text, ', ')
                     FROM (
                       SELECT sml.machine_code || ' (' || SUM(sml.qty_ok + sml.qty_ng) || ')' AS machine_text
                       FROM step_machine_logs sml
                       WHERE sml.form_id = se.form_id
                       GROUP BY sml.machine_code
                       ORDER BY sml.machine_code
                     )
                   ), '') AS machines_used
            FROM lots l
            LEFT JOIN step_entries se ON se.lot_code = l.lot_code
            WHERE l.order_code = ?
            ORDER BY l.lot_index, se.id
            """,
            (order_code,),
        ).fetchall()
