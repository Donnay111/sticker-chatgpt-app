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

const stickersPath = path.join(
  __dirname,
  "../data/stickers.json"
);

const widgetPath = path.join(
  __dirname,
  "../data/web/sticker-card.html"
);
);

const stickers = JSON.parse(
  fs.readFileSync(stickersPath, "utf-8")
);

const widgetHtml = fs.readFileSync(
  widgetPath,
  "utf-8"
);

/*
 * UI 版本。
 *
 * 以后只要你修改 sticker-card.html、
 * CSP、widgetState 恢复逻辑等，
 * 就把 v1 改成 v2、v3……
 *
 * 这样可以避免 ChatGPT 继续读旧缓存。
 */
const STICKER_WIDGET_URI =
  "ui://sticker-card/v1.html";


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


function scoreSticker(sticker, query) {
  const q = normalize(query);

  const words = q
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);

  const labels =
    sticker.labels || [];

  const normalizedName =
    normalize(sticker.name);

  const normalizedLabels =
    labels.map((label) => normalize(label));

  const haystack = normalize(
    [
      sticker.name,
      ...labels,
    ].join(" ")
  );

  let score = 0;


  /*
   * 整句直接命中
   */
  if (
    q &&
    haystack.includes(q)
  ) {
    score += 20;
  }


  /*
   * 单词匹配
   */
  for (const word of words) {

    if (
      normalizedName.includes(word)
    ) {
      score += 8;
    }

    if (
      normalizedLabels.some(
        (label) =>
          label === word
      )
    ) {
      score += 10;
    } else if (
      normalizedLabels.some(
        (label) =>
          label.includes(word)
      )
    ) {
      score += 6;
    }

    if (
      haystack.includes(word)
    ) {
      score += 3;
    }
  }


  return score;
}


function createMcpServer() {

  const server = new McpServer({
    name: "sticker-chatgpt-app",
    version: "3.0.0",
  });


  /*
   * =========================================================
   * MCP UI RESOURCE
   * =========================================================
   *
   * ChatGPT 在 sticker_pick 后会通过这个 URI 找到卡片。
   */

  server.registerResource(
    "sticker-card",
    STICKER_WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: STICKER_WIDGET_URI,

          /*
           * Apps SDK / MCP UI 使用的 HTML MIME type
           */
          mimeType:
            "text/html+skybridge",

          text: widgetHtml,

          _meta: {

            /*
             * 给模型的 UI 简短说明。
             */
            "openai/widgetDescription":
              "Displays the selected sticker image and its name.",


            /*
             * 表情卡不需要外边框。
             */
            "openai/widgetPrefersBorder":
              false,


            /*
             * CSP
             *
             * 图片直接从 Postimages CDN 加载。
             *
             * 以后如果换图床，
             * 新域名必须加入 resource_domains。
             */
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


  /*
   * =========================================================
   * TOOL 1 — sticker_search
   * =========================================================
   */

  server.registerTool(
    "sticker_search",

    {
      title:
        "Search stickers",

      description:
        "Search the user's personal sticker library according to the current conversation. " +

        "Use this tool proactively whenever a sticker would naturally fit the conversation; " +
        "the user does NOT need to explicitly ask for a sticker. " +

        "Suitable situations include affection, teasing, joking, cuteness, tiredness, helplessness, " +
        "apology, embarrassment, sadness, excitement, surprise, playful reactions and casual emotional conversation. " +

        "Do not force stickers into serious, formal, sensitive or inappropriate situations. " +

        "Describe the intended emotion or conversational meaning in the query. " +

        "After receiving candidates, choose the most contextually appropriate real sticker id and call sticker_pick.",

      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "A concise semantic description of the desired sticker. Example: 疲惫 无力 摆烂, 撒娇 委屈 求安慰, 调皮 俏皮, 想你 撒娇"
          )
      },

      _meta: {

        "openai/toolInvocation/invoking":
          "正在找合适的表情包…",

        "openai/toolInvocation/invoked":
          "找到几个合适的表情包"
      }
    },

    async ({ query }) => {

      const ranked = stickers
        .map((sticker) => ({
          ...sticker,
          score: scoreSticker(
            sticker,
            query
          )
        }))

        /*
         * 零分的也保留少量，
         * 避免搜索结果完全为空。
         */
        .sort(
          (a, b) =>
            b.score - a.score
        )

        .slice(0, 6);


      const candidates =
        ranked.map((sticker) => ({
          id: sticker.id,
          name: sticker.name,
          labels: sticker.labels,
          score: sticker.score
        }));


      return {

        structuredContent: {
          query,
          candidates
        },

        content: [
          {
            type: "text",

            text:
              "Sticker candidates:\n" +
              candidates
                .map(
                  (item) =>
                    `${item.id} — ${item.name} — ${item.labels.join(
                      " / "
                    )}`
                )
                .join("\n") +
              "\n\nChoose the best contextual match and call sticker_pick with its exact id."
          }
        ]
      };
    }
  );


  /*
   * =========================================================
   * TOOL 2 — sticker_pick
   * =========================================================
   *
   * 这个工具一次性返回最终图片地址。
   *
   * UI 不需要再调第二个工具。
   */

  server.registerTool(
    "sticker_pick",

    {
      title:
        "Show sticker",

      description:
        "Pick exactly one sticker using a real id returned by sticker_search. " +

        "This is the final display tool. " +

        "It returns id, name, labels and imageUrl in structuredContent, " +
        "and renders the sticker using the attached MCP UI card. " +

        "Do not call another tool to fetch the image after this.",

      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Exact sticker id returned by sticker_search, for example st_023"
          )
      },

      /*
       * 最关键的一行：
       *
       * 告诉 ChatGPT：
       * sticker_pick 的结果使用哪个 UI resource。
       */
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

      const sticker =
        stickers.find(
          (item) =>
            item.id === id
        );


      if (!sticker) {

        return {

          isError: true,

          content: [
            {
              type: "text",
              text:
                `Sticker not found: ${id}`
            }
          ]
        };
      }


      /*
       * UI 只需要这四项。
       *
       * imageUrl 已经是最终公网直链。
       */
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


      return {

        /*
         * Widget 主要读取这里。
         */
        structuredContent:
          result,


        /*
         * 同时保留一份简短文字输出，
         * 方便不支持 UI 的 MCP 客户端。
         */
        content: [
          {
            type: "text",

            text:
              `Selected sticker: ${sticker.name}`
          }
        ],


        /*
         * 工具结果自己的 metadata。
         */
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


/*
 * =========================================================
 * HEALTH CHECK
 * =========================================================
 */

app.get(
  "/",

  (_req, res) => {

    res.json({

      ok: true,

      name:
        "sticker-chatgpt-app",

      version:
        "3.0.0",

      stickerCount:
        stickers.length,

      widget:
        STICKER_WIDGET_URI,

      mcp:
        "/mcp"
    });
  }
);


/*
 * =========================================================
 * MCP STREAMABLE HTTP
 * =========================================================
 */

app.post(
  "/mcp",

  async (req, res) => {

    const server =
      createMcpServer();


    const transport =
      new StreamableHTTPServerTransport({

        /*
         * Stateless 模式。
         *
         * 对这个简单表情项目足够。
         */
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


/*
 * =========================================================
 * START SERVER
 * =========================================================
 */

app.listen(
  PORT,

  () => {

    console.log(
      `sticker-chatgpt-app v3 listening on port ${PORT}`
    );

    console.log(
      `Loaded ${stickers.length} stickers`
    );

    console.log(
      `Widget URI: ${STICKER_WIDGET_URI}`
    );
  }
);
