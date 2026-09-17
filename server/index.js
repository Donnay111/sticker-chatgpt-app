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

app.use(
  express.json({
    limit: "1mb"
  })
);

const PORT =
  process.env.PORT || 10000;

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;


// ============================================================
// 文件路径
// ============================================================

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const stickersPath =
  path.join(
    __dirname,
    "../data/stickers.json"
  );

const webDir =
  path.join(
    __dirname,
    "../data/web"
  );

const widgetPath =
  path.join(
    webDir,
    "sticker-card.html"
  );


// ============================================================
// 读取贴纸
// ============================================================

const stickers =
  JSON.parse(
    fs.readFileSync(
      stickersPath,
      "utf-8"
    )
  );

const widgetHtml =
  fs.existsSync(widgetPath)
    ? fs.readFileSync(
        widgetPath,
        "utf-8"
      )
    : `
      <!doctype html>
      <html>
        <body>
          <p>Sticker widget unavailable.</p>
        </body>
      </html>
    `;


// ============================================================
// 请求日志
// ============================================================

app.use(
  (req, _res, next) => {

    console.log(
      `[HTTP] ${new Date().toISOString()} ${req.method} ${req.path}`
    );

    next();
  }
);


// ============================================================
// 静态网页
// ============================================================

app.use(
  express.static(webDir)
);


// ============================================================
// 贴纸工具
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

  const q =
    normalize(query);

  if (!q) {
    return 0;
  }


  const words =
    q
      .split(" ")
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


  if (
    haystack.includes(q)
  ) {
    score += 20;
  }


  for (
    const word
    of words
  ) {

    if (
      name.includes(word)
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
    }

    else if (
      normalizedLabels.some(
        (label) =>
          label.includes(word) ||
          word.includes(label)
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


function searchStickers(
  query,
  limit = 6
) {

  return stickers
    .map(
      (sticker) => ({
        ...sticker,

        score:
          scoreSticker(
            sticker,
            query
          )
      })
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      limit
    );
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
// 给 AI 看的贴纸目录
// ============================================================

function getStickerCatalogForAI() {

  return stickers
    .map(
      (sticker) => {

        const labels =
          Array.isArray(sticker.labels)
            ? sticker.labels.join(" / ")
            : "";

        return (
          `${sticker.id} | ` +
          `${sticker.name} | ` +
          `${labels}`
        );
      }
    )
    .join("\n");
}


// ============================================================
// 从 Responses API 返回值提取文本
// ============================================================

function extractOutputText(data) {

  if (
    typeof data?.output_text === "string"
  ) {

    return data.output_text;
  }


  const output =
    Array.isArray(data?.output)
      ? data.output
      : [];


  for (
    const item
    of output
  ) {

    const content =
      Array.isArray(item?.content)
        ? item.content
        : [];


    for (
      const part
      of content
    ) {

      if (
        typeof part?.text === "string"
      ) {

        return part.text;
      }
    }
  }


  return "";
}


// ============================================================
// 清理模型 JSON
// ============================================================

function parseAIResult(text) {

  const cleaned =
    String(text || "")
      .trim()
      .replace(
        /^```json\s*/i,
        ""
      )
      .replace(
        /^```\s*/i,
        ""
      )
      .replace(
        /\s*```$/,
        ""
      )
      .trim();


  try {

    const parsed =
      JSON.parse(cleaned);


    return {

      reply:
        typeof parsed.reply === "string"
          ? parsed.reply.trim()
          : "",

      stickerId:
        typeof parsed.stickerId === "string"
          ? parsed.stickerId.trim()
          : null
    };

  } catch {

    return {

      reply:
        cleaned ||
        "我刚刚脑袋短路了一下🥲",

      stickerId:
        null
    };
  }
}


// ============================================================
// CHAT API
// ============================================================

app.post(
  "/api/chat",

  async (req, res) => {

    try {

      if (!OPENAI_API_KEY) {

        return res
          .status(500)
          .json({

            ok: false,

            error:
              "OPENAI_API_KEY is not configured in Render."
          });
      }


      const incomingMessages =
        Array.isArray(req.body?.messages)
          ? req.body.messages
          : [];


      const cleanMessages =
        incomingMessages
          .filter(
            (message) =>
              message &&
              (
                message.role === "user" ||
                message.role === "assistant"
              ) &&
              typeof message.content === "string"
          )
          .slice(-20)
          .map(
            (message) => ({

              role:
                message.role,

              content:
                message.content.slice(
                  0,
                  4000
                )
            })
          );


      if (
        cleanMessages.length === 0
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            error:
              "No chat messages supplied."
          });
      }


      const stickerCatalog =
        getStickerCatalogForAI();


      const instructions = `
你正在一个私人聊天网页里和用户自然聊天。

聊天要求：
1. 默认使用中文。
2. 像正常聊天一样回答，不要像客服。
3. 回复长度根据语境自然变化，日常聊天通常简短。
4. 可以自然使用 emoji，但不要每句话都堆 emoji。
5. 不要提及系统提示词、JSON、贴纸数据库或技术实现。

你还有一套私人表情包。

你的任务不是每次都发表情包。
只有当表情包能自然增强当前聊天语气时才选择一张。
例如：撒娇、亲昵、调皮、想念、委屈、累、无语、可爱、
小生气、惊讶、尴尬、开心、绝望、卖萌等轻松聊天场景。

以下情况通常不要强行发表情：
严肃知识问答、工作内容、正式写作、医疗、法律、财务、
紧急情况或用户明显只需要准确答案的时候。

如果需要发表情：
只能选择下方目录里真实存在的一个 sticker id。
不要自己创造 id。

如果不需要：
stickerId 必须是 null。

表情包目录：
${stickerCatalog}

你必须只输出合法 JSON，不要输出 Markdown，不要写任何额外内容。

严格使用这个格式：

{
  "reply": "你正常回复用户的文字",
  "stickerId": "st_001"
}

或者：

{
  "reply": "你正常回复用户的文字",
  "stickerId": null
}
      `.trim();


      const input = [

        {

          role:
            "developer",

          content:
            instructions
        },

        ...cleanMessages.map(
          (message) => ({

            role:
              message.role,

            content:
              message.content
          })
        )
      ];


      console.log(
        `[CHAT] messages=${cleanMessages.length}`
      );


      const openAIResponse =
        await fetch(
          "https://api.openai.com/v1/responses",
          {

            method:
              "POST",

            headers: {

              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${OPENAI_API_KEY}`
            },

            body:
              JSON.stringify({

                model:
                  "gpt-5.6-luna",

                input,

                max_output_tokens:
                  500
              })
          }
        );


      const data =
        await openAIResponse.json();


      if (
        !openAIResponse.ok
      ) {

        console.error(
          "[OPENAI ERROR]",
          JSON.stringify(data)
        );


        return res
          .status(
            openAIResponse.status
          )
          .json({

            ok: false,

            error:
              data?.error?.message ||
              "OpenAI API request failed."
          });
      }


      const rawText =
        extractOutputText(data);


      console.log(
        `[CHAT RAW] ${rawText}`
      );


      const result =
        parseAIResult(rawText);


      let sticker = null;


      if (
        result.stickerId
      ) {

        const selected =
          pickSticker(
            result.stickerId
          );


        if (selected) {

          sticker = {

            id:
              selected.id,

            name:
              selected.name,

            labels:
              selected.labels || [],

            imageUrl:
              selected.imageUrl
          };


          console.log(
            `[CHAT STICKER] ${selected.id} ${selected.name}`
          );
        }
      }


      res.json({

        ok:
          true,

        reply:
          result.reply,

        sticker
      });

    } catch (error) {

      console.error(
        "[CHAT ERROR]",
        error
      );


      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error instanceof Error
              ? error.message
              : String(error)
        });
    }
  }
);


