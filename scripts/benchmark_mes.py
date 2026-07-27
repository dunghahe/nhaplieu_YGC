from __future__ import annotations

import argparse
import random
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path
import sys
from dataclasses import dataclass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import database


@dataclass
class BenchmarkResult:
    name: str
    elapsed_ms: float
    rows: int


def now_ms() -> float:
    return time.perf_counter() * 1000


def seed_random(seed: int) -> random.Random:
    return random.Random(seed)


def clone_database(src: Path) -> tuple[Path, Path]:
    tmp_dir = Path(tempfile.mkdtemp(prefix="mes-bench-"))
    dst = tmp_dir / src.name
    shutil.copy2(src, dst)
    return dst, tmp_dir


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def ensure_base_data(conn: sqlite3.Connection, rng: random.Random, part_count: int = 30, machine_count: int = 120, worker_count: int = 180) -> None:
    existing_parts = conn.execute("SELECT COUNT(*) AS c FROM parts").fetchone()["c"]
    if existing_parts < part_count:
        for idx in range(existing_parts + 1, part_count + 1):
            part_code = f"BM-PART-{idx:03d}"
            conn.execute("INSERT OR IGNORE INTO parts(part_code) VALUES (?)", (part_code,))
            part_id = conn.execute("SELECT id FROM parts WHERE part_code = ?", (part_code,)).fetchone()["id"]
            for step_idx in range(1, 5):
                conn.execute(
                    "INSERT OR IGNORE INTO part_steps(part_id, step_name, step_order, cycle_time_seconds) VALUES (?, ?, ?, ?)",
                    (part_id, f"CONG DOAN {step_idx}", step_idx, rng.randint(12, 85)),
                )

    existing_machines = conn.execute("SELECT COUNT(*) AS c FROM machines").fetchone()["c"]
    if existing_machines < machine_count:
        for idx in range(existing_machines + 1, machine_count + 1):
            conn.execute(
                "INSERT OR IGNORE INTO machines(machine_code, machine_name, location, is_active) VALUES (?, ?, ?, 1)",
                (f"BM-MC-{idx:03d}", f"Machine {idx:03d}", f"Xuong {((idx - 1) % 4) + 1}"),
            )

    existing_workers = conn.execute("SELECT COUNT(*) AS c FROM workers").fetchone()["c"]
    if existing_workers < worker_count:
        for idx in range(existing_workers + 1, worker_count + 1):
            conn.execute(
                "INSERT OR IGNORE INTO workers(worker_code, worker_name, is_active) VALUES (?, ?, 1)",
                (f"BM-WK-{idx:03d}", f"Worker {idx:03d}"),
            )


def existing_order_count(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) AS c FROM orders").fetchone()["c"])


