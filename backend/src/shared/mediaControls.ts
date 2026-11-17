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
  error?: string;
}

export const SPEAKER_TEST_MEDIA_ID = 'lobby:speaker-test';
