import os
import sys
import time
import winsound

# Nếu bạn cần lưu vào database thì bỏ comment dòng dưới
# from database import save_message

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
SOUND_PATH = os.path.join(ASSETS_DIR, "alert.wav")

if not os.path.exists(ASSETS_DIR):
    os.makedirs(ASSETS_DIR)

# ----------------------------------------------------
# 1. GIAO DIỆN POPUP (PYQT5)
# ----------------------------------------------------
def show_popup(alert_type, advice_text, suggestions):
    try:
        from PyQt5.QtWidgets import (QApplication, QWidget, QLabel, QPushButton,
                                     QVBoxLayout, QHBoxLayout, QFrame, QButtonGroup, QDesktopWidget)
        from PyQt5.QtCore import Qt
        from PyQt5.QtGui import QPainter, QPainterPath, QFont, QFontMetrics, QColor, QPen
    except ImportError:
        print("\n❌ LỖI: Vui lòng cài đặt PyQt5 (Lệnh: pip install PyQt5)")
        return

    # Khởi tạo QApplication (Chỉ chạy 1 lần cho mỗi lần gọi)
    app = QApplication.instance()
    if not app:
        app = QApplication(sys.argv)

    # Label chữ SENTIFY có viền trắng + bóng đổ (giống hình thiết kế)
    class OutlineLabel(QLabel):
        def __init__(self, text, parent=None):
            super().__init__(text, parent)
            self.setAlignment(Qt.AlignCenter)
            self.setFixedHeight(66)

        def paintEvent(self, event):
            p = QPainter(self)
            p.setRenderHint(QPainter.Antialiasing)

            font = QFont("Arial Black")
            font.setPixelSize(48)
            font.setWeight(QFont.Black)
            fm = QFontMetrics(font)
            text = self.text()
            width = fm.horizontalAdvance(text) if hasattr(fm, "horizontalAdvance") else fm.width(text)

            x = (self.width() - width) / 2
            y = (self.height() + fm.ascent() - fm.descent()) / 2

            path = QPainterPath()
            path.addText(x, y, font, text)

            # Bóng đổ
            p.save()
            p.translate(0, 4)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(70, 10, 10, 150))
            p.drawPath(path)
            p.restore()

            # Viền trắng
            p.setPen(QPen(QColor("#FFFFFF"), 5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
            p.setBrush(Qt.NoBrush)
            p.drawPath(path)

            # Ruột xanh ngọc
            p.setPen(Qt.NoPen)
            p.setBrush(QColor("#0FA3B8"))
            p.drawPath(path)

    class CenterAlertPopup(QWidget):
        def __init__(self, alert_type, advice_text, suggestions):
            super().__init__()
            self.suggestions = suggestions
            self.selected_suggestion = ""

            # Cấu hình cửa sổ không viền, luôn nổi trên cùng
            self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
            self.setAttribute(Qt.WA_TranslucentBackground)

            # Kích thước cố định giống hình
            self.WIN_W, self.WIN_H = 560, 780
            self.setFixedSize(self.WIN_W, self.WIN_H)

            self.setup_ui(alert_type, advice_text)
            self.center_on_screen()

        def setup_ui(self, alert_type, advice_text):
            # Chọn tiêu đề dựa trên alert_type
            if alert_type == 1:
                alert_title = "CẢNH BÁO: ĐỐI PHƯƠNG CÓ NGUY CƠ LỪA ĐẢO !!!"
                alert_color = "#DB1C1C"  # Cam đỏ
                icon_color = "#EF4444"   # Đỏ
            elif alert_type == 2:
                alert_title = "PHÂN TÍCH: ĐỐI PHƯƠNG ĐANG NỔI GIẬN"
                alert_color = "#FF8800"  # Cam
                icon_color = alert_color
            elif alert_type == 3:
                alert_title = "PHÂN TÍCH: ĐỐI PHƯƠNG ĐANG BUỒN BÃ"
                alert_color = "#FFE664"  # Xanh dương
                icon_color = alert_color
            else:
                alert_title = "THÔNG BÁO HỆ THỐNG"
                alert_color = "#2ECC71"  # Xanh lá
                icon_color = alert_color

            # Font chung (ưu tiên Inter giống thiết kế, không có thì dùng Segoe UI)
            self.setStyleSheet("""
                QLabel, QPushButton { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; }
            """)

            main_layout = QVBoxLayout(self)
            main_layout.setContentsMargins(10, 10, 10, 10)

            # Khung ngoài (Viền vàng dày)
            outer_frame = QFrame()
            outer_frame.setObjectName("outer")
            outer_frame.setStyleSheet("""
                QFrame#outer {
                    background-color: #FFF08D;
                    border-radius: 30px;
                }
            """)
            outer_layout = QVBoxLayout(outer_frame)
            outer_layout.setContentsMargins(10, 10, 10, 10)
            outer_layout.setSpacing(0)

            # Khung trong (Nền trắng -> xám xanh dần xuống dưới)
            inner_frame = QFrame()
            inner_frame.setObjectName("inner")
            inner_frame.setStyleSheet("""
                QFrame#inner {
                    background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                        stop:0 #FFFFFF, stop:0.25 #FFFFFF, stop:1 #B6C3CD);
                    border-radius: 20px;
                }
            """)
            inner_layout = QVBoxLayout(inner_frame)
            inner_layout.setContentsMargins(0, 0, 0, 0)
            inner_layout.setSpacing(0)

            # ---------------- HEADER ----------------
            header_frame = QFrame()
            header_frame.setObjectName("header")
            header_frame.setFixedHeight(140)
            header_frame.setStyleSheet("""
                QFrame#header {
                    background: qlineargradient(x1:0, y1:0, x2:1, y2:0.4,
                        stop:0 #C42320, stop:1 #EE6535);
                    border-top-left-radius: 20px;
                    border-top-right-radius: 20px;
                    border-bottom-left-radius: 0px;
                    border-bottom-right-radius: 0px;
                }
            """)
            header_layout = QVBoxLayout(header_frame)
            header_layout.setContentsMargins(20, 14, 20, 12)
            header_layout.setSpacing(4)

            # Tiêu đề Sentify
            sentify_label = OutlineLabel("SENTIFY")

            sub_label = QLabel("Hệ thống giám sát an toàn và phân tích cảm xúc")
            sub_label.setAlignment(Qt.AlignCenter)
            sub_label.setStyleSheet("color: white; font-size: 18px; font-weight: bold; background: transparent;")

            header_layout.addWidget(sentify_label)
            header_layout.addWidget(sub_label)
            header_layout.addStretch()

            # Nút Đóng (X) - tròn trắng, nằm góc phải trên của header
            close_btn = QPushButton("✕", header_frame)
            close_btn.setFixedSize(34, 34)
            close_btn.move(self.WIN_W - 20 - 20 - 34 - 6, 12)
            close_btn.setCursor(Qt.PointingHandCursor)
            close_btn.setStyleSheet("""
                QPushButton {
                    background-color: white;
                    color: #E8553A;
                    border: none;
                    border-radius: 17px;
                    font-weight: bold;
                    font-size: 17px;
                }
                QPushButton:hover { background-color: #FADBD8; }
            """)
            close_btn.clicked.connect(self.close)
            close_btn.raise_()

            # ---------------- BODY ----------------
            body_layout = QVBoxLayout()
            body_layout.setContentsMargins(24, 18, 24, 22)
            body_layout.setSpacing(12)

            # Tiêu đề cảnh báo (icon tròn "!" + chữ)
            alert_row = QHBoxLayout()
            alert_row.setSpacing(10)

            icon_label = QLabel("!")
            icon_label.setFixedSize(28, 28)
            icon_label.setAlignment(Qt.AlignCenter)
            icon_label.setStyleSheet(f"""
                background-color: {icon_color};
                color: white;
                border-radius: 14px;
                font-size: 17px;
                font-weight: bold;
            """)

            alert_label = QLabel(alert_title)
            alert_label.setStyleSheet(
                f"color: {alert_color}; font-size: 16px; font-weight: bold; background: transparent;"
            )
            alert_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

            alert_row.addWidget(icon_label)
            alert_row.addWidget(alert_label)
            alert_row.addStretch()

            # Text lời khuyên (căn đều 2 bên, giãn dòng)
            import html as _html
            safe_text = _html.escape(advice_text).replace("\n", "<br>")
            advice_label = QLabel(
                f'<p align="justify" style="line-height:140%; margin:0;">{safe_text}</p>'
            )
            advice_label.setTextFormat(Qt.RichText)
            advice_label.setWordWrap(True)
            advice_label.setStyleSheet("color: #5C6B8A; font-size: 15px; background: transparent;")
            advice_label.setAlignment(Qt.AlignJustify | Qt.AlignTop)

            body_layout.addLayout(alert_row)
            body_layout.addSpacing(4)
            body_layout.addWidget(advice_label)

            # ---------------- SUGGESTIONS ----------------
            suggest_label = QLabel("Bạn có thể tham khảo 3 gợi ý dưới đây để phản hồi đối phương :")
            suggest_label.setFixedHeight(46)
            suggest_label.setStyleSheet("""
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #EE6535, stop:1 #D63A33);
                color: white;
                padding-left: 20px;
                border-radius: 12px;
                font-weight: bold;
                font-size: 13px;
            """)
            suggest_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
            body_layout.addSpacing(6)
            body_layout.addWidget(suggest_label)

            # Group các nút gợi ý để chỉ chọn được 1
            self.btn_group = QButtonGroup(self)
            self.btn_group.setExclusive(True)
            self.btn_group.buttonClicked.connect(self.on_suggestion_selected)

            for i, text in enumerate(self.suggestions):
                if not text: continue
                btn = QPushButton(text)
                btn.setCheckable(True)
                btn.setFixedHeight(46)
                btn.setCursor(Qt.PointingHandCursor)
                btn.setStyleSheet("""
                    QPushButton {
                        background-color: #7FC1CC;
                        color: white;
                        text-align: left;
                        padding-left: 20px;
                        border-radius: 12px;
                        font-size: 13px;
                        font-weight: bold;
                        border: none;
                    }
                    QPushButton:hover { background-color: #66B2BF; }
                    QPushButton:checked { background-color: #038A99; }
                """)
                self.btn_group.addButton(btn, i)
                body_layout.addWidget(btn)

            # Nút Dùng gợi ý
            body_layout.addStretch()
            action_layout = QHBoxLayout()
            self.use_btn = QPushButton("Dùng gợi ý này")
            self.use_btn.setFixedSize(140, 40)
            self.use_btn.setCursor(Qt.PointingHandCursor)
            self.use_btn.setStyleSheet("""
                QPushButton {
                    background-color: #6FB9C9;
                    color: white;
                    border-radius: 10px;
                    font-weight: bold;
                    font-size: 14px;
                    border: none;
                }
                QPushButton:hover { background-color: #4FA9BB; }
                QPushButton:disabled { background-color: #6FB9C9; }
            """)
            self.use_btn.setEnabled(False) # Disable nếu chưa chọn
            self.use_btn.clicked.connect(self.copy_and_close)

            action_layout.addStretch()
            action_layout.addWidget(self.use_btn)
            body_layout.addLayout(action_layout)

            # Ráp các thành phần lại
            inner_layout.addWidget(header_frame)
            inner_layout.addLayout(body_layout)
            outer_layout.addWidget(inner_frame)
            main_layout.addWidget(outer_frame)

        def on_suggestion_selected(self, btn):
            self.selected_suggestion = btn.text()
            self.use_btn.setEnabled(True) # Mở khóa nút
            self.use_btn.setStyleSheet("""
                QPushButton {
                    background-color: #038A99;
                    color: white;
                    border-radius: 10px;
                    font-weight: bold;
                    font-size: 14px;
                    border: none;
                }
                QPushButton:hover { background-color: #027583; }
            """)

        def copy_and_close(self):
            if self.selected_suggestion:
                # Copy vào Clipboard
                clipboard = QApplication.clipboard()
                clipboard.setText(self.selected_suggestion)
                print(f"Đã copy: {self.selected_suggestion}")
            self.close()

        def center_on_screen(self):
            # Căn giữa màn hình
            qr = self.frameGeometry()
            cp = QDesktopWidget().availableGeometry().center()
            qr.moveCenter(cp)
            self.move(qr.topLeft())

    # Khởi tạo và hiển thị
    popup = CenterAlertPopup(alert_type, advice_text, suggestions)
    popup.show()

    # Bắt đầu vòng lặp sự kiện của PyQt5
    app.exec_()

# ----------------------------------------------------
# 2. HÀM TRUNG TÂM XỬ LÝ GỌI POPUP
# ----------------------------------------------------
def trigger_alert(alert_type: int, advice_text: str, suggestions: list):
    """
    Hàm gọi hiển thị Popup.
    :param alert_type: 0 (Bỏ qua), 1 (Lừa đảo), 2 (Nổi giận), 3 (Buồn bã)
    :param advice_text: Lời khuyên/giải thích để hiện trên UI.
    :param suggestions: List chứa tối đa 3 câu gợi ý (ví dụ: ["Gợi ý 1", "Gợi ý 2", "Gợi ý 3"])
    """
    if alert_type == 0:
        print("ℹ️ Không trúng trường hợp cảnh báo (Type 0). Không hiện Popup.")
        return

    print(f"🚨 Kích hoạt Popup Cảnh báo Loại {alert_type}")

    # Phát âm thanh cảnh báo
    if os.path.exists(SOUND_PATH):
        winsound.PlaySound(SOUND_PATH, winsound.SND_FILENAME | winsound.SND_ASYNC)
    else:
        winsound.PlaySound("SystemNotification", winsound.SND_ALIAS | winsound.SND_ASYNC)

    # Gọi giao diện lên (sẽ block (dừng) luồng hiện tại cho đến khi đóng popup)
    show_popup(alert_type, advice_text, suggestions[:3])

# TEST CHẠY THỬ
if __name__ == "__main__":
    test_advice = (
        "Bạn ơi việc một người thân quen nhờ chuyển tiền hộ tồn tại nguy cơ người đó đã bị hack acc nhé, "
        "hãy gọi điện số trực tiếp xác minh với người đó cho dù có thân thiết đến nhường nào đi nữa, "
        "nếu vẫn chưa thấy mặt, nghe giọng đừng bao giờ chuyển tiền, hãy dừng lại vài giây suy nghĩ, "
        "nếu chuyển tiền gấp nhưng chưa xác minh được đối phương tốt nhất là nên làm lơ hoặc từ chối đi "
        "biết đâu được chỉ 1 tiếng hay 15 phút nữa thôi người chính chủ sẽ lên bài cảnh báo của họ.\n"
        "Hãy nhớ:” Chuyển tiền đi thì dễ, lấy lại được mới khó.”"
    )
    test_suggestions = [
        "Mình muốn gọi điện để xác minh nhé",
        "Bạn ơi mình hết tiền rồi không chuyển được",
        "Đợi mình 20 phút nữa được không ?"
    ]

    # Kích hoạt thử trường hợp Lừa đảo (Type = 1)
    trigger_alert(2, test_advice, test_suggestions)