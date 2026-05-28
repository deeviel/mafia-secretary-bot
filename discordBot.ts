import { Client, GatewayIntentBits, VoiceChannel, ChannelType } from 'discord.js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
  entersState,
  StreamType
} from '@discordjs/voice';
import * as googleTTS from 'google-tts-api';
import { ScheduledEvent } from './src/hooks/useSchedule.js';
import ffmpeg from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

process.on('unhandledRejection', (reason, promise) => {
  debugLog(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

export function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(process.cwd(), 'discord-debug.log'), line);
  } catch (e) {}
  console.log(`[DISCORD-DEBUG] ${msg}`);
}

if (ffmpeg) {
  process.env.FFMPEG_PATH = ffmpeg;
  const ffmpegDir = path.dirname(ffmpeg);
  if (!process.env.PATH?.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}:${process.env.PATH}`;
  }
  debugLog(`FFMPEG configured successfully at: ${ffmpeg}`);
} else {
  debugLog("FFMPEG-STATIC was not found!");
}

let client: Client | null = null;
const globalVoicePlayer = createAudioPlayer();

globalVoicePlayer.on('error', error => {
  console.error('Audio Player Error:', error.message);
});

const lastSpokenValues = new Map<string, number>();

// Persistent Player registry
const guildPlayers = new Map<string, any>();

export function getOrCreateGuildPlayer(guildId: string, connection: any) {
  let player = guildPlayers.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    guildPlayers.set(guildId, player);
    
    player.on('error', (error: any) => {
      debugLog(`Persistent Player error on guild ${guildId}: ${error.message}`);
    });
  }
  connection.subscribe(player);
  return player;
}

const GODFATHER_CACHE_PATH = path.join(process.cwd(), 'godfather-theme-15s.mp3');

export async function ensureGodfatherThemeCached(): Promise<string> {
  if (fs.existsSync(GODFATHER_CACHE_PATH)) {
    const stats = fs.statSync(GODFATHER_CACHE_PATH);
    if (stats.size > 1000) {
      return GODFATHER_CACHE_PATH;
    }
  }

  debugLog(`Godfather theme not found at: ${GODFATHER_CACHE_PATH}`);
  throw new Error('Godfather theme 15s audio is missing from the directory.');
}

const cacheList = [
  { key: '10', text: '10' },
  { key: '9', text: '9' },
  { key: '8', text: '8' },
  { key: '7', text: '7' },
  { key: '6', text: '6' },
  { key: '5', text: '5' },
  { key: '4', text: '4' },
  { key: '3', text: '3' },
  { key: '2', text: '2' },
  { key: '1', text: '1' },
  { key: 'clear-comms', text: 'Clear comms and chat and get that win.' }
];

const cachedSpeechPaths = new Map<string, string>();

export async function preCacheSpeechSounds(): Promise<void> {
  debugLog("Pre-caching standard alert sounds...");
  for (const item of cacheList) {
    const targetPath = path.join(process.cwd(), `sound-cache-${item.key}.mp3`);
    cachedSpeechPaths.set(item.key, targetPath);
    
    if (fs.existsSync(targetPath)) {
      const stats = fs.statSync(targetPath);
      if (stats.size > 100) {
        continue;
      }
    }
    
    try {
      const url = getAudioUrl(item.text);
      const res = await fetch(url);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        fs.writeFileSync(targetPath, Buffer.from(arrayBuf));
        debugLog(`Pre-cached speech voice: "${item.text}" to ${targetPath}`);
      } else {
        debugLog(`Failed to pre-cache "${item.text}" with code ${res.status}`);
      }
    } catch (e: any) {
      debugLog(`Error pre-caching speech "${item.text}": ${e.message}`);
    }
  }

  try {
    await ensureGodfatherThemeCached();
  } catch (e: any) {
    debugLog(`Godfather caching warning: ${e.message}`);
  }
}

export async function playLocalFileInChannels(filePath: string, channelIds: string[]) {
  if (!client || !channelIds || channelIds.length === 0) {
    const fallbackId = process.env.DISCORD_VOICE_CHANNEL_ID;
    if (fallbackId) channelIds = [fallbackId];
    else return;
  }

  debugLog(`Requested local file playback: "${filePath}" into channels: ${channelIds.join(', ')}`);

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        continue;
      }

      let connection = getVoiceConnection(channel.guild.id);
      if (!connection || connection.joinConfig.channelId !== channel.id) {
        connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator as any,
        });
      }

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      } catch (err: any) {
        debugLog(`Voice Ready timeout for ${channel.name}: ${err.message}`);
        continue;
      }

      const player = getOrCreateGuildPlayer(channel.guild.id, connection);
      const resource = createAudioResource(filePath, {
        inputType: StreamType.Arbitrary
      });
      player.play(resource);
    } catch (error: any) {
      debugLog(`Failed during execution of playLocalFile in channel ${channelId}: ${error.message}`);
    }
  }
}

export function isDiscordConnected() {
  return !!(client && client.isReady());
}

export interface DiscordBotSettings {
  warnings: number[];
  voiceCountdown: boolean;
  timezone?: string;
  voiceLang?: string;
  voiceStartText?: string;
  warningAudioOffsetSec?: number;
  warningAudioFileName?: string;
}

export async function initDiscordBot(
  globalSchedule: { events: ScheduledEvent[] },
  globalSettings: DiscordBotSettings,
  token?: string
): Promise<void> {
  const currentToken = (token || process.env.DISCORD_TOKEN || '').trim();
  // Prevent login attempt with obvious invalid or placeholder tokens
  if (!currentToken || currentToken === 'undefined' || currentToken.length < 50 || currentToken.includes("INSERT_YOUR_DISCORD_BOT_TOKEN_HERE")) {
    throw new Error("Invalid token format.");
  }

  if (client) {
    client.destroy();
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ]
  });

  return new Promise((resolve, reject) => {
    client!.on('ready', () => {
      debugLog(`Discord bot logged in and READY as: ${client?.user?.tag}`);
      preCacheSpeechSounds().catch(err => {
        debugLog(`Pre-caching error (non-fatal): ${err.message}`);
      });
      startScheduleLoop(globalSchedule, globalSettings);

      // Register /ss global slash commands
      try {
        client?.application?.commands.create({
          name: 'ss',
          description: 'Speak a message aloud into your voice channel chat/channel',
          options: [
            {
              name: 'text',
              type: 3, // String type
              description: 'The text for Mafia Secretary to speak',
              required: true
            }
          ]
        }).then(() => {
          debugLog(`Successfully registered global slash command '/ss'`);
        }).catch(err => {
          debugLog(`Failed during global slash command '/ss' registration: ${err.message}`);
        });
      } catch (err: any) {
        debugLog(`Error queuing slash command register: ${err.message}`);
      }

      resolve();
    });

    client!.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName === 'ss') {
          const textToSpeak = interaction.options.getString('text');
          if (!textToSpeak) {
            await interaction.reply({ content: "Please supply the text to speak.", ephemeral: true });
            return;
          }
          const member = interaction.guild?.members.cache.get(interaction.user.id);
          const voiceChannel = member?.voice?.channel;
          if (voiceChannel) {
            await interaction.deferReply();
            await playAudioInVoiceChannels(textToSpeak, [voiceChannel.id], globalSettings.voiceLang || 'en');
            await interaction.editReply({ content: `🗣️ *Speaking:* "${textToSpeak}"` });
          } else {
            await interaction.reply({ content: `❌ You must join a voice channel for Mafia Secretary to speak.`, ephemeral: true });
          }
        }
      } catch (err: any) {
        debugLog(`Error processing slash interaction: ${err.message}`);
      }
    });

    client!.on('error', (err) => {
      debugLog(`Discord client error event: ${err.message}`);
    });

    client!.login(currentToken).catch(err => {
      debugLog(`Discord login command rejected: ${err.message}`);
      client?.destroy();
      client = null;
      reject(err);
    });
  });
}

// Ensure clean audio URL fetching via google-tts-api
function getAudioUrl(text: string) {
  return googleTTS.getAudioUrl(text, {
    lang: 'en',
    slow: false,
    host: 'https://translate.google.com',
  });
}

export function getAvailableVoiceChannels() {
  if (!client) return [];
  const channels: { id: string; name: string; guildName: string }[] = [];
  client.guilds.cache.forEach(guild => {
    guild.channels.cache.forEach(channel => {
      if (channel.type === ChannelType.GuildVoice) {
        channels.push({
          id: channel.id,
          name: channel.name,
          guildName: guild.name,
        });
      }
    });
  });
  return channels;
}

export async function testVoice(channelId: string, lang = 'en') {
  console.log(`Running test voice on channel ${channelId} with lang ${lang}`);
  await playAudioInVoiceChannels("This is a test message to verify the voice channel connection.", [channelId], lang);
}

export async function playAudioInVoiceChannels(text: string, channelIds: string[], lang = 'en') {
  if (!client || !channelIds || channelIds.length === 0) {
    // Fallback to process.env if none specified
    const fallbackId = process.env.DISCORD_VOICE_CHANNEL_ID;
    if (fallbackId) channelIds = [fallbackId];
    else return;
  }

  debugLog(`Requested TTS broadcast for text: "${text}" into channels: ${channelIds.join(', ')}`);

  let tempPath = '';
  try {
    const url = googleTTS.getAudioUrl(text, {
      lang: lang,
      slow: false,
      host: 'https://translate.google.com',
    });
    debugLog(`Generating Google TTS speech URL: ${url}`);
    
    // Fetch and download TTS file locally via Node's native fetch
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google TTS request failed with HTTP status ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    tempPath = path.join(process.cwd(), `tts-temp-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp3`);
    fs.writeFileSync(tempPath, buffer);
    debugLog(`Successfully downloaded TTS file. Size: ${buffer.byteLength} bytes. Saved to: ${tempPath}`);
  } catch (err: any) {
    debugLog(`CRITICAL - TTS Download failed: ${err.message}`);
    return;
  }

  // Define a cleanup function
  const cleanupTmpFile = (filePath: string) => {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        debugLog(`Cleaned up temporary TTS audio file: ${filePath}`);
      }
    } catch (e: any) {
      debugLog(`Error deleting file ${filePath}: ${e.message}`);
    }
  };

  const currentTempPath = tempPath;
  setTimeout(() => {
    cleanupTmpFile(currentTempPath);
  }, 25000);

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        debugLog(`Channel with ID ${channelId} is not a valid guild voice channel.`);
        continue;
      }

      debugLog(`Fetching voice connection for channel: ${channel.name} (guild: ${channel.guild.name})`);
      let connection = getVoiceConnection(channel.guild.id);
      
      if (!connection || connection.joinConfig.channelId !== channel.id) {
        debugLog(`No active voice connection or channel mismatch. Connecting now...`);
        connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator as any,
        });
      }

      try {
        debugLog(`Waiting for Voice Connection to become READY in ${channel.name}...`);
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
        debugLog(`Voice Connection is READY in ${channel.name}`);
      } catch (err: any) {
        debugLog(`TIMEOUT ERROR - Voice Connection failed to reach READY state in 15s for ${channel.name}: ${err.message}`);
        continue;
      }

      const player = getOrCreateGuildPlayer(channel.guild.id, connection);
      
      // Use Arbitrary StreamType to transcode the raw saved mp3 using ffmpeg
      debugLog(`Creating audio resource from local file: ${currentTempPath}`);
      const resource = createAudioResource(currentTempPath, {
        inputType: StreamType.Arbitrary
      });
      
      player.play(resource);
      debugLog(`Play triggered on persistent player in channel: ${channel.name}`);
    } catch (error: any) {
      debugLog(`Failed during execution of playAudio in channel ${channelId}: ${error.message}`);
    }
  }
}

function tzParts(timeZone: string, date: Date) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = parseInt(part.value, 10);
      }
    }
    return {
      year: map.year,
      month: map.month,
      day: map.day,
      hour: map.hour === 24 ? 0 : map.hour,
      minute: map.minute,
      second: map.second
    };
  } catch (e) {
    return null;
  }
}

function getTzOffsetMs(timeZone: string, date: Date = new Date()): number {
  try {
    const partsTz = tzParts(timeZone, date);
    const partsUtc = tzParts('UTC', date);
    if (!partsTz || !partsUtc) return 0;

    const d1 = Date.UTC(partsTz.year, partsTz.month - 1, partsTz.day, partsTz.hour, partsTz.minute, partsTz.second);
    const d2 = Date.UTC(partsUtc.year, partsUtc.month - 1, partsUtc.day, partsUtc.hour, partsUtc.minute, partsUtc.second);
    return d1 - d2;
  } catch (e) {
    return 0; // fallback to UTC
  }
}

export async function autoJoinScheduledChannels(
  globalSchedule: { events: ScheduledEvent[] },
  globalSettings?: { timezone?: string, voiceLang?: string }
) {
  if (!client || !client.isReady()) return;

  const tz = globalSettings?.timezone || 'UTC';
  const offsetMs = getTzOffsetMs(tz, new Date());
  const localNowDate = new Date(Date.now() + offsetMs);
  const today = localNowDate.getUTCDay(); // Get correct localized day of week
  const events = globalSchedule.events || [];

  // Filter events that are enabled and scheduled for today
  const todaysEvents = events.filter(e => 
    e.enabled && (!e.days || e.days.length === 0 || e.days.includes(today))
  );

  const voiceChannelIds = new Set<string>();
  todaysEvents.forEach(e => {
    if (e.channelIds && Array.isArray(e.channelIds)) {
      e.channelIds.forEach(id => {
        if (id) voiceChannelIds.add(id);
      });
    }
  });

  if (voiceChannelIds.size === 0) {
    return;
  }

  for (const channelId of voiceChannelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) continue;

      let connection = getVoiceConnection(channel.guild.id);
      if (!connection || connection.joinConfig.channelId !== channel.id) {
        console.log(`Auto-joining voice channel ${channel.name} since it has a scheduled event today.`);
        joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator as any,
        });
      }
    } catch (error) {
      console.error(`Error auto-joining channel ${channelId}:`, error);
    }
  }
}

let scheduleInterval: any;

// Evaluate events every second
function startScheduleLoop(
  globalSchedule: { events: ScheduledEvent[] },
  globalSettings: DiscordBotSettings
) {
  if (scheduleInterval) clearInterval(scheduleInterval);
  
  let lastAutoJoinTime = 0;
  const spokenMilestones = new Map<string, Set<string>>();

  scheduleInterval = setInterval(() => {
    const now = Date.now();
    const events = globalSchedule.events;
    const tz = globalSettings.timezone || 'UTC';
    const offsetMs = getTzOffsetMs(tz, new Date(now));
    const localNowDate = new Date(now + offsetMs);

    // Check and run auto-join every 10 seconds
    if (now - lastAutoJoinTime >= 10000) {
      lastAutoJoinTime = now;
      autoJoinScheduledChannels(globalSchedule, globalSettings).catch(err => {
        console.error("Auto-joining channel error:", err);
      });
    }

    let nextEvent: ScheduledEvent | null = null;
    let nextTime = Infinity;

    // Standard Next-event calculation logic using target timezone
    events.filter((e: ScheduledEvent) => e.enabled).forEach((e: ScheduledEvent) => {
       const [h, m] = e.time.split(':').map(Number);
       
       const year = localNowDate.getUTCFullYear();
       const month = localNowDate.getUTCMonth();
       const day = localNowDate.getUTCDate();
       
       const targetLocalTime = Date.UTC(year, month, day, h, m, 0, 0);
       let t = targetLocalTime - offsetMs;
       
       const currentDay = localNowDate.getUTCDay();
       if (!e.days || e.days.length === 0) {
         // Only roll over if the event has been missed by more than 1 minute
         if (t <= now - 60000) {
           t += 24 * 60 * 60 * 1000;
         }
       } else {
           if (e.days.includes(currentDay) && t > now - 60000) {
               // valid for today
           } else {
               let daysToAdd = 1;
               while (daysToAdd <= 7) {
                   const nextDay = (currentDay + daysToAdd) % 7;
                   if (e.days.includes(nextDay)) {
                       t += daysToAdd * 24 * 60 * 60 * 1000;
                       break;
                   }
                   daysToAdd++;
               }
           }
       }
       
       if (t < nextTime) {
         nextTime = t;
         nextEvent = e;
       }
    });

    if (!nextEvent) return;

    const msLeft = nextTime - now;
    const secsLeft = Math.round(msLeft / 1000);
    const minsLeft = Math.ceil(msLeft / 60000);

    const eventId = nextEvent.id;
    const occurrenceId = `${eventId}_${nextTime}`;
    const targetChannels = nextEvent.channelIds || [];

    if (!spokenMilestones.has(occurrenceId)) {
      spokenMilestones.set(occurrenceId, new Set<string>());
      
      // Memory cleanup for older occurrences
      for (const [key] of spokenMilestones.entries()) {
        const keyEventId = key.split('_')[0];
        const keyTime = Number(key.split('_')[1]);
        if ((keyEventId === eventId && keyTime < nextTime) || (now - keyTime > 2 * 60 * 60 * 1000)) {
          spokenMilestones.delete(key);
        }
      }
    }
    const milestones = spokenMilestones.get(occurrenceId)!;

    // Trigger warnings
    globalSettings.warnings.forEach((warnMin) => {
      const milestoneKey = `warn-${warnMin}`;
      if (minsLeft === warnMin && !milestones.has(milestoneKey) && msLeft > 0) {
        milestones.add(milestoneKey);
        playAudioInVoiceChannels(`Reminder: ${nextEvent!.name} starts in ${warnMin} minute${warnMin > 1 ? 's' : ''}.`, targetChannels, globalSettings.voiceLang);
        debugLog(`Spoke warning milestone: ${milestoneKey} for ${nextEvent!.name}`);
      }
    });

    // Handle standard countdown checks (custom warning audio intro, countdown details, and clear comms message at T-0)
    if (globalSettings.voiceCountdown) {
      const warningOffset = typeof globalSettings.warningAudioOffsetSec === 'number' ? globalSettings.warningAudioOffsetSec : 30;
      if (secsLeft === warningOffset) {
        const milestoneKey = `warning-audio-${warningOffset}`;
        if (!milestones.has(milestoneKey)) {
          milestones.add(milestoneKey);
          const customFileName = globalSettings.warningAudioFileName || 'godfather-theme-15s.mp3';
          const customAudioPath = path.join(process.cwd(), customFileName);
          if (fs.existsSync(customAudioPath)) {
            playLocalFileInChannels(customAudioPath, targetChannels);
            debugLog(`Played custom audio "${customFileName}" milestone: ${milestoneKey} for ${nextEvent.name}`);
          } else {
            const fallbackPath = path.join(process.cwd(), 'godfather-theme-15s.mp3');
            if (fs.existsSync(fallbackPath)) {
              playLocalFileInChannels(fallbackPath, targetChannels);
              debugLog(`Played fallback godfather audio milestone: ${milestoneKey} for ${nextEvent.name}`);
            } else {
              debugLog(`No warning audio file found at ${customAudioPath} or ${fallbackPath}`);
            }
          }
        }
      } else if (secsLeft <= 10 && secsLeft >= 1) {
        const milestoneKey = `countdown-${secsLeft}`;
        if (!milestones.has(milestoneKey)) {
          milestones.add(milestoneKey);
          const cachedFile = cachedSpeechPaths.get(secsLeft.toString());
          if (cachedFile && fs.existsSync(cachedFile)) {
            playLocalFileInChannels(cachedFile, targetChannels);
          } else {
            playAudioInVoiceChannels(secsLeft.toString(), targetChannels, globalSettings.voiceLang);
          }
          debugLog(`Spoke countdown milestone: ${milestoneKey} for ${nextEvent.name}`);
        }
      } else if (secsLeft <= 0) {
        const milestoneKey = 'countdown-0';
        if (!milestones.has(milestoneKey)) {
          milestones.add(milestoneKey);
          
          const customStartText = globalSettings.voiceStartText || "Clear comms and chat and get that win.";
          const isDefaultText = customStartText.trim().toLowerCase().startsWith("clear comms and chat");
          const clearCommsFile = cachedSpeechPaths.get('clear-comms');
          
          if (isDefaultText && clearCommsFile && fs.existsSync(clearCommsFile)) {
            playLocalFileInChannels(clearCommsFile, targetChannels);
            setTimeout(() => {
              playAudioInVoiceChannels(`${nextEvent!.name} is starting now.`, targetChannels, globalSettings.voiceLang);
            }, 2600);
          } else {
            playAudioInVoiceChannels(`${customStartText} ${nextEvent.name} is starting now.`, targetChannels, globalSettings.voiceLang);
          }
          debugLog(`Spoke starting-now milestone: ${milestoneKey} for ${nextEvent.name}`);
        }
      }
    } else {
      if (secsLeft <= 0) {
        const milestoneKey = 'countdown-0';
        if (!milestones.has(milestoneKey)) {
          milestones.add(milestoneKey);
          playAudioInVoiceChannels(`${nextEvent.name} is starting now.`, targetChannels, globalSettings.voiceLang);
          debugLog(`Spoke starting-now milestone (no countdown): ${milestoneKey} for ${nextEvent.name}`);
        }
      }
    }
  }, 1000);
}
