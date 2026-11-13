export type MediaAction = 'play' | 'pause' | 'seek' | 'seekTo' | 'status';
export interface MediaCommand {
  mediaId: string;
  action: MediaAction;
  value?: number;
}

export interface MediaPlaybackStatus {
  mediaId: string;
  playing: boolean;
  currentTime?: number;
  duration?: number;
  playbackRate?: number;
}
