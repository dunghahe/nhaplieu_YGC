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


def split_lot_quantities(total_qty: int, qty_per_lot: int) -> list[int]:
    """Chia lô theo số PCS/lô người dùng nhập."""
    if qty_per_lot <= 0:
        raise ValueError("Số lượng PCS/lô phải > 0")
    if qty_per_lot > total_qty:
        return [total_qty]
    import math
    total_lots = math.ceil(total_qty / qty_per_lot)
    lots = [qty_per_lot for _ in range(total_lots - 1)]
    last_lot_qty = total_qty % qty_per_lot or qty_per_lot
    lots.append(last_lot_qty)
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
              work_date    DATE,
              shift        TEXT DEFAULT '',
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              technical_info TEXT DEFAULT '',
              tech_code    TEXT DEFAULT '',
              note         TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(form_id, line_index)
            );

            CREATE TABLE IF NOT EXISTS lot_qc_forms (
              lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
              max_qty      INTEGER NOT NULL DEFAULT 0,
              last_step_form_id TEXT DEFAULT '',
              last_step_name TEXT DEFAULT '',
              qc_date      TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lot_qc_rows (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              lot_code     TEXT NOT NULL REFERENCES lot_qc_forms(lot_code) ON DELETE CASCADE,
              line_index   INTEGER NOT NULL,
              check_name   TEXT DEFAULT '',
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              defect_content TEXT DEFAULT '',
              inspector    TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(lot_code, line_index)
            );

            CREATE TABLE IF NOT EXISTS lot_bavia_forms (
              lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
              max_qty      INTEGER NOT NULL DEFAULT 0,
              last_step_form_id TEXT DEFAULT '',
              last_step_name TEXT DEFAULT '',
              bavia_date   TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lot_bavia_rows (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              lot_code     TEXT NOT NULL REFERENCES lot_bavia_forms(lot_code) ON DELETE CASCADE,
              line_index   INTEGER NOT NULL,
              check_name   TEXT DEFAULT '',
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              defect_content TEXT DEFAULT '',
              inspector    TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(lot_code, line_index)
            );

            CREATE TABLE IF NOT EXISTS lot_bavia_work_forms (
              lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
              max_qty      INTEGER NOT NULL DEFAULT 0,
              work_date    TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lot_bavia_work_rows (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              lot_code     TEXT NOT NULL REFERENCES lot_bavia_work_forms(lot_code) ON DELETE CASCADE,
              machine_code TEXT DEFAULT '',
              worker_code  TEXT DEFAULT '',
              work_date    TEXT DEFAULT '',
              shift        TEXT DEFAULT '',
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              note         TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lot_warehouse_forms (
              lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
              max_qty      INTEGER NOT NULL DEFAULT 0,
              warehouse_date TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS lot_warehouse_rows (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              lot_code     TEXT NOT NULL REFERENCES lot_warehouse_forms(lot_code) ON DELETE CASCADE,
              line_index   INTEGER NOT NULL,
              check_name   TEXT DEFAULT '',
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              defect_content TEXT DEFAULT '',
              performer    TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(lot_code, line_index)
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
        machine_logs_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(step_machine_logs)").fetchall()
        }
        if "tech_code" not in machine_logs_cols:
            conn.execute("ALTER TABLE step_machine_logs ADD COLUMN tech_code TEXT DEFAULT ''")
        if "work_date" not in machine_logs_cols:
            conn.execute("ALTER TABLE step_machine_logs ADD COLUMN work_date DATE")
        if "shift" not in machine_logs_cols:
            conn.execute("ALTER TABLE step_machine_logs ADD COLUMN shift TEXT DEFAULT ''")
        if "technical_info" not in machine_logs_cols:
            conn.execute("ALTER TABLE step_machine_logs ADD COLUMN technical_info TEXT DEFAULT ''")
        lot_qc_form_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_qc_forms)").fetchall()}
        if not lot_qc_form_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_qc_forms (
                  lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
                  max_qty      INTEGER NOT NULL DEFAULT 0,
                  last_step_form_id TEXT DEFAULT '',
                  last_step_name TEXT DEFAULT '',
                  qc_date      TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        if "qc_date" not in lot_qc_form_cols:
            conn.execute("ALTER TABLE lot_qc_forms ADD COLUMN qc_date TEXT DEFAULT ''")
        lot_qc_row_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_qc_rows)").fetchall()}
        if not lot_qc_row_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_qc_rows (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  lot_code     TEXT NOT NULL REFERENCES lot_qc_forms(lot_code) ON DELETE CASCADE,
                  line_index   INTEGER NOT NULL,
                  check_name   TEXT DEFAULT '',
                  qty_ok       INTEGER DEFAULT 0,
                  qty_ng       INTEGER DEFAULT 0,
                  defect_content TEXT DEFAULT '',
                  inspector    TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(lot_code, line_index)
                )
                """
            )
        bavia_form_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_bavia_forms)").fetchall()}
        if not bavia_form_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_bavia_forms (
                  lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
                  max_qty      INTEGER NOT NULL DEFAULT 0,
                  last_step_form_id TEXT DEFAULT '',
                  last_step_name TEXT DEFAULT '',
                  bavia_date   TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        if "bavia_date" not in bavia_form_cols:
            conn.execute("ALTER TABLE lot_bavia_forms ADD COLUMN bavia_date TEXT DEFAULT ''")
        bavia_row_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_bavia_rows)").fetchall()}
        if not bavia_row_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_bavia_rows (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  lot_code     TEXT NOT NULL REFERENCES lot_bavia_forms(lot_code) ON DELETE CASCADE,
                  line_index   INTEGER NOT NULL,
                  check_name   TEXT DEFAULT '',
                  qty_ok       INTEGER DEFAULT 0,
                  qty_ng       INTEGER DEFAULT 0,
                  defect_content TEXT DEFAULT '',
                  inspector    TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(lot_code, line_index)
                )
                """
            )
        bavia_work_form_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_bavia_work_forms)").fetchall()}
        if not bavia_work_form_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_bavia_work_forms (
                  lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
                  max_qty      INTEGER NOT NULL DEFAULT 0,
                  work_date    TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        if "work_date" not in bavia_work_form_cols:
            conn.execute("ALTER TABLE lot_bavia_work_forms ADD COLUMN work_date TEXT DEFAULT ''")
        bavia_work_row_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_bavia_work_rows)").fetchall()}
        if not bavia_work_row_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_bavia_work_rows (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  lot_code     TEXT NOT NULL REFERENCES lot_bavia_work_forms(lot_code) ON DELETE CASCADE,
                  machine_code TEXT DEFAULT '',
                  worker_code  TEXT DEFAULT '',
                  work_date    TEXT DEFAULT '',
                  shift        TEXT DEFAULT '',
                  qty_ok       INTEGER DEFAULT 0,
                  qty_ng       INTEGER DEFAULT 0,
                  note         TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        warehouse_form_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_warehouse_forms)").fetchall()}
        if not warehouse_form_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_warehouse_forms (
                  lot_code     TEXT PRIMARY KEY REFERENCES lots(lot_code) ON DELETE CASCADE,
                  max_qty      INTEGER NOT NULL DEFAULT 0,
                  warehouse_date TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        if "warehouse_date" not in warehouse_form_cols:
            conn.execute("ALTER TABLE lot_warehouse_forms ADD COLUMN warehouse_date TEXT DEFAULT ''")
        warehouse_row_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_warehouse_rows)").fetchall()}
        if not warehouse_row_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_warehouse_rows (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  lot_code     TEXT NOT NULL REFERENCES lot_warehouse_forms(lot_code) ON DELETE CASCADE,
                  line_index   INTEGER NOT NULL,
                  check_name   TEXT DEFAULT '',
                  qty_ok       INTEGER DEFAULT 0,
                  qty_ng       INTEGER DEFAULT 0,
                  defect_content TEXT DEFAULT '',
                  performer    TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(lot_code, line_index)
                )
                """
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


def get_parts_summary(date_from: str | None = None, date_to: str | None = None) -> list[dict[str, Any]]:
    """Thống kê theo mã hàng: số đơn, tổng SL, đơn hoàn thành, OK, NG, có lọc ngày tạo đơn."""
    with connect() as conn:
        parts = conn.execute("SELECT id, part_code, created_at FROM parts ORDER BY created_at DESC, id DESC").fetchall()
        result = []
        for part in parts:
            # Build date filter clause
            date_cond = ""
            params: list[Any] = [part["part_code"]]
            if date_from:
                date_cond += " AND o.created_at >= ?"
                params.append(date_from)
            if date_to:
                date_cond += " AND o.created_at <= ?"
                params.append(date_to + " 23:59:59")

            orders_row = conn.execute(
                f"""
                SELECT COUNT(DISTINCT o.order_code) AS order_count,
                       COALESCE(SUM(o.total_qty), 0) AS total_qty
                FROM orders o
                WHERE o.part_code = ?{date_cond}
                """,
                params,
            ).fetchone()

            stats_row = conn.execute(
                f"""
                SELECT COALESCE(SUM(se.qty_ok), 0) AS total_ok,
                       COALESCE(SUM(se.qty_ng), 0) AS total_ng
                FROM step_entries se
                JOIN lots l ON l.lot_code = se.lot_code
                JOIN orders o ON o.order_code = l.order_code
                WHERE o.part_code = ?{date_cond}
                """,
                params,
            ).fetchone()

            completed_row = conn.execute(
                f"""
                SELECT COUNT(*) AS completed_orders
                FROM orders o
                WHERE o.part_code = ?{date_cond}
                  AND NOT EXISTS (
                    SELECT 1
                    FROM lots l
                    WHERE l.order_code = o.order_code
                      AND (
                        NOT EXISTS (
                          SELECT 1
                          FROM step_entries se
                          WHERE se.lot_code = l.lot_code
                        )
                        OR EXISTS (
                          SELECT 1
                          FROM step_entries se
                          WHERE se.lot_code = l.lot_code
                            AND se.status != 'done'
                        )
                      )
                  )
                """,
                params,
            ).fetchone()

            result.append({
                "part_code": part["part_code"],
                "created_at": part["created_at"],
                "order_count": orders_row["order_count"] or 0,
                "total_qty": orders_row["total_qty"] or 0,
                "completed_orders": completed_row["completed_orders"] or 0,
                "total_ok": stats_row["total_ok"] or 0,
                "total_ng": stats_row["total_ng"] or 0,
            })
        return result


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


def update_part_steps(part_code: str, steps: list[dict[str, Any]]) -> None:
    """Cập nhật lại toàn bộ quy trình công đoạn cho một mã hàng."""
    with connect() as conn:
        part = conn.execute("SELECT id FROM parts WHERE part_code = ?", (part_code,)).fetchone()
        if not part:
            raise LookupError("Không tìm thấy mã hàng")
        conn.execute("DELETE FROM part_steps WHERE part_id = ?", (part["id"],))
        for step in steps:
            conn.execute(
                "INSERT INTO part_steps (part_id, step_name, step_order, cycle_time_seconds) VALUES (?, ?, ?, ?)",
                (part["id"], step["step_name"].strip(), step["step_order"], step["duration_seconds"]),
            )


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


def create_order(order_code: str, part_code: str, total_qty: int, qty_per_lot: int, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Tạo đơn hàng, chia lô dựa trên qty_per_lot."""
    if not get_part(part_code):
        raise LookupError("Mã hàng không tồn tại")

    lot_quantities = split_lot_quantities(total_qty, qty_per_lot)
    total_lots = len(lot_quantities)
    order_extra = normalize_order_extra(extra)
    with connect() as conn:
        try:
            conn.execute(
                """
                INSERT INTO orders(
                    order_code, part_code, total_qty, qty_per_lot, planned_lots, total_lots,
                    raw_material_code, drawing_code, drawing_rev, material,
                    blank_size, order_receive_date, blank_issue_date, delivered_by, received_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_code, part_code, total_qty, qty_per_lot, total_lots, total_lots,
                    order_extra["raw_material_code"], order_extra["drawing_code"], order_extra["drawing_rev"],
                    order_extra["material"], order_extra["blank_size"],
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
        "planned_lots": total_lots,
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
                blank_size = ?, order_receive_date = ?, blank_issue_date = ?,
                delivered_by = ?, received_by = ?
            WHERE order_code = ?
            """,
            (
                part_code, total_qty, qty_per_lot, planned_lots, total_lots,
                order_extra["raw_material_code"], order_extra["drawing_code"], order_extra["drawing_rev"],
                order_extra["material"], order_extra["blank_size"],
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


DEFAULT_QC_ITEMS = [
	"Đo 100% kích thước theo tiêu chuẩn",
	"Soi ngoại quan 100%",
	"Kiểm tra đúng mã sản phẩm, chất liệu",
	"QC trong kiểm tra xác suất",
]

DEFAULT_BAVIA_ITEMS = DEFAULT_QC_ITEMS[:3]

DEFAULT_WAREHOUSE_ITEMS = [
    "Số lượng nhận từ QC",
    "Kiểm tra đúng mã sản phẩm, chất liệu",
    "Đóng gói",
]


def get_lot_last_output(conn: sqlite3.Connection, lot_code: str) -> dict[str, Any]:
    """Lấy output của công đoạn cuối cùng trong lô để làm giới hạn QC."""
    row = conn.execute(
        """
        SELECT se.form_id, se.step_name,
               COALESCE(se.qty_ok, 0) AS qty_ok,
               COALESCE(se.qty_ng, 0) AS qty_ng,
               COALESCE(se.qty_ok, 0) + COALESCE(se.qty_ng, 0) AS max_qty
        FROM step_entries se
        WHERE se.lot_code = ?
        ORDER BY se.id DESC
        LIMIT 1
        """,
        (lot_code,),
    ).fetchone()
    if not row:
        return {"form_id": "", "step_name": "", "qty_ok": 0, "qty_ng": 0, "max_qty": 0}
    return dict(row)


def get_lot_bavia_work_limit(conn: sqlite3.Connection, lot_code: str) -> int:
    """Lấy số lượng tối đa của Bavia từ tổng OK+NG đã nhập ở form Bavia work."""
    row = conn.execute(
        """
        SELECT COALESCE(qty_ok, 0) AS qty_ok,
               COALESCE(qty_ng, 0) AS qty_ng
        FROM lot_bavia_work_rows
        WHERE lot_code = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (lot_code,),
    ).fetchone()
    if row:
        return int(row["qty_ok"] or 0) + int(row["qty_ng"] or 0)
    form_row = conn.execute(
        "SELECT max_qty FROM lot_bavia_work_forms WHERE lot_code = ?",
        (lot_code,),
    ).fetchone()
    return int(form_row["max_qty"] or 0) if form_row else 0


def _get_quality_form(
    lot_code: str,
    *,
    form_table: str,
    row_table: str,
    date_column: str,
    date_key: str,
    default_items: list[str],
    row_limit: int,
    use_bavia_work_limit: bool = False,
) -> dict[str, Any] | None:
    """L?y form ch?t l??ng theo l? cho QC/Bavia."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            return None
        last_output = get_lot_last_output(conn, lot_code)
        max_qty = get_lot_bavia_work_limit(conn, lot_code) if use_bavia_work_limit else int(last_output["max_qty"] or 0)
        rows = conn.execute(
            f"""
            SELECT line_index, check_name, qty_ok, qty_ng, defect_content, inspector
            FROM {row_table}
            WHERE lot_code = ?
              AND line_index BETWEEN 1 AND ?
              AND UPPER(COALESCE(check_name, '')) != 'T?NG'
            ORDER BY line_index
            """,
            (lot_code, row_limit),
        ).fetchall()
        if not rows:
            rows = [
                {
                    "line_index": index,
                    "check_name": item,
                    "qty_ok": 0,
                    "qty_ng": 0,
                    "defect_content": "",
                    "inspector": "",
                }
                for index, item in enumerate(default_items, start=1)
            ]
        form_row = conn.execute(
            f"SELECT {date_column} FROM {form_table} WHERE lot_code = ?",
            (lot_code,),
        ).fetchone()
        return {
            "lot": lot,
            "order": conn.execute("SELECT * FROM orders WHERE order_code = ?", (lot["order_code"],)).fetchone(),
            "max_qty": max_qty,
            "last_step_form_id": last_output["form_id"],
            "last_step_name": last_output["step_name"],
            "last_step_ok": int(last_output["qty_ok"] or 0),
            "last_step_ng": int(last_output["qty_ng"] or 0),
            date_key: (form_row[date_column] if form_row else "") or "",
            "rows": rows,
        }


def _save_quality_form(
    lot_code: str,
    payload: dict[str, Any],
    *,
    form_table: str,
    row_table: str,
    date_column: str,
    date_key: str,
    default_items: list[str],
    row_limit: int,
    use_bavia_work_limit: bool = False,
) -> dict[str, Any]:
    """L?u form ch?t l??ng theo l? cho QC/Bavia."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Kh?ng t?m th?y l?")
        last_output = get_lot_last_output(conn, lot_code)
        max_qty = get_lot_bavia_work_limit(conn, lot_code) if use_bavia_work_limit else int(last_output["max_qty"] or 0)
        form_date = str(payload.get(date_key) or "").strip()
        rows = list(payload.get("rows") or [])[:row_limit]
        cleaned_rows: list[dict[str, Any]] = []
        previous_total = max_qty
        blank_seen = False
        for index, row in enumerate(rows, start=1):
            qty_ok = int(row.get("qty_ok") or 0)
            qty_ng = int(row.get("qty_ng") or 0)
            defect_content = str(row.get("defect_content") or "").strip()
            inspector = str(row.get("inspector") or "").strip()
            raw_check_name = str(row.get("check_name") or "").strip().upper()
            if raw_check_name == "T?NG":
                continue
            has_data = (qty_ok + qty_ng) > 0
            if blank_seen and has_data:
                raise ValueError("C?ng ?o?n ph?i nh?p tu?n t?, kh?ng ???c b? tr?ng c?ng ?o?n tr??c")
            if not has_data:
                blank_seen = True
                continue
            if index > 1 and previous_total <= 0:
                raise ValueError("C?ng ?o?n tr??c ch?a c? d? li?u, ch?a th? nh?p c?ng ?o?n sau")
            row_limit_qty = max_qty if index == 1 else previous_total
            if row_limit_qty and qty_ok + qty_ng > row_limit_qty:
                raise ValueError(f"T?ng OK + NG c?a c?ng ?o?n kh?ng ???c v??t qu? s? l??ng t?i ?a {row_limit_qty}")
            if not inspector:
                raise ValueError("Vui lòng chọn người kiểm tra cho tất cả các dòng có dữ liệu")
            cleaned_rows.append({
                "line_index": index,
                "check_name": default_items[index - 1] if index - 1 < len(default_items) else f"QC {index}",
                "qty_ok": qty_ok,
                "qty_ng": qty_ng,
                "defect_content": defect_content,
                "inspector": inspector,
            })
            previous_total = qty_ok + qty_ng
        conn.execute(
            f"""
            INSERT INTO {form_table}(lot_code, max_qty, last_step_form_id, last_step_name, {date_column}, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(lot_code) DO UPDATE SET
              max_qty = excluded.max_qty,
              last_step_form_id = excluded.last_step_form_id,
              last_step_name = excluded.last_step_name,
              {date_column} = excluded.{date_column},
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                lot_code,
                max_qty,
                last_output["form_id"],
                last_output["step_name"],
                form_date,
            ),
        )
        conn.execute(f"DELETE FROM {row_table} WHERE lot_code = ?", (lot_code,))
        for row in cleaned_rows:
            conn.execute(
                f"""
                INSERT INTO {row_table}(lot_code, line_index, check_name, qty_ok, qty_ng, defect_content, inspector)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lot_code,
                    row["line_index"],
                    row["check_name"],
                    row["qty_ok"],
                    row["qty_ng"],
                    row["defect_content"],
                    row["inspector"],
                ),
            )
    return _get_quality_form(
        lot_code,
        form_table=form_table,
        row_table=row_table,
        date_column=date_column,
        date_key=date_key,
        default_items=default_items,
        row_limit=row_limit,
    ) or {"lot_code": lot_code, "max_qty": max_qty, "rows": cleaned_rows}


def get_lot_qc(lot_code: str) -> dict[str, Any] | None:
    """L?y form QC c?a l?, n?u ch?a c? d? li?u th? tr? v? m?u r?ng."""
    return _get_quality_form(
        lot_code,
        form_table="lot_qc_forms",
        row_table="lot_qc_rows",
        date_column="qc_date",
        date_key="qc_date",
        default_items=DEFAULT_QC_ITEMS,
        row_limit=4,
    )


def save_lot_qc(lot_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    """L?u to?n b? form QC theo l?."""
    return _save_quality_form(
        lot_code,
        payload,
        form_table="lot_qc_forms",
        row_table="lot_qc_rows",
        date_column="qc_date",
        date_key="qc_date",
        default_items=DEFAULT_QC_ITEMS,
        row_limit=4,
    )


def get_lot_bavia(lot_code: str) -> dict[str, Any] | None:
    """L?y form Bavia c?a l?, n?u ch?a c? d? li?u th? tr? v? m?u r?ng."""
    return _get_quality_form(
        lot_code,
        form_table="lot_bavia_forms",
        row_table="lot_bavia_rows",
        date_column="bavia_date",
        date_key="bavia_date",
        default_items=DEFAULT_BAVIA_ITEMS,
        row_limit=3,
        use_bavia_work_limit=True,
    )


def save_lot_bavia(lot_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    """L?u to?n b? form Bavia theo l?."""
    return _save_quality_form(
        lot_code,
        payload,
        form_table="lot_bavia_forms",
        row_table="lot_bavia_rows",
        date_column="bavia_date",
        date_key="bavia_date",
        default_items=DEFAULT_BAVIA_ITEMS,
        row_limit=3,
        use_bavia_work_limit=True,
    )


def get_lot_bavia_work(lot_code: str) -> dict[str, Any] | None:
    """Lấy form nhập sản lượng Bavia theo lô."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            return None
        last_output = get_lot_last_output(conn, lot_code)
        form_row = conn.execute(
            "SELECT work_date FROM lot_bavia_work_forms WHERE lot_code = ?",
            (lot_code,),
        ).fetchone()
        row = conn.execute(
            """
            SELECT *
            FROM lot_bavia_work_rows
            WHERE lot_code = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (lot_code,),
        ).fetchone()
        if not row:
            row = {
                "machine_code": "",
                "worker_code": "",
                "work_date": "",
                "shift": "",
                "qty_ok": 0,
                "qty_ng": 0,
                "note": "",
            }
        return {
            "lot": lot,
            "order": conn.execute("SELECT * FROM orders WHERE order_code = ?", (lot["order_code"],)).fetchone(),
            "max_qty": int(last_output["max_qty"] or 0),
            "last_step_form_id": last_output["form_id"],
            "last_step_name": last_output["step_name"],
            "last_step_ok": int(last_output["qty_ok"] or 0),
            "last_step_ng": int(last_output["qty_ng"] or 0),
            "work_date": (form_row["work_date"] if form_row else "") or "",
            "row": row,
        }


def save_lot_bavia_work(lot_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Lưu form nhập sản lượng Bavia theo lô."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Không tìm thấy lô")
        last_output = get_lot_last_output(conn, lot_code)
        max_qty = int(last_output["max_qty"] or 0)
        work_date = str(payload.get("work_date") or "").strip()
        row = dict(payload.get("row") or {})
        qty_ok = int(row.get("qty_ok") or 0)
        qty_ng = int(row.get("qty_ng") or 0)
        total = qty_ok + qty_ng
        if max_qty and total > max_qty:
            raise ValueError(f"Tổng OK + NG không được vượt quá số lượng tối đa {max_qty}")
        conn.execute(
            """
            INSERT INTO lot_bavia_work_forms(lot_code, max_qty, work_date, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(lot_code) DO UPDATE SET
              max_qty = excluded.max_qty,
              work_date = excluded.work_date,
              updated_at = CURRENT_TIMESTAMP
            """,
            (lot_code, max_qty, work_date),
        )
        conn.execute("DELETE FROM lot_bavia_work_rows WHERE lot_code = ?", (lot_code,))
        conn.execute(
            """
            INSERT INTO lot_bavia_work_rows(lot_code, machine_code, worker_code, work_date, shift, qty_ok, qty_ng, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lot_code,
                str(row.get("machine_code") or "").strip(),
                str(row.get("worker_code") or "").strip(),
                str(row.get("work_date") or work_date or "").strip(),
                str(row.get("shift") or "").strip(),
                qty_ok,
                qty_ng,
                str(row.get("note") or "").strip(),
            ),
        )
    return get_lot_bavia_work(lot_code) or {"lot_code": lot_code, "max_qty": max_qty, "row": row}


def get_lot_bavia_work(lot_code: str) -> dict[str, Any] | None:
    """Lấy form nhập sản lượng Bavia theo lô, với max lấy từ tổng OK+NG của Bavia work."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            return None
        last_output = get_lot_last_output(conn, lot_code)
        form_row = conn.execute(
            "SELECT work_date FROM lot_bavia_work_forms WHERE lot_code = ?",
            (lot_code,),
        ).fetchone()
        row = conn.execute(
            """
            SELECT *
            FROM lot_bavia_work_rows
            WHERE lot_code = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (lot_code,),
        ).fetchone()
        if not row:
            row = {
                "machine_code": "",
                "worker_code": "",
                "work_date": "",
                "shift": "",
                "qty_ok": 0,
                "qty_ng": 0,
                "note": "",
            }
        return {
            "lot": lot,
            "order": conn.execute("SELECT * FROM orders WHERE order_code = ?", (lot["order_code"],)).fetchone(),
            "max_qty": get_lot_bavia_work_limit(conn, lot_code),
            "last_step_form_id": last_output["form_id"],
            "last_step_name": last_output["step_name"],
            "last_step_ok": int(last_output["qty_ok"] or 0),
            "last_step_ng": int(last_output["qty_ng"] or 0),
            "work_date": (form_row["work_date"] if form_row else "") or "",
            "row": row,
        }


def save_lot_bavia_work(lot_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Lưu form nhập sản lượng Bavia theo lô, đồng thời lưu max_qty = OK + NG."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Không tìm thấy lô")
        work_date = str(payload.get("work_date") or "").strip()
        row = dict(payload.get("row") or {})
        qty_ok = int(row.get("qty_ok") or 0)
        qty_ng = int(row.get("qty_ng") or 0)
        total = qty_ok + qty_ng
        max_qty = int(lot["qty_per_lot"] or 0)
        if max_qty and total > max_qty:
            raise ValueError(f"Tổng OK + NG không được vượt quá số lượng tối đa {max_qty}")
        conn.execute(
            """
            INSERT INTO lot_bavia_work_forms(lot_code, max_qty, work_date, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(lot_code) DO UPDATE SET
              max_qty = excluded.max_qty,
              work_date = excluded.work_date,
              updated_at = CURRENT_TIMESTAMP
            """,
            (lot_code, total, work_date),
        )
        conn.execute("DELETE FROM lot_bavia_work_rows WHERE lot_code = ?", (lot_code,))
        conn.execute(
            """
            INSERT INTO lot_bavia_work_rows(lot_code, machine_code, worker_code, work_date, shift, qty_ok, qty_ng, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lot_code,
                str(row.get("machine_code") or "").strip(),
                str(row.get("worker_code") or "").strip(),
                str(row.get("work_date") or work_date or "").strip(),
                str(row.get("shift") or "").strip(),
                qty_ok,
                qty_ng,
                str(row.get("note") or "").strip(),
            ),
        )
    return get_lot_bavia_work(lot_code) or {"lot_code": lot_code, "max_qty": total, "row": row}


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
            SELECT sml.*,
                   m.machine_name,
                   w.worker_name,
                   tw.worker_name AS tech_name
            FROM step_machine_logs sml
            LEFT JOIN machines m ON m.machine_code = sml.machine_code
            LEFT JOIN workers w ON w.worker_code = sml.worker_code
            LEFT JOIN workers tw ON tw.worker_code = sml.tech_code
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


def validate_machine_log_refs(conn: sqlite3.Connection, machine_code: str, worker_code: str, tech_code: str = "") -> None:
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
    tech_code = (tech_code or "").strip().upper()
    if tech_code:
        tech = conn.execute(
            "SELECT * FROM workers WHERE worker_code = ? AND is_active = 1",
            (tech_code,),
        ).fetchone()
        if not tech:
            raise LookupError("Không tìm thấy kỹ thuật đang hoạt động")


def create_machine_log(form_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Thêm một dòng máy mới và cập nhật lại status form."""
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM step_entries WHERE form_id = ?", (form_id,)).fetchone():
            raise LookupError("Không tìm thấy biểu mẫu")
        validate_machine_log_refs(conn, payload["machine_code"], payload["worker_code"], payload.get("tech_code") or "")
        next_index = conn.execute(
            "SELECT COALESCE(MAX(line_index), 0) + 1 AS next_index FROM step_machine_logs WHERE form_id = ?",
            (form_id,),
        ).fetchone()["next_index"]
        conn.execute(
            """
            INSERT INTO step_machine_logs(form_id, line_index, machine_code, worker_code, work_date, shift, qty_ok, qty_ng, technical_info, note, tech_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                form_id,
                next_index,
                payload["machine_code"],
                payload["worker_code"],
                payload.get("work_date"),
                payload.get("shift") or "",
                int(payload.get("qty_ok") or 0),
                int(payload.get("qty_ng") or 0),
                payload.get("technical_info") or "",
                payload.get("note") or "",
                payload.get("tech_code") or "",
            ),
        )
        recalc_entry_from_machine_logs(conn, form_id)
    return {"line_index": next_index, **payload}


def update_machine_log(form_id: str, line_index: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Cập nhật một dòng máy và cập nhật lại status form."""
    with connect() as conn:
        validate_machine_log_refs(conn, payload["machine_code"], payload["worker_code"], payload.get("tech_code") or "")
        cur = conn.execute(
            """
            UPDATE step_machine_logs
            SET machine_code = ?, worker_code = ?, work_date = ?, shift = ?, qty_ok = ?, qty_ng = ?, technical_info = ?, note = ?, tech_code = ?
            WHERE form_id = ? AND line_index = ?
            """,
            (
                payload["machine_code"],
                payload["worker_code"],
                payload.get("work_date"),
                payload.get("shift") or "",
                int(payload.get("qty_ok") or 0),
                int(payload.get("qty_ng") or 0),
                payload.get("technical_info") or "",
                payload.get("note") or "",
                payload.get("tech_code") or "",
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
                   COALESCE((
                     SELECT sml.work_date
                     FROM step_machine_logs sml
                     WHERE sml.form_id = se.form_id AND COALESCE(sml.work_date, '') != ''
                     ORDER BY sml.line_index
                     LIMIT 1
                   ), se.work_date, '') AS work_date,
                   COALESCE((
                     SELECT sml.shift
                     FROM step_machine_logs sml
                     WHERE sml.form_id = se.form_id AND COALESCE(sml.shift, '') != ''
                     ORDER BY sml.line_index
                     LIMIT 1
                   ), se.shift, '') AS shift,
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


def get_lot_warehouse(lot_code: str) -> dict[str, Any] | None:
    """Lấy form nhập kho thành phẩm theo lô."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            return None
        last_output = get_lot_last_output(conn, lot_code)
        source_max = int(last_output["qty_ok"] or 0)
        form_row = conn.execute(
            "SELECT warehouse_date FROM lot_warehouse_forms WHERE lot_code = ?",
            (lot_code,),
        ).fetchone()
        rows = conn.execute(
            """
            SELECT line_index, check_name, qty_ok, qty_ng, defect_content, performer
            FROM lot_warehouse_rows
            WHERE lot_code = ?
            ORDER BY line_index
            """,
            (lot_code,),
        ).fetchall()
        if not rows:
            rows = [
                {
                    "line_index": index,
                    "check_name": item,
                    "qty_ok": 0,
                    "qty_ng": 0,
                    "defect_content": "",
                    "performer": "",
                }
                for index, item in enumerate(DEFAULT_WAREHOUSE_ITEMS, start=1)
            ]
        return {
            "lot": lot,
            "order": conn.execute("SELECT * FROM orders WHERE order_code = ?", (lot["order_code"],)).fetchone(),
            "max_qty": source_max,
            "last_step_form_id": last_output["form_id"],
            "last_step_name": last_output["step_name"],
            "last_step_ok": int(last_output["qty_ok"] or 0),
            "last_step_ng": int(last_output["qty_ng"] or 0),
            "warehouse_date": (form_row["warehouse_date"] if form_row else "") or "",
            "rows": rows,
        }


def save_lot_warehouse(lot_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Lưu form nhập kho thành phẩm theo lô."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Không tìm thấy lô")
        last_output = get_lot_last_output(conn, lot_code)
        source_max = int(last_output["qty_ok"] or 0)
        form_date = str(payload.get("warehouse_date") or "").strip()
        rows = list(payload.get("rows") or [])[:3]
        cleaned_rows: list[dict[str, Any]] = []
        previous_total = source_max
        blank_seen = False
        for index, row in enumerate(rows, start=1):
            qty_ok = int(row.get("qty_ok") or 0)
            qty_ng = int(row.get("qty_ng") or 0)
            defect_content = str(row.get("defect_content") or "").strip()
            performer = str(row.get("performer") or "").strip()
            if index in (1, 3):
                qty_ng = 0
                defect_content = ""
            has_data = (qty_ok + qty_ng) > 0
            if blank_seen and has_data:
                raise ValueError("Công đoạn phải nhập tuần tự, không được bỏ trống công đoạn trước")
            if not has_data:
                blank_seen = True
                continue
            if index > 1 and previous_total <= 0:
                raise ValueError("Công đoạn trước chưa có dữ liệu, chưa thể nhập công đoạn sau")
            row_limit_qty = source_max if index == 1 else previous_total
            if row_limit_qty and qty_ok + qty_ng > row_limit_qty:
                raise ValueError(f"Tổng OK + NG của công đoạn không được vượt quá số lượng tối đa {row_limit_qty}")
            if not performer:
                raise ValueError("Vui lòng chọn người thực hiện cho tất cả các dòng có dữ liệu")
            cleaned_rows.append({
                "line_index": index,
                "check_name": DEFAULT_WAREHOUSE_ITEMS[index - 1] if index - 1 < len(DEFAULT_WAREHOUSE_ITEMS) else f"KHO {index}",
                "qty_ok": qty_ok,
                "qty_ng": qty_ng,
                "defect_content": defect_content,
                "performer": performer,
            })
            previous_total = qty_ok + qty_ng
        conn.execute(
            """
            INSERT INTO lot_warehouse_forms(lot_code, max_qty, warehouse_date, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(lot_code) DO UPDATE SET
              max_qty = excluded.max_qty,
              warehouse_date = excluded.warehouse_date,
              updated_at = CURRENT_TIMESTAMP
            """,
            (lot_code, source_max, form_date),
        )
        conn.execute("DELETE FROM lot_warehouse_rows WHERE lot_code = ?", (lot_code,))
        for row in cleaned_rows:
            conn.execute(
                """
                INSERT INTO lot_warehouse_rows(lot_code, line_index, check_name, qty_ok, qty_ng, defect_content, performer)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lot_code,
                    row["line_index"],
                    row["check_name"],
                    row["qty_ok"],
                    row["qty_ng"],
                    row["defect_content"],
                    row["performer"],
                ),
            )
    return get_lot_warehouse(lot_code) or {"lot_code": lot_code, "max_qty": source_max, "rows": cleaned_rows}
