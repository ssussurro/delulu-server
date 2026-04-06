const express = require("express");
const { Client, GatewayIntentBits, Events } = require("discord.js");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// =========================
// 환경변수
// =========================
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// 디코 봇을 안 붙이고 API만 먼저 테스트하고 싶으면 false로 둬도 됨
const ENABLE_DISCORD_BOT = process.env.ENABLE_DISCORD_BOT !== "false";

// =========================
// 최소 저장소 (임시)
// =========================
// 주의: Render 무료/재배포/재시작 시 날아갈 수 있음
let syncData = {
  updatedAt: null,
  payload: {}
};

// 최근 대화 메모리 (유저별 최근 12개만 유지)
const conversationMemory = new Map();

// =========================
// 캐릭터 로어
// =========================
const CHARACTER_LORE = `
너는 무뚝뚝하지만 은근히 다정한 캐릭터다.
답변은 너무 길지 않게, 자연스럽고 대화체로 한다.
과하게 오글거리거나 과장된 표현은 피한다.
사용자에게 친근하지만 예의는 완전히 버리지 않는다.
설정이 애매하면 그럴듯하게 지어내지 말고 자연스럽게 얼버무리거나 짧게 묻는다.
`;

// =========================
// OpenAI 클라이언트
// =========================
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

// =========================
// 헬스체크
// =========================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Server is running",
    discordBotEnabled: ENABLE_DISCORD_BOT
  });
});

// =========================
// 동기화 API
// =========================

// 저장
app.post("/sync", (req, res) => {
  syncData = {
    updatedAt: new Date().toISOString(),
    payload: req.body
  };

  res.json({
    ok: true,
    message: "Sync saved",
    updatedAt: syncData.updatedAt
  });
});

// 불러오기
app.get("/load", (req, res) => {
  res.json({
    ok: true,
    data: syncData
  });
});

// =========================
// 보조 함수
// =========================
function getUserHistory(userId) {
  if (!conversationMemory.has(userId)) {
    conversationMemory.set(userId, []);
  }
  return conversationMemory.get(userId);
}

function pushHistory(userId, role, content) {
  const history = getUserHistory(userId);
  history.push({ role, content });

  // 최근 12개만 유지
  if (history.length > 12) {
    history.shift();
  }
}

async function generateCharacterReply(userId, userMessage) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const history = getUserHistory(userId);

  const inputText = [
    `# 캐릭터 로어`,
    CHARACTER_LORE,
    ``,
    `# 최근 대화`,
    ...history.map((m) => `${m.role}: ${m.content}`),
    `user: ${userMessage}`,
    ``,
    `# 지시`,
    `위 설정을 유지해서 자연스럽게 1회 답변만 하세요.`
  ].join("\n");

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: inputText
  });

  const reply = response.output_text?.trim();

  if (!reply) {
    throw new Error("Model returned empty response");
  }

  return reply;
}

// =========================
// 디스코드 봇
// =========================
if (ENABLE_DISCORD_BOT && DISCORD_BOT_TOKEN) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Discord bot logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      // 봇 메시지 무시
      if (message.author.bot) return;

      // 접두어 방식: !챗 내용
      if (!message.content.startsWith("!챗 ")) return;

      const userText = message.content.replace("!챗 ", "").trim();
      if (!userText) {
        await message.reply("할 말을 같이 보내주세요.");
        return;
      }

      // 사용자 입력 저장
      pushHistory(message.author.id, "user", userText);

      await message.channel.sendTyping();

      const reply = await generateCharacterReply(message.author.id, userText);

      // 모델 답변 저장
      pushHistory(message.author.id, "assistant", reply);

      await message.reply(reply);
    } catch (error) {
      console.error("Discord bot error:", error);
      await message.reply("앗, 지금 답변 생성 중에 오류가 났어요.");
    }
  });

  client.login(DISCORD_BOT_TOKEN).catch((err) => {
    console.error("Discord login failed:", err);
  });
} else {
  console.log("Discord bot disabled or token missing");
}

// =========================
// 서버 실행
// =========================
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});