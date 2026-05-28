// Utility for text-to-speech functionality

export interface VoiceOption {
  uri: string;
  name: string;
  lang: string;
}

class SpeechService {
  private synth: SpeechSynthesis | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  public availableVoices: SpeechSynthesisVoice[] = [];
  public voicesLoaded: boolean = false;
  private listeners: (() => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      
      const loadVoices = () => {
        if (!this.synth) return;
        
        // Filter English and Tagalog/Filipino voices to support proper bilingual pronunciation accents
        this.availableVoices = this.synth.getVoices().filter(v => 
          v.lang.startsWith('en') || 
          v.lang.startsWith('tl') || 
          v.lang.startsWith('fil')
        );

        if (this.availableVoices.length > 0) {
          this.voicesLoaded = true;
          
          let savedUri = null;
          try {
            savedUri = localStorage.getItem('selectedVoiceUri');
          } catch (e) {}

          if (savedUri) {
            const matched = this.availableVoices.find(v => v.voiceURI === savedUri);
            if (matched) {
              this.voice = matched;
            }
          }

          if (!this.voice) {
            // Prefer a smooth voice if no stored preset
            this.voice = this.availableVoices.find(v => 
              v.name.includes('Google') || 
              v.name.includes('Samantha') || 
              v.name.includes('Tessa') ||
              v.lang.startsWith('tl') ||
              v.lang.startsWith('fil')
            ) || this.availableVoices[0];
          }
          
          this.listeners.forEach(cb => {
            try { cb(); } catch (e) {}
          });
        }
      };

      loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = loadVoices;
      }
    }
  }

  subscribe(cb: () => void) {
    this.listeners.push(cb);
    if (this.voicesLoaded) {
      try { cb(); } catch (e) {}
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  onVoicesLoaded(cb: () => void) {
    this.subscribe(cb);
  }

  getVoices(): VoiceOption[] {
    return this.availableVoices.map(v => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang
    }));
  }

  setVoiceByUri(uri: string) {
    const v = this.availableVoices.find(v => v.voiceURI === uri);
    if (v) this.voice = v;
  }

  getCurrentVoiceUri(): string | null {
    return this.voice ? this.voice.voiceURI : null;
  }

  speak(text: string, rate: number = 1.0, interrupt: boolean = true) {
    if (!this.synth) return;

    if (interrupt) {
      this.synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) {
      utterance.voice = this.voice;
    }
    utterance.rate = rate; // 1.0 is normal speed
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    this.synth.speak(utterance);
  }

  cancel() {
    if (this.synth) {
      this.synth.cancel();
    }
  }
}

export const speech = new SpeechService();
