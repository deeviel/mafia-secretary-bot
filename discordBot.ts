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
import dns from 'dns';
import { Readable } from 'stream';

if (dns && typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

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
const activeGuildIds = new Set<string>();

async function resolveMentions(text: string, guild: any): Promise<string> {
  if (!text) return text;
  let resolved = text;

  // Resolve user mentions: <@123456789> or <@!123456789>
  const userRegex = /<@!?(\d+)>/g;
  const userMatches = [...resolved.matchAll(userRegex)];
  for (const match of userMatches) {
    const fullMatch = match[0];
    const userId = match[1];
    let name = "someone";
    if (guild) {
      try {
        let member = guild.members.cache.get(userId);
        if (!member) {
          member = await guild.members.fetch(userId).catch(() => null);
        }
        if (member) {
          name = member.displayName || member.user.username;
        }
      } catch (e) {}
    }
    if (name === "someone") {
      try {
        let user = client?.users.cache.get(userId);
        if (!user) {
          user = await client?.users.fetch(userId).catch(() => null);
        }
        if (user) {
          name = user.displayName || user.username;
        }
      } catch (e) {}
    }
    resolved = resolved.replace(fullMatch, name);
  }

  // Resolve role mentions: <@&123456789>
  const roleRegex = /<@&(\d+)>/g;
  const roleMatches = [...resolved.matchAll(roleRegex)];
  for (const match of roleMatches) {
    const fullMatch = match[0];
    const roleId = match[1];
    let name = "a role";
    if (guild) {
      try {
        let role = guild.roles.cache.get(roleId);
        if (!role) {
          role = await guild.roles.fetch(roleId).catch(() => null);
        }
        if (role) {
          name = role.name;
        }
      } catch (e) {}
    }
    resolved = resolved.replace(fullMatch, name);
  }

  // Resolve channel mentions: <#123456789>
  const channelRegex = /<#(\d+)>/g;
  const channelMatches = [...resolved.matchAll(channelRegex)];
  for (const match of channelMatches) {
    const fullMatch = match[0];
    const channelId = match[1];
    let name = "a channel";
    if (guild) {
      try {
        let channel = guild.channels.cache.get(channelId);
        if (!channel) {
          channel = await guild.channels.fetch(channelId).catch(() => null);
        }
        if (channel) {
          name = channel.name;
        }
      } catch (e) {}
    }
    if (name === "a channel") {
      try {
        const globalChannel = client?.channels.cache.get(channelId) || await client?.channels.fetch(channelId).catch(() => null);
        if (globalChannel && 'name' in globalChannel) {
          name = (globalChannel as any).name;
        }
      } catch (e) {}
    }
    resolved = resolved.replace(fullMatch, name);
  }

  return resolved;
}

export function getOrCreateVoiceConnection(channel: any): any {
  const guildId = channel.guild.id;
  activeGuildIds.add(guildId);
  let connection = getVoiceConnection(guildId);
  
  // If there's an existing voice connection but it's in a broken state, destroy it first so we can rebuild cleanly
  if (connection) {
    const status = connection.state.status;
    if (status === VoiceConnectionStatus.Disconnected || status === VoiceConnectionStatus.Destroyed) {
      debugLog(`Existing connection in guild ${guildId} is ${status}. Destroying to reconnect cleanly.`);
      try {
        connection.destroy();
      } catch (e) {}
      connection = null;
    } else if (connection.joinConfig.channelId !== channel.id) {
      debugLog(`Channel mismatch for guild ${guildId} (expected "${channel.name}" but connected to channel ID ${connection.joinConfig.channelId}). Destroying and switching.`);
      try {
        connection.destroy();
      } catch (e) {}
      connection = null;
    }
  }

  if (!connection) {
    debugLog(`Connecting to voice channel: "${channel.name}" in guild "${channel.guild.name}"...`);
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator as any,
      selfDeaf: true,
      selfMute: false,
    });
  }

  return connection;
}

