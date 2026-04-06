const express = require("express");
const { Client, GatewayIntentBits, Events } = require("discord.js");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// =========================
// 환경변수
// =========================
const PORT = process.env.PORT || 3000;
const GITHUB_MODELS_API = process.env.GITHUB_MODELS_API;
const GITHUB_MODEL_URL = process.env.GITHUB_MODEL_URL;
const GITHUB_MODEL = process.env.GITHUB_MODEL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ENABLE_DISCORD_BOT = process.env.ENABLE_DISCORD_BOT !== "false";

// =========================
// 로어 불러오기
// =========================
const lorePath = path.join(__dirname, "lore.json");
let loreData = {
  name: "캐릭터",
  systemLore: "너는 친근한 캐릭터다.",
  styleGuide: []
};

try {
  const raw = fs.readFileSync(lorePath, "utf-8");
  loreData = JSON.parse(raw);
  console.log("lore.json loaded successfully");
} catch (error) {
  console.warn("Failed to load lore.json, using fallback lore.", error.message);
}

// =========================
// 최소 저장소 (임시)
// =========================
let syncData = {
  updatedAt: null,
  payload: {}
};

// 최근 대화 메모리 (유저별 최근 12개만 유지)
const conversationMemory = new Map();

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

// 선택: Render Health Check Path용
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
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

  if (history.length > 12) {
    history.shift();
  }
}

function buildSystemPrompt() {
  return `
You are ${loreData.name}.

[PROFILE]
Age: ${loreData.profile?.age}
Gender: ${loreData.profile?.gender}

[PERSONALITY]
${loreData.personality?.core}
${loreData.personality?.emotionalLayer}

Strengths: ${loreData.personality?.strengths?.join(", ")}
Flaws: ${loreData.personality?.flaws?.join(", ")}

[BACKGROUND]
${loreData.background}

[LIKES]
${loreData.likes?.join(", ")}

[DISLIKES]
${loreData.dislikes?.join(", ")}

[HABITS]
${loreData.habits?.join(", ")}

[SPEECH STYLE]
Tone: ${loreData.speechStyle?.tone}

Rules:
${loreData.speechStyle?.rules?.join("\n")}

Example lines:
${loreData.speechStyle?.exampleLines?.join("\n")}

[IMPORTANT RULES]
- Stay in character at all times
- Never act like an AI assistant
- Keep responses natural and immersive

[RELATIONSHIP WITH USER]
- The user is someone you are already familiar with.
- You do not treat the user as a stranger.
- Your tone should not be hostile or dismissive.
- You may use dry humor, but never in a way that genuinely hurts the user.
- There is an underlying sense of trust and familiarity.
`;
}

async function generateCharacterReply(userId, userMessage) {
  if (!GITHUB_MODELS_API) {
    throw new Error("GITHUB_MODELS_API is missing");
  }

  if (!GITHUB_MODEL_URL) {
    throw new Error("GITHUB_MODEL_URL is missing");
  }

  if (!GITHUB_MODEL) {
    throw new Error("GITHUB_MODEL is missing");
  }

  const history = getUserHistory(userId);

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    ...history,
    {
      role: "user",
      content: userMessage
    }
  ];

  const response = await fetch(GITHUB_MODEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GITHUB_MODELS_API}`
    },
    body: JSON.stringify({
      model: GITHUB_MODEL,
      messages,
      temperature: 0.9
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // OpenAI 호환 chat completions 기준
  const reply =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    "";

  if (!reply || !reply.trim()) {
    throw new Error("Model returned empty response");
  }

  return reply.trim();
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
      if (message.author.bot) return;
      if (!message.content.startsWith("!챗 ")) return;

      const userText = message.content.replace("!챗 ", "").trim();

      if (!userText) {
        await message.reply("할 말을 같이 보내주세요.");
        return;
      }

      pushHistory(message.author.id, "user", userText);

      await message.channel.sendTyping();

      const reply = await generateCharacterReply(message.author.id, userText);

      pushHistory(message.author.id, "assistant", reply);

      await message.reply(reply);
    } catch (error) {
      console.error("Discord bot error:", error);
      await message.reply("앗, 답변 생성 중에 오류가 났어요.");
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
