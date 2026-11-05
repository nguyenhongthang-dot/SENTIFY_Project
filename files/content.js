// Dùng URL làm Lọ, lưu tên thật và chữ ký mốc tin nhắn
const chatMemory = {};
// Cấu trúc: chatMemory[chatId] = { partnerName, lastSig, jar: [...], pending }

let currentUrl = location.href;

const BATCH_SIZE = 5; // đủ 5 tin mới thì gửi
const JAR_MAX = 15; // lọ tối đa 15 tin
const JAR_REMOVE = 2; // đủ 15 thì xóa 2 tin cũ nhất

function getPartnerName() {
  const nameElement = document.querySelector(
    'span[dir="auto"] h1[dir="auto"], div[role="main"] span[dir="auto"]',
  );
  if (nameElement && nameElement.innerText.trim() !== "") {
    return nameElement.innerText.trim();
  }

  const h1 = document.querySelector('h1[dir="auto"]');
  if (h1 && h1.innerText.trim() !== "") {
    return h1.innerText.trim();
  }

  return null;
}

// 🛑 HÀM KIỂM TRA NHÓM
// Dựa trên dữ liệu thật đo được từ Messenger:
//  - Chat 1-1 CÓ thẻ <h4>, nhưng nội dung chỉ là: tên đối phương (trùng tên trên header) hoặc "Bạn đã gửi".
//  - Nhóm có thêm <h4> chứa tên NGƯỜI KHÁC (khác tên header) -> đó mới là dấu hiệu nhóm.
//  - alt của avatar luôn là tên thật (có thể khác tên header do biệt danh) nên KHÔNG so với header.
//  - Ảnh có alt là emoji/icon (vd nút 🦋 ở ô soạn tin) phải bị loại, không được tính là "một người".
function isGroupChat() {
  const mainChat = document.querySelector('div[role="main"]');
  if (!mainChat) return false;

  const headerName = (getPartnerName() || "").trim().toLowerCase();

  // 1. Quét TOÀN BỘ thẻ <h4> trong khung chat (không leo từ avatar nữa)
  for (const h of mainChat.querySelectorAll("h4")) {
    const t = h.innerText.trim().toLowerCase();
    if (!t) continue;

    if (t === headerName) continue; // tên đối phương trong chat 1-1
    if (t === "bạn đã gửi" || t === "you sent") continue; // nhãn tin nhắn của mình
    if (/\sđã\s/.test(t)) continue; // thông báo hệ thống: "... đã xoá/rời/trả lời ..."

    // Còn lại: tên một người khác trên bong bóng -> NHÓM
    return true;
  }

  // 2. Chốt chặn phụ: có từ 2 người khác nhau trên avatar -> NHÓM
  const partnerRealNames = new Set();
  for (const img of mainChat.querySelectorAll("img[alt]")) {
    const altText = img.getAttribute("alt").trim();
    if (altText.length < 2) continue;
    if (!/\p{L}/u.test(altText)) continue; // bỏ emoji/icon không có chữ cái

    const lowerAlt = altText.toLowerCase();
    if (
      ["đã xem", "đang hoạt động", "thu hồi", "gửi lúc", "biểu tượng"].some(
        (w) => lowerAlt.includes(w),
      )
    )
      continue;

    partnerRealNames.add(lowerAlt.replace(/\s+/g, " "));
  }

  return partnerRealNames.size > 1;
}

function detectIsSelf(element) {
  const mainChat = document.querySelector('div[role="main"]');
  if (!mainChat) return false;

  const chatRect = mainChat.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();

  const elCenter = (elRect.left + elRect.right) / 2;
  const chatCenter = (chatRect.left + chatRect.right) / 2;

  return elCenter > chatCenter;
}

function sendJarToBackground(partnerName, jar) {
  const payload = {
    user_A: "Bạn",
    user_B: partnerName,
    messages: jar.map((m) => ({
      message: m.text,
      is_self: m.isSelf,
      timestamp: m.time,
    })),
  };

  chrome.runtime.sendMessage(
    { type: "SENTIFY_MESSAGE", payload },
    (response) => {
      // Nếu có kết quả AI và là cảnh báo (alert_type > 0), tiến hành vẽ Overlay
      if (response && response.ok && response.data && response.data.ai_result) {
        const aiData = response.data.ai_result;
        if (aiData.alert_type > 0) {
          showSentifyOverlay(
            aiData.alert_type,
            aiData.advice_text,
            aiData.suggestions,
          );
        }
      }
    },
  );
}

