// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.140.0/http/server.ts";

let lastMessageId = "";

const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord リアクションボット</title>
</head>
<body>
  <h1>Discord リアクションボット</h1>
  <form id="form">
    <label>
      ユーザートークン: <input type="text" id="token" required />
    </label>
    <br />
    <label>
      チャンネルID: <input type="text" id="channelId" required />
    </label>
    <br />
    <label>
      リアクションで使用する絵文字:
      <select id="emojiList" multiple>
        <option value="🔆">🔆</option>
      </select>
    </label>
    <br />
    <label>
      各絵文字のリアクション回数: <input type="number" id="repeatCount" min="1" value="1" required />
    </label>
    <br />
    <button type="submit">監視を開始</button>
  </form>
  <p id="status"></p>
  <script>
    const form = document.getElementById("form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = document.getElementById("token").value;
      const channelId = document.getElementById("channelId").value;
      const repeatCount = parseInt(document.getElementById("repeatCount").value, 10);
      const selectedEmojis = Array.from(
        document.getElementById("emojiList").selectedOptions
      ).map(option => option.value);
      const response = await fetch("/api/discord/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, channelId, emojis: selectedEmojis, repeatCount }),
      });
      const result = await response.json();
      document.getElementById("status").innerText = result.message;
    });
  </script>
</body>
</html>
`;

async function addReactionsSequentially(
  token: string,
  channelId: string,
  messageId: string,
  emojis: string[],
  repeatCount: number
) {
  // 幅広い絵文字の並列処理
  const reactions = emojis.flatMap(
    (emoji) => Array(repeatCount).fill(emoji) // repeatCount回数分絵文字を生成
  );

  // 非同期で絵文字を並列処理
  const reactionPromises = reactions.map((emoji) => {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const emojiEncoded = encodeURIComponent(emoji);
        const reactionResponse = await fetch(
          `https://discord.com/api/v9/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`,
          {
            method: "PUT",
            headers: {
              Authorization: token,
            },
          }
        );

        if (reactionResponse.ok) {
          console.log(`リアクション成功: ${emoji}`);
          resolve();
        } else if (reactionResponse.status === 429) {
          const retryAfter =
            parseInt(reactionResponse.headers.get("Retry-After") || "1", 10) *
            1000;
          console.warn(
            `リアクション失敗: ${emoji} (429 - 再試行まで ${retryAfter}ms 待機)`
          );
          setTimeout(() => {
            reject(new Error("Rate limit exceeded"));
          }, retryAfter); // 再試行
        } else {
          console.error(
            `リアクション失敗: ${emoji} (${reactionResponse.status})`
          );
          reject(new Error("Unknown error"));
        }
      } catch (err) {
        console.error(`エラーが発生しました: ${emoji}`, err);
        reject(err);
      }
    });
  });

  try {
    // すべてのリアクションを並列で実行
    await Promise.all(reactionPromises);
  } catch (err) {
    console.error("リアクション処理中にエラーが発生しました:", err);
  }
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "GET") {
    return new Response(HTML_CONTENT, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  } else if (
    request.method === "POST" &&
    request.url.endsWith("/api/discord/watch")
  ) {
    const { token, channelId, emojis, repeatCount } = await request.json();

    setInterval(async () => {
      try {
        const messagesResponse = await fetch(
          `https://discord.com/api/v9/channels/${channelId}/messages?limit=1`,
          {
            headers: {
              Authorization: token,
            },
          }
        );

        const messages = await messagesResponse.json();
        if (messages && messages[0]?.id !== lastMessageId) {
          lastMessageId = messages[0]?.id;

          console.log(`新しいメッセージ検出: ${lastMessageId}`);
          await addReactionsSequentially(
            token,
            channelId,
            lastMessageId,
            emojis,
            repeatCount
          );
        }
      } catch (err) {
        console.error("エラーが発生しました:", err);
      }
    }, 5000); // 5秒間隔で監視

    return new Response(
      JSON.stringify({ message: "チャンネル監視を開始しました！" }),
      { headers: { "Content-Type": "application/json; charset=UTF-8" } }
    );
  }

  return new Response("Not Found", { status: 404 });
}

serve(handleRequest);
