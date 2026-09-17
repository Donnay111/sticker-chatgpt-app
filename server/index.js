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

const PORT = process.env.PORT || 10000;


// ============================================================
// 路径
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 35 张贴纸
const stickersPath = path.join(
  __dirname,
  "../data/stickers.json"
);

// 普通网页目录
const webDir = path.join(
  __dirname,
  "../data/web"
);

// MCP UI 卡片
const widgetPath = path.join(
  webDir,
  "sticker-card.html"
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

const widgetHtml = fs.existsSync(widgetPath)
  ? fs.readFileSync(
      widgetPath,
      "utf-8"
    )
  : `
    <!doctype html>
    <html>
      <body>
        <p>sticker-card.html not found</p>
      </body>
    </html>
  `;


// ============================================================
// 请求日志
// ============================================================

app.use((req, _res, next) => {
  console.log(
    `[HTTP] ${new Date().toISOString()} ${req.method} ${req.path}`
  );

  next();
});


// ============================================================
// 普通网页静态文件
// ============================================================
//
// data/web/index.html
// data/web/app.js
// data/web/style.css
//

app.use(
  express.static(webDir)
);


// ============================================================
// 工具函数
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


function scoreSticker(
  sticker,
  query
) {

  const q = normalize(query);

  if (!q) {
    return 0;
  }


  const words = q
    .split(" ")
    .map(
      (word) => word.trim()
    )
    .filter(Boolean);


  const name =
    normalize(
      sticker.name || ""
    );


  const labels =
    Array.isArray(sticker.labels)
      ? sticker.labels
      : [];


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


  // 整句命中
  if (
    haystack.includes(q)
  ) {
    score += 20;
  }


  // 分词匹配
  for (const word of words) {

    if (!word) {
      continue;
    }


    // 名称包含
    if (
      name.includes(word)
    ) {
      score += 8;
    }


    // 标签完全匹配
    if (
      normalizedLabels.some(
        (label) =>
          label === word
      )
    ) {
      score += 10;
    }

    // 标签部分匹配
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


function searchStickers(
  query,
  limit = 8
) {

  const ranked =
    stickers
      .map(
        (sticker) => ({
          id:
            sticker.id,

          name:
            sticker.name,

          labels:
            sticker.labels || [],

          imageUrl:
            sticker.imageUrl,

          score:
            scoreSticker(
              sticker,
              query
            )
        })
      )
      .filter(
        (sticker) =>
          sticker.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(
        0,
        limit
      );


  // 完全搜不到时给前几张兜底，
  // 避免网页一片空白。
  if (
    ranked.length === 0
  ) {

    return stickers
      .slice(
        0,
        limit
      )
      .map(
        (sticker) => ({
          id:
            sticker.id,

          name:
            sticker.name,

          labels:
            sticker.labels || [],

          imageUrl:
            sticker.imageUrl,

          score:
            0
        })
      );
  }


  return ranked;
}


function pickSticker(id) {

  return (
    stickers.find(
      (sticker) =>
        sticker.id === id
    ) || null
  );
}


// ============================================================
// 普通网页 API：搜索
// ============================================================

app.get(
  "/api/search",

  (req, res) => {

    const query =
      String(
        req.query.q || ""
      ).trim();


    const candidates =
      searchStickers(
        query,
        8
      );


    res.json({
      ok: true,
      query,
      candidates
    });
  }
);


// ============================================================
// 普通网页 API：选择一张
// ============================================================

app.get(
  "/api/pick",

  (req, res) => {

    const id =
      String(
        req.query.id || ""
      ).trim();


    const sticker =
      pickSticker(id);


    if (!sticker) {

      return res
        .status(404)
        .json({
          ok: false,
          error:
            "Sticker not found"
        });
    }


    res.json({

      ok: true,

      sticker: {

        id:
          sticker.id,

        name:
          sticker.name,

        labels:
          sticker.labels || [],

        imageUrl:
          sticker.imageUrl
      }
    });
  }
);


// ============================================================
// 健康检查
// ============================================================

app.get(
  "/health",

  (_req, res) => {

    res.json({

      ok: true,

      name:
        "sticker-chatgpt-app",

      version:
        "web-mcp-1.0.0",

      stickerCount:
        stickers.length,

      mcp:
        "/mcp"
    });
  }
);


// ============================================================
// MCP UI 配置
// ============================================================

const STICKER_WIDGET_URI =
  "ui://sticker-card/v1.html";


// ============================================================
// 创建 MCP Server
// ============================================================

function createMcpServer() {

  const server =
    new McpServer({

      name:
        "sticker-chatgpt-app",

      version:
        "web-mcp-1.0.0"
    });


  // ==========================================================
  // UI Resource
  // ==========================================================

  server.registerResource(

    "sticker-card",

    STICKER_WIDGET_URI,

    {},

    async () => ({

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
    })
  );


  // ==========================================================
  // MCP TOOL：sticker_search
  // ==========================================================

  server.registerTool(

    "sticker_search",

    {

      title:
        "Search stickers",

      description:
        "Search the user's personal sticker library according to the current conversation. " +

        "Use this proactively whenever a sticker would naturally fit casual emotional conversation. " +

        "The user does not need to explicitly ask for a sticker. " +

        "Suitable situations include affection, teasing, joking, cuteness, tiredness, helplessness, sadness, apology, embarrassment, excitement, surprise, playful reactions and light frustration. " +

        "Do not force stickers into serious, formal, sensitive or inappropriate situations. " +

        "After receiving candidates, choose the best match and call sticker_pick with the exact returned id.",

      inputSchema: {

        query:
          z
            .string()
            .min(1)
            .describe(
              "Concise semantic meaning of the desired sticker, for example: 疲惫 无力 摆烂; 撒娇 委屈; 调皮 俏皮; 想你 撒娇"
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


      const candidates =
        searchStickers(
          query,
          6
        );


      console.log(
        `[TOOL] sticker_search top=${candidates[0]?.id || "none"}`
      );


      return {

        structuredContent: {

          query,

          candidates:
            candidates.map(
              (item) => ({

                id:
                  item.id,

                name:
                  item.name,

                labels:
                  item.labels,

                score:
                  item.score
              })
            )
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
                "Choose the single best contextual match, then call sticker_pick using its exact id."
              ].join("\n")
          }
        ]
      };
    }
  );


  // ==========================================================
  // MCP TOOL：sticker_pick
  // ==========================================================

  server.registerTool(

    "sticker_pick",

    {

      title:
        "Show sticker",

      description:
        "Pick exactly one sticker using a real id returned by sticker_search. " +

        "This is the final display tool. " +

        "It returns id, name, labels and imageUrl in structuredContent. " +

        "Do not call another tool to retrieve the image after this.",

      inputSchema: {

        id:
          z
            .string()
            .min(1)
            .describe(
              "Exact sticker id returned by sticker_search"
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
        pickSticker(id);


      if (!sticker) {

        return {

          isError: true,

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
          sticker.labels || [],

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
// MCP 路由
// ============================================================

app.all(
  "/mcp",

  async (req, res) => {

    console.log(
      `[MCP] method=${req.body?.method || req.method}`
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

        } catch {}


        try {

          server.close();

        } catch {}
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
// 首页
// ============================================================
//
// express.static(webDir) 会自动返回：
//
// data/web/index.html
//
// 所以这里仅作为兜底。
//

app.get(
  "/",

  (_req, res) => {

    const indexPath =
      path.join(
        webDir,
        "index.html"
      );


    if (
      fs.existsSync(indexPath)
    ) {

      return res.sendFile(
        indexPath
      );
    }


    res.json({

      ok: true,

      name:
        "sticker-chatgpt-app",

      message:
        "index.html not found",

      stickerCount:
        stickers.length
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
      `sticker-chatgpt-app web+mcp listening on port ${PORT}`
    );


    console.log(
      `Loaded ${stickers.length} stickers`
    );


    console.log(
      `Web directory: ${webDir}`
    );


    console.log(
      `Widget URI: ${STICKER_WIDGET_URI}`
    );
  }
);
