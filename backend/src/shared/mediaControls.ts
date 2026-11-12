export type MediaAction = 'play' | 'pause' | 'seek' | 'status';
export interface MediaCommand {
  mediaId: string;
  action: MediaAction;
  value?: number;
}

export interface MediaPlaybackStatus {
  mediaId: string;
  playing: boolean;
}
