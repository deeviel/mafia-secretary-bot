import React from 'react';
import { motion } from 'motion/react';

interface CircularProgressProps {
  progress: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  timeText: string;
  colorClass?: string;
}

export function CircularProgress({ progress, size = 320, strokeWidth = 8, timeText, colorClass = "text-rose-600" }: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Background Circle */}
      <svg
        className="absolute inset-0 transform -rotate-90"
        width={size}
        height={size}
      >
        <circle
          stroke="rgba(255, 255, 255, 0.03)"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        {/* Animated Progress Circle */}
        <motion.circle
          stroke="currentColor"
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={colorClass}
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{ strokeDasharray: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.1, ease: 'linear' }} // Smooth updates for the tick
        />
      </svg>

      {/* Time Display */}
      <div className="absolute flex flex-col items-center justify-center font-mono">
        <span className="text-7xl font-bold tracking-tighter text-white">
          {timeText}
        </span>
      </div>
    </div>
  );
}
