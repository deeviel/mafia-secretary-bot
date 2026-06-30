import { useState, useEffect, useRef, useCallback } from 'react';
import { speech } from '../lib/speech';

export interface ScheduledEvent {
  id: string;
  name: string;
  time: string; // "HH:mm" in 24h format
  enabled: boolean;
  channelIds?: string[];
  bot2ChannelIds?: string[];
  days?: number[];
  autoTransferEnabled?: boolean;
  autoTransferDelayMins?: number;
  autoTransferType?: 'delay' | 'absolute';
  autoTransferTime?: string; // "HH:mm" in 24h format
}

export function useSchedule(
  events: ScheduledEvent[],
  onEventTrigger: (e: ScheduledEvent) => void,
  voiceCountdown: boolean,
  warnings: number[]
) {
  const [nextEvent, setNextEvent] = useState<ScheduledEvent | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [progress, setProgress] = useState(0);

  const targetTimeRef = useRef<number | null>(null);
  const initialDurationRef = useRef<number | null>(null);
  const lastSpokenRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const calculateUpcoming = useCallback(() => {
    if (events.length === 0) return null;
    const now = Date.now();
    let bestEvent: ScheduledEvent | null = null;
    let bestTime = Infinity;

    events.filter(e => e.enabled).forEach(e => {
       const [h, m] = e.time.split(':').map(Number);
       const d = new Date();
       d.setHours(h, m, 0, 0);
       let t = d.getTime();
       
       const currentDay = d.getDay();
       if (!e.days || e.days.length === 0) {
         // If it's already past for today, schedule for tomorrow
         if (t <= now) {
           t += 24 * 60 * 60 * 1000;
         }
       } else {
           if (e.days.includes(currentDay) && t > now) {
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

       if (t < bestTime) {
         bestTime = t;
         bestEvent = e;
       }
    });

    return bestEvent ? { event: bestEvent as ScheduledEvent, time: bestTime } : null;
  }, [events]);

  const updateIdleState = useCallback(() => {
    const upcoming = calculateUpcoming();
    if (upcoming) {
        setNextEvent(upcoming.event);
        targetTimeRef.current = upcoming.time;
        // Seed initial duration if null
        if (initialDurationRef.current === null) {
            initialDurationRef.current = upcoming.time - Date.now();
        }
        const msLeft = upcoming.time - Date.now();
        setTimeLeft(Math.ceil(Math.max(0, msLeft) / 1000));
    } else {
        setNextEvent(null);
        targetTimeRef.current = null;
        setTimeLeft(0);
        setProgress(0);
    }
  }, [calculateUpcoming]);

  const tick = useCallback(() => {
    if (!targetTimeRef.current || !nextEvent) {
      const upcoming = calculateUpcoming();
      if (!upcoming) {
         // Pause tick logic loop basically when there are no events.
         return;
      }
      setNextEvent(upcoming.event);
      targetTimeRef.current = upcoming.time;
      initialDurationRef.current = upcoming.time - Date.now();
      lastSpokenRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const now = Date.now();
    let msLeft = targetTimeRef.current - now;

    if (msLeft <= 0) {
      if (nextEvent) {
        onEventTrigger(nextEvent);
      }
      
      // Reset to find the next one
      setNextEvent(null);
      targetTimeRef.current = null;
      lastSpokenRef.current = null;
      setTimeLeft(0);
      setProgress(1); // flash full
      
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const secsLeft = Math.ceil(msLeft / 1000);
    setTimeLeft(secsLeft);

    const initD = initialDurationRef.current || 1;
    setProgress(1 - (msLeft / initD));

    if (voiceCountdown) {
      if (secsLeft === 12 && lastSpokenRef.current !== 12) {
        lastSpokenRef.current = 12;
        speech.speak(`${nextEvent.name} is starting in...`, 1.0, true);
      } else if (secsLeft <= 10 && secsLeft > 0 && lastSpokenRef.current !== secsLeft) {
        lastSpokenRef.current = secsLeft;
        speech.speak(secsLeft.toString(), 1.0, true);
      }
    }
    
    if (secsLeft % 60 === 0 && secsLeft > 0) {
      const minsLeft = Math.floor(secsLeft / 60);
      if (warnings.includes(minsLeft) && lastSpokenRef.current !== secsLeft) {
        lastSpokenRef.current = secsLeft;
        speech.speak(`The ${nextEvent.name} starts in ${minsLeft} minute${minsLeft > 1 ? 's' : ''}.`, 1.0, true);
      }
    }

    rafRef.current = requestAnimationFrame(tick);


  }, [nextEvent, calculateUpcoming, voiceCountdown, onEventTrigger]);

  // Recalculate if events change
  useEffect(() => {
    updateIdleState();
  }, [events, updateIdleState]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  return { nextEvent, timeLeft, progress };
}
