import ClueMedia from './ClueMedia';
import type { Question } from '@shared/types';
import { getYouTubeEmbedUrl } from '../../utils/media';

export default function ResponseMedia({ responseMediaType, responseMediaUrl, autoPlay = false, controlId }: Pick<Question, 'responseMediaType' | 'responseMediaUrl'> & { autoPlay?: boolean; controlId?: string }) {
  if (!responseMediaType || !responseMediaUrl) return null;
  if (controlId && responseMediaType !== 'image') {
    return <div className="mt-3"><ClueMedia mediaType={responseMediaType} mediaUrl={responseMediaUrl} paused={!autoPlay} hideVideo={false} controlId={controlId} /></div>;
  }
  if (responseMediaType === 'image') {
    return <img src={responseMediaUrl} alt="Correct answer" className="max-h-[50dvh] max-w-full object-contain rounded mx-auto mt-3" />;
  }
  if (responseMediaType === 'audio') {
    return <audio key={responseMediaUrl} src={responseMediaUrl} autoPlay={autoPlay} controls aria-label="Correct answer audio" className="w-full mt-3" />;
  }
  if (responseMediaType === 'video') {
    return <video key={responseMediaUrl} src={responseMediaUrl} autoPlay={autoPlay} controls className="max-h-[50dvh] w-full object-contain rounded mt-3" />;
  }
  if (responseMediaType === 'youtube') {
    const src = getYouTubeEmbedUrl(responseMediaUrl).replace('autoplay=1', `autoplay=${autoPlay ? 1 : 0}`);
    return (
      <div className="w-full aspect-video mt-3">
        <iframe key={src} title="Correct answer video" className="w-full h-full rounded" src={src} allow="autoplay; fullscreen" allowFullScreen />
      </div>
    );
  }
  return null;
}
