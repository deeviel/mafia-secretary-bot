import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, Pause, History, CheckCircle2, Plus, Trash2, CalendarClock, 
  Volume2, Save, Pencil, X, Settings, Clock, Shield, Bot, AlertTriangle, 
  ChevronRight, Activity, Radio, VolumeX, Flame, Terminal, HelpCircle,
  Upload, Music 
} from 'lucide-react';
import { useSchedule, ScheduledEvent } from './hooks/useSchedule';
import { CircularProgress } from './components/CircularProgress';
import { speech, VoiceOption } from './lib/speech';

let tzList: string[] = ['Asia/Manila', 'UTC'];

const DISCORD_VOICE_ACCENTS = [
  { value: 'en-US', label: '🇺🇸 US English (United States)' },
  { value: 'en-GB', label: '🇬🇧 UK English (United Kingdom)' },
  { value: 'en-AU', label: '🇦🇺 AU English (Australia)' },
  { value: 'en-CA', label: '🇨🇦 CA English (Canada)' },
  { value: 'en-IN', label: '🇮🇳 IN English (India)' },
  { value: 'tl', label: '🇵🇭 Tagalog / Filipino (Philippines)' }
];

const format12Hour = (timeStr: string) => {
  if (!timeStr) return '';
  const [hourStr, minStr] = timeStr.split(':');
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return timeStr;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minStr} ${ampm}`;
};

export default function App() {
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [voiceCountdown, setVoiceCountdown] = useState(true);
  const [warnings, setWarnings] = useState<number[]>([30, 15, 5, 1]);
  const [logs, setLogs] = useState<{ id: string; time: string; msg: string }[]>([]);
  const [timezone, setTimezone] = useState<string>('Asia/Manila');
  
  // Custom audio & announcement settings
  const [voiceStartText, setVoiceStartText] = useState('Clear comms and chat and get that win.');
  const [warningAudioOffsetSec, setWarningAudioOffsetSec] = useState(30);
  const [warningAudioFileName, setWarningAudioFileName] = useState('godfather-theme-15s.mp3');
  const [warningAudioVolume, setWarningAudioVolume] = useState(100);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>(['godfather-theme-15s.mp3']);
  const [isUploading, setIsUploading] = useState(false);
  
  // Voice settings
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [voiceLang, setVoiceLang] = useState<string>('en');
  
  // Live Manila clock states
  const [liveManilaTime, setLiveManilaTime] = useState<string>('--:--:--');
  const [liveManilaDate, setLiveManilaDate] = useState<string>('---, --- --, ----');

  useEffect(() => {
    const tick = () => {
      try {
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Manila',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        const dateFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Manila',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        const d = new Date();
        setLiveManilaTime(timeFormatter.format(d));
        setLiveManilaDate(dateFormatter.format(d));
      } catch (e) {
        const d = new Date();
        setLiveManilaTime(d.toLocaleTimeString());
        setLiveManilaDate(d.toLocaleDateString());
      }
    };
    tick();
    const clockIntv = setInterval(tick, 1000);
    return () => clearInterval(clockIntv);
  }, []);
  
  // New event form state
  const [newEventName, setNewEventName] = useState('');
  const [newEventTime, setNewEventTime] = useState('09:00');
  const [newEventChannelIds, setNewEventChannelIds] = useState<string[]>([]);
  const [newEventDays, setNewEventDays] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New warning form state
  const [newWarning, setNewWarning] = useState('');

  // Discord connection
  const [discordToken, setDiscordToken] = useState('');
  const [isDiscordConnected, setIsDiscordConnected] = useState(false);
  const [isDiscordConnecting, setIsDiscordConnecting] = useState(false);

  // Discord connection 2
  const [discordToken2, setDiscordToken2] = useState('');
  const [isDiscordConnected2, setIsDiscordConnected2] = useState(false);
  const [isDiscordConnecting2, setIsDiscordConnecting2] = useState(false);

  // Additional settings
  const [bot2ChannelId, setBot2ChannelId] = useState('');
  const [autoTransferAtStart, setAutoTransferAtStart] = useState(false);
  
  // Discord channels
  const [availableChannels, setAvailableChannels] = useState<{id:string, name:string, guildName:string}[]>([]);

  // Adaptive in-app notification toasts
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  };

  // Fetch functions for discord
  const fetchDiscordStatus = () => {
     fetch('/api/discord/status')
       .then(async res => {
          if (!res.ok) return null;
          const text = await res.text();
          try { return JSON.parse(text); } catch { return null; }
       })
       .then(data => {
          if (!data) return;
          setIsDiscordConnected(data.connected);
          setIsDiscordConnected2(data.connected2);
          if (data.connected || data.connected2) fetchDiscordChannels();
       })
       .catch(err => console.error(err));
  };

  const fetchDiscordChannels = () => {
     fetch('/api/discord/channels')
       .then(async res => {
          if (!res.ok) return null;
          const text = await res.text();
          try { return JSON.parse(text); } catch { return null; }
       })
       .then(data => {
         if (!data) return;
         if (Array.isArray(data)) setAvailableChannels(data);
       })
       .catch(err => console.error("Failed to load discord channels", err));
  };

  const fetchAudioFiles = () => {
    fetch('/api/audio-files')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.files)) {
          setAvailableAudioFiles(data.files);
        }
      })
      .catch(err => console.error("Failed to load audio files:", err));
  };

  // Load Initial Data from Backend
  useEffect(() => {
    fetch('/api/schedule')
      .then(async res => {
          if (!res.ok) return null;
          const text = await res.text();
          try { return JSON.parse(text); } catch { return null; }
       })
      .then(data => {
        if (!data) return;
        if (Array.isArray(data)) setEvents(data);
      })
      .catch(err => console.error("Failed to load schedule", err));
      
    fetchDiscordStatus();
    fetchAudioFiles();
    // Poll status every 5 seconds just in case it connects in background
    const intv = setInterval(fetchDiscordStatus, 5000);

    fetch('/api/settings')
      .then(async res => {
          if (!res.ok) return null;
          const text = await res.text();
          try { return JSON.parse(text); } catch { return null; }
       })
      .then(data => {
        if (!data) return;
        if (data.warnings) setWarnings(data.warnings);
        if (typeof data.voiceCountdown === 'boolean') setVoiceCountdown(data.voiceCountdown);
        if (typeof data.voiceLang === 'string') setVoiceLang(data.voiceLang);
        if (typeof data.voiceStartText === 'string') setVoiceStartText(data.voiceStartText);
        if (typeof data.warningAudioOffsetSec === 'number') setWarningAudioOffsetSec(data.warningAudioOffsetSec);
        if (typeof data.warningAudioFileName === 'string') setWarningAudioFileName(data.warningAudioFileName);
        if (typeof data.warningAudioVolume === 'number') setWarningAudioVolume(data.warningAudioVolume);
        if (typeof data.bot2ChannelId === 'string') setBot2ChannelId(data.bot2ChannelId);
        if (typeof data.autoTransferAtStart === 'boolean') setAutoTransferAtStart(data.autoTransferAtStart);
        setTimezone("Asia/Manila");
        // Ensure backend setting is set to Asia/Manila too
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            warnings: data.warnings || warnings, 
            voiceCountdown: typeof data.voiceCountdown === 'boolean' ? data.voiceCountdown : voiceCountdown,
            timezone: "Asia/Manila"
          })
        }).catch(console.error);
      })
      .catch(err => console.error("Failed to load settings", err));

    const unsubscribeSpeech = speech.subscribe(() => {
      const v = speech.getVoices();
      setVoices(v);
      let saved = null;
      try {
        saved = localStorage.getItem('selectedVoiceUri');
      } catch (e) {}
      
      if (saved) {
        speech.setVoiceByUri(saved);
        setSelectedVoice(saved);
      } else {
        const current = speech.getCurrentVoiceUri();
        if (current) setSelectedVoice(current);
      }
    });
    
    return () => {
      clearInterval(intv);
      unsubscribeSpeech();
    };
  }, []);

  // Synchronize browser voice simulation when backend voice language changes
  useEffect(() => {
    if (voices.length === 0) return;
    
    // Check if we already have a selected voice that matches the lang
    const currentVoice = voices.find(v => v.uri === selectedVoice);
    if (currentVoice && currentVoice.lang.toLowerCase().replace('_', '-').startsWith(voiceLang.toLowerCase().replace('_', '-').split('-')[0])) {
      return; // Already matches
    }

    // Try to find a matching voice
    const normalizedLang = voiceLang.toLowerCase().replace('_', '-').split('-')[0];
    const bestMatch = voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(normalizedLang)) || voices[0];
    
    if (bestMatch && bestMatch.uri !== selectedVoice) {
      speech.setVoiceByUri(bestMatch.uri);
      setSelectedVoice(bestMatch.uri);
    }
  }, [voiceLang, voices]);

  const syncSchedule = (updatedEvents: ScheduledEvent[]) => {
    setEvents(updatedEvents);
    fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: updatedEvents })
    }).catch(console.error);
  };

  const syncSettings = (
    updatedWarnings: number[], 
    updatedVoiceCountdown: boolean, 
    newVoiceLang?: string,
    newVoiceStartText?: string,
    newWarningOffset?: number,
    newWarningFile?: string,
    newWarningVolume?: number,
    newBot2ChannelId?: string,
    newAutoTransferAtStart?: boolean
  ) => {
    setWarnings(updatedWarnings);
    setVoiceCountdown(updatedVoiceCountdown);
    if (newVoiceLang !== undefined) setVoiceLang(newVoiceLang);
    if (newVoiceStartText !== undefined) setVoiceStartText(newVoiceStartText);
    if (newWarningOffset !== undefined) setWarningAudioOffsetSec(newWarningOffset);
    if (newWarningFile !== undefined) setWarningAudioFileName(newWarningFile);
    if (newWarningVolume !== undefined) setWarningAudioVolume(newWarningVolume);
    if (newBot2ChannelId !== undefined) setBot2ChannelId(newBot2ChannelId);
    if (newAutoTransferAtStart !== undefined) setAutoTransferAtStart(newAutoTransferAtStart);

    const lang = newVoiceLang !== undefined ? newVoiceLang : voiceLang;
    const bot2Ch = newBot2ChannelId !== undefined ? newBot2ChannelId : bot2ChannelId;
    const autoTrans = newAutoTransferAtStart !== undefined ? newAutoTransferAtStart : autoTransferAtStart;
    
    const postBody = {
      warnings: updatedWarnings,
      voiceCountdown: updatedVoiceCountdown,
      timezone,
      voiceLang: lang,
      voiceStartText: newVoiceStartText !== undefined ? newVoiceStartText : voiceStartText,
      warningAudioOffsetSec: newWarningOffset !== undefined ? newWarningOffset : warningAudioOffsetSec,
      warningAudioFileName: newWarningFile !== undefined ? newWarningFile : warningAudioFileName,
      warningAudioVolume: newWarningVolume !== undefined ? newWarningVolume : warningAudioVolume,
      bot2ChannelId: bot2Ch,
      autoTransferAtStart: autoTrans
    };

    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody)
    }).catch(console.error);
  };

  const handleVoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uri = e.target.value;
    setSelectedVoice(uri);
    speech.setVoiceByUri(uri);
    try {
      localStorage.setItem('selectedVoiceUri', uri);
    } catch (e) {}
    speech.speak("Voice updated successfully.", 1.0, true);
    const v = voices.find(v => v.uri === uri);
    if (v) syncSettings(warnings, voiceCountdown, v.lang);
  };

  const handleDiscordConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!discordToken) return;
    setIsDiscordConnecting(true);
    fetch('/api/discord/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: discordToken })
    })
    .then(async res => {
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { return null; }
        if (!res.ok) throw new Error(data?.error || "Failed to connect");
        return data;
     })
    .then(data => {
       if (data && data.success) {
          fetchDiscordStatus();
       }
    })
    .catch(err => {
      console.error(err);
      showToast(`Failed to connect Bot 1: ${err.message}. If the server is restarting, please wait a moment.`, 'error');
    })
    .finally(() => setIsDiscordConnecting(false));
  };

  const handleDiscordDisconnect = () => {
    fetch('/api/discord/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(async res => {
      if (!res.ok) throw new Error("Failed to disconnect Bot 1");
      const data = await res.json();
      if (data && data.success) {
        setIsDiscordConnected(false);
        showToast("Discord Bot 1 stopped successfully.", "success");
      }
    })
    .catch(err => {
      console.error(err);
      showToast("Error during Bot 1 disconnection: " + String(err), "error");
    });
  };

  const handleDiscordConnect2 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!discordToken2) return;
    setIsDiscordConnecting2(true);
    fetch('/api/discord/connect2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: discordToken2 })
    })
    .then(async res => {
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { return null; }
        if (!res.ok) throw new Error(data?.error || "Failed to connect Bot 2");
        return data;
     })
    .then(data => {
       if (data && data.success) {
          fetchDiscordStatus();
       }
    })
    .catch(err => {
      console.error(err);
      showToast(`Failed to connect Bot 2: ${err.message}. If the server is restarting, please wait a moment.`, 'error');
    })
    .finally(() => setIsDiscordConnecting2(false));
  };

  const handleDiscordDisconnect2 = () => {
    fetch('/api/discord/disconnect2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(async res => {
      if (!res.ok) throw new Error("Failed to disconnect Bot 2");
      const data = await res.json();
      if (data && data.success) {
        setIsDiscordConnected2(false);
        showToast("Discord Bot 2 stopped successfully.", "success");
      }
    })
    .catch(err => {
      console.error(err);
      showToast("Error during Bot 2 disconnection: " + String(err), "error");
    });
  };

  const handleAudioUpload = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.mp3')) {
      showToast("Only MP3 audio files are permitted.", "error");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast("File is too large. Max size is 20MB.", "error");
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = (reader.result as string).split(',')[1];
      fetch('/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: base64Data })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showToast(`Successfully uploaded audio briefings code: ${data.fileName}`, "success");
          setWarningAudioFileName(data.fileName);
          fetchAudioFiles();
        } else {
          showToast(data.error || "Failed to upload audio briefing", "error");
        }
      })
      .catch(err => {
        console.error(err);
        showToast("Error upload transmission: check connections.", "error");
      })
      .finally(() => setIsUploading(false));
    };
    reader.readAsDataURL(file);
  };

  const handleEventTrigger = (event: ScheduledEvent) => {
    speech.speak(event.name + " is starting now.", 1.0, true);
    
    const now = new Date();
    setLogs(prev => [
      {
        id: crypto.randomUUID(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        msg: `Triggered: ${event.name}`
      },
      ...prev
    ].slice(0, 10)); // keep last 10
  };

  const {
    nextEvent,
    timeLeft,
    progress
  } = useSchedule(events, handleEventTrigger, voiceCountdown, warnings);

  const handleSubmitEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName || !newEventTime) return;

    if (editingId) {
        const updated = events.map(ev => 
            ev.id === editingId ? { ...ev, name: newEventName, time: newEventTime, channelIds: newEventChannelIds, days: newEventDays } : ev
        );
        syncSchedule(updated);
        setEditingId(null);
    } else {
        const newEv: ScheduledEvent = {
            id: crypto.randomUUID(),
            name: newEventName,
            time: newEventTime,
            enabled: true,
            channelIds: newEventChannelIds,
            days: newEventDays
        };
        syncSchedule([...events, newEv]);
    }
    setNewEventName('');
    setNewEventChannelIds([]);
    setNewEventDays([]);
  };

  const handleEdit = (ev: ScheduledEvent) => {
    setEditingId(ev.id);
    setNewEventName(ev.name);
    setNewEventTime(ev.time);
    setNewEventChannelIds(ev.channelIds || []);
    setNewEventDays(ev.days || []);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNewEventName('');
    setNewEventChannelIds([]);
    setNewEventDays([]);
  };

  const removeEvent = (id: string) => {
    syncSchedule(events.filter(ev => ev.id !== id));
  };

  const toggleEvent = (id: string) => {
    syncSchedule(events.map(ev => ev.id === id ? { ...ev, enabled: !ev.enabled } : ev));
  };

  const formatCountdownData = (seconds: number) => {
    if (seconds <= 0 || !nextEvent) return '--:--:--';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (d > 0) {
      return `${d}d ${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
    }
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#07090F] text-slate-300 font-sans selection:bg-rose-500/30 flex flex-col p-4 md:p-8">
      {/* Top Premium Status & Control Header */}
      <header className="max-w-6xl w-full mx-auto mb-8 flex flex-col md:flex-row md:items-center md:justify-between border-b border-rose-950/20 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold uppercase tracking-[0.2em] text-white">
              MAFIA SECRETARY
            </h1>
          </div>
          {/* Subtitle removed per user request */}
        </div>

        {/* Live Manila Time Status */}
        <div className="bg-[#111522] border border-rose-950/30 rounded-2xl px-5 py-3 flex items-center gap-4 shadow-lg shadow-rose-950/5">
          <div className="flex flex-col text-right">
            <div className="text-2xl font-bold font-mono tracking-wider text-rose-500 animate-pulse-slow">
              {liveManilaTime}
            </div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-medium">
              Asia/Manila (PHT) • {liveManilaDate}
            </div>
          </div>
          <div className="h-8 w-px bg-rose-950/40" />
          <div className="flex flex-col items-center justify-center">
            <Radio className="w-5 h-5 text-rose-500/80" />
            <span className="text-[9px] font-mono text-rose-400 uppercase tracking-widest mt-1">Live</span>
          </div>
        </div>
      </header>

      {/* Main Grid Bento Layout */}
      <main className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8">
        
        {/* Left Column: Chronology & Audio Briefings */}
        <div className="space-y-8">
          
          {/* Executive Chronometer Card */}
          <div className="relative overflow-hidden bg-gradient-to-b from-[#111522] to-[#0E1119] border border-rose-950/15 rounded-3xl p-8 flex flex-col items-center justify-center shadow-2xl ring-1 ring-white/5">
            {/* Ambient Red glow background */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-rose-500/5 rounded-full blur-[90px] pointer-events-none" />
            
            <div className="w-full flex justify-between items-center mb-6">
              <span className="text-xs font-mono uppercase tracking-widest text-slate-400 flex items-center gap-2 bg-rose-950/20 border border-rose-900/30 px-3 py-1 rounded-full">
                <Clock className="w-3.5 h-3.5 text-rose-500" /> Executive Chronometer
              </span>
              <button
                onClick={() => syncSettings(warnings, !voiceCountdown)}
                title={voiceCountdown ? 'Switch Voice countdown off' : 'Switch Voice countdown on'}
                className={`px-3 py-1.5 text-xs rounded-full border transition-all duration-300 flex items-center gap-1.5 font-mono ${
                  voiceCountdown 
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 font-semibold shadow-[0_0_15px_rgba(244,63,94,0.1)]' 
                    : 'bg-slate-900/80 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {voiceCountdown ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-rose-500" /> 10s Countdown: Engaged
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-slate-500" /> 10s Countdown: Silent
                  </>
                )}
              </button>
            </div>

            <p className="text-[11px] text-slate-500 uppercase tracking-[0.25em] font-mono mb-1">
              {nextEvent ? 'Target Briefing' : 'No Active Briefings'}
            </p>
            <h2 className="text-2xl font-bold text-white mb-8 text-center flex flex-col min-h-[4rem] justify-center">
              {nextEvent ? (
                <>
                  <span className="text-rose-400 font-mono tracking-wide">{nextEvent.name}</span>
                  <span className="text-xs font-mono font-medium text-slate-400 mt-2 uppercase flex items-center justify-center gap-1.5">
                    Trigger operations at <span className="text-rose-400 bg-rose-950/30 font-semibold px-2 py-0.5 rounded border border-rose-900/20">{format12Hour(nextEvent.time)}</span> Manila
                  </span>
                </>
              ) : (
                <span className="text-slate-600 font-mono text-lg">All systems standby</span>
              )}
            </h2>
            
            <CircularProgress 
              progress={progress} 
              size={340} 
              strokeWidth={7} 
              timeText={formatCountdownData(timeLeft)} 
              colorClass="text-rose-600"
            />
          </div>

          {/* Secure Comms & Wiretap Connection */}
          <div className="bg-[#111522] border border-rose-950/15 rounded-3xl p-6 shadow-xl ring-1 ring-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
            
            <div className="flex items-center gap-2 mb-4">
              <Bot className="w-5 h-5 text-indigo-400" />
              <h3 className="text-xs font-bold font-mono tracking-[0.15em] uppercase text-white">Dual Bot Comms Interface</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
              {/* Primary Bot Section */}
              <div className="bg-[#07090F]/50 border border-slate-800/40 p-4 rounded-2xl flex flex-col justify-between">
                <div>
                  <h4 className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-bold mb-3 flex items-center justify-between">
                    <span>Bot 1 (Main Reminders)</span>
                    <span className={`h-2 w-2 rounded-full ${isDiscordConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                  </h4>

                  {isDiscordConnected ? (
                    <div className="space-y-3">
                      <div className="text-emerald-400 font-semibold text-xs flex items-center gap-1.5 font-mono">
                        ONLINE & BOUND
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
                        Handles voice countdown warnings, TTS alerts, and custom sound milestones.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
                        Authorize Bot 1 with your Token to play countdowns and event reminders.
                      </p>
                      <form onSubmit={handleDiscordConnect} className="space-y-2">
                        <input 
                          type="password"
                          placeholder="Bot 1 Token..."
                          value={discordToken}
                          onChange={e => setDiscordToken(e.target.value)}
                          className="w-full bg-[#05060a] border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500/50 transition-all font-mono placeholder:text-slate-600"
                        />
                        <button 
                          type="submit"
                          disabled={isDiscordConnecting || !discordToken}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-semibold py-2 rounded-xl transition-all font-mono uppercase tracking-wider"
                        >
                          {isDiscordConnecting ? 'Connecting...' : 'Connect Bot 1'}
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {isDiscordConnected && (
                  <div className="mt-4 pt-3 border-t border-slate-800/40 flex flex-col gap-2">
                    {availableChannels.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-mono text-slate-500 uppercase">Voice Test Trigger</span>
                        <select 
                          className="bg-[#05060a] border border-slate-800 text-slate-300 text-[11px] rounded-xl px-2 py-1.5 outline-none cursor-pointer focus:border-indigo-500/50 transition-colors w-full font-mono"
                          onChange={e => {
                            const val = e.target.value;
                            if (val) {
                              const lang = voices.find(v => v.uri === selectedVoice)?.lang || 'en';
                              fetch('/api/discord/test', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ channelId: val, lang: lang })
                              }).then(async res => {
                                const data = await res.json();
                                if (!res.ok) showToast("Failed: " + data.error, "error");
                                else showToast(data.message, "success");
                              }).catch(err => {
                                console.error(err);
                                showToast("Test voice failed", "error");
                              });
                            }
                          }}
                        >
                          <option value="">-- Choose Channel to Test --</option>
                          {availableChannels.map(c => (
                            <option key={c.id} value={c.id}>{c.guildName} — {c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleDiscordDisconnect}
                      className="text-[10px] text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 py-1.5 rounded-xl transition-all font-bold font-mono"
                    >
                      Disconnect Bot 1
                    </button>
                  </div>
                )}
              </div>

              {/* Secondary Bot Section */}
              <div className="bg-[#07090F]/50 border border-slate-800/40 p-4 rounded-2xl flex flex-col justify-between">
                <div>
                  <h4 className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-bold mb-3 flex items-center justify-between">
                    <span>Bot 2 (Dedicated Target)</span>
                    <span className={`h-2 w-2 rounded-full ${isDiscordConnected2 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                  </h4>

                  {isDiscordConnected2 ? (
                    <div className="space-y-3">
                      <div className="text-emerald-400 font-semibold text-xs flex items-center gap-1.5 font-mono">
                        ONLINE & ACTIVE
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
                        Joins specific target channel only. Leaves automatically 5 minutes after event starts. TTS disabled to prevent overlap.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
                        Connect Bot 2 to announce godfather audio and execute smart auto-transfers.
                      </p>
                      <form onSubmit={handleDiscordConnect2} className="space-y-2">
                        <input 
                          type="password"
                          placeholder="Bot 2 Token..."
                          value={discordToken2}
                          onChange={e => setDiscordToken2(e.target.value)}
                          className="w-full bg-[#05060a] border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500/50 transition-all font-mono placeholder:text-slate-600"
                        />
                        <button 
                          type="submit"
                          disabled={isDiscordConnecting2 || !discordToken2}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-semibold py-2 rounded-xl transition-all font-mono uppercase tracking-wider"
                        >
                          {isDiscordConnecting2 ? 'Connecting...' : 'Connect Bot 2'}
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {isDiscordConnected2 && (
                  <div className="mt-4 pt-3 border-t border-slate-800/40 flex flex-col gap-2.5">
                    {/* Bot 2 Specific Settings */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-mono text-slate-500 uppercase">Target Voice Channel</span>
                      <select 
                        value={bot2ChannelId}
                        onChange={e => {
                          const val = e.target.value;
                          syncSettings(warnings, voiceCountdown, undefined, undefined, undefined, undefined, undefined, val, undefined);
                          showToast("Secondary bot target channel updated.", "success");
                        }}
                        className="bg-[#05060a] border border-slate-800 text-slate-300 text-[11px] rounded-xl px-2 py-1.5 outline-none cursor-pointer focus:border-indigo-500/50 transition-colors w-full font-mono"
                      >
                        <option value="">-- Select Voice Channel --</option>
                        {availableChannels.map(c => (
                          <option key={c.id} value={c.id}>{c.guildName} — {c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-2 py-1">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400">Auto Transfer at T-0</span>
                        <span className="text-[8px] text-slate-500">Moves all users to target channel</span>
                      </div>
                      <input 
                        type="checkbox"
                        checked={autoTransferAtStart}
                        onChange={e => {
                          const val = e.target.checked;
                          syncSettings(warnings, voiceCountdown, undefined, undefined, undefined, undefined, undefined, undefined, val);
                          showToast(val ? "Auto transfer engaged for T-0" : "Auto transfer disabled", "info");
                        }}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500/30 bg-[#05060a] border-slate-800 cursor-pointer"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={!bot2ChannelId}
                      onClick={() => {
                        fetch('/api/discord/transfer', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ channelId: bot2ChannelId })
                        })
                        .then(async res => {
                          const data = await res.json();
                          if (res.ok && data.success) {
                            showToast(`Successfully transferred members! Moved: ${data.movedCount}`, "success");
                          } else {
                            showToast("Transfer failed: " + (data.error || "no users found in other voice channels"), "error");
                          }
                        })
                        .catch(err => {
                          console.error(err);
                          showToast("Transfer transmission error", "error");
                        });
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 bg-emerald-950/20 hover:bg-emerald-950/40 border border-emerald-900/30 py-1.5 rounded-xl transition-all font-bold font-mono uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ⚡ Force Transfer All Here
                    </button>

                    <button
                      type="button"
                      onClick={handleDiscordDisconnect2}
                      className="text-[10px] text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 py-1.5 rounded-xl transition-all font-bold font-mono"
                    >
                      Disconnect Bot 2
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Broadcast Briefing Settings Card */}
          <div className="bg-[#111522] border border-rose-950/15 rounded-3xl p-6 shadow-xl ring-1 ring-white/5 relative overflow-hidden mt-6">
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />
            
            <div className="flex items-center gap-2 mb-4">
              <Volume2 className="w-5 h-5 text-rose-500" />
              <h3 className="text-xs font-bold font-mono tracking-[0.15em] uppercase text-white">Broadcast Audio Settings</h3>
            </div>
            
            <div className="space-y-4 text-xs font-mono">
              {/* Feature 1: Custom Event Start Speech Text */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">
                  Event Start Announcement Text
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={voiceStartText} 
                    onChange={e => setVoiceStartText(e.target.value)} 
                    placeholder="Clear comms and chat and get that win." 
                    className="bg-[#07090F] border border-slate-800 text-slate-300 text-xs rounded-xl px-4 py-3 flex-1 outline-none focus:border-rose-500/45 transition-all font-mono placeholder:text-slate-600"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      syncSettings(warnings, voiceCountdown, undefined, voiceStartText, warningAudioOffsetSec, warningAudioFileName);
                      showToast("Speech announcement updated successfully", "success");
                    }}
                    className="bg-rose-950/40 hover:bg-rose-900/40 border border-rose-900/30 text-rose-400 font-semibold px-4 rounded-xl transition-all font-mono hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Generated as real-time voice speech when countdown is complete (T-0s).
                </p>
              </div>

              {/* Feature 2: Warning Countdown Offset */}
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">
                  Warning Audio Trigger Offset
                </label>
                <div className="flex gap-2 items-center">
                  <select
                    value={warningAudioOffsetSec}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      setWarningAudioOffsetSec(val);
                      syncSettings(warnings, voiceCountdown, undefined, voiceStartText, val, warningAudioFileName);
                      showToast(`Warning sound set to trigger at T-${val}s`, "success");
                    }}
                    className="bg-[#07090F] border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-3 flex-1 outline-none focus:border-rose-500/40 transition-colors cursor-pointer"
                  >
                    <option value="60">60 seconds before event (T-60s)</option>
                    <option value="45">45 seconds before event (T-45s)</option>
                    <option value="30">30 seconds before event (T-30s)</option>
                    <option value="20">20 seconds before event (T-20s)</option>
                    <option value="15">15 seconds before event (T-15s)</option>
                    <option value="10">10 seconds before event (T-10s)</option>
                    <option value="5">5 seconds before event (T-5s)</option>
                  </select>
                  
                  <div className="flex items-center gap-1.5 bg-[#07090F] px-3 py-3 border border-slate-800 rounded-xl leading-none">
                    <input
                      type="number"
                      min="1"
                      max="300"
                      value={warningAudioOffsetSec}
                      onChange={e => {
                        const val = parseInt(e.target.value) || 30;
                        setWarningAudioOffsetSec(val);
                        syncSettings(warnings, voiceCountdown, undefined, voiceStartText, val, warningAudioFileName);
                      }}
                      className="bg-transparent text-center border-none text-rose-400 text-xs w-10 outline-none p-0 font-mono"
                    />
                    <span className="text-slate-500 text-[10px]">secs</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  How many seconds before event start the warning soundtrack executes.
                </p>
              </div>

              {/* Feature 3: Warning Audio File Manage/Upload */}
              <div className="border-t border-rose-950/10 pt-4">
                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">
                  Select Custom Warning Sound
                </label>
                <div className="flex flex-col gap-2">
                  {availableAudioFiles.length > 0 ? (
                    <select
                      value={warningAudioFileName}
                      onChange={e => {
                        const val = e.target.value;
                        setWarningAudioFileName(val);
                        syncSettings(warnings, voiceCountdown, undefined, voiceStartText, warningAudioOffsetSec, val);
                        showToast(`Warning sound updated to: ${val}`, "success");
                      }}
                      className="bg-[#07090F] border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-3 outline-none focus:border-rose-500/40 transition-colors cursor-pointer font-mono"
                    >
                      {availableAudioFiles.map(file => (
                        <option key={file} value={file}>
                          📁 {file}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic">No custom audio files uploaded yet.</p>
                  )}

                  <div className="flex gap-3 items-center">
                    <label className="text-xs text-slate-400 font-mono">Vol: {warningAudioVolume}%</label>
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      value={warningAudioVolume} 
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setWarningAudioVolume(val);
                      }}
                      onMouseUp={e => {
                        const val = parseInt((e.target as HTMLInputElement).value);
                        syncSettings(warnings, voiceCountdown, undefined, voiceStartText, warningAudioOffsetSec, warningAudioFileName, val);
                        showToast(`Warning sound volume set to ${val}%`, "success");
                      }}
                      onTouchEnd={e => {
                        const val = parseInt((e.target as HTMLInputElement).value);
                        syncSettings(warnings, voiceCountdown, undefined, voiceStartText, warningAudioOffsetSec, warningAudioFileName, val);
                        showToast(`Warning sound volume set to ${val}%`, "success");
                      }}
                      className="flex-1 accent-rose-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Test Custom Warning Sound on Discord */}
                  {isDiscordConnected && availableChannels.length > 0 && (
                    <div className="mt-3 bg-[#07090F] p-3 rounded-2xl border border-rose-950/15 flex flex-col gap-2">
                      <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider block">Test warning volume on Discord</span>
                      <div className="flex gap-2">
                        <select 
                          id="test-warning-channel-select"
                          className="bg-[#0c0f1a] border border-slate-800 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 outline-none cursor-pointer focus:border-rose-500/40 transition-colors flex-1"
                          defaultValue=""
                        >
                          <option value="">-- Select Discord Channel --</option>
                          {availableChannels.map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.guildName})</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const selectEl = document.getElementById('test-warning-channel-select') as HTMLSelectElement;
                            const channelId = selectEl?.value;
                            if (!channelId) {
                              showToast("Please select a Discord voice channel first.", "error");
                              return;
                            }
                            fetch('/api/discord/test-warning-sound', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                channelId,
                                fileName: warningAudioFileName,
                                volume: warningAudioVolume
                              })
                            }).then(async res => {
                              const data = await res.json();
                              if (!res.ok) showToast("Test sound failed: " + data.error, "error");
                              else showToast("Playing custom warning sound on Discord...", "success");
                            }).catch(err => {
                              console.error(err);
                              showToast("Failed to run test warning sound.", "error");
                            });
                          }}
                          className="bg-rose-950/45 hover:bg-rose-950/70 border border-rose-900/40 text-rose-300 font-mono text-xs px-3 py-1.5 rounded-xl transition-all font-semibold active:scale-[0.98]"
                        >
                          🔊 Test Sound
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Drag & Drop Area */}
                  <div 
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('bg-rose-500/5', 'border-rose-500/30'); }}
                    onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove('bg-rose-500/5', 'border-rose-500/30'); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('bg-rose-500/5', 'border-rose-500/30');
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleAudioUpload(e.dataTransfer.files[0]);
                      }
                    }}
                    className="border border-dashed border-slate-800 rounded-2xl p-4 text-center cursor-pointer hover:bg-slate-900/40 hover:border-rose-500/10 transition-all flex flex-col items-center justify-center gap-1.5 group relative"
                  >
                    <input 
                      type="file" 
                      accept=".mp3"
                      disabled={isUploading}
                      onChange={e => {
                        if (e.target.files && e.target.files[0]) {
                          handleAudioUpload(e.target.files[0]);
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <Upload className={`w-5 h-5 ${isUploading ? 'text-rose-400 animate-bounce' : 'text-slate-600 group-hover:text-rose-400'} transition-colors`} />
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">
                      {isUploading ? 'Uploading Briefings...' : 'Drag & Drop MP3 File'}
                    </span>
                    <span className="text-[9px] text-slate-500 block">
                      or click to upload custom warning soundtrack (Max 20MB)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Operations Dispatch (Schedules, voice configurations, and logs) */}
        <div className="space-y-8 flex flex-col">
          
          {/* Dispatch Schedule Card */}
          <div className="bg-[#111522] border border-rose-950/15 rounded-3xl p-6 shadow-xl ring-1 ring-white/5 flex flex-col min-h-[500px]">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-rose-950/10">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-rose-500" />
                <div>
                  <h2 className="text-xs font-bold font-mono uppercase tracking-[0.15em] text-white">Operations Orders</h2>
                  <p className="text-[9px] font-mono text-slate-400 mt-0.5">Timezone Bound: Asia/Manila (PHT)</p>
                </div>
              </div>
            </div>

            {/* Voice option selection */}
            {voiceCountdown && (
              <div className="mb-5 space-y-4">
                <div>
                  <label className="text-[10px] text-rose-500/80 uppercase tracking-widest font-bold font-mono block mb-1.5">Discord Voice Accent</label>
                  <select
                    value={voiceLang}
                    onChange={e => {
                      const val = e.target.value;
                      syncSettings(warnings, voiceCountdown, val);
                      showToast(`Discord accent updated to: ${val}`, "success");
                    }}
                    className="w-full bg-[#07090F] border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2.5 outline-none focus:border-rose-500/40 transition-colors cursor-pointer font-sans"
                  >
                    {DISCORD_VOICE_ACCENTS.map((acc) => (
                      <option key={acc.value} value={acc.value}>
                        {acc.label}
                      </option>
                    ))}
                  </select>
                </div>

                {voices.length > 0 && (
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold font-mono block mb-1.5">Local Browser Voice Override</label>
                    <select
                      value={selectedVoice}
                      onChange={handleVoiceChange}
                      className="w-full bg-[#07090F] border border-slate-800 text-slate-400 text-xs rounded-xl px-3 py-2 outline-none focus:border-rose-500/40 transition-colors cursor-pointer"
                    >
                      {voices.map((v, i) => (
                        <option key={i} value={v.uri}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Alert warnings milestones */}
            <div className="mb-6 flex flex-col gap-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold font-mono">Advance Wire Reminders</label>
              <div className="flex flex-wrap items-center gap-1.5 bg-[#07090F] p-2 rounded-2xl border border-rose-950/15">
                {warnings.map(w => (
                  <span key={w} className="bg-rose-950/20 border border-rose-900/40 text-rose-300 text-[10px] px-2.5 py-1 rounded-lg flex items-center gap-1 font-mono">
                    {w}m before
                    <button type="button" onClick={() => syncSettings(warnings.filter(x => x !== w), voiceCountdown)} className="hover:text-red-400 ml-1 transition-colors"><X className="w-3 h-3 text-rose-500/60 hover:text-rose-400" /></button>
                  </span>
                ))}
                
                <form 
                  onSubmit={e => {
                    e.preventDefault(); 
                    const val = parseInt(newWarning); 
                    if (!isNaN(val) && val > 0 && !warnings.includes(val)) {
                      syncSettings([...warnings, val].sort((a,b)=>b-a), voiceCountdown);
                    }
                    setNewWarning('');
                  }}
                  className="flex items-center gap-1 ml-1"
                >
                  <input 
                    type="number" min="1" max="120"
                    required
                    value={newWarning} onChange={e => setNewWarning(e.target.value)}
                    placeholder="+"
                    className="bg-transparent text-center border-none text-rose-400 text-xs w-8 outline-none focus:ring-0 font-mono"
                  />
                  <button type="submit" className="text-rose-400 hover:bg-rose-500/10 p-1 rounded-md transition-colors"><Plus className="w-3 h-3" /></button>
                </form>
              </div>
            </div>

            {/* Event Dispatch Cards List */}
            <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-2 mb-6 max-h-[350px]">
              {events.map(ev => (
                <div key={ev.id} className="flex items-center justify-between bg-[#07090F]/80 hover:bg-[#07090F] border border-slate-800/40 hover:border-rose-950/30 rounded-2xl p-4 transition-all duration-200">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => toggleEvent(ev.id)}
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-all duration-300 ${
                        ev.enabled 
                          ? 'bg-rose-600 border-rose-600 shadow-[0_0_10px_rgba(244,63,94,0.35)] text-white' 
                          : 'border-slate-700 bg-transparent hover:border-slate-500 text-transparent'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    </button>
                    <div className={`transition-opacity duration-300 ${ev.enabled ? 'opacity-100' : 'opacity-40'}`}>
                      <p className="text-sm font-bold text-white font-mono tracking-wide">{ev.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 font-mono">
                        <span className="text-rose-400 font-semibold">{format12Hour(ev.time)}</span>
                        {ev.days && ev.days.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-slate-400 font-mono">{ev.days.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => handleEdit(ev)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="Edit Operation"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => removeEvent(ev.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="Delete Operation"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <div className="text-center py-10 fill-stone-800">
                  <Flame className="w-8 h-8 mx-auto text-slate-700 stroke-[1.5] mb-2" />
                  <p className="text-xs text-slate-500 font-mono">No operations scheduled.</p>
                </div>
              )}
            </div>

            {/* Quick Add Form at Bottom */}
            <form onSubmit={handleSubmitEvent} className="flex flex-col gap-3 mt-auto pt-4 border-t border-rose-950/10">
              <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-rose-500 font-bold">
                {editingId ? 'Modify Dispatch Code' : 'Queue New Order'}
              </span>
              <div className="flex items-center gap-2">
                <input 
                  type="time" 
                  required
                  value={newEventTime}
                  onChange={(e) => setNewEventTime(e.target.value)}
                  className="bg-[#07090F] border border-slate-800 text-slate-300 text-sm rounded-xl px-3 py-3 w-28 outline-none focus:border-rose-500/40 transition-colors font-mono"
                />
                <input 
                  type="text" 
                  placeholder="Order Name (e.g. Boss Meeting)" 
                  required
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  className="bg-[#07090F] border border-slate-800 text-slate-300 text-sm rounded-xl px-4 py-3 flex-1 outline-none focus:border-rose-500/40 transition-colors placeholder:text-slate-600 font-mono text-white"
                />
                {editingId ? (
                  <div className="flex gap-1.5">
                    <button 
                      type="submit"
                      title="Save Order Changes"
                      className="bg-rose-600 hover:bg-rose-500 text-white p-3 rounded-xl transition-all shadow-md shadow-rose-950/35"
                    >
                      <Save className="w-5 h-5" />
                    </button>
                    <button 
                      type="button"
                      title="Cancel Edit"
                      onClick={cancelEdit}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-3 rounded-xl transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <button 
                    type="submit"
                    className="bg-rose-600 hover:bg-rose-500 text-white p-3 rounded-xl transition-all shadow-md shadow-rose-950/35 flex items-center justify-center font-semibold"
                    title="Queue Order"
                  >
                    <Plus className="w-5 h-5 text-white" />
                  </button>
                )}
              </div>
              
              {/* Day selection */}
              <div className="flex flex-wrap gap-1 items-center text-[10px] mt-1">
                <span className="text-slate-500 font-mono uppercase mr-2 font-semibold">Active Days:</span>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName, idx) => {
                  const isSelected = newEventDays.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (isSelected) setNewEventDays(prev => prev.filter(d => d !== idx));
                        else setNewEventDays(prev => [...prev, idx]);
                      }}
                      className={`px-2 py-1 rounded-lg border transition-all duration-200 font-mono text-[9px] ${
                        isSelected 
                          ? 'bg-rose-500/15 text-rose-400 border-rose-500/35 font-semibold shadow-[0_0_10px_rgba(244,63,94,0.05)]' 
                          : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {dayName}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setNewEventDays([])}
                  className={`px-2 py-1 rounded-lg border transition-all duration-200 font-mono text-[9px] ${
                    newEventDays.length === 0 
                      ? 'bg-rose-500/15 text-rose-400 border-rose-500/35 font-semibold' 
                      : 'bg-transparent border-slate-800 text-slate-500 hover:text-slate-400 hover:border-slate-700'
                  }`}
                >
                  Daily
                </button>
              </div>

              {/* Channel list multiselect */}
              {availableChannels.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-2 border-t border-rose-950/10 pt-3">
                  <span className="text-[10px] font-mono uppercase text-slate-500 font-semibold">Restrict to Channels:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {availableChannels.map(ch => {
                      const isSelected = newEventChannelIds.includes(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) setNewEventChannelIds(prev => prev.filter(id => id !== ch.id));
                            else setNewEventChannelIds(prev => [...prev, ch.id]);
                          }}
                          className={`px-2.5 py-1 rounded-lg border transition-all duration-200 font-mono text-[9px] ${
                            isSelected 
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/40 font-semibold' 
                              : 'bg-transparent border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {ch.guildName} — {ch.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Audit & Intelligence Logs Card */}
          <div className="bg-[#111522] border border-rose-950/15 rounded-3xl p-6 shadow-xl flex-1 max-h-[280px] ring-1 ring-white/5 flex flex-col">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-rose-950/10">
              <History className="w-5 h-5 text-rose-500" />
              <h2 className="text-xs font-bold font-mono uppercase tracking-[0.15em] text-white">Trigger History Log</h2>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2.5 custom-scrollbar">
              <AnimatePresence initial={false}>
                {logs.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full py-8 flex flex-col items-center justify-center text-slate-600 text-xs pb-6 font-mono"
                  >
                    <Terminal className="w-6 h-6 mb-2 text-slate-700 stroke-[1.5]" />
                    Standby. No transmissions registered.
                  </motion.div>
                ) : (
                  logs.map((log) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="flex items-start gap-3 bg-[#07090F]/90 p-3 rounded-xl border border-rose-950/10"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 mt-2 animate-pulse" />
                      <div className="flex-1">
                        <p className="text-xs text-slate-300 font-mono font-medium">{log.msg}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{log.time} Manila Time</p>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </main>

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 border shadow-2xl backdrop-blur-md max-w-sm rounded-2xl ${
              toast.type === 'error'
                ? 'bg-rose-950/85 border-rose-500/30 text-rose-200'
                : toast.type === 'success'
                ? 'bg-emerald-950/85 border-emerald-500/30 text-emerald-200'
                : 'bg-slate-900/90 border-slate-800 text-white'
            }`}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              toast.type === 'error' ? 'bg-rose-500 animate-pulse' : toast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-400'
            }`} />
            <p className="text-xs font-semibold leading-relaxed font-mono">{toast.message}</p>
            <button
              onClick={() => setToast(null)}
              className="ml-auto pl-2 text-slate-500 hover:text-white transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Styles overrides */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(244, 63, 94, 0.08);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(244, 63, 94, 0.2);
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
}

