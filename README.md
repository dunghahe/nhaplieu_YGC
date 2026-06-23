# YGC MES Nhập liệu sản xuất

Web application nội bộ để nhập kết quả sản xuất theo lô, thay cho ghi giấy rồi nhập lại Excel. Server chạy trên 1 máy PC Windows, các máy khác trong mạng LAN truy cập bằng trình duyệt.

## Chức năng chính

- Khai báo mã hàng và danh sách công đoạn theo thứ tự.
- Mỗi công đoạn bắt buộc khai báo `cycle time` tiêu chuẩn theo phút/giây.
- Có thể sửa lại mã hàng/công đoạn/cycle time từ bảng lịch sử mã hàng.
- Khai báo Master Data máy CNC/nhân công để dùng khi nhập liệu sản xuất.
- Khai báo đơn hàng, tự chia lô và sinh QR cho từng lô.
- Khai báo thêm thông tin Phần I - Kho Vật Liệu của đơn hàng để in biểu theo dõi công đoạn.
- `Tổng SL`, `Số lô muốn chia`, OK và NG bắt buộc là số nguyên; phần xem trước chia lô hiển thị thương số thập phân để dễ kiểm tra.
- Hệ thống tự tính pcs/lô chuẩn; nếu còn dư sẽ tạo thêm 1 lô cuối chứa phần dư.
- Có thể sửa mã hàng, tổng SL, số lô của đơn hàng nếu đơn chưa phát sinh dữ liệu nhập liệu.
- Có thể xóa mã hàng/đơn hàng bằng mã xóa nội bộ; đơn hàng bị xóa sẽ xóa luôn lô và dữ liệu nhập liệu bên trong.
- Nhập OK/NG theo từng công đoạn của từng lô.
- Nhập OK/NG theo từng máy và từng nhân công; hệ thống tự cộng tổng cho công đoạn.
- In biểu lô A4 gồm Phần I, Phần II và QR từng công đoạn để công nhân điền tay.
- Báo cáo tổng quan và chi tiết đơn hàng theo thời gian thực.
- Validation cả frontend và backend: `OK + NG` không được vượt quá số lượng lô.

## Cài đặt lần đầu trên máy server

1. Tải Python 3.11+ từ [python.org](https://www.python.org/downloads/), khi cài đặt nhớ tick chọn `Add Python to PATH`.
2. Mở Command Prompt tại thư mục dự án.
3. Cài thư viện:

   ```bat
   pip install fastapi uvicorn[standard]
   ```

   Hoặc:

   ```bat
   pip install -r requirements.txt
   ```

4. Chạy server bằng cách double-click `start.bat`, hoặc chạy lệnh:

   ```bat
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

5. Mở trình duyệt trên máy server:

   ```text
   http://localhost:8000
   ```

FastAPI tự sinh tài liệu API tại:

```text
http://localhost:8000/docs
```

## Truy cập từ máy khác trong mạng LAN

1. Trên máy server, mở CMD và chạy:

   ```bat
   ipconfig
   ```

2. Ghi lại địa chỉ `IPv4 Address`, ví dụ `192.168.1.100`.
3. Trên máy khác trong cùng mạng LAN, mở trình duyệt:

   ```text
   http://192.168.1.100:8000
   ```

4. Nếu không truy cập được, kiểm tra Windows Firewall:
   - Mở Windows Firewall.
   - Chọn `Allow an app through firewall`.
   - Cho phép Python, hoặc mở inbound port `8000`.

## Đặt IP tĩnh cho máy server

Nên đặt IP tĩnh để địa chỉ truy cập không đổi sau mỗi lần khởi động máy.

1. Mở `Settings`.
2. Vào `Network & Internet`.
3. Chọn mạng đang dùng, mở phần cấu hình IP.
4. Đổi từ DHCP sang Manual.
5. Nhập IP cố định cùng lớp mạng, ví dụ `192.168.1.100`.
6. Nhập gateway/router, thường là `192.168.1.1`.
7. Lưu lại và kiểm tra bằng trình duyệt.

## Backup dữ liệu

- File database nằm tại:

  ```text
  data/mes.db
  ```

- Mỗi ngày nên copy file này vào USB, ổ mạng nội bộ, hoặc thư mục backup.
- Có thể mở bằng DB Browser for SQLite để xem dữ liệu hoặc export ra Excel khi cần.

## Tự khởi động khi bật máy

Có thể dùng Windows Task Scheduler:

1. Mở `Task Scheduler`.
2. Chọn `Create Basic Task`.
3. Trigger: `When the computer starts`.
4. Action: `Start a program`.
5. Program/script: chọn file `start.bat` trong thư mục dự án.
6. Lưu task và khởi động lại máy để kiểm tra.

## Triển khai trên Ubuntu Server

Khuyến nghị cài app tại `/opt/mes-app` và chạy bằng user riêng tên `mes`.

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
sudo useradd --system --home /opt/mes-app --shell /usr/sbin/nologin mes
sudo mkdir -p /opt/mes-app
sudo cp -r . /opt/mes-app/
sudo chown -R mes:mes /opt/mes-app
cd /opt/mes-app
sudo -u mes python3 -m venv .venv
sudo -u mes .venv/bin/pip install -r requirements.txt
sudo chmod +x /opt/mes-app/start.sh /opt/mes-app/scripts/backup_mes.sh
```

Chạy thử:

```bash
sudo -u mes /opt/mes-app/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Nếu chạy ổn, cài service để tự khởi động:

```bash
sudo cp /opt/mes-app/deploy/mes-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mes-app.service
sudo systemctl status mes-app.service
```

Mở firewall nếu Ubuntu bật UFW:

```bash
sudo ufw allow 8000/tcp
```

Máy khác trong LAN truy cập bằng:

```text
http://IP_SERVER_UBUNTU:8000
```

## Backup tự động trên Ubuntu

Database nằm tại:

```text
/opt/mes-app/data/mes.db
```

Script backup có sẵn:

```text
/opt/mes-app/scripts/backup_mes.sh
```

Script này dùng cơ chế backup an toàn của SQLite, tạo file nén tại:

```text
/opt/mes-app/backups/mes_YYYYMMDD_HHMMSS.db.gz
```

Mặc định giữ backup 30 ngày. Có thể chạy thử:

```bash
sudo -u mes /opt/mes-app/scripts/backup_mes.sh
```

Cài backup tự động hằng ngày lúc 18:00:

```bash
sudo cp /opt/mes-app/deploy/mes-backup.service /etc/systemd/system/
sudo cp /opt/mes-app/deploy/mes-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mes-backup.timer
systemctl list-timers | grep mes-backup
```

Xem log backup:

```bash
journalctl -u mes-backup.service -n 50
```

Nên copy thêm thư mục `/opt/mes-app/backups` sang ổ khác, NAS, hoặc cloud nội bộ để tránh mất dữ liệu nếu hỏng ổ cứng server.

## Ghi chú vận hành

- Không xóa thư mục `data` nếu muốn giữ dữ liệu.
- Mã xóa mặc định khi chạy local là `admin123`. Khi triển khai thật nên đặt biến môi trường `MES_DELETE_CODE` thành mã riêng của quản lý.
- Khi nhập lô lần đầu, hệ thống tự sinh các biểu mẫu công đoạn.
- Mã lô có dạng `LOT-{MÃ PO}-{SỐ THỨ TỰ 2 CHỮ SỐ}`.
- Mã biểu mẫu có dạng `FORM-{MÃ LÔ}-{CÔNG ĐOẠN KHÔNG DẤU}`.
- Báo cáo chỉ cập nhật khi bấm `Làm mới`.