def ensure_benchmark_orders(conn: sqlite3.Connection, rng: random.Random, target_orders: int, lots_per_order: tuple[int, int] = (4, 8), steps_per_part: int = 4) -> None:
    current = existing_order_count(conn)
    if current >= target_orders:
        return

    parts = [row["part_code"] for row in conn.execute("SELECT part_code FROM parts ORDER BY part_code").fetchall()]
    if not parts:
        raise RuntimeError("No parts available for benchmark data")

    machine_codes = [row["machine_code"] for row in conn.execute("SELECT machine_code FROM machines WHERE is_active = 1 ORDER BY machine_code").fetchall()]
    worker_codes = [row["worker_code"] for row in conn.execute("SELECT worker_code FROM workers WHERE is_active = 1 ORDER BY worker_code").fetchall()]

    order_start = current + 1
    for order_idx in range(order_start, target_orders + 1):
        order_code = f"BM{order_idx:06d}"
        part_code = parts[(order_idx - 1) % len(parts)]
        total_qty = rng.randint(400, 5000)
        planned_lots = rng.randint(*lots_per_order)
        lot_qtys = database.split_lot_quantities(total_qty, planned_lots)
        order_receive_date = f"2026-07-{((order_idx - 1) % 25) + 1:02d}"
        conn.execute(
            """
            INSERT INTO orders(
              order_code, part_code, total_qty, qty_per_lot, planned_lots, total_lots,
              raw_material_code, drawing_code, drawing_rev, material, blank_size,
              order_receive_date, blank_issue_date, delivered_by, received_by, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_code,
                part_code,
                total_qty,
                lot_qtys[0],
                planned_lots,
                len(lot_qtys),
                f"RM-{order_idx:04d}",
                f"DWG-{order_idx:04d}",
                f"R{(order_idx % 9) + 1}",
                f"Material {((order_idx - 1) % 5) + 1}",
                f"{rng.randint(10, 120)}x{rng.randint(10, 120)}",
                order_receive_date,
                order_receive_date,
                f"Del-{((order_idx - 1) % 8) + 1}",
                f"Recv-{((order_idx - 1) % 8) + 1}",
                f"2026-07-{((order_idx - 1) % 25) + 1:02d} 08:00:00",
            ),
        )

        for lot_idx, lot_qty in enumerate(lot_qtys, start=1):
            lot_code = f"LOT-{order_code}-{lot_idx:02d}"
            conn.execute(
                "INSERT INTO lots(lot_code, order_code, part_code, qty_per_lot, lot_index, printed, blank_received_by, blank_received_at, created_at) VALUES (?, ?, ?, ?, ?, 1, '', '', ?)",
                (
                    lot_code,
                    order_code,
                    part_code,
                    lot_qty,
                    lot_idx,
                    f"2026-07-{((order_idx - 1) % 25) + 1:02d} 08:00:00",
                ),
            )

            step_names = [row["step_name"] for row in conn.execute("SELECT step_name FROM part_steps JOIN parts ON parts.id = part_steps.part_id WHERE parts.part_code = ? ORDER BY step_order LIMIT ?", (part_code, steps_per_part)).fetchall()]
            previous_total = lot_qty
            for step_idx, step_name in enumerate(step_names, start=1):
                form_id = f"FORM-{lot_code}-{step_idx}"
                if step_idx == 1:
                    qty_ok = previous_total
                    qty_ng = 0
                    status = "done"
                else:
                    qty_ok = max(0, int(previous_total * rng.uniform(0.72, 0.97)))
                    qty_ng = max(0, previous_total - qty_ok)
                    status = "done" if qty_ok + qty_ng > 0 else "todo"
                worker = worker_codes[(order_idx + lot_idx + step_idx) % len(worker_codes)]
                tech = worker_codes[(order_idx + lot_idx + step_idx + 7) % len(worker_codes)]
                conn.execute(
                    """
                    INSERT INTO step_entries(form_id, lot_code, step_name, work_date, shift, qty_ok, qty_ng, tech_name, worker_name, status, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (
                        form_id,
                        lot_code,
                        step_name,
                        order_receive_date,
                        "KÍP 1" if step_idx % 2 else "KÍP 2",
                        qty_ok,
                        qty_ng,
                        tech,
                        worker,
                        status,
                    ),
                )
                log_count = rng.randint(1, 3)
                for log_idx in range(1, log_count + 1):
                    machine = machine_codes[(order_idx + lot_idx + step_idx + log_idx) % len(machine_codes)]
                    log_qty = max(1, (qty_ok + qty_ng) // log_count)
                    conn.execute(
                        """
                        INSERT INTO step_machine_logs(
                          form_id, line_index, machine_code, worker_code, work_date, shift,
                          qty_ok, qty_ng, technical_info, tech_code, note
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            form_id,
                            log_idx,
                            machine,
                            worker,
                            order_receive_date,
                            "KÍP 1" if log_idx % 2 else "KÍP 2",
                            log_qty,
                            0,
                            "",
                            tech,
                            "",
                        ),
                    )
                previous_total = qty_ok + qty_ng

            # Receipt data for a subset of lots so warehouse reports have realistic rows
            if lot_idx % 2 == 0:
                receipted = max(0, int(lot_qty * 0.6))
                conn.execute(
                    "INSERT INTO lot_warehouse_receipts(lot_code, qty, receipt_date, note, created_at) VALUES (?, ?, ?, ?, ?)",
                    (lot_code, receipted, order_receive_date, "", f"2026-07-{((order_idx - 1) % 25) + 1:02d} 15:30:00"),
                )


def timed(name: str, fn) -> BenchmarkResult:
    start = now_ms()
    rows = fn()
    elapsed = now_ms() - start
    return BenchmarkResult(name=name, elapsed_ms=elapsed, rows=rows if isinstance(rows, int) else int(rows or 0))


def run_benchmark(scale: int) -> dict[str, BenchmarkResult]:
    original_db_path = Path(database.DB_PATH)
    clone, tmp_dir = clone_database(original_db_path)
    rng = seed_random(42)
    try:
        database.DB_PATH = clone
        database.init_db()

        with connect(clone) as conn:
            ensure_base_data(conn, rng)
            ensure_benchmark_orders(conn, rng, scale)

        results: dict[str, BenchmarkResult] = {}
        results["get_orders"] = timed("get_orders", lambda: len(database.get_orders()))
        results["parts_summary"] = timed("get_parts_summary", lambda: len(database.get_parts_summary()))
        results["summary_report"] = timed("get_summary_report", lambda: len(database.get_summary_report()))
        results["machine_report"] = timed("get_machine_efficiency_report", lambda: len(database.get_machine_efficiency_report()))
        results["warehouse_summary"] = timed("get_warehouse_orders_summary", lambda: len(database.get_warehouse_orders_summary()))
        orders = database.get_orders()
        first_order = orders[0]["order_code"] if orders else None
        if first_order:
            results["order_report"] = timed("get_order_report", lambda: len(database.get_order_report(first_order)))
            results["warehouse_detail"] = timed("get_warehouse_order_detail", lambda: len(database.get_warehouse_order_detail(first_order)["lots"]))
        return results
    finally:
        database.DB_PATH = original_db_path
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark MES reports on synthetic data")
    parser.add_argument("--orders", type=int, nargs="+", default=[100, 500, 1000, 5000], help="Target synthetic order counts")
    args = parser.parse_args()

    base_db = Path(database.DB_PATH)
    print(f"Base DB: {base_db}")
    print(f"Base size: {base_db.stat().st_size} bytes")

    for target in args.orders:
        results = run_benchmark(target)
        print(f"\n=== Synthetic orders: {target} ===")
        for key, result in results.items():
            print(f"{key:22} | {result.elapsed_ms:8.2f} ms | rows={result.rows}")


if __name__ == "__main__":
    main()
