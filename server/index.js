import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";


// ============================================================
// 基础配置
// ============================================================

const app = express();

app.use(express.json());


// ============================================================
// HTTP 请求日志
// ============================================================
//
// 以后任何客户端访问这个服务，Render Logs 都会出现：
//
// [HTTP] GET /
// [HTTP] POST /mcp
//
// 这样就能看出 ChatGPT 到底有没有真的连过来。
//

app.use((req, _res, next) => {
  console.log(
    `[HTTP] ${new Date().toISOString()} ${req.method} ${req.path}`
  );

  next();
});


const PORT = process.env.PORT || 3000;


// ============================================================
// 文件路径
// ============================================================

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);


// 35 张表情 JSON
const stickersPath = path.join(
  __dirname,
  "../data/stickers.json"
);


// 你现在真实目录：
// data/web/sticker-card.html
const widgetPath = path.join(
  __dirname,
  "../data/web/sticker-card.html"
);


// ============================================================
// 读取数据
// ============================================================

const stickers = JSON.parse(
  fs.readFileSync(
    stickersPath,
    "utf-8"
  )
);


const widgetHtml = fs.readFileSync(
  widgetPath,
  "utf-8"
);


// ============================================================
// Widget 版本
// ============================================================
//
// 以后只要你改：
//
// sticker-card.html
// CSP
// widgetState
// UI 恢复逻辑
//
// 就把 v1 改成 v2 / v3 / v4。
//

const STICKER_WIDGET_URI =
  "ui://sticker-card/v1.html";


// ============================================================
// 文本标准化
// ============================================================

