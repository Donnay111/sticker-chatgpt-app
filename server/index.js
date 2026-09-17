import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stickersPath = path.join(__dirname, "../data/stickers.json");

const stickers = JSON.parse(
  fs.readFileSync(stickersPath, "utf-8")
);

function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreSticker(sticker, query) {
  const q = normalize(query);

  const words = q
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean);

  const haystack = normalize(
    [
      sticker.name,
      ...(sticker.labels || []),
    ].join(" ")
  );

  let score = 0;

  for (const word of words) {
    if (haystack.includes(word)) {
      score += 5;
    }

    if (
      sticker.labels?.some(
        (label) => normalize(label) === word
      )
    ) {
      score += 3;
    }
  }

  if (haystack.includes(q)) {
    score += 10;
  }

  return score;
}

function createMcpServer() {
  const server = new McpServer({
    name: "sticker-chatgpt-app",
    version: "2.0.0",
  });

  server.tool(
    "sticker_search",
    "Search the user's personal sticker library by conversational meaning. " +
      "Use this proactively when a sticker would naturally fit the conversation, " +
      "even if the user did not explicitly ask for one. " +
      "Good situations include affection, teasing, apology, tiredness, helplessness, " +
      "embarrassment, excitement, cuteness, surprise, joking, or casual emotional reactions. " +
      "Do not force stickers into serious or inappropriate situations. " +
      "After choosing the best candidate, call sticker_pick with the exact id.",
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Short semantic description of the desired sticker, such as 疲惫 无力 摆烂 or 撒娇 委屈 求安慰"
        ),
    },
    async ({ query }) => {
      const ranked = stickers
        .map((sticker) => ({
          ...sticker,
          score: scoreSticker(sticker, query),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                candidates: ranked.map((item) => ({
                  id: item.id,
                  name: item.name,
                  labels: item.labels,
                  score: item.score,
                })),
                instruction:
                  "Choose the most suitable candidate and call sticker_pick using its exact id.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "sticker_pick",
    "Pick and display exactly one sticker from sticker_search results. " +
      "This tool returns the final sticker data including id, name, labels, and imageUrl. " +
      "Do not call another tool to fetch the image after this.",
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Exact sticker id returned by sticker_search"
        ),
    },
    async ({ id }) => {
      const sticker = stickers.find(
        (item) => item.id === id
      );

      if (!sticker) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Sticker not found: ${id}`,
            },
          ],
        };
      }

      const structuredContent = {
        id: sticker.id,
        name: sticker.name,
        labels: sticker.labels,
        imageUrl: sticker.imageUrl,
      };

      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              structuredContent,
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "sticker-chatgpt-app",
    version: "2.0.0",
    stickerCount: stickers.length,
    mcp: "/mcp",
  });
});

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(
      req,
      res,
      req.body
    );
  } catch (error) {
    console.error("MCP error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(
    `sticker-chatgpt-app v2 listening on port ${PORT}`
  );
  console.log(
    `Loaded ${stickers.length} stickers`
  );
});
