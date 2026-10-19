from __future__ import annotations

import math
import re
import sqlite3
import unicodedata
from datetime import datetime
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
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
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
              printed     INTEGER NOT NULL DEFAULT 0,
              blank_received_by   TEXT DEFAULT '',
              blank_received_at   TEXT DEFAULT '',
              created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS step_entries (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              form_id     TEXT UNIQUE NOT NULL,
              lot_code    TEXT NOT NULL,
              step_name   TEXT NOT NULL,
              work_date   DATE,
              shift       TEXT DEFAULT 'KÍP 1'
                            CHECK(shift IN ('KÍP 1','KÍP 2','TĂNG CA')),
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
              line_index   INTEGER NOT NULL DEFAULT 1,
              machine_code TEXT DEFAULT '',
              worker_code  TEXT DEFAULT '',
              tech_code    TEXT DEFAULT '',
              work_date    TEXT DEFAULT '',
              shift        TEXT DEFAULT '',
              qty_ok       INTEGER DEFAULT 0,
              qty_ng       INTEGER DEFAULT 0,
              note         TEXT DEFAULT '',
              created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(lot_code, line_index)
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
        lot_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(lots)").fetchall()
        }
        if "printed" not in lot_columns:
            conn.execute("ALTER TABLE lots ADD COLUMN printed INTEGER NOT NULL DEFAULT 0")
        if "blank_received_by" not in lot_columns:
            conn.execute("ALTER TABLE lots ADD COLUMN blank_received_by TEXT DEFAULT ''")
        if "blank_received_at" not in lot_columns:
            conn.execute("ALTER TABLE lots ADD COLUMN blank_received_at TEXT DEFAULT ''")
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
                  line_index   INTEGER NOT NULL DEFAULT 1,
                  machine_code TEXT DEFAULT '',
                  worker_code  TEXT DEFAULT '',
                  tech_code    TEXT DEFAULT '',
                  work_date    TEXT DEFAULT '',
                  shift        TEXT DEFAULT '',
                  qty_ok       INTEGER DEFAULT 0,
                  qty_ng       INTEGER DEFAULT 0,
                  note         TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        if "tech_code" not in bavia_work_row_cols:
            conn.execute("ALTER TABLE lot_bavia_work_rows ADD COLUMN tech_code TEXT DEFAULT ''")
        if "line_index" not in bavia_work_row_cols:
            conn.execute("ALTER TABLE lot_bavia_work_rows ADD COLUMN line_index INTEGER NOT NULL DEFAULT 0")
            # Dữ liệu cũ mỗi lô chỉ có tối đa 1 dòng (bản trước ghi đè), nên đánh số lại theo id để an toàn.
            counters: dict[str, int] = {}
            for row in conn.execute(
                "SELECT id, lot_code FROM lot_bavia_work_rows ORDER BY lot_code, id"
            ).fetchall():
                counters[row["lot_code"]] = counters.get(row["lot_code"], 0) + 1
                conn.execute(
                    "UPDATE lot_bavia_work_rows SET line_index = ? WHERE id = ?",
                    (counters[row["lot_code"]], row["id"]),
                )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_bavia_work_rows_lot_line ON lot_bavia_work_rows(lot_code, line_index)"
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
        # Bảng phiếu nhập kho mới (đơn giản: qty + date, nhiều phiếu/lô)
        receipts_cols = {row["name"] for row in conn.execute("PRAGMA table_info(lot_warehouse_receipts)").fetchall()}
        if not receipts_cols:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lot_warehouse_receipts (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  lot_code     TEXT NOT NULL REFERENCES lots(lot_code) ON DELETE CASCADE,
                  qty          INTEGER NOT NULL DEFAULT 0,
                  receipt_date TEXT DEFAULT '',
                  note         TEXT DEFAULT '',
                  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

        # Index cho các truy vấn lớn / báo cáo / lọc theo ngày
        index_statements = [
            "CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC, id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_orders_part_code ON orders(part_code)",
            "CREATE INDEX IF NOT EXISTS idx_orders_order_receive_date ON orders(order_receive_date)",
            "CREATE INDEX IF NOT EXISTS idx_orders_effective_date ON orders(COALESCE(NULLIF(order_receive_date, ''), substr(created_at, 1, 10)))",
            "CREATE INDEX IF NOT EXISTS idx_lots_order_code ON lots(order_code, lot_index)",
            "CREATE INDEX IF NOT EXISTS idx_lots_part_code ON lots(part_code)",
            "CREATE INDEX IF NOT EXISTS idx_step_entries_lot_code_id ON step_entries(lot_code, id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_step_entries_work_date ON step_entries(work_date)",
            "CREATE INDEX IF NOT EXISTS idx_step_entries_status ON step_entries(status)",
            "CREATE INDEX IF NOT EXISTS idx_step_machine_logs_form_line ON step_machine_logs(form_id, line_index)",
            "CREATE INDEX IF NOT EXISTS idx_step_machine_logs_machine_code ON step_machine_logs(machine_code)",
            "CREATE INDEX IF NOT EXISTS idx_step_machine_logs_work_date ON step_machine_logs(work_date)",
            "CREATE INDEX IF NOT EXISTS idx_part_steps_part_order ON part_steps(part_id, step_order)",
            "CREATE INDEX IF NOT EXISTS idx_part_steps_part_step_name ON part_steps(part_id, UPPER(TRIM(step_name)))",
            "CREATE INDEX IF NOT EXISTS idx_lot_warehouse_receipts_lot_id ON lot_warehouse_receipts(lot_code, id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_lot_qc_forms_date ON lot_qc_forms(qc_date)",
            "CREATE INDEX IF NOT EXISTS idx_lot_bavia_forms_date ON lot_bavia_forms(bavia_date)",
            "CREATE INDEX IF NOT EXISTS idx_lot_bavia_work_forms_date ON lot_bavia_work_forms(work_date)",
            "CREATE INDEX IF NOT EXISTS idx_lot_warehouse_forms_date ON lot_warehouse_forms(warehouse_date)",
        ]
        for stmt in index_statements:
            conn.execute(stmt)

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
        where_clause = ""
        params: list[Any] = []
        if date_from:
            where_clause += " AND o.created_at >= ?"
            params.append(f"{date_from} 00:00:00")
        if date_to:
            where_clause += " AND o.created_at <= ?"
            params.append(f"{date_to} 23:59:59")

        return conn.execute(
            f"""
            WITH filtered_orders AS (
              SELECT o.order_code, o.part_code, o.total_qty
              FROM orders o
              WHERE 1=1{where_clause}
            ),
            order_stats AS (
              SELECT fo.part_code,
                     COUNT(*) AS order_count,
                     COALESCE(SUM(fo.total_qty), 0) AS total_qty
              FROM filtered_orders fo
              GROUP BY fo.part_code
            ),
            entry_stats AS (
              SELECT fo.part_code,
                     COALESCE(SUM(se.qty_ok), 0) AS total_ok,
                     COALESCE(SUM(se.qty_ng), 0) AS total_ng
              FROM filtered_orders fo
              JOIN lots l ON l.order_code = fo.order_code
              JOIN step_entries se ON se.lot_code = l.lot_code
              GROUP BY fo.part_code
            ),
            lot_stats AS (
              SELECT l.order_code,
                     l.lot_code,
                     COALESCE(se.total_entries, 0) AS total_entries,
                     COALESCE(se.not_done_entries, 0) AS not_done_entries
              FROM lots l
              LEFT JOIN (
                SELECT lot_code,
                       COUNT(*) AS total_entries,
                       COALESCE(SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END), 0) AS not_done_entries
                FROM step_entries
                GROUP BY lot_code
              ) se ON se.lot_code = l.lot_code
            ),
            completed_stats AS (
              SELECT fo.part_code,
                     COUNT(*) AS completed_orders
              FROM filtered_orders fo
              JOIN lot_stats ls ON ls.order_code = fo.order_code
              GROUP BY fo.part_code, fo.order_code
              HAVING MIN(CASE WHEN ls.total_entries > 0 AND ls.not_done_entries = 0 THEN 1 ELSE 0 END) = 1
            )
            SELECT p.part_code,
                   p.created_at,
                   COALESCE(os.order_count, 0) AS order_count,
                   COALESCE(os.total_qty, 0) AS total_qty,
                   COALESCE(cs.completed_orders, 0) AS completed_orders,
                   COALESCE(es.total_ok, 0) AS total_ok,
                   COALESCE(es.total_ng, 0) AS total_ng
            FROM parts p
            LEFT JOIN order_stats os ON os.part_code = p.part_code
            LEFT JOIN entry_stats es ON es.part_code = p.part_code
            LEFT JOIN (
              SELECT part_code, SUM(completed_orders) AS completed_orders
              FROM completed_stats
              GROUP BY part_code
            ) cs ON cs.part_code = p.part_code
            ORDER BY p.created_at DESC, p.id DESC
            """,
            params,
        ).fetchall()


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
        return conn.execute(
            """
            WITH entry_stats AS (
              SELECT l.order_code,
                     COUNT(se.id) AS total_entries,
                     COALESCE(SUM(CASE WHEN se.status = 'done' THEN 1 ELSE 0 END), 0) AS done_entries
              FROM lots l
              LEFT JOIN step_entries se ON se.lot_code = l.lot_code
              GROUP BY l.order_code
            )
            SELECT o.*,
                   ROUND(
                     CASE
                       WHEN COALESCE(es.total_entries, 0) > 0
                       THEN COALESCE(es.done_entries, 0) * 100.0 / es.total_entries
                       ELSE 0
                     END,
                     1
                   ) AS progress_percent
            FROM orders o
            LEFT JOIN entry_stats es ON es.order_code = o.order_code
            ORDER BY o.created_at DESC, o.id DESC
            """
        ).fetchall()


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
            """
            SELECT lot_code, qty_per_lot, lot_index, printed,
                   blank_received_by, blank_received_at
            FROM lots
            WHERE order_code = ?
            ORDER BY lot_index
            """,
            (order_code,),
        ).fetchall()
        return order


