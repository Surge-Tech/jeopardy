import { useRef, useState } from 'react';

export default function LoadingImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // A new URL gets its own state, including when an editor replaces an image.
  return <ImageWithStatus key={src} src={src} alt={alt} className={className} />;
}

function ImageWithStatus({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const imageRef = useRef<HTMLImageElement | null>(null);
  return <div className={`loading-image ${className ?? ''}`} data-status={status} aria-busy={status === 'loading'}>
    {status !== 'ready' && <div className="loading-image__status" role="status">
      {status === 'error' ? 'Image could not be loaded' : 'Loading image…'}
    </div>}
    <img ref={element => {
      imageRef.current = element;
      // Cached images may already be complete when attached.
      if (element?.complete && element.naturalWidth > 0) setStatus('ready');
    }} src={src} alt={alt} decoding="async"
      style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
      onLoad={async () => {
        const image = imageRef.current;
        // Decode before revealing to avoid a blank frame for large images.
        try { await image?.decode?.(); } catch { /* onLoad still confirms a usable image. */ }
        if (imageRef.current === image) setStatus('ready');
      }} onError={() => setStatus('error')} />
  </div>;
}
