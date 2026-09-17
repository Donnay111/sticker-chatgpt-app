import express from "express";
import { createClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://svyuhtijqgzargzixhfs.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Render environment variables."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || ""
);

function makeServer() {
  const server = new McpServer({
    name: "sticker-mcp",
    version: "1.0.0",
  });

  server.tool(
    "search_stickers",
    "When the current conversation naturally suits a sticker, proactively search for one even if the user did not explicitly ask. Use this for casual emotional conversation such as tiredness, affection, teasing, apology, excitement, embarrassment, helplessness, cuteness, joking, or similar situations. Do not force stickers into serious or inappropriate contexts.",
    {
      query: z
        .string()
        .describe(
          "Concise semantic description of the sticker needed, e.g. 疲惫 无力 摆烂"
        ),
    },
    async ({ query }) => {
      const { data, error } = await supabase
        .from("sticker_catalog")
        .select(
          "id, public_url, ocr_text, visual_description, semantic_intent, tone_tags, use_intents, avoid_when, confidence"
        )
        .eq("assistant_enabled", true);

      if (error) {
        throw new Error(error.message);
      }

      const words = query
        .toLowerCase()
        .split(/[\s，。！？、,.!?;；:：]+/)
        .filter(Boolean);

      const scored = (data || [])
        .map((sticker) => {
          const text = [
            sticker.ocr_text || "",
            sticker.visual_description || "",
            sticker.semantic_intent || "",
            ...(sticker.tone_tags || []),
            ...(sticker.use_intents || []),
          ]
            .join(" ")
            .toLowerCase();

          let score = 0;

          for (const word of words) {
            if (text.includes(word)) {
              score += 1;
            }
          }

          return {
            ...sticker,
            match_score: score,
          };
        })
        .sort((a, b) => {
          if (b.match_score !== a.match_score) {
            return b.match_score - a.match_score;
          }

          return (b.confidence || 0) - (a.confidence || 0);
        })
        .slice(0, 6);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                candidates: scored,
                instruction:
                  "Choose the most suitable real sticker_id, then call send_sticker.",
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
    "send_sticker",
    "Send one sticker using a real sticker_id returned by search_stickers. Avoid repeating the same sticker unnecessarily.",
    {
      sticker_id: z.string(),
    },
    async ({ sticker_id }) => {
      const { data, error } = await supabase
        .from("sticker_catalog")
        .select("id, public_url, semantic_intent, ocr_text")
        .eq("id", sticker_id)
        .eq("assistant_enabled", true)
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
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
    mcp: "/mcp",
  });
});

app.post("/mcp", async (req, res) => {
  const server = makeServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`sticker-chatgpt-app listening on port ${PORT}`);
});