function scanMessages() {
  const mainChat = document.querySelector('div[role="main"]');
  if (!mainChat) return;

  const chatId = location.pathname;
  const currentUIName = getPartnerName();

  if (!currentUIName) return;

  // 🛑 CHẶN GROUP CHAT NGAY TẠI ĐÂY
  // (Đã xóa currentUIName vì hàm isGroupChat mới tự nhận diện siêu chuẩn mà không cần so tên nữa)
  if (isGroupChat()) {
    return; // Nếu phát hiện là nhóm, ngắt luồng ngay lập tức.
  }

  const elements = Array.from(mainChat.querySelectorAll('div[dir="auto"]'));
  const validElements = [];

  elements.forEach((el) => {
    if (el.querySelector('div[dir="auto"]')) return;
    if (el.closest('[contenteditable="true"], [role="textbox"]')) return;

    let text = el.innerText.trim();
    if (!text) return;

    const lowerText = text.toLowerCase();
    const isUIGarbage =
      lowerText.startsWith("nhấp, tin nhắn") ||
      lowerText.startsWith("nhấp để") ||
      lowerText.includes("gửi lúc") ||
      /^\d{1,2}:\d{2}(\s*(am|pm|sa|ch))?$/i.test(lowerText) ||
      ["đã gửi", "đã xem", "đang hoạt động", "chỉnh sửa", "thu hồi"].includes(
        lowerText,
      );

    if (!isUIGarbage) {
      const isSelf = detectIsSelf(el);
      validElements.push({
        text: text,
        isSelf: isSelf,
        sig: `${isSelf ? "Self" : "Partner"}::${text}`,
      });
    }
  });

  if (validElements.length === 0) return;

  if (!chatMemory[chatId]) {
    chatMemory[chatId] = {
      partnerName: currentUIName,
      messages: validElements.map((v) => v.sig),
      jar: [], // lọ chứa tin
      count: 0, // đếm số tin mới từ lần gửi trước
    };
    return;
  }

  const memory = chatMemory[chatId].messages;
  const partnerNameFromMemory = chatMemory[chatId].partnerName;
  const lastKnownSig = memory[memory.length - 1];

  let boundaryIndex = -1;

  for (let i = validElements.length - 1; i >= 0; i--) {
    if (validElements[i].sig === lastKnownSig) {
      boundaryIndex = i;
      break;
    }
  }

  if (boundaryIndex === validElements.length - 1) {
    return;
  } else if (boundaryIndex !== -1) {
    const newMessages = validElements.slice(boundaryIndex + 1);
    const mem = chatMemory[chatId];

    newMessages.forEach((msg) => {
      mem.messages.push(msg.sig);

      // bỏ tin vào lọ, mỗi tin +1
      mem.jar.push({
        text: msg.text,
        isSelf: msg.isSelf,
        time: new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
      mem.count++;

      // đủ 5 tin -> gửi NGUYÊN LỌ, reset đếm về 0
      if (mem.count >= BATCH_SIZE) {
        sendJarToBackground(partnerNameFromMemory, mem.jar);
        mem.count = 0;
      }

      // lọ chạm 15 -> xóa 2 tin trên cùng
      if (mem.jar.length >= JAR_MAX) {
        mem.jar.splice(0, JAR_REMOVE);
      }
    });
  } else {
    chatMemory[chatId].messages = validElements.map((v) => v.sig);
    if (currentUIName && currentUIName !== "Đối Phương") {
      chatMemory[chatId].partnerName = currentUIName;
    }
  }
}

const observer = new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
  }
  scanMessages();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

function showSentifyOverlay(alert_type, advice_text, suggestions) {
  // Loại 0 => không hiển thị. Đã có popup => bỏ qua
  if (alert_type === 0) return;
  if (document.getElementById("sentify-overlay-wrapper")) return;

  // ---- Thông số màu / tiêu đề (y hệt Popup.py) ----
  let alertTitle, alertColor, iconColor;
  if (alert_type === 1) {
    alertTitle = "CẢNH BÁO: ĐỐI PHƯƠNG CÓ NGUY CƠ LỪA ĐẢO !!!";
    alertColor = "#DB1C1C";
    iconColor = "#EF4444";
  } else if (alert_type === 2) {
    alertTitle = "PHÂN TÍCH: ĐỐI PHƯƠNG ĐANG NỔI GIẬN";
    alertColor = "#FF8800";
    iconColor = alertColor;
  } else if (alert_type === 3) {
    alertTitle = "PHÂN TÍCH: ĐỐI PHƯƠNG ĐANG BUỒN BÃ";
    alertColor = "#FFE664";
    iconColor = alertColor;
  } else {
    alertTitle = "THÔNG BÁO HỆ THỐNG";
    alertColor = "#2ECC71";
    iconColor = alertColor;
  }

  // Escape HTML (giống html.escape trong Python)
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const safeAdvice = esc(advice_text).replace(/\n/g, "<br>");
  const suggList = (suggestions || []).filter(Boolean).slice(0, 3);
  const suggestionsHTML = suggList
    .map((t, i) => `<button class="sugg" data-index="${i}">${esc(t)}</button>`)
    .join("");

  // ---- Host + Shadow DOM (tránh CSS của Facebook/Messenger/Zalo ghi đè) ----
  const wrapper = document.createElement("div");
  wrapper.id = "sentify-overlay-wrapper";
  wrapper.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;";
  const root = wrapper.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'Inter','Segoe UI',Arial,sans-serif; }

      .stage {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        display: flex; justify-content: center; align-items: center;
      }

      /* Cửa sổ Qt là 560x780 nhưng có margin 10px => khung vàng thực tế 540x760 */
      .card {
        width: 540px; height: 760px; flex: none;
        background: #FFF08D; border-radius: 30px; padding: 10px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.35);
        transform-origin: center center;
      }
      .inner {
        width: 100%; height: 100%;
        background: linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 25%, #B6C3CD 100%);
        border-radius: 20px; overflow: hidden;
        display: flex; flex-direction: column;
      }

      /* ---------- Header ---------- */
      .header {
        position: relative; height: 140px; flex: none;
        padding: 14px 20px 12px 20px;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
      }
      .header-bg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .title-svg { position: relative; width: 100%; height: 66px; flex: none; overflow: visible; }
      .sub {
        position: relative; margin: 0; color: #fff;
        font-size: 18px; font-weight: 700; text-align: center;
      }
      .close {
        position: absolute; top: 12px; right: 6px; width: 34px; height: 34px;
        background: #fff; color: #E8553A; border: none; border-radius: 17px;
        font-weight: 700; font-size: 17px; cursor: pointer; padding: 0;
        display: flex; justify-content: center; align-items: center;
      }
      .close:hover { background: #FADBD8; }

      /* ---------- Body ---------- */
      .body {
        flex: 1; min-height: 0; overflow-y: auto;
        padding: 18px 24px 22px 24px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .alert-row { display: flex; align-items: center; gap: 10px; flex: none; }
      .icon {
        width: 28px; height: 28px; border-radius: 14px; flex: none;
        color: #fff; font-size: 17px; font-weight: 700;
        display: flex; justify-content: center; align-items: center;
      }
      .alert-title { font-size: 16px; font-weight: 700; }

      /* line-height 28px = 140% của line-spacing Qt => đúng khoảng dòng trong popup Python */
      .advice {
        margin: 0; flex: 1 0 auto;
        color: #5C6B8A; font-size: 15px; line-height: 28px; text-align: justify;
      }

      .suggest-label {
        flex: none; height: 46px; margin-top: 6px; padding-left: 20px;
        display: flex; align-items: center;
        background: linear-gradient(90deg, #EE6535 0%, #D63A33 100%);
        color: #fff; border-radius: 12px; font-weight: 700; font-size: 13px;
      }

      .sugg {
        flex: none; width: 100%; height: 46px;
        display: flex; align-items: center; text-align: left;
        padding: 0 16px 0 20px; line-height: 1.25;
        background: #7FC1CC; color: #fff; border: none; border-radius: 12px;
        font-size: 13px; font-weight: 700; cursor: pointer;
      }
      .sugg:hover { background: #66B2BF; }
      .sugg.active { background: #038A99; }

      .action { display: flex; justify-content: flex-end; flex: none; }
      .use {
        width: 140px; height: 40px; background: #6FB9C9; color: #fff;
        border: none; border-radius: 10px; font-weight: 700; font-size: 14px;
        cursor: pointer;
      }
      .use:disabled { background: #6FB9C9; }
      .use:not(:disabled):hover { background: #4FA9BB; }
      .use.active { background: #038A99; }
      .use.active:hover { background: #027583; }
    </style>

    <div class="stage">
      <div class="card" id="card">
        <div class="inner">

          <div class="header">
            <!-- Gradient dùng objectBoundingBox y hệt qlineargradient(x1:0,y1:0,x2:1,y2:0.4) -->
            <svg class="header-bg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="hg" x1="0" y1="0" x2="1" y2="0.4">
                  <stop offset="0" stop-color="#C42320"/>
                  <stop offset="1" stop-color="#EE6535"/>
                </linearGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#hg)"/>
            </svg>

            <!-- Chữ SENTIFY: bóng đổ lệch 4px + viền trắng 5px bo tròn + chữ xanh (giống paintEvent) -->
            <svg class="title-svg" xmlns="http://www.w3.org/2000/svg">
              <text x="50%" y="56" text-anchor="middle"
                    font-family="'Arial Black','Arial',sans-serif" font-weight="900" font-size="48"
                    fill="rgba(70,10,10,0.59)">SENTIFY</text>
              <text x="50%" y="52" text-anchor="middle"
                    font-family="'Arial Black','Arial',sans-serif" font-weight="900" font-size="48"
                    fill="#0FA3B8" stroke="#FFFFFF" stroke-width="5"
                    stroke-linejoin="round" stroke-linecap="round"
                    paint-order="stroke fill">SENTIFY</text>
            </svg>

            <p class="sub">Hệ thống giám sát an toàn và phân tích cảm xúc</p>
            <button class="close" id="close-btn">✕</button>
          </div>

          <div class="body">
            <div class="alert-row">
              <div class="icon" style="background:${iconColor}">!</div>
              <div class="alert-title" style="color:${alertColor}">${alertTitle}</div>
            </div>

            <p class="advice">${safeAdvice}</p>

            <div class="suggest-label">Bạn có thể tham khảo 3 gợi ý dưới đây để phản hồi đối phương :</div>
            ${suggestionsHTML}

            <div class="action">
              <button class="use" id="use-btn" disabled>Dùng gợi ý này</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper);

  // ---- Tự thu nhỏ theo tỉ lệ nếu màn hình nhỏ (giữ nguyên bố cục cân đối) ----
  const card = root.getElementById("card");
  const fit = () => {
    const s = Math.min(
      0.8,
      (window.innerHeight * 0.96) / 760,
      (window.innerWidth * 0.96) / 540,
    );
    card.style.transform = `scale(${s})`;
  };
  fit();
  window.addEventListener("resize", fit);
  const cleanup = () => {
    window.removeEventListener("resize", fit);
    wrapper.remove();
  };

  // ---- Logic: chọn 1 gợi ý (exclusive) + copy ----
  let selectedText = "";
  const closeBtn = root.getElementById("close-btn");
  const useBtn = root.getElementById("use-btn");
  const suggBtns = root.querySelectorAll(".sugg");

  closeBtn.addEventListener("click", cleanup);

  suggBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      suggBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedText = suggList[Number(btn.dataset.index)];
      useBtn.disabled = false;
      useBtn.classList.add("active");
    });
  });

  const fallbackCopy = (text) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    ta.remove();
  };

  useBtn.addEventListener("click", () => {
    if (!selectedText) return;
    const done = () => {
      console.log("Đã copy: " + selectedText);
      cleanup();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(selectedText)
        .then(done)
        .catch(() => {
          fallbackCopy(selectedText);
          done();
        });
    } else {
      fallbackCopy(selectedText);
      done();
    }
  });
}
