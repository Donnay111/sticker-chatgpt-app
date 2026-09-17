import express from "express";

const app = express();
app.use(express.json());

const SUPABASE_MCP_URL =
  "https://svyuhtijqgzargzixhfs.supabase.co/functions/v1/sticker-mcp/mcp";

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "sticker-chatgpt-app",
  });
});

app.post("/mcp", async (req, res) => {
  try {
    const response = await fetch(SUPABASE_MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(req.body),
    });

    const contentType =
      response.headers.get("content-type") || "application/json";

    const body = await response.text();

    res.status(response.status);
    res.setHeader("content-type", contentType);
    res.send(body);
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`sticker-chatgpt-app listening on port ${port}`);
});
