import React from 'react';
import { ConnectionStatus } from '../types';
import { Mic, Square, Play, Settings2 } from 'lucide-react';

interface ControlsProps {
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  hasPermission: boolean;
}

export const Controls: React.FC<ControlsProps> = ({ status, onConnect, onDisconnect, hasPermission }) => {
  const isConnected = status === ConnectionStatus.CONNECTED;
  const isConnecting = status === ConnectionStatus.CONNECTING;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      
      {!isConnected && !isConnecting && (
        <button
          onClick={onConnect}
          disabled={!hasPermission}
          className={`group relative flex items-center justify-center w-20 h-20 rounded-full shadow-xl transition-all duration-300 ${
            hasPermission 
              ? 'bg-indigo-600 hover:bg-indigo-500 hover:scale-105 cursor-pointer' 
              : 'bg-slate-400 cursor-not-allowed'
          }`}
        >
          <div className="absolute inset-0 rounded-full border-2 border-white/20 group-hover:border-white/40 transition-colors" />
          <Mic className="w-8 h-8 text-white" />
        </button>
      )}

      {isConnecting && (
        <div className="flex flex-col items-center gap-3">
           <div className="w-16 h-16 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
           <span className="text-indigo-600 font-medium">Connecting to Examiner...</span>
        </div>
      )}

      {isConnected && (
        <button
          onClick={onDisconnect}
          className="flex items-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-full font-medium transition-colors shadow-lg"
        >
          <Square className="w-5 h-5 fill-current" />
          <span>End Session</span>
        </button>
      )}

      <div className="text-sm text-slate-500 text-center">
        {!hasPermission ? (
           <span className="text-amber-600 font-semibold">Please allow microphone access to start.</span>
        ) : status === ConnectionStatus.DISCONNECTED ? (
          "Tap microphone to start your IELTS speaking test"
        ) : status === ConnectionStatus.CONNECTED ? (
          "Session in progress. Speak naturally."
        ) : null}
      </div>
    </div>
  );
};