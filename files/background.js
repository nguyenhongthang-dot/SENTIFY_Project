// background.js — Service worker: nhận lọ tin nhắn từ content.js -> gọi thẳng Gemini -> trả kết quả về content.js
// (Thay thế hoàn toàn server.py + ai_caller.py)

importScripts("config.js"); // nạp GEMINI_API_KEY

// Danh sách model theo thứ tự ưu tiên (giữ nguyên như ai_caller.py).
// Nếu model đầu bị 503 / 429 / 404 sẽ tự động chuyển sang model tiếp theo.
const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

// Timeout mỗi model (service worker MV3 dễ bị tắt nếu chờ quá lâu nên để ngắn hơn bản Python 25s)
const REQUEST_TIMEOUT_MS = 12000;

// ── Prompt hệ thống cho Gemini (giữ nguyên nội dung từ ai_caller.py) ──
const SYSTEM_PROMPT = `Bạn là SENTIFY — hệ thống giám sát an toàn và phân tích cảm xúc để BẢO VỆ người dùng A (Bạn / Người nhắn).

Hội thoại gồm 2 phía:
- A (Bạn / Người dùng / Người nhắn tin trên máy tính này)
- B (Đối phương / Người đang trò chuyện cùng A)

QUY TẮC CỐT LÕI (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT):
1. Bạn CHỈ phân tích hành vi và cảm xúc của B (Đối phương).
2. TUYỆT ĐỐI KHÔNG đánh giá hoặc cảnh báo hành vi/cảm xúc của A (Bạn / Người nhắn).
3. NẾU hành vi lừa đảo (đòi tiền, ép chuyển khoản, gửi link...) HOẶC cảm xúc tiêu cực (tức giận, chửi bới, đe dọa, buồn bã, chán nản...) xuất phát từ A mà KHÔNG PHẢI từ B -> BẮT BUỘC TRẢ VỀ \`alert_type: 0\` (KHÔNG HIỆN POPUP).
   - Ví dụ: A chửi bới B, A đòi tiền B, A dọa nạt B, hay A than thở buồn bã... trong khi B bình thường hoặc không gây hại -> alert_type = 0.
4. HÃY coi kỹ ngữ cảnh nếu thuộc trường hợp đang giỡn thì vẫn trả về alert_type=0 8.
5. Chỉ cảnh báo khi B (Đối phương) là bên gây nguy cơ hoặc mang cảm xúc tiêu cực đối với A:
   - alert_type = 1: B (Đối phương) có dấu hiệu LỪA ĐẢO (B mượn tiền gấp, B gửi link lạ, B giả danh người thân, B tạo áp lực bắt A chuyển tiền/cung cấp tài khoản...).
   - alert_type = 2: B (Đối phương) đang NỔI GIẬN, chửi bới, hung hăng, đe dọa A.
   - alert_type = 3: B (Đối phương) đang BUỒN BÃ, tuyệt vọng hoặc cần được an ủi.
   - alert_type = 0: Cuộc trò chuyện bình thường, HOẶC cảm xúc tiêu cực/lừa đảo xuất phát từ A chứ không phải từ B.


- advice_text: Lời khuyên chi tiết dành cho A (người dùng) khi có cảnh báo đối phương, viết bằng tiếng Việt tự nhiên (khoảng 3-6 câu). Nếu alert_type = 0, để nội dung ngắn gọn.
- suggestions: Đúng 3 câu gợi ý phản hồi ngắn gọn (dưới 60 ký tự) cho A.

Lưu ý: Chỉ trả về đúng 1 JSON object, KHÔNG viết bất kỳ chữ nào ngoài JSON:
{
  "alert_type": <int 0, 1, 2, hoặc 3>,
  "advice_text": "<string>",
  "suggestions": ["<string>", "<string>", "<string>"]
}
`;

// ── Tách lọ thành 2 mảng A / B (thay cho phần ghép box trong server.py) ──
function buildBox(messages) {
  const box = { A_msgs: [], B_msgs: [] };
  for (const m of messages || []) {
    const entry = `[${m.timestamp || ""}] ${m.message || ""}`;
    if (m.is_self) box.A_msgs.push(entry);
    else box.B_msgs.push(entry);
  }
  return box;
}

