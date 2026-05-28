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
  private onVoicesLoadedCallback: (() => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      
      const loadVoices = () => {
        if (!this.synth) return;
        this.availableVoices = this.synth.getVoices().filter(v => v.lang.startsWith('en'));
        if (this.availableVoices.length > 0) {
          this.voicesLoaded = true;
          if (!this.voice) {
            // Prefer a smooth english voice
            this.voice = this.availableVoices.find(v => v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Tessa')) || this.availableVoices[0];
          }
          if (this.onVoicesLoadedCallback) this.onVoicesLoadedCallback();
        }
      };

      loadVoices();
      if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = loadVoices;
      }
    }
  }

  onVoicesLoaded(cb: () => void) {
    if (this.voicesLoaded) {
      cb();
    } else {
      this.onVoicesLoadedCallback = cb;
    }
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