def mark_order_lots_printed(order_code: str, start_index: int, end_index: int) -> dict[str, Any]:
    """Đánh dấu một dải lô trong đơn là đã in."""
    if start_index <= 0 or end_index <= 0:
        raise ValueError("Số lô phải lớn hơn 0")
    if start_index > end_index:
        raise ValueError("Lô bắt đầu phải nhỏ hơn hoặc bằng lô kết thúc")

    with connect() as conn:
        order = conn.execute(
            "SELECT order_code, total_lots FROM orders WHERE order_code = ?",
            (order_code,),
        ).fetchone()
        if not order:
            raise LookupError("Không tìm thấy đơn hàng")
        total_lots = int(order["total_lots"] or 0)
        if end_index > total_lots:
            raise ValueError(f"Lô kết thúc không được vượt quá tổng số lô ({total_lots})")

        conn.execute(
            """
            UPDATE lots
            SET printed = 1
            WHERE order_code = ? AND lot_index BETWEEN ? AND ?
            """,
            (order_code, start_index, end_index),
        )
        printed_total = conn.execute(
            "SELECT COUNT(*) AS count_printed FROM lots WHERE order_code = ? AND printed = 1",
            (order_code,),
        ).fetchone()["count_printed"]
        return {
            "order_code": order_code,
            "start_index": start_index,
            "end_index": end_index,
            "marked": end_index - start_index + 1,
            "printed_total": int(printed_total or 0),
            "total_lots": total_lots,
        }


