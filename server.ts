import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

// Simple helper to parse M3U content server-side
function parseM3UContent(data: string) {
  const lines = data.split("\n");
  const parsed: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXTINF")) {
      let url = "";
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine && !nextLine.startsWith("#")) {
          url = nextLine;
          break;
        }
      }

      if (!url) continue;

      const nameParts = line.split(",");
      const name = nameParts[nameParts.length - 1].trim() || "Unknown Channel";

      let logo = "";
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      if (logoMatch) {
        logo = logoMatch[1].trim();
      }

      let categories = ["Other"];
      const groupMatch = line.match(/group-title="([^"]*)"/);
      if (groupMatch) {
         const splitCats = groupMatch[1]
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        if (splitCats.length > 0) {
          categories = splitCats;
        }
      }

      parsed.push({
        name,
        url,
        logo,
        categories,
      });
    }
  }
  return parsed;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: "20mb" }));

  // Database paths for persistent JSON storage on localhost
  const statsFilePath = path.join(process.cwd(), "stats-db.json");
  const channelsFilePath = path.join(process.cwd(), "channels-db.json");

  // Helper to read Stats DB
  function getStatsDb() {
    try {
      if (fs.existsSync(statsFilePath)) {
        const fileContent = fs.readFileSync(statsFilePath, "utf-8");
        return JSON.parse(fileContent);
      }
    } catch (e) {
      console.error("Error reading stats database:", e);
    }
    return {
      totalUniqueVisitors: 9850,
      visitorsList: [] as string[]
    };
  }

  // Helper to save Stats DB
  function saveStatsDb(data: any) {
    try {
      fs.writeFileSync(statsFilePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error("Error writing to stats database:", e);
    }
  }

  // Helper to read Channels DB
  function getChannelsDb() {
    try {
      if (fs.existsSync(channelsFilePath)) {
        const fileContent = fs.readFileSync(channelsFilePath, "utf-8");
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Error reading channels database:", e);
    }
    return [];
  }

  // Helper to save Channels DB
  function saveChannelsDb(data: any) {
    try {
      fs.writeFileSync(channelsFilePath, JSON.stringify(data, null, 2), "utf-8");
      
      // Update the original public/channels.m3u file accordingly
      try {
        const lines = ["#EXTM3U"];
        if (Array.isArray(data)) {
          for (const ch of data) {
            const logoAttr = ch.logo ? ` tvg-logo="${ch.logo}"` : '';
            const groupAttr = (Array.isArray(ch.categories) && ch.categories.length > 0) ? ` group-title="${ch.categories.join(",")}"` : ' group-title="Other"';
            lines.push(`#EXTINF:-1${logoAttr}${groupAttr},${ch.name}`);
            lines.push(ch.url);
          }
        }
        const content = lines.join("\n");
        const m3uPath = path.join(process.cwd(), "public", "channels.m3u");
        fs.writeFileSync(m3uPath, content, "utf-8");
      } catch (err) {
        console.error("Failed to sync changes to original channels.m3u:", err);
      }
    } catch (e) {
      console.error("Error writing to channels database:", e);
    }
  }

  // Initialize channels fallback on server start
  let defaultChannels = getChannelsDb();
  if (defaultChannels.length === 0) {
    const localM3uPath = path.join(process.cwd(), "public", "channels.m3u");
    if (fs.existsSync(localM3uPath)) {
      try {
        const m3uText = fs.readFileSync(localM3uPath, "utf-8");
        defaultChannels = parseM3UContent(m3uText);
        if (defaultChannels.length > 0) {
          saveChannelsDb(defaultChannels);
        }
      } catch (e) {
        console.error("Failed to parse public/channels.m3u on init:", e);
      }
    }
  }

  // Active user sessions (in-memory) to track real-time active devices
  const activeSessions: Record<string, { lastPing: number; channelUrl: string; isMobile: boolean }> = {};

  // Periodically clean up session connections that have stopped pinging
  setInterval(() => {
    const now = Date.now();
    for (const [visitorId, session] of Object.entries(activeSessions)) {
      if (now - session.lastPing > 25000) {
        delete activeSessions[visitorId];
      }
    }
  }, 5000);

  // POST endpoint to handle active viewer tracking ping
  app.post("/api/stats/ping", (req, res) => {
    const { visitorId, channelUrl, isMobile } = req.body;
    if (!visitorId) {
      return res.status(400).json({ error: "visitorId parameter is required" });
    }

    const now = Date.now();
    
    // Register or update current session status
    activeSessions[visitorId] = {
      lastPing: now,
      channelUrl: channelUrl || "",
      isMobile: !!isMobile
    };

    // Update persistent visitor count database
    const db = getStatsDb();
    if (!db.visitorsList) {
      db.visitorsList = [];
    }
    if (typeof db.totalUniqueVisitors !== "number") {
      db.totalUniqueVisitors = 9850;
    }

    if (!db.visitorsList.includes(visitorId)) {
      db.visitorsList.push(visitorId);
      db.totalUniqueVisitors += 1;
      saveStatsDb(db);
    }

    // Compute live device stats
    const sessionsList = Object.values(activeSessions);
    const liveCount = sessionsList.length;
    const mobileCount = sessionsList.filter(s => s.isMobile).length;

    // Viewers per channel breakdown
    const channelViewerMap: Record<string, number> = {};
    sessionsList.forEach(s => {
      if (s.channelUrl) {
        channelViewerMap[s.channelUrl] = (channelViewerMap[s.channelUrl] || 0) + 1;
      }
    });

    res.json({
      success: true,
      liveCount: Math.max(1, liveCount), // Always show at least 1 when active viewer opens
      totalCount: db.totalUniqueVisitors,
      mobileCount,
      channelViewers: channelViewerMap
    });
  });

  // GET endpoint to query current active stats
  app.get("/api/stats", (req, res) => {
    const db = getStatsDb();
    const sessionsList = Object.values(activeSessions);
    res.json({
      liveCount: Math.max(1, sessionsList.length),
      totalCount: db.totalUniqueVisitors,
      mobileCount: sessionsList.filter(s => s.isMobile).length
    });
  });

  const ADMIN_PASSWORD = "416737@";

  // Middleware to authenticate admin requests
  const verifyAdmin = (req: any, res: any, next: () => void) => {
    const authHeader = req.headers["x-admin-password"];
    if (authHeader !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized access: Invalid admin password" });
    }
    next();
  };

  // GET API to fetch list of custom channels
  app.get("/api/channels", (req, res) => {
    const list = getChannelsDb();
    res.json(list);
  });

  // POST API to add a new custom channel
  app.post("/api/channels", verifyAdmin, (req, res) => {
    const { name, url, logo, categories } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "Channel name and stream URL are required" });
    }

    const list = getChannelsDb();
    
    // Avoid double entries for same URL
    const existingIndex = list.findIndex((c: any) => c.url === url);
    const newChannel = {
      name,
      url,
      logo: logo || "",
      categories: Array.isArray(categories) && categories.length > 0 ? categories : ["Other"]
    };

    if (existingIndex !== -1) {
      list[existingIndex] = newChannel;
    } else {
      list.unshift(newChannel);
    }

    saveChannelsDb(list);
    res.json({ success: true, channel: newChannel, list });
  });

  // DELETE API to remove a channel
  app.post("/api/channels/delete", verifyAdmin, (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Channel URL is required to delete" });
    }

    let list = getChannelsDb();
    list = list.filter((c: any) => c.url !== url);
    saveChannelsDb(list);
    res.json({ success: true, list });
  });

  // DELETE Multiple APIs to remove many channels at once (Highly efficient)
  app.post("/api/channels/delete-multiple", verifyAdmin, (req, res) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "No channel URLs selected to delete" });
    }

    let list = getChannelsDb();
    const urlSet = new Set(urls);
    list = list.filter((c: any) => !urlSet.has(c.url));
    saveChannelsDb(list);
    res.json({ success: true, list });
  });

  // POST API to import an M3U playlist file content (e.g. from custom client uploads)
  app.post("/api/playlist/import", verifyAdmin, (req, res) => {
    const { m3uText, isReplace } = req.body;
    if (!m3uText) {
      return res.status(400).json({ error: "No M3U content received" });
    }

    try {
      const parsed = parseM3UContent(m3uText);
      if (parsed.length === 0) {
        return res.status(400).json({ error: "No active channels found in this M3U file format" });
      }

      let list = getChannelsDb();
      if (isReplace) {
        list = parsed;
      } else {
        // Merge without double adding URLs
        const existingUrls = new Set(list.map((c: any) => c.url));
        parsed.forEach(c => {
          if (!existingUrls.has(c.url)) {
            list.push(c);
          }
        });
      }

      saveChannelsDb(list);
      res.json({ success: true, count: parsed.length, total: list.length, list });
    } catch (e: any) {
      res.status(500).json({ error: "M3U Parsing failed: " + e.message });
    }
  });

  // Proxy Express route for local channels.m3u
  app.get("/channels.m3u", (req, res) => {
    const localFilePath = path.join(process.cwd(), "public", "channels.m3u");
    if (fs.existsSync(localFilePath)) {
      res.setHeader("Content-Type", "audio/mpegurl");
      res.sendFile(localFilePath);
    } else {
      res.status(404).send("M3U Playlist file not found");
    }
  });

  // Vite Integration for instant preview compilation & Node server routing
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Live TV Channel Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