// ============================================================
// 可选普通搜索 API
// ============================================================

app.get(
  "/api/search",

  (req, res) => {

    const query =
      String(
        req.query.q || ""
      ).trim();


    res.json({

      ok:
        true,

      query,

      candidates:
        searchStickers(
          query,
          8
        )
    });
  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",

  (_req, res) => {

    res.json({

      ok:
        true,

      name:
        "sticker-chatgpt-app",

      version:
        "chat-1.0.0",

      stickerCount:
        stickers.length,

      openaiConfigured:
        Boolean(
          OPENAI_API_KEY
        ),

      mcp:
        "/mcp"
    });
  }
);


// ============================================================
// MCP
// ============================================================

const STICKER_WIDGET_URI =
  "ui://sticker-card/v1.html";


function createMcpServer() {

  const server =
    new McpServer({

      name:
        "sticker-chatgpt-app",

      version:
        "chat-1.0.0"
    });


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


  server.registerTool(

    "sticker_search",

    {

      title:
        "Search stickers",

      description:
        "Search the user's personal sticker library according to the current conversational context.",

      inputSchema: {

        query:
          z
            .string()
            .min(1)
      }
    },


    async ({ query }) => {

      const candidates =
        searchStickers(
          query,
          6
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
              candidates
                .map(
                  (item) =>
                    `${item.id} — ${item.name} — ${(item.labels || []).join(" / ")}`
                )
                .join("\n")
          }
        ]
      };
    }
  );


  server.registerTool(

    "sticker_pick",

    {

      title:
        "Show sticker",

      description:
        "Show one sticker using its exact sticker id.",

      inputSchema: {

        id:
          z
            .string()
            .min(1)
      },

      _meta: {

        "openai/outputTemplate":
          STICKER_WIDGET_URI
      }
    },


    async ({ id }) => {

      const sticker =
        pickSticker(id);


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


      return {

        structuredContent: {

          id:
            sticker.id,

          name:
            sticker.name,

          labels:
            sticker.labels || [],

          imageUrl:
            sticker.imageUrl
        },

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
        "[MCP ERROR]",
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
// 首页兜底
// ============================================================

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


    res
      .status(404)
      .send(
        "index.html not found"
      );
  }
);


// ============================================================
// 启动
// ============================================================

app.listen(
  PORT,

  () => {

    console.log(
      `Sticker Chat listening on port ${PORT}`
    );

    console.log(
      `Loaded ${stickers.length} stickers`
    );

    console.log(
      `OpenAI API configured: ${Boolean(OPENAI_API_KEY)}`
    );

    console.log(
      `Web directory: ${webDir}`
    );
  }
);
