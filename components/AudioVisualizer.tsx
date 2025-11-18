import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  mode: 'listening' | 'speaking' | 'idle';
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, mode }) => {
  const bars = 5;
  
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`w-3 rounded-full transition-all duration-300 ease-in-out ${
            isActive 
              ? mode === 'speaking' 
                ? 'bg-indigo-500' 
                : 'bg-emerald-500'
              : 'bg-slate-300'
          }`}
          style={{
            height: isActive ? `${Math.random() * 100}%` : '20%',
            minHeight: '20%',
            animation: isActive ? `bounce ${0.5 + i * 0.1}s infinite alternate` : 'none'
          }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0% { height: 20%; }
          100% { height: 100%; }
        }
      `}</style>
    </div>
  );
};