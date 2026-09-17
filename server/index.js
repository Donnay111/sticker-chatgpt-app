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


// 你的实际目录现在是：
// data/web/sticker-card.html
const widgetPath = path.join(
  __dirname,
  "../data/web/sticker-card.html"
);


// ============================================================
// 读取资源
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
// 以后只要修改：
//
// sticker-card.html
// CSP
// widgetState
// 恢复逻辑
//
// 就把 v1 改为 v2 / v3 / v4。
//
// 这样可以降低客户端继续加载旧缓存的概率。
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
        "3.0.0"
    });


  // ==========================================================
  // MCP UI RESOURCE
  // ==========================================================
  //
  // sticker_pick 调用成功后，
  // 客户端根据 outputTemplate 找到这个 UI。
  //

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


            // ChatGPT MCP UI / Apps SDK HTML
            mimeType:
              "text/html+skybridge",


            text:
              widgetHtml,


            _meta: {

              // 给模型/客户端的 Widget 描述
              "openai/widgetDescription":
                "Displays one selected sticker image from the user's personal sticker library.",


              // 不需要额外边框
              "openai/widgetPrefersBorder":
                false,


              // ------------------------------------------------
              // CSP
              // ------------------------------------------------
              //
              // 图片全部来自：
              //
              // https://i.postimg.cc
              //
              // 以后新增其他图床，
              // 必须把新域名加到 resource_domains。
              //

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
  //
  // 这个工具就是最终展示工具。
  //
  // 它一次性返回：
  //
  // id
  // name
  // labels
  // imageUrl
  //
  // Widget 不再调第二个工具取图片。
  //

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


      // --------------------------------------------------------
      // 最关键：
      //
      // 把 sticker_pick 与 UI resource 绑定。
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // 最终结构化结果
      // --------------------------------------------------------

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

        // Widget 读取的主要数据
        structuredContent:
          result,


        // 不支持 UI 的 MCP 客户端仍可读
        content: [

          {

            type:
              "text",

            text:
              `Selected sticker: ${sticker.name}`
          }
        ],


        // 额外 metadata
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


// ============================================================
// MCP Streamable HTTP
// ============================================================

app.post(
  "/mcp",

  async (req, res) => {

    const server =
      createMcpServer();


    const transport =
      new StreamableHTTPServerTransport({

        // Stateless 模式
        sessionIdGenerator:
          undefined
      });


    // ----------------------------------------------------------
    // 请求结束时清理资源
    // ----------------------------------------------------------

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
// 非 POST 的 /mcp
// ============================================================
//
// 浏览器直接打开 /mcp 时给一个明确提示，
// 避免看到普通 404 以为服务坏了。
//

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
// 启动服务器
// ============================================================

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


    console.log(
      `Widget file: ${widgetPath}`
    );
  }
);
