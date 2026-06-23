import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

import { createServer as createViteServer } from "vite";
import { initDiscordBot, getAvailableVoiceChannels, isDiscordConnected } from "./discordBot.js";
import { ScheduledEvent } from "./src/hooks/useSchedule.js";

dotenv.config();

process.on('uncaughtException', (err: any) => {
  const errStr = err ? (err.message || String(err)) : '';
  if (errStr.includes('Cannot perform IP discovery') || errStr.includes('socket closed')) {
    console.log(`[Voice Connection Diagnostics] Handled anticipated Voice Connection uncaught exception cleanly (UDP IP discovery restricted inside Google Cloud Run/Sandbox environment).`);
    return;
  }
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason: any, promise) => {
  const reasonStr = reason ? (reason.message || String(reason)) : '';
  if (reasonStr.includes('Cannot perform IP discovery') || reasonStr.includes('socket closed')) {
    console.log(`[Voice Connection Diagnostics] Handled anticipated Voice Connection unhandled rejection cleanly (UDP IP discovery restricted inside Google Cloud Run/Sandbox environment).`);
    return;
  }
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Global in-memory schedule for simplicity across the Applet.
export const globalSchedule: { events: ScheduledEvent[] } = {
  events: [
    { id: '1', name: 'Morning Standup', time: '10:00', enabled: true },
    { id: '2', name: 'Lunch Break', time: '12:00', enabled: true },
    { id: '3', name: 'Focus Session End', time: '16:00', enabled: true },
  ]
};

export const globalSettings: any = {
  warnings: [30, 15, 5, 1], // Notification minutes
  voiceCountdown: true,      // 10s countdown
  timezone: "Asia/Manila",
  voiceLang: "en",
  voiceStartText: "Clear comms and chat and get that win.",
  warningAudioOffsetSec: 30,
  warningAudioFileName: "godfather-theme-15s.mp3",
  warningAudioVolume: 100
};

const PREFS_FILE = path.join(process.cwd(), '.discord-prefs.json');
try {
  if (fs.existsSync(PREFS_FILE)) {
    const prefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'));
    if (prefs.token) {
      process.env.DISCORD_TOKEN = prefs.token;
    }
    if (prefs.schedule) {
      globalSchedule.events = prefs.schedule;
    }
    if (prefs.settings) {
      Object.assign(globalSettings, prefs.settings);
    }
  }
} catch (e) {
  console.error("Failed to read prefs:", e);
}

function savePrefs() {
  try {
    const data = {
      token: process.env.DISCORD_TOKEN,
      schedule: globalSchedule.events,
      settings: globalSettings
    };
    fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to write prefs:", e);
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  
  app.use(express.json({ limit: '50mb' }));

  // Security Middleware removed as basic auth is handled by CloudPanel.

  // API to get events
  app.get("/api/schedule", (req, res) => {
    res.json(globalSchedule.events);
  });

  // API to update events
  app.post("/api/schedule", (req, res) => {
    const { events } = req.body;
    if (Array.isArray(events)) {
      globalSchedule.events = events;
      savePrefs();
    }
    res.json({ success: true, events: globalSchedule.events });
  });

  // API to get settings
  app.get("/api/settings", (req, res) => {
    res.json(globalSettings);
  });

  // API to update settings
  app.post("/api/settings", (req, res) => {
    if (req.body.warnings && Array.isArray(req.body.warnings)) {
      globalSettings.warnings = req.body.warnings;
    }
    if (typeof req.body.voiceCountdown === 'boolean') {
      globalSettings.voiceCountdown = req.body.voiceCountdown;
    }
    if (typeof req.body.voiceLang === 'string') {
      globalSettings.voiceLang = req.body.voiceLang;
    }
    if (typeof req.body.voiceStartText === 'string') {
      globalSettings.voiceStartText = req.body.voiceStartText;
    }
    if (typeof req.body.warningAudioOffsetSec === 'number') {
      globalSettings.warningAudioOffsetSec = req.body.warningAudioOffsetSec;
    }
    if (typeof req.body.warningAudioFileName === 'string') {
      globalSettings.warningAudioFileName = req.body.warningAudioFileName;
    }
    if (typeof req.body.warningAudioVolume === 'number') {
      globalSettings.warningAudioVolume = req.body.warningAudioVolume;
    }
    globalSettings.timezone = "Asia/Manila";
    savePrefs();
    res.json({ success: true, settings: globalSettings });
  });

  // API to list customized/uploaded warning audio files
  app.get("/api/audio-files", (req, res) => {
    try {
      const files = fs.readdirSync(process.cwd());
      const mp3Files = files.filter(f => f.endsWith('.mp3') && !f.startsWith('sound-cache-') && !f.startsWith('tts-temp-'));
      res.json({ files: mp3Files });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API to upload custom audio files
  app.post("/api/upload-audio", (req, res) => {
    const { name, data } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: "Missing name or data" });
    }
    
    // Prevent directory traversal or malicious filenames
    const cleanName = path.basename(name).replace(/[^a-zA-Z0-9.\-_]/g, "");
    if (!cleanName.endsWith('.mp3')) {
      return res.status(400).json({ error: "Only .mp3 files are allowed for security." });
    }
    
    try {
      // Decode base64
      const buffer = Buffer.from(data, 'base64');
      const targetPath = path.join(process.cwd(), cleanName);
      
      fs.writeFileSync(targetPath, buffer);
      console.log(`Successfully uploaded custom audio file: ${cleanName} (${buffer.byteLength} bytes)`);
      
      // Auto upgrade settings to use this uploaded file
      globalSettings.warningAudioFileName = cleanName;
      savePrefs();
      
      res.json({ success: true, fileName: cleanName, message: "Audio uploaded successfully!" });
    } catch (err: any) {
      console.error("Audio upload error:", err);
      res.status(500).json({ error: "Failed to save file: " + err.message });
    }
  });

  // API to get discord voice channels
  app.get("/api/discord/channels", (req, res) => {
    res.json(getAvailableVoiceChannels());
  });

  // API to query connection status
  app.get("/api/discord/status", (req, res) => {
    res.json({ connected: isDiscordConnected() });
  });

  // API to connect externally
  app.post("/api/discord/connect", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required" });
    
    try {
      await initDiscordBot(globalSchedule, globalSettings, token);
      
      process.env.DISCORD_TOKEN = token;
      savePrefs();

      res.json({ success: true, message: "Connected to Discord successfully!" });
    } catch (err: any) {
      res.status(400).json({ error: "Failed to connect: " + err.message });
    }
  });

  // API to disconnect and disengage of token conflict
  app.post("/api/discord/disconnect", async (req, res) => {
    try {
      const { stopDiscordBot } = await import("./discordBot.js");
      stopDiscordBot();
      process.env.DISCORD_TOKEN = "";
      savePrefs();
      res.json({ success: true, message: "Discord bot stopped successfully and session disengaged." });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to disengage bot: " + err.message });
    }
  });

  app.post("/api/discord/test", async (req, res) => {
    try {
      const { testVoice } = await import("./discordBot.js");
      const { channelId, lang } = req.body;
      if (!channelId) return res.status(400).json({ error: "Missing channelId" });
      
      await testVoice(channelId, lang || 'en');
      res.json({ success: true, message: "Test voice requested." });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  // Catch-all for API routes to prevent Vite SPA fallback from returning HTML
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "API endpoint not found: " + req.method + " " + req.url });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Initialize Discord Bot
  if (process.env.DISCORD_TOKEN) {
    try {
      initDiscordBot(globalSchedule, globalSettings);
      console.log("Discord bot initialized.");
    } catch (e) {
      console.error("Failed to initialize discord bot:", e);
    }
  } else {
    console.log("DISCORD_TOKEN environment variable is not set. Discord features are disabled.");
  }
}

startServer();
