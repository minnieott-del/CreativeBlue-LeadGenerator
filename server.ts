import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import {
  handleSenderProfile,
  handleSeriesALeads,
  handleGenerateEmail,
  handleStreamingText,
  setupLiveApiWebSocket,
} from "./server/gemini.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json({ limit: "10mb" }));

// Health Check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Gemini Server-Side API Routes
app.post("/api/gemini/profile", handleSenderProfile);
app.post("/api/gemini/leads", handleSeriesALeads);
app.post("/api/gemini/email", handleGenerateEmail);
app.post("/api/gemini/stream", handleStreamingText);

// Setup Live API WebSocket on /api/gemini/live
const wss = new WebSocketServer({ noServer: true });
setupLiveApiWebSocket(wss);

server.on("upgrade", (request, socket, head) => {
  try {
    const { pathname } = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
    if (pathname === "/api/gemini/live" || pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  } catch (err) {
    console.error("Upgrade error:", err);
    socket.destroy();
  }
});

// Dev environment uses Vite middleware; production serves built static assets
const isProduction = process.env.NODE_ENV === "production";

if (!isProduction) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: false,
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, "dist")));
  app.use((_req, res) => {
    res.sendFile(path.resolve(__dirname, "dist", "index.html"));
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT} (mode: ${isProduction ? "production" : "development"})`);
});
