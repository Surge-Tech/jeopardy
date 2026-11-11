import { useState } from 'react';
import type { Question } from '@shared/types';
import { hostFetch } from '../../lib/hostAuth';

export default function MediaEditor({ label, mediaType, mediaUrl, onChange, onUploadingChange, disabled = false }: {
  disabled?: boolean;
  label: string;
  mediaType?: Question['mediaType'];
  mediaUrl?: string;
  onChange: (media: { mediaType?: Question['mediaType']; mediaUrl?: string }) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function upload(file: File) {
    setUploading(true);
    onUploadingChange?.(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await hostFetch('/api/media/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      onChange({ mediaType: data.mediaType, mediaUrl: data.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

  return (
    <fieldset disabled={uploading || disabled} className="space-y-2">
      <legend className="text-sm text-gray-400 mb-2">{label}</legend>
      <div className="flex gap-2 flex-wrap">
        <label className={`btn-ghost text-sm py-1 px-3 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
          {uploading ? 'Uploading...' : '📁 Upload Image/Video'}
          <input type="file" aria-label={`${label} upload`} className="hidden" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/ogg"
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
        </label>
        <button type="button" className="btn-ghost text-sm py-1 px-3" onClick={() => onChange({ mediaType: 'youtube', mediaUrl: '' })}>▶ YouTube URL</button>
        {mediaType && <button type="button" className="btn-danger text-sm py-1 px-3" onClick={() => onChange({ mediaType: undefined, mediaUrl: undefined })}>Remove Media</button>}
      </div>
      {mediaType === 'youtube' && <input aria-label={`${label} YouTube URL`} className="input-field" placeholder="https://www.youtube.com/watch?v=..." value={mediaUrl ?? ''} onChange={e => onChange({ mediaType, mediaUrl: e.target.value })} />}
      {mediaUrl && mediaType === 'image' && <img src={mediaUrl} alt={`${label} preview`} className="max-h-40 rounded border border-gray-600" />}
      {mediaUrl && mediaType === 'video' && <video key={mediaUrl} src={mediaUrl} controls className="max-h-40 rounded border border-gray-600 w-full" />}
      {mediaUrl && mediaType === 'youtube' && <p className="text-sm text-gray-400">YouTube video will be embedded during the game.</p>}
      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    </fieldset>
  );
}
