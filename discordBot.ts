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

process.on('unhandledRejection', (reason: any, promise) => {
  const reasonStr = reason ? (reason.message || String(reason)) : '';
  if (reasonStr.includes('Cannot perform IP discovery') || reasonStr.includes('socket closed')) {
    debugLog(`[Voice Connection Diagnostics] Cleanly handled anticipated network issue: UDP IP discovery is limited/sandboxed in this container. This is expected in the Google AI Studio Sandbox/Cloud Run environment, but voice will work seamlessly on VPS/production deployments.`);
    return;
  }
  debugLog(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (err: any) => {
  const errStr = err ? (err.message || String(err)) : '';
  if (errStr.includes('Cannot perform IP discovery') || errStr.includes('socket closed')) {
    debugLog(`[Voice Connection Diagnostics] Cleanly handled anticipated network uncaught exception: UDP IP discovery socket closed (expected in Google Cloud Run / Sandbox environment).`);
    return;
  }
  debugLog(`Uncaught Exception: ${err}`);
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

export let client: Client | null = null;
export let client2: Client | null = null;
const activeGuildIds = new Set<string>();
let lastAudioPlayTime = 0;

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
        const activeClient = client || client2;
        let user = activeClient?.users.cache.get(userId);
        if (!user) {
          user = await activeClient?.users.fetch(userId).catch(() => null);
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
        const activeClient = client || client2;
        const globalChannel = activeClient?.channels.cache.get(channelId) || await activeClient?.channels.fetch(channelId).catch(() => null);
        if (globalChannel && 'name' in globalChannel) {
          name = (globalChannel as any).name;
        }
      } catch (e) {}
    }
    resolved = resolved.replace(fullMatch, name);
  }

  return resolved;
}

export function getOrCreateVoiceConnection(channel: any, group?: string): any {
  const guildId = channel.guild.id;
  const connectionKey = group ? `${guildId}_${group}` : guildId;
  activeGuildIds.add(connectionKey);
  let connection = getVoiceConnection(guildId, group);
  
  // If there's an existing voice connection but it's in a broken state, destroy it first so we can rebuild cleanly
  if (connection) {
    const status = connection.state.status;
    if (status === VoiceConnectionStatus.Disconnected || status === VoiceConnectionStatus.Destroyed) {
      debugLog(`Existing connection in guild ${guildId} (group: ${group || 'default'}) is ${status}. Destroying to reconnect cleanly.`);
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
    debugLog(`Connecting to voice channel: "${channel.name}" in guild "${channel.guild.name}" with group: "${group || 'default'}"...`);
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator as any,
      selfDeaf: true,
      selfMute: false,
      group: group
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
    
    connection.on('error', (err: any) => {
      debugLog(`[Voice Connection Error Handled] Guild ${guildId} encountered connection or IP discovery issue: ${err.message}`);
    });

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
    const errStr = String(err.message || err);
    if (!errStr.includes("The operation was aborted") && !errStr.includes("destroyed")) {
      debugLog(`[Voice Connection Stalled] Connection failed to reach READY status. Current state: "${connection.state.status}". Error: ${err.message}`);
      debugLog(`[Diagnosis] A voice connection stuck in "signalling" state typically indicates:`);
      debugLog(`  * Option A: Dynamic outward UDP egress/sockets are sandboxed or restricted in this container. This is expected in the Google AI Studio Sandbox/Cloud Run environment, but will work seamlessly on your dedicated CloudPanel VPS deployment where dynamic UDP routing is fully enabled.`);
      debugLog(`  * Option B: Bot Token conflict. If your production bot at https://secretary.mafia.anvorte.com/ is simultaneously running with this exact token, Discord kills the voice session state for one client. You can use the "Disconnect Bot" button on the UI dashboard to turn off the bot here!`);
    } else {
      debugLog(`[Voice Connection State] Connection to channel "${channel.name}" cleanly terminated before reaching READY (likely clean disconnect or timeout jump).`);
    }
    
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

    newConnection.on('error', (err: any) => {
      debugLog(`[Voice Connection Retry Error Handled] Guild ${guildId} encountered connection or IP discovery issue: ${err.message}`);
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

type QueueItem = {
  createResource: () => any;
  onStart?: (player: any) => void;
};

const guildAudioQueues = new Map<string, QueueItem[]>();
const guildIsPlaying = new Map<string, boolean>();
const guildIdleTimeouts = new Map<string, NodeJS.Timeout>();

export function playNext(guildId: string, player: any, connection: any) {
  // Clear any existing idle timeout
  const timeout = guildIdleTimeouts.get(guildId);
  if (timeout) {
    clearTimeout(timeout);
    guildIdleTimeouts.delete(guildId);
  }

  const queue = guildAudioQueues.get(guildId) || [];
  if (queue.length === 0) {
    guildIsPlaying.set(guildId, false);
    debugLog(`Queue empty for guild ${guildId}, scheduling disconnect in 5 minutes if idle...`);
    
    const newTimeout = setTimeout(() => {
      // Check if it's still idle
      if (!guildIsPlaying.get(guildId) && (guildAudioQueues.get(guildId) || []).length === 0) {
        debugLog(`Guild ${guildId} idle for 5 minutes, disconnecting bot from voice...`);
        try {
          connection.destroy();
        } catch (e) {}
        activeGuildIds.delete(guildId);
        guildPlayers.delete(guildId);
      }
      guildIdleTimeouts.delete(guildId);
    }, 5 * 60 * 1000); // 5 minutes
    
    guildIdleTimeouts.set(guildId, newTimeout);
    return;
  }
  
  guildIsPlaying.set(guildId, true);
  const nextItem = queue.shift();
  try {
    const resource = nextItem!.createResource();
    player.play(resource);
    if (nextItem!.onStart) {
      nextItem!.onStart(player);
    }
  } catch (err) {
    debugLog(`Failed to create/play resource for guild ${guildId}: ${err}`);
    playNext(guildId, player, connection);
  }
}

// Persistent Player registry
const guildPlayers = new Map<string, any>();

export function getOrCreateGuildPlayer(guildId: string, connection: any) {
  let player = guildPlayers.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    guildPlayers.set(guildId, player);
    
    player.on('error', (error: any) => {
      debugLog(`Persistent Player error on guild ${guildId}: ${error.message}`);
      playNext(guildId, player, connection);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      // Small delay helps Discord not cut off the end of speech abruptly
      setTimeout(() => {
        playNext(guildId, player, connection);
      }, 500);
    });
  }
  
  // Resubscribe if the connection changed
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

async function playLocalFileInChannelForClient(
  clientInst: Client,
  channel: any,
  filePath: string,
  group?: string,
  options?: { volume?: number, maxDurationSec?: number }
) {
  const connection = getOrCreateVoiceConnection(channel, group);
  const isReady = await ensureVoiceConnectionReady(connection, channel);
  if (!isReady) {
    return;
  }

  const guildId = channel.guild.id;
  const connectionKey = group ? `${guildId}_${group}` : guildId;
  const player = getOrCreateGuildPlayer(connectionKey, connection);
  
  const createResource = () => {
    const resource = createAudioResource(filePath, {
      inputType: StreamType.Arbitrary,
      inlineVolume: options?.volume !== undefined
    });

    if (options?.volume !== undefined) {
      resource.volume?.setVolume(options.volume / 100);
    }
    return resource;
  };

  const queue = guildAudioQueues.get(connectionKey) || [];
  queue.push({
    createResource,
    onStart: (p: any) => {
      if (options?.maxDurationSec) {
        setTimeout(() => {
          if (p.state.status === AudioPlayerStatus.Playing) {
            p.stop();
          }
        }, options.maxDurationSec * 1000);
      }
    }
  });
  guildAudioQueues.set(connectionKey, queue);

  lastAudioPlayTime = Date.now();
  
  if (!guildIsPlaying.get(connectionKey)) {
    playNext(connectionKey, player, connection);
  }
}

export async function playLocalFileInChannels(filePath: string, channelIds: string[], options?: { volume?: number, maxDurationSec?: number }) {
  if (channelIds.length === 0) {
    const fallbackId = process.env.DISCORD_VOICE_CHANNEL_ID;
    if (fallbackId) channelIds = [fallbackId];
    else return;
  }

  debugLog(`Requested local file playback: "${filePath}" into channels: ${channelIds.join(', ')}`);

  for (const channelId of channelIds) {
    // Try to play on bot 1
    if (client && client.isReady()) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice || (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()))) {
          await playLocalFileInChannelForClient(client, channel, filePath, undefined, options);
        }
      } catch (err: any) {
        debugLog(`Bot 1 failed to play local file in channel ${channelId}: ${err.message}`);
      }
    }

    // Try to play on bot 2
    if (client2 && client2.isReady()) {
      try {
        const channel = await client2.channels.fetch(channelId).catch(() => null);
        if (channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice || (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()))) {
          await playLocalFileInChannelForClient(client2, channel, filePath, 'bot2', options);
        }
      } catch (err: any) {
        debugLog(`Bot 2 failed to play local file in channel ${channelId}: ${err.message}`);
      }
    }
  }
}

export function isDiscordConnected() {
  return !!(client && client.isReady());
}

export function isDiscordConnected2() {
  return !!(client2 && client2.isReady());
}

export async function transferVoiceMembers(guild: any, targetChannelId: string) {
  const voiceStates = guild.voiceStates.cache;
  let movedCount = 0;
  let failedCount = 0;

  for (const [memberId, state] of voiceStates.entries()) {
    if (state.channelId && state.channelId !== targetChannelId) {
      try {
        const member = state.member || await guild.members.fetch(memberId).catch(() => null);
        if (member) {
          await member.voice.setChannel(targetChannelId);
          movedCount++;
        }
      } catch (err: any) {
        debugLog(`Failed to move member ${memberId}: ${err.message}`);
        failedCount++;
      }
    }
  }
  return { movedCount, failedCount };
}

export interface DiscordBotSettings {
  warnings: number[];
  voiceCountdown: boolean;
  timezone?: string;
  voiceLang?: string;
  voiceStartText?: string;
  warningAudioOffsetSec?: number;
  warningAudioFileName?: string;
  warningAudioVolume?: number;
  bot2ChannelId?: string;
  autoTransferAtStart?: boolean;
}

function registerSlashCommands(clientInst: Client) {
  try {
    const commandsToCreate = [];

    if (clientInst === client) {
      commandsToCreate.push({
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
      });
    }

    commandsToCreate.push({
      name: 'transfer',
      description: 'Transfer all members from any voice channel to a target voice channel',
      options: [
        {
          name: 'channel',
          type: 7, // Channel type
          description: 'The channel to move everyone to. If not specified, moves everyone to your voice channel.',
          required: false
        }
      ]
    });

    clientInst.application?.commands.set(commandsToCreate).then(() => {
      debugLog(`Successfully registered commands for bot: ${clientInst.user?.tag}`);
    }).catch(err => {
      debugLog(`Failed during command registration for ${clientInst.user?.tag}: ${err.message}`);
    });

    // Clear guild-level commands to prevent duplication
    clientInst.guilds.cache.forEach(guild => {
      guild.commands.set([]).catch(() => {});
    });
  } catch (err: any) {
    debugLog(`Error registering commands: ${err.message}`);
  }
}

async function handleTransferInteraction(interaction: any) {
  let deferSuccess = true;
  await interaction.deferReply().catch(err => {
    deferSuccess = false;
  });

  try {
    const guild = interaction.guild;
    if (!guild) {
      if (deferSuccess) await interaction.editReply({ content: "❌ This command can only be used in a Discord server." });
      return;
    }

    let targetChannel = interaction.options.getChannel('channel');
    if (!targetChannel) {
      const member = guild.members.cache.get(interaction.user.id) || await guild.members.fetch(interaction.user.id).catch(() => null);
      if (member?.voice?.channel) {
        targetChannel = member.voice.channel;
      }
    }

    if (!targetChannel || !(targetChannel.type === ChannelType.GuildVoice || targetChannel.type === ChannelType.GuildStageVoice || (typeof targetChannel.isVoiceBased === 'function' && targetChannel.isVoiceBased()))) {
      if (deferSuccess) {
        await interaction.editReply({ content: "❌ Please specify a valid voice channel, or join one yourself to transfer members here." });
      }
      return;
    }

    const { movedCount, failedCount } = await transferVoiceMembers(guild, targetChannel.id);

    if (deferSuccess) {
      if (movedCount === 0) {
        await interaction.editReply({ content: `ℹ️ No other members found in other voice channels to transfer to **${targetChannel.name}**.` });
      } else {
        await interaction.editReply({ content: `✅ Successfully transferred **${movedCount}** member(s) to **${targetChannel.name}**${failedCount > 0 ? ` (${failedCount} failed)` : ''}.` });
      }
    }
  } catch (err: any) {
    debugLog(`Error executing transfer command: ${err.message}`);
    if (deferSuccess) {
      await interaction.editReply({ content: `❌ Failed to execute transfer: ${err.message}` });
    }
  }
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

        try {
          registerSlashCommands(client!);
        } catch (err: any) {
          debugLog(`Error cleaning up & registering slash commands: ${err.message}`);
        }

        resolve();
      });

      client.on('interactionCreate', async (interaction) => {
        try {
          if (!interaction.isChatInputCommand()) return;
          if (interaction.commandName === 'ss') {
            let deferSuccess = true;
            await interaction.deferReply().catch(err => {
              deferSuccess = false;
              if (err.message && !err.message.includes('Unknown interaction')) {
                debugLog(`Immediate deferReply failed: ${err.message}`);
              }
            });

            const textToSpeak = interaction.options.getString('text');
            if (!textToSpeak) {
              if (deferSuccess) {
                await interaction.editReply({ content: "❌ Please supply the text to speak." }).catch(() => {});
              }
              return;
            }

            const member = interaction.guild?.members.cache.get(interaction.user.id);
            const voiceChannel = member?.voice?.channel;
            if (voiceChannel) {
              try {
                debugLog(`Interactions command (/ss) triggered by ${interaction.user.tag} for: "${textToSpeak}"`);
                const cleanSpeech = await resolveMentions(textToSpeak, interaction.guild);
                await playAudioInVoiceChannels(cleanSpeech, [voiceChannel.id], globalSettings.voiceLang || 'en');
                if (deferSuccess) {
                  await interaction.editReply({ content: `🗣️ *Speaking:* "${textToSpeak}"` }).catch(() => {});
                }
              } catch (playErr: any) {
                debugLog(`Failed to speak via interactions: ${playErr.message}`);
                if (deferSuccess) {
                  await interaction.editReply({ content: `❌ Stalled voice stream: ${playErr.message}` }).catch(() => {});
                }
              }
            } else {
              if (deferSuccess) {
                await interaction.editReply({ content: `❌ You must join a voice channel for Mafia Secretary to speak.` }).catch(() => {});
              }
            }
          } else if (interaction.commandName === 'transfer') {
            await handleTransferInteraction(interaction);
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
            const lower = content.toLowerCase();

            // Match text-based transfer trigger
            if (lower.startsWith('!transfer') || lower.startsWith('.transfer') || lower === 'transfer all here' || lower.startsWith('!transfer ')) {
              const member = message.guild.members.cache.get(message.author.id) || await message.guild.members.fetch(message.author.id).catch(() => null);
              const voiceChannel = member?.voice?.channel;
              if (voiceChannel) {
                message.react('✅').catch(() => {});
                const { movedCount } = await transferVoiceMembers(message.guild, voiceChannel.id);
                message.reply(`✅ Successfully transferred **${movedCount}** member(s) to **${voiceChannel.name}**!`).catch(() => {});
              } else {
                message.react('❌').catch(() => {});
                message.reply(`❌ You must join a voice channel to transfer members to your location.`).catch(() => {});
              }
              return;
            }

            let textToSpeak = '';
            
            // Match clean /ss as a fast alternate, !ss, .ss, or ss prefix-less commands
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

export async function initDiscordBot2(
  globalSchedule: { events: ScheduledEvent[] },
  globalSettings: DiscordBotSettings,
  token?: string
): Promise<void> {
  const currentToken = (token || process.env.DISCORD_TOKEN_2 || '').trim();
  // Prevent login attempt with obvious invalid or placeholder tokens
  if (!currentToken || currentToken === 'undefined' || currentToken.length < 50 || currentToken.includes("INSERT_YOUR_DISCORD_BOT_TOKEN_HERE")) {
    throw new Error("Invalid secondary token format.");
  }

  if (client2) {
    client2.destroy();
  }

  return new Promise((resolve, reject) => {
    client2 = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    client2.on('ready', () => {
      debugLog(`Secondary Discord bot logged in and READY as: ${client2?.user?.tag}`);
      try {
        registerSlashCommands(client2!);
      } catch (err: any) {
        debugLog(`Error registering slash commands for bot 2: ${err.message}`);
      }
      startScheduleLoop(globalSchedule, globalSettings);
      resolve();
    });

    client2.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName === 'transfer') {
          await handleTransferInteraction(interaction);
        }
      } catch (err: any) {
        debugLog(`Error processing slash interaction on bot 2: ${err.message}`);
      }
    });

    client2.on('error', (err) => {
      debugLog(`Secondary Discord client error event: ${err.message}`);
    });

    client2.login(currentToken).catch(err => {
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

function isTaglishOrTagalog(text: string): boolean {
  const normalized = text.toLowerCase();
  
  const strongTagalogWords = [
    'po', 'opo', 'ikaw', 'kami', 'tayo', 'sila', 'natin', 'namin', 'inyo', 'kanya', 'kanila', 'dito', 'diyan', 'doon', 'kayo',
    'gising', 'tulog', 'tara', 'laro', 'lods', 'boss', 'pre', 'gago', 'tangina', 'kupal', 'bobo', 'pucha', 'ulol',
    'botohan', 'patay', 'buhay', 'pumatay', 'papatay', 
    'kuya', 'ate', 'bakit', 'paano', 'kailan', 'saan', 'sino', 'salamat', 
    'kamusta', 'kumusta', 'meron', 'mayroon', 'hindi', 'naman', 'nga', 
    'gabi', 'umaga', 'tanghali', 'hapon', 'araw', 'oras', 'sulat', 'basa', 'magulo', 'ayos', 'basta', 
    'talaga', 'sige', 'muna', 'pala', 'sana', 'kahit', 'mismo', 'kasi', 'dahil', 'kaya'
  ];
  
  const smallWords = ['na', 'pa', 'ba', 'sa', 'ng', 'mga', 'ang', 'at', 'o', 'ako', 'ito', 'iyon', 'wala', 'oo', 'lang', 'din', 'rin', 'para'];

  const words = normalized.split(/[^a-zA-Z]+/);
  let strongCount = 0;
  let smallCount = 0;

  for (const word of words) {
    if (strongTagalogWords.includes(word)) strongCount++;
    else if (smallWords.includes(word)) smallCount++;
  }

  if (strongCount >= 1) return true;
  if (smallCount >= 2) return true;

  if (normalized.includes('mga') || normalized.includes('ng ') || normalized.includes(' ng ') || normalized.includes('ang ') || normalized.includes(' ang ')) {
    return true;
  }

  return false;
}

function applyPhonetics(text: string, lang: string): string {
  let mapped = text;
  // Laughing phonetics globally
  mapped = mapped.replace(/\b(ha){2,}h?\b/gi, "ha ha ha ha ha ha");
  mapped = mapped.replace(/\b(he){2,}h?\b/gi, "hehe hehe hehe");

  // Specific user/nickname phonetics
  mapped = mapped.replace(/\bla{2,}ns\b/gi, "LANCEEEEEEE");

  if (lang.startsWith('tl') || lang.startsWith('fil')) {
    mapped = mapped.replace(/\btangina\b/gi, "tang ina");
    mapped = mapped.replace(/\btanginamo\b/gi, "tang ina mo");
    mapped = mapped.replace(/\bgago\b/gi, "ga go");
    mapped = mapped.replace(/\bulol\b/gi, "u lol");
    mapped = mapped.replace(/\bpucha\b/gi, "pu tsha");
    mapped = mapped.replace(/\bbobo\b/gi, "bo bo");
  }
  return mapped;
}

export async function testVoice(channelId: string, lang = 'en') {
  console.log(`Running test voice on channel ${channelId} with lang ${lang}`);
  await playAudioInVoiceChannels("This is a test message to verify the voice channel connection.", [channelId], lang, true);
}

export async function testWarningSound(channelId: string, fileName: string, volume: number) {
  console.log(`Testing warning sound: ${fileName} on channel ${channelId} with volume ${volume}`);
  const targetPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Warning sound file ${fileName} does not exist on the server.`);
  }
  await playLocalFileInChannels(targetPath, [channelId], { volume, maxDurationSec: 15 });
}

export async function playAudioInVoiceChannels(text: string, channelIds: string[], lang = 'en', disableAutoDetect = false) {
  if (!client || !channelIds || channelIds.length === 0) {
    // Fallback to process.env if none specified
    const fallbackId = process.env.DISCORD_VOICE_CHANNEL_ID;
    if (fallbackId) channelIds = [fallbackId];
    else return;
  }

  // Clean and map language code
  let resolvedLang = lang ? lang.toLowerCase().replace('_', '-') : 'en';
  if (resolvedLang === 'fil') {
    resolvedLang = 'tl';
  }
  
  // Auto-detect Tagalog/Taglish or enforce 'tl' if explicitly selected or detected
  if (!disableAutoDetect && (resolvedLang.startsWith('tl') || resolvedLang.startsWith('fil') || isTaglishOrTagalog(text))) {
    resolvedLang = 'tl';
  } else {
    // Standardize and keep valid Google Translate subcodes, otherwise take the 2-letter ISO code.
    const googleSupportsSub = ['en-gb', 'en-us', 'en-au', 'en-ca', 'en-in', 'pt-br', 'zh-cn', 'zh-tw', 'es-es', 'es-mx', 'fr-fr', 'de-de'];
    if (googleSupportsSub.includes(resolvedLang)) {
      // Keep support for regional accents
    } else if (resolvedLang.startsWith('en')) {
      // Safely default other English profiles to standard British/American or plain 'en'
      resolvedLang = 'en';
    } else {
      // Map 'es-AR' -> 'es', 'pt-PT' -> 'pt'
      resolvedLang = resolvedLang.split('-')[0];
    }
  }

  // Apply phonetic fixes
  const spokenText = applyPhonetics(text, resolvedLang);

  debugLog(`Requested TTS broadcast for text: "${text}" into channels: ${channelIds.join(', ')} with resolved lang: "${resolvedLang}"`);

  let audioBuffer: Buffer;
  try {
    const url = googleTTS.getAudioUrl(spokenText, {
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
      if (!channel || !(channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice || (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()))) {
        debugLog(`Channel with ID ${channelId} is not a valid voice channel.`);
        continue;
      }

      const connection = getOrCreateVoiceConnection(channel);
      const isReady = await ensureVoiceConnectionReady(connection, channel);
      if (!isReady) {
        continue;
      }

      const guildId = channel.guild.id;
      const player = getOrCreateGuildPlayer(guildId, connection);
      
      const createResource = () => {
        debugLog(`Streaming buffered audio directly in-memory to persistent voice player.`);
        // We recreate the stream inside the closure so it reads from the start each time it queues
        const stream = Readable.from(audioBuffer);
        return createAudioResource(stream, {
          inputType: StreamType.Arbitrary
        });
      };
      
      const queue = guildAudioQueues.get(guildId) || [];
      queue.push({ createResource });
      guildAudioQueues.set(guildId, queue);
      
      lastAudioPlayTime = Date.now();
      debugLog(`Play queued on persistent player in channel: ${channel.name}`);
      
      if (!guildIsPlaying.get(guildId)) {
        playNext(guildId, player, connection);
      }
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

    const msLeft = nextEvent ? nextTime - now : Infinity;
    const minsLeft = nextEvent ? Math.ceil(msLeft / 60000) : Infinity;

    // Check and run auto-join every 10 seconds
    if (now - lastAutoJoinTime >= 10000) {
      lastAutoJoinTime = now;
      
      // Bot 1 (Main Bot) Connection Logic
      let shouldBeConnected1 = false;
      let targetConnectionChannels1: string[] = [];

      if (nextEvent) {
          const warnMins = globalSettings.warnings || [];
          const maxWarn = warnMins.length > 0 ? Math.max(...warnMins) : 30;
          
          if (minsLeft <= maxWarn + 2 && minsLeft >= -5) {
             shouldBeConnected1 = true;
          }

          if (shouldBeConnected1) {
             targetConnectionChannels1 = nextEvent.channelIds || [];
             if (targetConnectionChannels1.length === 0 && process.env.DISCORD_VOICE_CHANNEL_ID) {
                targetConnectionChannels1 = [process.env.DISCORD_VOICE_CHANNEL_ID];
             }
          }
      }

      // Keep bot 1 connected if active queues
      let hasActiveQueues1 = false;
      for (const [key, isPlay] of guildIsPlaying.entries()) {
         if (!key.endsWith("_bot2") && isPlay) hasActiveQueues1 = true;
      }
      if (hasActiveQueues1 || (now - lastAudioPlayTime < 5 * 60 * 1000)) {
         shouldBeConnected1 = true;
      }

      if (client && client.isReady()) {
         if (shouldBeConnected1 && targetConnectionChannels1.length > 0) {
             targetConnectionChannels1.forEach(channelId => {
                client?.channels.fetch(channelId).then(async channel => {
                    if (channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice || (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()))) {
                        const connection = getOrCreateVoiceConnection(channel);
                        await ensureVoiceConnectionReady(connection, channel).catch(()=>{});
                    }
                }).catch(()=>{});
             });
         } else {
             // Disconnect Bot 1 from any guilds we joined if we shouldn't be connected
             for (const connectionKey of activeGuildIds) {
                if (!connectionKey.endsWith("_bot2")) {
                   try {
                      const conn = getVoiceConnection(connectionKey);
                      if (conn) conn.destroy();
                   } catch(e){}
                   activeGuildIds.delete(connectionKey);
                }
             }
         }
      }

      // Bot 2 (Secondary Bot) Connection Logic
      let shouldBeConnected2 = false;
      let targetConnectionChannels2: string[] = [];

      if (nextEvent && globalSettings.bot2ChannelId) {
          const warnMins = globalSettings.warnings || [];
          const maxWarn = warnMins.length > 0 ? Math.max(...warnMins) : 30;
          
          // Connect starting from max warning plus 2 mins, up until exactly 5 mins after starting
          if (minsLeft <= maxWarn + 2 && minsLeft > -5) {
             shouldBeConnected2 = true;
             targetConnectionChannels2 = [globalSettings.bot2ChannelId];
          }
      }

      let hasActiveQueues2 = false;
      for (const [key, isPlay] of guildIsPlaying.entries()) {
         if (key.endsWith("_bot2") && isPlay) hasActiveQueues2 = true;
      }
      if (hasActiveQueues2) {
         shouldBeConnected2 = true;
      }

      if (client2 && client2.isReady()) {
         if (shouldBeConnected2 && targetConnectionChannels2.length > 0) {
             targetConnectionChannels2.forEach(channelId => {
                client2?.channels.fetch(channelId).then(async channel => {
                    if (channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice || (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()))) {
                        const connection = getOrCreateVoiceConnection(channel, "bot2");
                        await ensureVoiceConnectionReady(connection, channel).catch(()=>{});
                    }
                }).catch(()=>{});
             });
         } else {
             // Disconnect Bot 2 from any guilds we joined if we shouldn't be connected
             for (const connectionKey of activeGuildIds) {
                if (connectionKey.endsWith("_bot2")) {
                   try {
                      const guildId = connectionKey.replace("_bot2", "");
                      const conn = getVoiceConnection(guildId, "bot2");
                      if (conn) conn.destroy();
                   } catch(e){}
                   activeGuildIds.delete(connectionKey);
                }
             }
         }
      }
    }

    if (!nextEvent) return;

    const secsLeft = Math.round(msLeft / 1000);

    const eventId = nextEvent.id;
    const occurrenceId = `${eventId}_${nextTime}`;
    const targetChannels = nextEvent.channelIds || [];
    const bot2Chs = globalSettings.bot2ChannelId ? [globalSettings.bot2ChannelId] : [];
    const mergedChs = Array.from(new Set([...targetChannels, ...bot2Chs]));

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
        // Play TTS only on Bot 1 (to prevent redundant voices/conflicts)
        playAudioInVoiceChannels(`Reminder: ${nextEvent!.name} starts in ${warnMin} minute${warnMin > 1 ? 's' : ''}.`, targetChannels, globalSettings.voiceLang, true);
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
            // Play custom warning audio on BOTH bots (using mergedChs)
            playLocalFileInChannels(customAudioPath, mergedChs, { volume: globalSettings.warningAudioVolume || 100, maxDurationSec: 10 });
            debugLog(`Played custom audio "${customFileName}" milestone: ${milestoneKey} for ${nextEvent.name} with volume ${globalSettings.warningAudioVolume || 100}% playing for max 10s`);
          } else {
            const fallbackPath = path.join(process.cwd(), 'godfather-theme-15s.mp3');
            if (fs.existsSync(fallbackPath)) {
              playLocalFileInChannels(fallbackPath, mergedChs, { volume: 100, maxDurationSec: 10 });
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
            // Play cached countdown MP3 on BOTH bots
            playLocalFileInChannels(cachedFile, mergedChs);
          } else {
            // Fallback: TTS only on Bot 1
            playAudioInVoiceChannels(secsLeft.toString(), targetChannels, globalSettings.voiceLang, true);
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
            // Play clear comms on BOTH bots
            playLocalFileInChannels(clearCommsFile, mergedChs);
            setTimeout(() => {
              // TTS on Bot 1 only
              playAudioInVoiceChannels(`${nextEvent!.name} is starting now.`, targetChannels, globalSettings.voiceLang, true);
            }, 2600);
          } else {
            // TTS on Bot 1 only
            playAudioInVoiceChannels(`${customStartText} ${nextEvent.name} is starting now.`, targetChannels, globalSettings.voiceLang, true);
          }

          // Handle auto-transfer at start if enabled!
          if (globalSettings.autoTransferAtStart) {
            debugLog(`Executing automatic member transfer at T-0s to target channels.`);
            const activeClient = client || client2;
            if (activeClient && activeClient.isReady()) {
              activeClient.guilds.cache.forEach(async guild => {
                const targetChId = targetChannels[0] || (globalSettings.bot2ChannelId);
                if (targetChId) {
                  await transferVoiceMembers(guild, targetChId);
                }
              });
            }
          }

          debugLog(`Spoke starting-now milestone: ${milestoneKey} for ${nextEvent.name}`);
        }
      }
    } else {
      if (secsLeft <= 0) {
        const milestoneKey = 'countdown-0';
        if (!milestones.has(milestoneKey)) {
          milestones.add(milestoneKey);
          // Fallback: TTS on Bot 1 only
          playAudioInVoiceChannels(`${nextEvent.name} is starting now.`, targetChannels, globalSettings.voiceLang, true);
          debugLog(`Spoke starting-now milestone (no countdown): ${milestoneKey} for ${nextEvent.name}`);
        }
      }
    }
  }, 1000);
}

export function stopDiscordBot() {
  debugLog("Manual token disengagement triggered: Stopping and destroying all active voice connections...");
  for (const connectionKey of activeGuildIds) {
    if (!connectionKey.endsWith("_bot2")) {
      try {
        const connection = getVoiceConnection(connectionKey);
        if (connection) {
          debugLog(`Destroying active voice connection in guild: ${connectionKey}`);
          connection.destroy();
        }
      } catch (e: any) {
        debugLog(`Error destroying connection for guild ${connectionKey}: ${e.message}`);
      }
    }
  }

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

export function stopDiscordBot2() {
  debugLog("Manual token disengagement for bot 2: Stopping and destroying all active voice connections...");
  for (const connectionKey of activeGuildIds) {
    if (connectionKey.endsWith("_bot2")) {
      try {
        const guildId = connectionKey.replace("_bot2", "");
        const connection = getVoiceConnection(guildId, "bot2");
        if (connection) {
          debugLog(`Destroying active voice connection for bot 2 in guild: ${guildId}`);
          connection.destroy();
        }
      } catch (e: any) {
        debugLog(`Error destroying bot 2 connection: ${e.message}`);
      }
      activeGuildIds.delete(connectionKey);
    }
  }

  if (client2) {
    debugLog("Manual token disengagement for bot 2: Stopping and destroying secondary Discord Bot client instance...");
    try {
      client2.destroy();
    } catch (e: any) {
      debugLog(`Error while destroying client2: ${e.message}`);
    }
    client2 = null;
  }
}