export async function ensureVoiceConnectionReady(connection: any, channel: any): Promise<boolean> {
  const guildId = channel.guild.id;

  // If already ready, return instantly
  if (connection.state.status === VoiceConnectionStatus.Ready) {
    return true;
  }

  // Hook listeners for robust reconnection state changes
  if (!connection._hasListeners) {
    connection._hasListeners = true;
    connection.on('stateChange', (oldState: any, newState: any) => {
      debugLog(`[Voice Connection State Change] Guild ${guildId}: ${oldState.status} -> ${newState.status}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // If disconnected, try to wait for automatic reconnection signalling/connecting
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 4000),
          entersState(connection, VoiceConnectionStatus.Connecting, 4000),
        ]);
      } catch (error) {
        debugLog(`[Voice Connection] Real disconnection detected for guild ${guildId}. Attempting automatic reconnection...`);
        try {
          connection.reconnect();
        } catch (e: any) {
          debugLog(`[Voice Connection] Reconnect attempt failed: ${e.message}`);
        }
      }
    });
  }

  try {
    debugLog(`Waiting for Voice Connection to become READY in channel "${channel.name}"...`);
    // Standard 10s wait for GCP Cloud Run / Sandbox networks
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);
    debugLog(`Voice Connection is now READY in channel "${channel.name}"`);
    return true;
  } catch (err: any) {
    debugLog(`[Voice Connection Stalled] Connection failed to reach READY status. Current state: "${connection.state.status}". Error: ${err.message}`);
    debugLog(`[Diagnosis] A voice connection stuck in "signalling" state typically indicates:`);
    debugLog(`  * Option A: Dynamic outward UDP egress/sockets are sandboxed or restricted in this container. This is expected in the Google AI Studio Sandbox/Cloud Run environment, but will work seamlessly on your dedicated CloudPanel VPS deployment where dynamic UDP routing is fully enabled.`);
    debugLog(`  * Option B: Bot Token conflict. If your production bot at https://secretary.mafia.anvorte.com/ is simultaneously running with this exact token, Discord kills the voice session state for one client. You can use the "Disconnect Bot" button on the UI dashboard to turn off the bot here!`);
    
    // --- Self-Healing Retry ---
    // Re-creating the connection forces a brand-new UDP socket binding which handles strict NATs / frozen routes
    debugLog(`[Self-Healing] Re-creating a brand-new connection for channel "${channel.name}" to force fresh socket routing...`);
    try {
      connection.destroy();
    } catch (e) {}

    const newConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator as any,
      selfDeaf: true,
      selfMute: false,
    });

    newConnection.on('stateChange', (oldState: any, newState: any) => {
      debugLog(`[Voice Connection Retry State Change] Guild ${guildId}: ${oldState.status} -> ${newState.status}`);
    });

    try {
      await entersState(newConnection, VoiceConnectionStatus.Ready, 10000);
      debugLog(`[Self-Healing SUCCESS] Retried connection succeeded! Voice is now READY.`);
      // Update persistent player registry with the new connection if necessary
      getOrCreateGuildPlayer(guildId, newConnection);
      return true;
    } catch (retryErr: any) {
      debugLog(`[Self-Healing FAILURE] Ready state retry also timed out for channel "${channel.name}": ${retryErr.message}`);
      try {
        newConnection.destroy();
      } catch (e) {}
      return false;
    }
  }
}

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

      const connection = getOrCreateVoiceConnection(channel);
      const isReady = await ensureVoiceConnectionReady(connection, channel);
      if (!isReady) {
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

  const tryLoginWithIntents = (intentsList: any[]): Promise<void> => {
    return new Promise((resolve, reject) => {
      client = new Client({
        intents: intentsList
      });

      client.on('ready', () => {
        debugLog(`Discord bot logged in and READY as: ${client?.user?.tag}`);
        preCacheSpeechSounds().catch(err => {
          debugLog(`Pre-caching error (non-fatal): ${err.message}`);
        });
        startScheduleLoop(globalSchedule, globalSettings);

        // Register /ss global slash commands and clear redundant guild commands to prevent duplicates
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

          // Clear guild-level /ss commands so they don't double-up with the global command
          client?.guilds.cache.forEach(guild => {
            guild.commands.set([]).then(() => {
              debugLog(`Cleared custom guild-level slash commands for: "${guild.name}" to prevent duplication.`);
            }).catch(err => {
              debugLog(`Guild-level command resetting bypassed or failed for "${guild.name}": ${err.message}`);
            });
          });

        } catch (err: any) {
          debugLog(`Error cleaning up & registering slash commands: ${err.message}`);
        }

        resolve();
      });

      client.on('interactionCreate', async (interaction) => {
        try {
          if (!interaction.isChatInputCommand()) return;
          if (interaction.commandName === 'ss') {
            // SECURE IMMEDIATE DEFERRAL to completely prevent 3-second Discord expiration ("Unknown interaction")
            await interaction.deferReply().catch(err => {
              debugLog(`Immediate deferReply failed: ${err.message}`);
            });

            const textToSpeak = interaction.options.getString('text');
            if (!textToSpeak) {
              await interaction.editReply({ content: "❌ Please supply the text to speak." }).catch(() => {});
              return;
            }

            const member = interaction.guild?.members.cache.get(interaction.user.id);
            const voiceChannel = member?.voice?.channel;
            if (voiceChannel) {
              try {
                debugLog(`Interactions command (/ss) triggered by ${interaction.user.tag} for: "${textToSpeak}"`);
                const cleanSpeech = await resolveMentions(textToSpeak, interaction.guild);
                await playAudioInVoiceChannels(cleanSpeech, [voiceChannel.id], globalSettings.voiceLang || 'en');
                await interaction.editReply({ content: `🗣️ *Speaking:* "${textToSpeak}"` }).catch(() => {});
              } catch (playErr: any) {
                debugLog(`Failed to speak via interactions: ${playErr.message}`);
                await interaction.editReply({ content: `❌ Stalled voice stream: ${playErr.message}` }).catch(() => {});
              }
            } else {
              await interaction.editReply({ content: `❌ You must join a voice channel for Mafia Secretary to speak.` }).catch(() => {});
            }
          }
        } catch (err: any) {
          debugLog(`Error processing slash interaction: ${err.message}`);
        }
      });

      // Only mount the messageCreate handler if we have the messages permission
      if (intentsList.includes(GatewayIntentBits.GuildMessages)) {
        client.on('messageCreate', async (message) => {
          try {
            if (!message.guild || message.author.bot) return;

            const content = message.content.trim();
            let textToSpeak = '';
            
            // Match clean /ss as a fast alternate, !ss, .ss, or ss prefix-less commands
            const lower = content.toLowerCase();
            if (lower.startsWith('ss ')) {
              textToSpeak = content.substring(3).trim();
            } else if (lower.startsWith('!ss ')) {
              textToSpeak = content.substring(4).trim();
            } else if (lower.startsWith('.ss ')) {
              textToSpeak = content.substring(4).trim();
            } else if (lower.startsWith('/ss ')) {
              textToSpeak = content.substring(4).trim();
            }

            if (!textToSpeak) return;

            // Get guild member
            const member = message.guild.members.cache.get(message.author.id) || await message.guild.members.fetch(message.author.id).catch(() => null);
            const voiceChannel = member?.voice?.channel;
            if (voiceChannel) {
              const chName = 'name' in message.channel ? (message.channel as any).name : 'unknown-channel';
              debugLog(`Plain-text text transmission triggered by ${message.author.tag} in channel ${chName}: "${textToSpeak}"`);
              
              // Instantly react to the Discord message for beautiful, fast non-blocking feedback!
              message.react('🗣️').catch(() => {});
              
              const cleanSpeech = await resolveMentions(textToSpeak, message.guild);
              await playAudioInVoiceChannels(cleanSpeech, [voiceChannel.id], globalSettings.voiceLang || 'en');
            } else {
              message.react('❌').catch(() => {});
            }
          } catch (err: any) {
            debugLog(`Error processing text message listener: ${err.message}`);
          }
        });
      }

      client.on('error', (err) => {
        debugLog(`Discord client error event: ${err.message}`);
      });

      client.login(currentToken).catch(err => {
        reject(err);
      });
    });
  };

  try {
    debugLog("Attempting connection with direct text-reading intent (Privileged MessageContent)");
    await tryLoginWithIntents([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]);
  } catch (err: any) {
    const errMsg = (err.message || '').toLowerCase();
    if (errMsg.includes('disallowed') || errMsg.includes('privileged') || err.code === 'DisallowedIntents') {
      debugLog("⚠️ NOTICE: The bot prompt listener is currently using a graceful fallback state!");
      debugLog("⚠️ Problem detected: 'Message Content Intent' is not enabled in your Discord Developer Bot Portal.");
      debugLog("⚠️ Outcome: Regular chat message triggers (like typing 'ss hello' or '!ss hello') are bypassed. Slash command '/ss hello' remains fully functional.");
      debugLog("⚠️ To fix: Go to https://discord.com/developers/applications, select your bot, click the 'Bot' tab, scroll down to 'Privileged Gateway Intents', turn on 'Message Content Intent', and click 'Save Changes'.");
      debugLog("🔄 Booting bot on fallback intents mode right now...");
      
      if (client) {
        try { client.destroy(); } catch (e) {}
      }

      await tryLoginWithIntents([
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
      ]);
    } else {
      if (client) {
        try { client.destroy(); } catch (e) {}
      }
      client = null;
      throw err;
    }
  }
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

function isTaglishOrTagalog(text: string): boolean {
  const normalized = text.toLowerCase();
  const tagalogWords = [
    'po', 'opo', 'na', 'pa', 'ba', 'sa', 'ng', 'mga', 'ang', 'at', 'o',
    'ako', 'ikaw', 'ka', 'kami', 'tayo', 'sila', 'natin', 'namin', 'inyo', 'kanya', 'kanila', 'ito', 'iyan', 'iyon', 'dito', 'diyan', 'doon', 'kayo',
    'gising', 'tulog', 'tara', 'laro', 'lods', 'boss', 'pre', 'gago', 'tangina', 'kupal', 'bobo', 'pucha', 
    'boto', 'botohan', 'vouch', 'patay', 'buhay', 'pumatay', 'papatay', 'mafia', 'secretary', 
    'bata', 'kuya', 'ate', 'kapit', 'ano', 'bakit', 'paano', 'kailan', 'saan', 'sino', 'salamat', 
    'kamusta', 'kumusta', 'wala', 'meron', 'mayroon', 'hindi', 'oo', 'lang', 'naman', 'nga', 'din', 'rin',
    'gabi', 'umaga', 'tanghali', 'hapon', 'araw', 'oras', 'sulat', 'basa', 'magulo', 'ayos', 'basta', 
    'talaga', 'sige', 'muna', 'pala', 'sana', 'kahit', 'mismo', 'kasi', 'dahil', 'kaya', 'para'
  ];

  const words = normalized.split(/[^a-zA-Z]+/);
  for (const word of words) {
    if (tagalogWords.includes(word)) {
      return true;
    }
  }

  if (normalized.includes('mga') || normalized.includes('ng ') || normalized.includes(' ng ') || normalized.includes('ang ') || normalized.includes(' ang ')) {
    return true;
  }

  return false;
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

  // Clean and map language code
  let resolvedLang = lang.toLowerCase();
  
  // Auto-detect Tagalog/Taglish or enforce 'tl' if explicitly selected or detected
  if (resolvedLang.startsWith('tl') || resolvedLang.startsWith('fil') || isTaglishOrTagalog(text)) {
    resolvedLang = 'tl';
  } else if (resolvedLang.startsWith('en')) {
    resolvedLang = 'en';
  } else {
    // Standard ISO 2-letter fallback if subcode is sent
    resolvedLang = resolvedLang.split('-')[0];
  }

  debugLog(`Requested TTS broadcast for text: "${text}" into channels: ${channelIds.join(', ')} with resolved lang: "${resolvedLang}"`);

  let audioBuffer: Buffer;
  try {
    const url = googleTTS.getAudioUrl(text, {
      lang: resolvedLang,
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
    audioBuffer = Buffer.from(arrayBuffer);
    debugLog(`Successfully downloaded TTS file. Size: ${audioBuffer.byteLength} bytes. Streaming directly in-memory.`);
  } catch (err: any) {
    debugLog(`CRITICAL - TTS Download failed: ${err.message}`);
    return;
  }

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        debugLog(`Channel with ID ${channelId} is not a valid guild voice channel.`);
        continue;
      }

      const connection = getOrCreateVoiceConnection(channel);
      const isReady = await ensureVoiceConnectionReady(connection, channel);
      if (!isReady) {
        continue;
      }

      const player = getOrCreateGuildPlayer(channel.guild.id, connection);
      
      // Optimize: Create a readable stream directly from memory buffer representing the TTS audio, bypassing disk I/O completely
      debugLog(`Streaming buffered audio directly in-memory to persistent voice player.`);
      const stream = Readable.from(audioBuffer);
      const resource = createAudioResource(stream, {
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

      console.log(`Auto-joining voice channel ${channel.name} since it has a scheduled event today.`);
      getOrCreateVoiceConnection(channel);
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

export function stopDiscordBot() {
  debugLog("Manual token disengagement triggered: Stopping and destroying all active voice connections...");
  for (const guildId of activeGuildIds) {
    try {
      const connection = getVoiceConnection(guildId);
      if (connection) {
        debugLog(`Destroying active voice connection in guild: ${guildId}`);
        connection.destroy();
      }
    } catch (e: any) {
      debugLog(`Error destroying connection for guild ${guildId}: ${e.message}`);
    }
  }
  activeGuildIds.clear();

  if (client) {
    debugLog("Manual token disengagement triggered: Stopping and destroying current Discord Bot client instance...");
    try {
      client.destroy();
    } catch (e: any) {
      debugLog(`Error while destroying client: ${e.message}`);
    }
    client = null;
  }
}