def save_lot_blank_receipt(lot_code: str, received_by: str, received_at: Any) -> dict[str, Any]:
    """Lưu thông tin nhận phôi cho một lô."""
    received_by = str(received_by or "").strip()
    if not received_by:
        raise ValueError("Vui lòng nhập người nhận phôi")

    if isinstance(received_at, datetime):
        received_at_text = received_at.isoformat(timespec="minutes")
    else:
        received_at_text = str(received_at or "").strip()
        if not received_at_text:
            raise ValueError("Vui lòng chọn thời gian nhận phôi")
        try:
            received_at_text = datetime.fromisoformat(received_at_text).isoformat(timespec="minutes")
        except ValueError as exc:
            raise ValueError("Thời gian nhận phôi không hợp lệ") from exc

    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Không tìm thấy lô")
        conn.execute(
            """
            UPDATE lots
            SET blank_received_by = ?, blank_received_at = ?
            WHERE lot_code = ?
            """,
            (received_by, received_at_text, lot_code),
        )
        updated = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        return updated


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
    """Lấy số lượng tối đa của Bavia từ tổng OK+NG đã nhập ở tất cả các dòng Bavia work."""
    row = conn.execute(
        """
        SELECT COALESCE(SUM(qty_ok), 0) AS qty_ok,
               COALESCE(SUM(qty_ng), 0) AS qty_ng
        FROM lot_bavia_work_rows
        WHERE lot_code = ?
        """,
        (lot_code,),
    ).fetchone()
    total = int(row["qty_ok"] or 0) + int(row["qty_ng"] or 0) if row else 0
    if total:
        return total
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
    """Lấy form chất lượng theo lô cho QC/Bavia."""
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
              AND UPPER(COALESCE(check_name, '')) != 'TỔNG'
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
    """Lưu form chất lượng theo lô cho QC/Bavia."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Không tìm thấy lô")
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
            if raw_check_name == "TỔNG":
                continue
            has_data = (qty_ok + qty_ng) > 0
            if blank_seen and has_data:
                raise ValueError("Công đoạn phải nhập tuần tự, không được bỏ trống công đoạn trước")
            if not has_data:
                blank_seen = True
                continue
            if index > 1 and previous_total <= 0:
                raise ValueError("Công đoạn trước chưa có dữ liệu, chưa thể nhập công đoạn sau")
            row_limit_qty = max_qty if index == 1 else previous_total
            if row_limit_qty and qty_ok + qty_ng > row_limit_qty:
                raise ValueError(f"Tổng OK + NG của công đoạn không được vượt quá số lượng tối đa {row_limit_qty}")
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
    """Lấy form QC của lô, nếu chưa có dữ liệu thì trả về mẫu rỗng."""
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
    """Lưu toàn bộ form QC theo lô."""
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
    """Lấy form Bavia của lô, nếu chưa có dữ liệu thì trả về mẫu rỗng."""
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
    """Lưu toàn bộ form Bavia theo lô."""
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



def get_bavia_work_rows(lot_code: str) -> list[dict[str, Any]]:
    """Lấy các dòng máy thực hiện / chuyển máy của Bavia theo lô."""
    with connect() as conn:
        return conn.execute(
            """
            SELECT bwr.*,
                   m.machine_name,
                   w.worker_name,
                   tw.worker_name AS tech_name
            FROM lot_bavia_work_rows bwr
            LEFT JOIN machines m ON m.machine_code = bwr.machine_code
            LEFT JOIN workers w ON w.worker_code = bwr.worker_code
            LEFT JOIN workers tw ON tw.worker_code = bwr.tech_code
            WHERE bwr.lot_code = ?
            ORDER BY bwr.line_index
            """,
            (lot_code,),
        ).fetchall()


def get_lot_bavia_work(lot_code: str) -> dict[str, Any] | None:
    """Lấy form nhập sản lượng Bavia theo lô, với max lấy từ tổng OK+NG của Bavia work."""
    with connect() as conn:
        lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            return None
        last_output = get_lot_last_output(conn, lot_code)
        return {
            "lot": lot,
            "order": conn.execute("SELECT * FROM orders WHERE order_code = ?", (lot["order_code"],)).fetchone(),
            "max_qty": get_lot_bavia_work_limit(conn, lot_code),
            "last_step_form_id": last_output["form_id"],
            "last_step_name": last_output["step_name"],
            "last_step_ok": int(last_output["qty_ok"] or 0),
            "last_step_ng": int(last_output["qty_ng"] or 0),
            "rows": get_bavia_work_rows(lot_code),
        }


def recalc_bavia_work_form(conn: sqlite3.Connection, lot_code: str) -> None:
    """Tính tổng OK/NG từ lot_bavia_work_rows và cập nhật max_qty của form Bavia work."""
    lot = conn.execute("SELECT * FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
    if not lot:
        raise LookupError("Không tìm thấy lô")
    totals = conn.execute(
        """
        SELECT COALESCE(SUM(qty_ok), 0) AS qty_ok, COALESCE(SUM(qty_ng), 0) AS qty_ng
        FROM lot_bavia_work_rows
        WHERE lot_code = ?
        """,
        (lot_code,),
    ).fetchone()
    total = int(totals["qty_ok"] or 0) + int(totals["qty_ng"] or 0)
    qty_per_lot = int(lot["qty_per_lot"] or 0)
    if qty_per_lot and total > qty_per_lot:
        raise ValueError(f"Tổng OK + NG vượt quá số lượng lô ({qty_per_lot} cái)")
    conn.execute(
        """
        INSERT INTO lot_bavia_work_forms(lot_code, max_qty, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(lot_code) DO UPDATE SET
          max_qty = excluded.max_qty,
          updated_at = CURRENT_TIMESTAMP
        """,
        (lot_code, total),
    )


def create_bavia_work_row(lot_code: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Thêm một dòng máy/chuyển máy mới cho Bavia của lô."""
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM lots WHERE lot_code = ?", (lot_code,)).fetchone():
            raise LookupError("Không tìm thấy lô")
        validate_machine_log_refs(conn, payload["machine_code"], payload["worker_code"], payload.get("tech_code") or "")
        conn.execute(
            """
            INSERT INTO lot_bavia_work_forms(lot_code, updated_at)
            VALUES (?, CURRENT_TIMESTAMP)
            ON CONFLICT(lot_code) DO NOTHING
            """,
            (lot_code,),
        )
        next_index = conn.execute(
            "SELECT COALESCE(MAX(line_index), 0) + 1 AS next_index FROM lot_bavia_work_rows WHERE lot_code = ?",
            (lot_code,),
        ).fetchone()["next_index"]
        conn.execute(
            """
            INSERT INTO lot_bavia_work_rows(lot_code, line_index, machine_code, worker_code, tech_code, work_date, shift, qty_ok, qty_ng)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lot_code,
                next_index,
                payload["machine_code"],
                payload["worker_code"],
                payload.get("tech_code") or "",
                payload.get("work_date"),
                payload.get("shift") or "",
                int(payload.get("qty_ok") or 0),
                int(payload.get("qty_ng") or 0),
            ),
        )
        recalc_bavia_work_form(conn, lot_code)
    return {"line_index": next_index, **payload}


def update_bavia_work_row(lot_code: str, line_index: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Cập nhật một dòng máy của Bavia."""
    with connect() as conn:
        validate_machine_log_refs(conn, payload["machine_code"], payload["worker_code"], payload.get("tech_code") or "")
        cur = conn.execute(
            """
            UPDATE lot_bavia_work_rows
            SET machine_code = ?, worker_code = ?, tech_code = ?, work_date = ?, shift = ?, qty_ok = ?, qty_ng = ?
            WHERE lot_code = ? AND line_index = ?
            """,
            (
                payload["machine_code"],
                payload["worker_code"],
                payload.get("tech_code") or "",
                payload.get("work_date"),
                payload.get("shift") or "",
                int(payload.get("qty_ok") or 0),
                int(payload.get("qty_ng") or 0),
                lot_code,
                line_index,
            ),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy dòng máy")
        recalc_bavia_work_form(conn, lot_code)
    return {"line_index": line_index, **payload}


def delete_bavia_work_row(lot_code: str, line_index: int) -> None:
    """Xóa một dòng máy của Bavia."""
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM lot_bavia_work_rows WHERE lot_code = ? AND line_index = ?",
            (lot_code, line_index),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy dòng máy")
        recalc_bavia_work_form(conn, lot_code)


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
               COALESCE(SUM(qty_ng), 0) AS qty_ng,
               COUNT(*) AS row_count
        FROM step_machine_logs
        WHERE form_id = ?
        """,
        (form_id,),
    ).fetchone()
    qty_ok = int(totals["qty_ok"] or 0)
    qty_ng = int(totals["qty_ng"] or 0)
    row_count = int(totals["row_count"] or 0)
    qty_per_lot = int(lot["qty_per_lot"])
    total = qty_ok + qty_ng
    if total > qty_per_lot:
        raise ValueError(f"Tổng OK + NG vượt quá số lượng lô ({qty_per_lot} cái)")
    status = "todo" if row_count == 0 else "partial" if total < qty_per_lot else "done"
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


FINAL_STEP_CTE = """
final_steps AS (
  SELECT part_code, step_name
  FROM (
    SELECT p.part_code, ps.step_name,
           ROW_NUMBER() OVER (PARTITION BY p.part_code ORDER BY ps.step_order DESC, ps.id DESC) AS rn
    FROM parts p
    JOIN part_steps ps ON ps.part_id = p.id
  )
  WHERE rn = 1
)
"""


def get_summary_report(date_from: str | None = None, date_to: str | None = None) -> list[dict[str, Any]]:
    """Báo cáo đơn có sản xuất trong kỳ; OK từ OP cuối, NG từ các OP."""
    with connect() as conn:
        date_values: list[str] = []
        if date_from:
            date_values.append(date_from)
        if date_to:
            date_values.append(date_to)
        filtered = bool(date_values)

        def date_conditions(expression: str) -> str:
            conditions = []
            if date_from:
                conditions.append(f"{expression} >= ?")
            if date_to:
                conditions.append(f"{expression} <= ?")
            return " AND ".join(conditions)

        order_filter = ""
        if filtered:
            machine_date = "DATE(COALESCE(NULLIF(sml.work_date, ''), NULLIF(se.work_date, ''), sml.created_at))"
            activity_cte = f"""
            activity AS (
              SELECT l.order_code, l.part_code, se.step_name, sml.qty_ok, sml.qty_ng
              FROM step_machine_logs sml
              JOIN step_entries se ON se.form_id = sml.form_id
              JOIN lots l ON l.lot_code = se.lot_code
              WHERE {date_conditions(machine_date)}
              UNION ALL
              SELECT l.order_code, l.part_code, se.step_name, se.qty_ok, se.qty_ng
              FROM step_entries se
              JOIN lots l ON l.lot_code = se.lot_code
              WHERE NOT EXISTS (SELECT 1 FROM step_machine_logs sml WHERE sml.form_id = se.form_id)
                AND {date_conditions('DATE(se.work_date)')}
            ),
            """
            order_filter = "WHERE EXISTS (SELECT 1 FROM activity a WHERE a.order_code = o.order_code)"
        else:
            activity_cte = """
            activity AS (
              SELECT l.order_code, l.part_code, se.step_name, se.qty_ok, se.qty_ng
              FROM lots l
              JOIN step_entries se ON se.lot_code = l.lot_code
            ),
            """
        receipt_date = "DATE(COALESCE(NULLIF(r.receipt_date, ''), r.created_at))"
        receipt_filter = f"WHERE {date_conditions(receipt_date)}" if filtered else ""
        params: list[Any] = date_values * (3 if filtered else 0)
        return conn.execute(
            f"""
            WITH {FINAL_STEP_CTE}, {activity_cte} filtered_orders AS (
              SELECT o.order_code, o.part_code, o.total_qty, o.qty_per_lot,
                     o.planned_lots, o.total_lots, o.created_at
              FROM orders o
              {order_filter}
            ),
            lot_stats AS (
              SELECT l.order_code,
                     l.lot_code,
                     COALESCE(se.total_entries, 0) AS total_entries,
                     COALESCE(se.not_done_entries, 0) AS not_done_entries
              FROM lots l
              LEFT JOIN (
                SELECT lot_code,
                       COUNT(*) AS total_entries,
                       COALESCE(SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END), 0) AS not_done_entries
                FROM step_entries
                GROUP BY lot_code
              ) se ON se.lot_code = l.lot_code
            ),
            lot_done AS (
              SELECT order_code, COUNT(*) AS lots_done
              FROM lot_stats
              WHERE total_entries > 0 AND not_done_entries = 0
              GROUP BY order_code
            ),
            entry_stats AS (
              SELECT a.order_code,
                     COALESCE(SUM(CASE
                       WHEN UPPER(TRIM(a.step_name)) = UPPER(TRIM(fs.step_name)) THEN a.qty_ok
                       ELSE 0 END), 0) AS total_ok,
                     COALESCE(SUM(a.qty_ng), 0) AS total_ng
              FROM activity a
              LEFT JOIN final_steps fs ON fs.part_code = a.part_code
              GROUP BY a.order_code
            ),
            receipt_stats AS (
              SELECT l.order_code,
                     COALESCE(SUM(r.qty), 0) AS total_receipted
              FROM lot_warehouse_receipts r
              JOIN lots l ON l.lot_code = r.lot_code
              {receipt_filter}
              GROUP BY l.order_code
            )
            SELECT fo.*,
                   COALESCE(ld.lots_done, 0) AS lots_done,
                   COALESCE(es.total_ok, 0) AS total_ok,
                   COALESCE(es.total_ng, 0) AS total_ng,
                   COALESCE(rs.total_receipted, 0) AS total_receipted,
                   ROUND(
                     CASE
                       WHEN COALESCE(es.total_ok, 0) + COALESCE(es.total_ng, 0) > 0
                       THEN COALESCE(es.total_ng, 0) * 100.0 / (COALESCE(es.total_ok, 0) + COALESCE(es.total_ng, 0))
                       ELSE 0
                     END,
                     2
                   ) AS ng_rate
            FROM filtered_orders fo
            LEFT JOIN lot_done ld ON ld.order_code = fo.order_code
            LEFT JOIN entry_stats es ON es.order_code = fo.order_code
            LEFT JOIN receipt_stats rs ON rs.order_code = fo.order_code
            ORDER BY fo.created_at DESC, fo.order_code DESC
            """,
            params,
        ).fetchall()


def get_order_report(order_code: str, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, Any]]:
    """Báo cáo chi tiết từng lô/công đoạn của một đơn hàng."""
    if date_from or date_to:
        date_values = [value for value in (date_from, date_to) if value]

        def date_conditions(expression: str) -> str:
            conditions = []
            if date_from:
                conditions.append(f"{expression} >= ?")
            if date_to:
                conditions.append(f"{expression} <= ?")
            return " AND ".join(conditions)

        machine_date = "DATE(COALESCE(NULLIF(sml.work_date, ''), NULLIF(se.work_date, ''), sml.created_at))"
        with connect() as conn:
            return conn.execute(
                f"""
                WITH {FINAL_STEP_CTE}, period_logs AS (
                  SELECT sml.form_id, sml.machine_code, sml.qty_ok, sml.qty_ng, sml.shift,
                         {machine_date} AS work_date
                  FROM step_machine_logs sml
                  JOIN step_entries se ON se.form_id = sml.form_id
                  WHERE {date_conditions(machine_date)}
                ),
                log_totals AS (
                  SELECT form_id, SUM(qty_ok) AS qty_ok, SUM(qty_ng) AS qty_ng,
                         MAX(work_date) AS work_date,
                         GROUP_CONCAT(DISTINCT NULLIF(shift, '')) AS shift
                  FROM period_logs
                  GROUP BY form_id
                ),
                legacy_entries AS (
                  SELECT se.form_id, se.qty_ok, se.qty_ng, se.work_date, se.shift
                  FROM step_entries se
                  WHERE NOT EXISTS (SELECT 1 FROM step_machine_logs sml WHERE sml.form_id = se.form_id)
                    AND {date_conditions('DATE(se.work_date)')}
                ),
                machine_usage AS (
                  SELECT form_id, GROUP_CONCAT(machine_text, ', ') AS machines_used
                  FROM (
                    SELECT form_id, machine_code || ' (' || SUM(qty_ok + qty_ng) || ')' AS machine_text
                    FROM period_logs
                    GROUP BY form_id, machine_code
                    ORDER BY form_id, machine_code
                  )
                  GROUP BY form_id
                )
                SELECT l.lot_code, l.qty_per_lot, l.lot_index, se.step_name, se.form_id,
                       se.status,
                       CASE WHEN UPPER(TRIM(se.step_name)) = UPPER(TRIM(fs.step_name)) THEN 1 ELSE 0 END AS is_final_step,
                       COALESCE(lt.qty_ok, le.qty_ok, 0) AS qty_ok,
                       COALESCE(lt.qty_ng, le.qty_ng, 0) AS qty_ng,
                       se.worker_name, se.tech_name,
                       COALESCE(lt.work_date, le.work_date, '') AS work_date,
                       COALESCE(lt.shift, le.shift, se.shift, '') AS shift,
                       COALESCE(mu.machines_used, '') AS machines_used
                FROM lots l
                JOIN step_entries se ON se.lot_code = l.lot_code
                LEFT JOIN final_steps fs ON fs.part_code = l.part_code
                LEFT JOIN log_totals lt ON lt.form_id = se.form_id
                LEFT JOIN legacy_entries le ON le.form_id = se.form_id
                LEFT JOIN machine_usage mu ON mu.form_id = se.form_id
                WHERE l.order_code = ? AND (lt.form_id IS NOT NULL OR le.form_id IS NOT NULL)
                  AND (se.status != 'todo' OR EXISTS (
                    SELECT 1 FROM step_machine_logs sml WHERE sml.form_id = se.form_id
                  ))
                ORDER BY l.lot_index, se.id
                """,
                date_values + date_values + [order_code],
            ).fetchall()

    with connect() as conn:
        return conn.execute(
            f"""
            WITH {FINAL_STEP_CTE}, machine_first AS (
              SELECT form_id, work_date, shift
              FROM (
                SELECT form_id, work_date, shift,
                       ROW_NUMBER() OVER (PARTITION BY form_id ORDER BY line_index) AS rn
                FROM step_machine_logs
                WHERE COALESCE(work_date, '') != '' OR COALESCE(shift, '') != ''
              )
              WHERE rn = 1
            ),
            machine_usage AS (
              SELECT form_id,
                     GROUP_CONCAT(machine_text, ', ') AS machines_used
              FROM (
                SELECT form_id,
                       machine_code || ' (' || SUM(qty_ok + qty_ng) || ')' AS machine_text
                FROM step_machine_logs
                GROUP BY form_id, machine_code
                ORDER BY form_id, machine_code
              )
              GROUP BY form_id
            )
            SELECT l.lot_code, l.qty_per_lot, l.lot_index, se.step_name, se.form_id,
                   CASE WHEN UPPER(TRIM(se.step_name)) = UPPER(TRIM(fs.step_name)) THEN 1 ELSE 0 END AS is_final_step,
                   se.status, se.qty_ok, se.qty_ng, se.worker_name, se.tech_name,
                   COALESCE(mf.work_date, se.work_date, '') AS work_date,
                   COALESCE(mf.shift, se.shift, '') AS shift,
                   COALESCE(mu.machines_used, '') AS machines_used
            FROM lots l
            JOIN step_entries se ON se.lot_code = l.lot_code
            LEFT JOIN final_steps fs ON fs.part_code = l.part_code
            LEFT JOIN machine_first mf ON mf.form_id = se.form_id
            LEFT JOIN machine_usage mu ON mu.form_id = se.form_id
            WHERE l.order_code = ?
              AND (se.status != 'todo' OR EXISTS (
                SELECT 1 FROM step_machine_logs sml WHERE sml.form_id = se.form_id
              ))
            {f" AND COALESCE(NULLIF(se.work_date, ''), NULLIF(mf.work_date, ''), '') >= ?" if date_from else ""}
            {f" AND COALESCE(NULLIF(se.work_date, ''), NULLIF(mf.work_date, ''), '') <= ?" if date_to else ""}
            ORDER BY l.lot_index, se.id
            """,
            [order_code] + ([date_from] if date_from else []) + ([date_to] if date_to else []),
        ).fetchall()


def get_order_quality_report(order_code: str, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, Any]]:
    """Các dòng QC, Bavia và kiểm tra kho của đơn trong khoảng ngày chọn."""
    date_values = [value for value in (date_from, date_to) if value]

    def date_conditions(expression: str) -> str:
        conditions = []
        if date_from:
            conditions.append(f"{expression} >= ?")
        if date_to:
            conditions.append(f"{expression} <= ?")
        return " AND ".join(conditions) or "1=1"

    form_types = (
        ("QC gia công", "lot_qc_forms", "lot_qc_rows", "qc_date", "inspector"),
        ("QC Bavia", "lot_bavia_forms", "lot_bavia_rows", "bavia_date", "inspector"),
        ("Kiểm tra kho", "lot_warehouse_forms", "lot_warehouse_rows", "warehouse_date", "performer"),
    )
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM orders WHERE order_code = ?", (order_code,)).fetchone():
            raise LookupError("Không tìm thấy đơn hàng")
        result: list[dict[str, Any]] = []
        for kind, form_table, row_table, date_column, actor_column in form_types:
            form_date = f"DATE(COALESCE(NULLIF(f.{date_column}, ''), f.created_at))"
            result.extend(conn.execute(
                f"""
                SELECT ? AS kind, l.lot_code, l.lot_index,
                       {form_date} AS form_date, r.line_index, r.check_name,
                       r.qty_ok, r.qty_ng, r.defect_content,
                       r.{actor_column} AS actor
                FROM {form_table} f
                JOIN lots l ON l.lot_code = f.lot_code
                JOIN {row_table} r ON r.lot_code = f.lot_code
                WHERE l.order_code = ? AND {date_conditions(form_date)}
                """,
                [kind, order_code, *date_values],
            ).fetchall())
        work_date = "DATE(COALESCE(NULLIF(r.work_date, ''), r.created_at))"
        result.extend(conn.execute(
            f"""
            SELECT 'Gia công Bavia' AS kind, l.lot_code, l.lot_index,
                   {work_date} AS form_date, r.line_index,
                   COALESCE(m.machine_name, r.machine_code, '') AS check_name,
                   r.qty_ok, r.qty_ng, r.note AS defect_content,
                   COALESCE(w.worker_name, r.worker_code, '') AS actor
            FROM lot_bavia_work_rows r
            JOIN lots l ON l.lot_code = r.lot_code
            LEFT JOIN machines m ON m.machine_code = r.machine_code
            LEFT JOIN workers w ON w.worker_code = r.worker_code
            WHERE l.order_code = ? AND {date_conditions(work_date)}
            """,
            [order_code, *date_values],
        ).fetchall())
        return sorted(result, key=lambda row: (row["lot_index"], row["form_date"] or "", row["kind"], row["line_index"]))


def get_machine_efficiency_report(date_from: str | None = None, date_to: str | None = None) -> list[dict[str, Any]]:
    """Báo cáo hiệu suất máy theo công thức cycle time * sản lượng / 11 giờ."""
    with connect() as conn:
        where_clause = ""
        params: list[Any] = []
        if date_from:
            where_clause += " WHERE DATE(COALESCE(NULLIF(sml.work_date, ''), NULLIF(se.work_date, ''), sml.created_at)) >= ?"
            params.append(date_from)
        if date_to:
            where_clause += " AND DATE(COALESCE(NULLIF(sml.work_date, ''), NULLIF(se.work_date, ''), sml.created_at)) <= ?" if where_clause else " WHERE DATE(COALESCE(NULLIF(sml.work_date, ''), NULLIF(se.work_date, ''), sml.created_at)) <= ?"
            params.append(date_to)
        rows = conn.execute(
            f"""
            SELECT
              sml.machine_code,
              COALESCE(m.machine_name, sml.machine_code) AS machine_name,
              COUNT(*) AS log_count,
              COUNT(DISTINCT se.lot_code) AS lot_count,
              COUNT(DISTINCT l.order_code) AS order_count,
              COALESCE(SUM(sml.qty_ok + sml.qty_ng), 0) AS total_qty,
              COALESCE(SUM(COALESCE(ps.cycle_time_seconds, 0) * (sml.qty_ok + sml.qty_ng)), 0) AS total_cycle_seconds
            FROM step_machine_logs sml
            JOIN step_entries se ON se.form_id = sml.form_id
            JOIN lots l ON l.lot_code = se.lot_code
            LEFT JOIN machines m ON m.machine_code = sml.machine_code
            LEFT JOIN parts p ON p.part_code = l.part_code
            LEFT JOIN part_steps ps ON ps.part_id = p.id AND TRIM(UPPER(ps.step_name)) = TRIM(UPPER(se.step_name))
            {where_clause}
            GROUP BY sml.machine_code, m.machine_name
            ORDER BY total_cycle_seconds DESC, total_qty DESC, sml.machine_code
            """,
            params,
        ).fetchall()
        result = []
        for row in rows:
            total_cycle_seconds = float(row["total_cycle_seconds"] or 0)
            efficiency_percent = round(total_cycle_seconds * 100 / (11 * 3600), 2) if total_cycle_seconds else 0
            result.append({
                "machine_code": row["machine_code"],
                "machine_name": row["machine_name"],
                "log_count": int(row["log_count"] or 0),
                "lot_count": int(row["lot_count"] or 0),
                "order_count": int(row["order_count"] or 0),
                "total_qty": int(row["total_qty"] or 0),
                "total_cycle_seconds": total_cycle_seconds,
                "efficiency_percent": efficiency_percent,
            })
        return result


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


# ─── Kho thành phẩm mới (phiếu nhập kho) ────────────────────────────────────

def _get_lot_warehouse_eligible(conn: sqlite3.Connection, lot_code: str) -> dict[str, Any]:
    """Số lượng tối đa có thể nhập kho — theo OK công đoạn cuối (cùng logic form kho trên lô)."""
    last_output = get_lot_last_output(conn, lot_code)
    return {
        "eligible_qty": int(last_output["qty_ok"] or 0),
        "last_step_name": str(last_output.get("step_name") or "").strip(),
    }


def get_warehouse_orders_summary(search: str = "") -> list[dict[str, Any]]:
    """Danh sách đơn hàng kèm tổng SL được nhập kho và đã nhập kho (trang chủ kho)."""
    with connect() as conn:
        where_clause = ""
        params: list[Any] = []
        if search:
            like = f"%{search.upper()}%"
            where_clause = "WHERE UPPER(o.order_code) LIKE ? OR UPPER(o.part_code) LIKE ?"
            params = [like, like]
        return conn.execute(
            f"""
            WITH lot_last AS (
              SELECT lot_code, order_code, qty_ok AS eligible_qty
              FROM (
                SELECT l.order_code,
                       se.lot_code,
                       se.qty_ok,
                       ROW_NUMBER() OVER (PARTITION BY se.lot_code ORDER BY se.id DESC) AS rn
                FROM step_entries se
                JOIN lots l ON l.lot_code = se.lot_code
              )
              WHERE rn = 1
            ),
            eligible_by_order AS (
              SELECT order_code, COALESCE(SUM(eligible_qty), 0) AS total_eligible
              FROM lot_last
              GROUP BY order_code
            ),
            receipt_by_order AS (
              SELECT l.order_code, COALESCE(SUM(r.qty), 0) AS total_receipted
              FROM lot_warehouse_receipts r
              JOIN lots l ON l.lot_code = r.lot_code
              GROUP BY l.order_code
            )
            SELECT o.order_code,
                   o.part_code,
                   o.total_lots,
                   o.total_qty,
                   COALESCE(e.total_eligible, 0) AS total_eligible,
                   COALESCE(r.total_receipted, 0) AS total_receipted
            FROM orders o
            LEFT JOIN eligible_by_order e ON e.order_code = o.order_code
            LEFT JOIN receipt_by_order r ON r.order_code = o.order_code
            {where_clause}
            ORDER BY o.order_code DESC
            """,
            params,
        ).fetchall()


def get_warehouse_order_detail(order_code: str) -> dict[str, Any]:
    """Chi tiết một đơn kho thành phẩm kèm danh sách lô."""
    with connect() as conn:
        order = conn.execute(
            "SELECT order_code, part_code, total_qty, total_lots FROM orders WHERE order_code = ?",
            (order_code.upper(),),
        ).fetchone()
        if not order:
            raise LookupError("Không tìm thấy đơn hàng")
        lot_detail_rows = conn.execute(
            """
            WITH lot_last AS (
              SELECT lot_code, eligible_qty, last_step_name
              FROM (
                SELECT l.lot_code,
                       COALESCE(se.qty_ok, 0) AS eligible_qty,
                       se.step_name AS last_step_name,
                       ROW_NUMBER() OVER (PARTITION BY se.lot_code ORDER BY se.id DESC) AS rn
                FROM lots l
                LEFT JOIN step_entries se ON se.lot_code = l.lot_code
                WHERE l.order_code = ?
              )
              WHERE rn = 1 OR rn IS NULL
            ),
            receipt_by_lot AS (
              SELECT lot_code, COALESCE(SUM(qty), 0) AS total_receipted
              FROM lot_warehouse_receipts
              GROUP BY lot_code
            )
            SELECT l.lot_code,
                   l.part_code,
                   l.qty_per_lot,
                   l.lot_index,
                   COALESCE(ll.eligible_qty, 0) AS eligible_qty,
                   COALESCE(rb.total_receipted, 0) AS total_receipted,
                   COALESCE(ll.last_step_name, '') AS last_step_name
            FROM lots l
            LEFT JOIN lot_last ll ON ll.lot_code = l.lot_code
            LEFT JOIN receipt_by_lot rb ON rb.lot_code = l.lot_code
            WHERE l.order_code = ?
            ORDER BY l.lot_index
            """,
            (order_code.upper(), order_code.upper()),
        ).fetchall()
        receipts = conn.execute(
            """
            SELECT r.lot_code, r.id, r.qty, r.receipt_date, r.note, r.created_at
            FROM lot_warehouse_receipts r
            JOIN lots l ON l.lot_code = r.lot_code
            WHERE l.order_code = ?
            ORDER BY l.lot_index, r.id
            """,
            (order_code.upper(),),
        ).fetchall()
        receipt_map: dict[str, list[dict[str, Any]]] = {}
        for receipt in receipts:
            receipt_map.setdefault(receipt["lot_code"], []).append(dict(receipt))
        lot_detail: list[dict[str, Any]] = []
        total_receipted = 0
        for lot_row in lot_detail_rows:
            receipted = int(lot_row["total_receipted"] or 0)
            total_receipted += receipted
            lot_detail.append({
                "lot_code": lot_row["lot_code"],
                "part_code": lot_row["part_code"],
                "qty_per_lot": int(lot_row["qty_per_lot"] or 0),
                "eligible_qty": int(lot_row["eligible_qty"] or 0),
                "total_receipted": receipted,
                "remaining_qty": max(int(lot_row["eligible_qty"] or 0) - receipted, 0),
                "last_step_name": lot_row["last_step_name"],
                "receipts": receipt_map.get(lot_row["lot_code"], []),
            })
        return {
            "order_code": order["order_code"],
            "part_code": order["part_code"],
            "total_qty": order["total_qty"],
            "total_lots": order["total_lots"],
            "total_receipted": total_receipted,
            "progress_percent": round((total_receipted / float(order["total_qty"] or 0)) * 100) if float(order["total_qty"] or 0) > 0 else 0,
            "lots": lot_detail,
        }


def add_warehouse_receipt(lot_code: str, qty: int, receipt_date: str, note: str = "") -> dict[str, Any]:
    """Thêm phiếu nhập kho. Kiểm tra không vượt SL OK công đoạn cuối."""
    with connect() as conn:
        lot = conn.execute("SELECT 1 FROM lots WHERE lot_code = ?", (lot_code,)).fetchone()
        if not lot:
            raise LookupError("Không tìm thấy lô")
        if qty <= 0:
            raise ValueError("Số lượng nhập kho phải lớn hơn 0")
        eligible_qty = _get_lot_warehouse_eligible(conn, lot_code)["eligible_qty"]
        total_receipted = conn.execute(
            "SELECT COALESCE(SUM(qty), 0) AS total FROM lot_warehouse_receipts WHERE lot_code = ?",
            (lot_code,),
        ).fetchone()["total"]
        if eligible_qty <= 0:
            raise ValueError("Lô chưa có số lượng OK từ công đoạn cuối, chưa thể nhập kho")
        if (int(total_receipted) + qty) > eligible_qty:
            raise ValueError(
                f"Tổng nhập kho ({int(total_receipted) + qty}) vượt quá số lượng được phép ({eligible_qty})"
            )
        conn.execute(
            "INSERT INTO lot_warehouse_receipts(lot_code, qty, receipt_date, note) VALUES (?, ?, ?, ?)",
            (lot_code, qty, receipt_date.strip(), note.strip()),
        )
        row = conn.execute(
            "SELECT * FROM lot_warehouse_receipts WHERE lot_code = ? ORDER BY id DESC LIMIT 1",
            (lot_code,),
        ).fetchone()
        return dict(row)


def delete_warehouse_receipt(lot_code: str, receipt_id: int) -> None:
    """Xóa phiếu nhập kho."""
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM lot_warehouse_receipts WHERE id = ? AND lot_code = ?",
            (receipt_id, lot_code),
        )
        if cur.rowcount == 0:
            raise LookupError("Không tìm thấy phiếu nhập kho")
