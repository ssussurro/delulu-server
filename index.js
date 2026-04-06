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
`;
}