function normalize(text = "") {

  return String(text)
    .toLowerCase()
    .replace(
      /[，。！？、,.!?;；:："'“”‘’（）()\[\]{}]/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// 表情匹配评分
// ============================================================

function scoreSticker(
  sticker,
  query
) {

  const normalizedQuery =
    normalize(query);


  const words =
    normalizedQuery
      .split(" ")
      .map(
        (word) => word.trim()
      )
      .filter(Boolean);


  const labels =
    Array.isArray(sticker.labels)
      ? sticker.labels
      : [];


  const normalizedName =
    normalize(
      sticker.name || ""
    );


  const normalizedLabels =
    labels.map(
      (label) =>
        normalize(label)
    );


  const haystack =
    normalize(
      [
        sticker.name || "",
        ...labels
      ].join(" ")
    );


  let score = 0;


  // ----------------------------------------------------------
  // 整句直接命中
  // ----------------------------------------------------------

  if (
    normalizedQuery &&
    haystack.includes(
      normalizedQuery
    )
  ) {

    score += 20;
  }


  // ----------------------------------------------------------
  // 分词匹配
  // ----------------------------------------------------------

  for (const word of words) {

    if (!word) {
      continue;
    }


    // 名称命中
    if (
      normalizedName.includes(
        word
      )
    ) {

      score += 8;
    }


    // 标签完全命中
    if (
      normalizedLabels.some(
        (label) =>
          label === word
      )
    ) {

      score += 10;
    }

    // 标签部分命中
    else if (
      normalizedLabels.some(
        (label) =>
          label.includes(word) ||
          word.includes(label)
      )
    ) {

      score += 6;
    }


    // 整体文本出现
    if (
      haystack.includes(word)
    ) {

      score += 3;
    }
  }


  return score;
}


// ============================================================
// 创建 MCP Server
// ============================================================

function createMcpServer() {

  const server =
    new McpServer({
      name:
        "sticker-chatgpt-app",

      version:
        "3.1.0"
    });


  // ==========================================================
  // MCP UI RESOURCE
  // ==========================================================

  server.registerResource(

    "sticker-card",

    STICKER_WIDGET_URI,

    {},

    async () => {

      return {

        contents: [

          {

            uri:
              STICKER_WIDGET_URI,


            mimeType:
              "text/html+skybridge",


            text:
              widgetHtml,


            _meta: {

              "openai/widgetDescription":
                "Displays one selected sticker image from the user's personal sticker library.",


              "openai/widgetPrefersBorder":
                false,


              "openai/widgetCSP": {

                connect_domains: [],

                resource_domains: [
                  "https://i.postimg.cc"
                ]
              }
            }
          }
        ]
      };
    }
  );


  // ==========================================================
  // TOOL 1：sticker_search
  // ==========================================================

  server.registerTool(

    "sticker_search",

    {

      title:
        "Search stickers",


      description:
        "Search the user's personal sticker library according to the current conversational context. " +

        "Use this tool proactively when a sticker would naturally improve a casual conversation. " +

        "The user does not need to explicitly ask for a sticker. " +

        "Good situations include affection, teasing, joking, cuteness, tiredness, helplessness, sadness, apology, embarrassment, excitement, surprise, playful reactions, light frustration, or other casual emotional reactions. " +

        "Do not force stickers into serious, formal, sensitive, medical, legal, financial, emergency, or otherwise inappropriate situations. " +

        "Search using a concise semantic description of the desired emotion or reaction. " +

        "After receiving candidates, choose the best contextual match and call sticker_pick using the exact returned sticker id.",


      inputSchema: {

        query:
          z
            .string()
            .min(1)
            .describe(
              "Concise semantic meaning of the desired sticker. Examples: 疲惫 无力 摆烂; 撒娇 委屈 求安慰; 调皮 俏皮; 想你 撒娇; 无语 无奈"
            )
      },


      _meta: {

        "openai/toolInvocation/invoking":
          "正在找合适的表情包…",

        "openai/toolInvocation/invoked":
          "找到合适的表情包啦"
      }
    },


    async ({ query }) => {

      console.log(
        `[TOOL] sticker_search query=${JSON.stringify(query)}`
      );


      const ranked =
        stickers
          .map(
            (sticker) => {

              return {

                ...sticker,

                score:
                  scoreSticker(
                    sticker,
                    query
                  )
              };
            }
          )
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(
            0,
            6
          );


      const candidates =
        ranked.map(
          (sticker) => {

            return {

              id:
                sticker.id,

              name:
                sticker.name,

              labels:
                sticker.labels,

              score:
                sticker.score
            };
          }
        );


      console.log(
        `[TOOL] sticker_search top=${candidates[0]?.id || "none"}`
      );


      return {

        structuredContent: {

          query,

          candidates
        },


        content: [

          {

            type:
              "text",


            text:
              [
                "Sticker candidates:",
                "",
                ...candidates.map(
                  (item) =>
                    `${item.id} — ${item.name} — ${(item.labels || []).join(" / ")}`
                ),
                "",
                "Choose the single best contextual match, then call sticker_pick with its exact id."
              ].join("\n")
          }
        ]
      };
    }
  );


  // ==========================================================
  // TOOL 2：sticker_pick
  // ==========================================================

  server.registerTool(

    "sticker_pick",

    {

      title:
        "Show sticker",


      description:
        "Pick exactly one sticker using a real id returned by sticker_search. " +

        "This is the final display tool. " +

        "It returns id, name, labels, and imageUrl in structuredContent. " +

        "The attached UI widget should display the image directly from imageUrl. " +

        "Do not call another tool to retrieve the image after sticker_pick.",


      inputSchema: {

        id:
          z
            .string()
            .min(1)
            .describe(
              "Exact sticker id returned by sticker_search, for example st_023"
            )
      },


      _meta: {

        "openai/outputTemplate":
          STICKER_WIDGET_URI,


        "openai/toolInvocation/invoking":
          "正在拿表情包…",


        "openai/toolInvocation/invoked":
          "表情包来啦"
      }
    },


    async ({ id }) => {

      console.log(
        `[TOOL] sticker_pick id=${id}`
      );


      const sticker =
        stickers.find(
          (item) =>
            item.id === id
        );


      if (!sticker) {

        console.log(
          `[TOOL] sticker_pick not_found=${id}`
        );


        return {

          isError:
            true,


          content: [

            {

              type:
                "text",

              text:
                `Sticker not found: ${id}`
            }
          ]
        };
      }


      const result = {

        id:
          sticker.id,

        name:
          sticker.name,

        labels:
          sticker.labels,

        imageUrl:
          sticker.imageUrl
      };


      console.log(
        `[TOOL] sticker_pick selected=${sticker.id} image=${sticker.imageUrl}`
      );


      return {

        structuredContent:
          result,


        content: [

          {

            type:
              "text",

            text:
              `Selected sticker: ${sticker.name}`
          }
        ],


        _meta: {

          stickerId:
            sticker.id,

          imageUrl:
            sticker.imageUrl
        }
      };
    }
  );


  return server;
}


// ============================================================
// 健康检查
// ============================================================

app.get(
  "/",

  (_req, res) => {

    res.json({

      ok:
        true,

      name:
        "sticker-chatgpt-app",

      version:
        "3.1.0",

      stickerCount:
        stickers.length,

      widget:
        STICKER_WIDGET_URI,

      mcp:
        "/mcp"
    });
  }
);


// ============================================================
// MCP Streamable HTTP
// ============================================================

app.post(
  "/mcp",

  async (req, res) => {

    const method =
      req.body?.method || "unknown";


    console.log(
      `[MCP] method=${method}`
    );


    const server =
      createMcpServer();


    const transport =
      new StreamableHTTPServerTransport({

        sessionIdGenerator:
          undefined
      });


    res.on(
      "close",

      () => {

        try {

          transport.close();

        } catch {
          // ignore
        }


        try {

          server.close();

        } catch {
          // ignore
        }
      }
    );


    try {

      await server.connect(
        transport
      );


      await transport.handleRequest(
        req,
        res,
        req.body
      );

    } catch (error) {

      console.error(
        "MCP error:",
        error
      );


      if (!res.headersSent) {

        res
          .status(500)
          .json({

            error:
              error instanceof Error
                ? error.message
                : String(error)
          });
      }
    }
  }
);


// ============================================================
// 浏览器直接访问 /mcp
// ============================================================

app.get(
  "/mcp",

  (_req, res) => {

    res
      .status(405)
      .json({

        ok:
          false,

        message:
          "MCP endpoint is running. Use POST with an MCP client."
      });
  }
);


// ============================================================
// 启动
// ============================================================

app.listen(
  PORT,

  () => {

    console.log(
      `sticker-chatgpt-app v3.1 listening on port ${PORT}`
    );


    console.log(
      `Loaded ${stickers.length} stickers`
    );


    console.log(
      `Widget URI: ${STICKER_WIDGET_URI}`
    );


    console.log(
      `Widget file: ${widgetPath}`
    );
  }
);
