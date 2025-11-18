export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface AudioStreamConfig {
  sampleRate: number;
}

export interface VisualizerData {
  volume: number; // 0-1
  active: boolean;
}