// ── Ghép hội thoại có thứ tự thời gian (port từ _build_chat_text) ──
function buildChatText(box, userBName) {
  const lines = [];
  for (const msg of box.A_msgs) lines.push(`A (Bạn / Người nhắn): ${msg}`);
  for (const msg of box.B_msgs)
    lines.push(`B (${userBName} / Đối phương): ${msg}`);

  const extractTime = (line) => {
    const m = line.match(/\[(\d{2}:\d{2}:\d{2})\]/);
    return m ? m[1] : "99:99:99";
  };

  // Array.prototype.sort ổn định => giống sort() của Python
  lines.sort((a, b) => {
    const ta = extractTime(a);
    const tb = extractTime(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return lines.join("\n");
}

// ── Gọi Gemini, tự fallback model khi 503/429/404 (port từ _call_gemini) ──
async function callGemini(chatText) {
  const requestBody = {
    contents: [
      { parts: [{ text: SYSTEM_PROMPT + "\n\nĐoạn hội thoại:\n" + chatText }] },
    ],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  };

  let lastError = null;

  for (const modelName of CANDIDATE_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        lastError = `HTTP ${resp.status}: ${errText.slice(0, 180)}`;
        if ([503, 429, 404].includes(resp.status)) {
          console.warn(
            `⚠️ Model '${modelName}' gặp ${resp.status}. Đang chuyển sang model tiếp theo...`,
          );
          continue;
        }
        console.error(
          `❌ Gemini API HTTP ${resp.status} trên '${modelName}': ${errText}`,
        );
        return null;
      }

      const body = await resp.json();
      const rawText = body.candidates[0].content.parts[0].text;
      let cleaned = rawText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, "");
      }
      return JSON.parse(cleaned);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.error(`❌ Không parse được JSON từ Gemini (${modelName})`);
        return null;
      }
      lastError = String(e);
      console.warn(
        `⚠️ Lỗi kết nối tới ${modelName}: ${e}. Đang thử model khác...`,
      );
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  console.error(`❌ Tất cả model Gemini đều không phản hồi: ${lastError}`);
  return null;
}

// ── Phân tích 1 box chat (port từ analyze) ──
async function analyze(box, userBName) {
  if (!box.B_msgs.length) {
    console.log("⏳ Đối phương chưa gửi tin nhắn nào. Bỏ qua phân tích...");
    return null;
  }

  const chatText = buildChatText(box, userBName);
  console.log(
    `🤖 Đang gửi ${chatText.length} ký tự đến Gemini để phân tích...`,
  );

  const result = await callGemini(chatText);
  if (!result || typeof result !== "object") return null;

  let alertType = result.alert_type;
  const adviceText = result.advice_text || "";
  let suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];

  if (![0, 1, 2, 3].includes(alertType)) {
    console.warn(`⚠️ alert_type không hợp lệ: ${alertType}. Mặc định = 0.`);
    alertType = 0;
  }

  while (suggestions.length < 3) suggestions.push("Mình cần suy nghĩ thêm nhé");
  suggestions = suggestions.slice(0, 3);

  console.log(`✅ Kết quả AI: alert_type=${alertType}`);
  return { alert_type: alertType, advice_text: adviceText, suggestions };
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("🚀 SENTIFY Extension đã được cài đặt thành công!");
});

// Nhận lọ tin nhắn từ content.js -> phân tích bằng Gemini -> trả về cho content.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "SENTIFY_MESSAGE") return;

  const payload = msg.payload || {};
  const userB = payload.user_B || "Đối Phương";
  const box = buildBox(payload.messages);

  analyze(box, userB)
    // Giữ đúng cấu trúc { ok, data: { ai_result } } như server cũ => content.js KHÔNG cần sửa
    .then((aiResult) =>
      sendResponse({ ok: true, data: { ai_result: aiResult } }),
    )
    .catch((err) => {
      console.error("SENTIFY - Lỗi phân tích:", err);
      sendResponse({ ok: false, error: String(err) });
    });

  return true; // giữ kênh mở để trả lời bất đồng bộ
});
