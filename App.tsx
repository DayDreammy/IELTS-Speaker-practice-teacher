import React, { useEffect, useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionStatus } from './types';
import { createPcmBlob, decode, decodeAudioData } from './utils/audioUtils';
import { AudioVisualizer } from './components/AudioVisualizer';
import { Controls } from './components/Controls';
import { Mic, BookOpen, Award, MessageCircle } from 'lucide-react';

// Extend Window interface to include webkitAudioContext for older browsers/Safari
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

const API_KEY = process.env.API_KEY || '';
const MODEL_ID = 'gemini-2.5-flash-native-audio-preview-09-2025';

// System instructions for the persona
const SYSTEM_INSTRUCTION = `
You are Mr. Sterling, a professional, polite, and British IELTS Speaking Examiner. 
Your goal is to conduct a realistic IELTS Speaking test with the user.

Structure of the session:
1. Introduction: Briefly introduce yourself and check the candidate's name.
2. Part 1 (Interview): Ask 3-4 short questions about familiar topics (e.g., work, study, hometown, hobbies). Keep it conversational but formal.
3. Part 2 (Long Turn): Give the candidate a topic card (simulate this by verbally describing the topic). Tell them they have 1 minute to think (you can offer to pause or just tell them to start when ready). Then listen to them for 1-2 minutes.
4. Part 3 (Discussion): Ask deeper, abstract questions related to the Part 2 topic.
5. Conclusion & Feedback: When the user says "Finish" or "End Test" or "Feedback", stop the roleplay immediately. Provide constructive feedback on their:
   - Fluency and Coherence
   - Lexical Resource (Vocabulary)
   - Grammatical Range and Accuracy
   - Pronunciation
   Give an estimated Band Score (0-9) based on their performance.

Tone: Formal, encouraging, but neutral. Do not interrupt the user unless they stop talking for a long time.
`;

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [hasPermission, setHasPermission] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  
  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  
  // Connection Refs
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Playback State
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    // Check permissions on mount
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        setHasPermission(true);
        stream.getTracks().forEach(track => track.stop()); // Stop immediately, just checking
      })
      .catch(() => {
        setHasPermission(false);
      });

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => session.close()).catch(() => {});
      sessionPromiseRef.current = null;
    }

    // Stop all scheduled audio
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    // Disconnect input
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Close contexts
    if (inputAudioContextRef.current?.state !== 'closed') {
      inputAudioContextRef.current?.close();
    }
    if (outputAudioContextRef.current?.state !== 'closed') {
      outputAudioContextRef.current?.close();
    }

    setStatus(ConnectionStatus.DISCONNECTED);
    setIsUserSpeaking(false);
    setIsAiSpeaking(false);
  }, []);

  const connect = async () => {
    if (!API_KEY) {
      alert('API Key is missing in environment variables');
      return;
    }

    try {
      setStatus(ConnectionStatus.CONNECTING);

      // 1. Initialize Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      
      outputNodeRef.current = outputAudioContextRef.current.createGain();
      outputNodeRef.current.connect(outputAudioContextRef.current.destination);

      // 2. Get User Media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. Setup GenAI Client
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      // 4. Connect to Live API
      sessionPromiseRef.current = ai.live.connect({
        model: MODEL_ID,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } // Kore is often clear and professional
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Session opened");
            setStatus(ConnectionStatus.CONNECTED);
            
            // Start streaming Input Audio
            if (!inputAudioContextRef.current || !streamRef.current) return;
            
            const inputCtx = inputAudioContextRef.current;
            inputSourceRef.current = inputCtx.createMediaStreamSource(streamRef.current);
            processorRef.current = inputCtx.createScriptProcessor(4096, 1, 1);
            
            processorRef.current.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple VAD for visualizer (threshold based)
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setIsUserSpeaking(rms > 0.02); // Visual feedback threshold

              const pcmBlob = createPcmBlob(inputData);
              
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };

            inputSourceRef.current.connect(processorRef.current);
            processorRef.current.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (base64Audio && outputAudioContextRef.current && outputNodeRef.current) {
              setIsAiSpeaking(true);
              const ctx = outputAudioContextRef.current;
              
              // Sync timing
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                ctx,
                24000,
                1
              );
              
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNodeRef.current);
              
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) {
                   setIsAiSpeaking(false);
                }
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              console.log("Interrupted");
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsAiSpeaking(false);
            }
          },
          onclose: () => {
            console.log("Session closed");
            setStatus(ConnectionStatus.DISCONNECTED);
          },
          onerror: (err) => {
            console.error("Session error", err);
            setStatus(ConnectionStatus.ERROR);
            cleanup();
          }
        }
      });

    } catch (e) {
      console.error(e);
      setStatus(ConnectionStatus.ERROR);
      cleanup();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600">
             <Award className="w-8 h-8" />
             <h1 className="text-xl font-bold tracking-tight">IELTS Tutor AI</h1>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-600">
            <span className="hidden md:inline-block px-3 py-1 bg-slate-100 rounded-full">Speaking Part 1-3</span>
            <a href="#" className="hover:text-indigo-600 transition-colors">Help</a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
        
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 p-8 flex flex-col items-center gap-8 relative z-0">
          
          {/* Visualizer Area */}
          <div className="w-full h-48 bg-slate-900 rounded-2xl flex items-center justify-center relative overflow-hidden">
            {/* Background Gradients */}
            <div className="absolute top-0 left-0 w-full h-full opacity-20 bg-[radial-gradient(circle_at_50%_50%,_var(--tw-gradient-stops))] from-indigo-500 via-slate-900 to-slate-900" />
            
            <div className="relative z-10 flex flex-col items-center gap-4">
               {status === ConnectionStatus.CONNECTED ? (
                 <>
                   <div className="flex items-center gap-8">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Examiner</span>
                        <AudioVisualizer isActive={isAiSpeaking} mode="speaking" />
                      </div>
                      <div className="w-px h-12 bg-slate-700" />
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">You</span>
                        <AudioVisualizer isActive={isUserSpeaking} mode="listening" />
                      </div>
                   </div>
                   <p className="text-indigo-200 text-sm animate-pulse mt-4">
                     {isAiSpeaking ? "Examiner is speaking..." : "Listening to you..."}
                   </p>
                 </>
               ) : (
                 <div className="text-slate-500 flex flex-col items-center">
                   <MessageCircle className="w-12 h-12 mb-2 opacity-20" />
                   <span>Ready to start session</span>
                 </div>
               )}
            </div>
          </div>

          {/* Interaction Area */}
          <div className="w-full flex flex-col items-center">
            <Controls 
              status={status} 
              onConnect={connect} 
              onDisconnect={cleanup}
              hasPermission={hasPermission}
            />
          </div>

        </div>

        {/* Tips Section */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full text-slate-600">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">Real Exam Topics</h3>
            <p className="text-sm leading-relaxed">Practices cover current IELTS topics from work and study to abstract social issues.</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center mb-4">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">Instant Analysis</h3>
            <p className="text-sm leading-relaxed">Say "Feedback" at the end to get a band score estimate and tips on grammar & pronunciation.</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center mb-4">
              <Award className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">Full Simulation</h3>
            <p className="text-sm leading-relaxed">Experience all 3 parts of the test in a single seamless session with our AI examiner.</p>
          </div>
        </div>

      </main>
    </div>
  );
}