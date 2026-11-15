import { useState } from 'react';
import type { FinalJeopardyBoard } from '@shared/types';
import MediaEditor from '../shared/MediaEditor';

export default function FinalJeopardyEditor({
  finalJeopardy, onSave, onRemove, onClose,
}: {
  finalJeopardy?: FinalJeopardyBoard;
  onSave: (fj: FinalJeopardyBoard) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(finalJeopardy?.category ?? '');
  const [clue, setClue] = useState(finalJeopardy?.clue ?? '');
  const [clueAudioUrl, setClueAudioUrl] = useState(finalJeopardy?.clueAudioUrl ?? '');
  const [response, setResponse] = useState(finalJeopardy?.response ?? '');
  const [mediaType, setMediaType] = useState<FinalJeopardyBoard['mediaType']>(finalJeopardy?.mediaType);
  const [mediaUrl, setMediaUrl] = useState(finalJeopardy?.mediaUrl ?? '');
  const [responseMediaType, setResponseMediaType] = useState<FinalJeopardyBoard['responseMediaType']>(finalJeopardy?.responseMediaType);
  const [responseMediaUrl, setResponseMediaUrl] = useState(finalJeopardy?.responseMediaUrl ?? '');
  const [timerSeconds, setTimerSeconds] = useState(finalJeopardy?.timerSeconds ?? 30);
  const [uploading, setUploading] = useState(false);

  function save() {
    onSave({
      category: category.trim(),
      clue,
      clueAudioUrl: clueAudioUrl || undefined,
      response,
      responseMediaType,
      responseMediaUrl: responseMediaUrl || undefined,
      mediaType,
      mediaUrl: mediaUrl || undefined,
      timerSeconds: Number(timerSeconds) || 30,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border-2 border-jeopardy-gold rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-jeopardy-gold">⚡ Final Jeopardy</h2>
          <button className="text-gray-400 hover:text-white text-2xl" onClick={onClose} disabled={uploading}>✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <input
              className="input-field"
              placeholder="e.g. WORLD CAPITALS"
              value={category}
              onChange={e => setCategory(e.target.value)}
            />
          </div>

          <fieldset className="rounded-lg border border-gray-700 bg-gray-800/30 p-4 space-y-3">
            <legend className="px-2 text-lg font-bold text-jeopardy-gold">Clue</legend>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Clue (shown to contestants)</label>
              <textarea
                className="input-field h-24 resize-none"
                placeholder="This is the Final Jeopardy clue..."
                value={clue}
                onChange={e => setClue(e.target.value)}
              />
            </div>
            <MediaEditor
              disabled={uploading}
              label="Clue media (optional)"
              mediaType={mediaType}
              mediaUrl={mediaUrl}
              onChange={media => { setMediaType(media.mediaType); setMediaUrl(media.mediaUrl ?? ''); }}
              onUploadingChange={setUploading}
            />
            <MediaEditor
              disabled={uploading}
              label="Clue recording (optional)"
              audioOnly
              mediaType={clueAudioUrl ? 'audio' : undefined}
              mediaUrl={clueAudioUrl}
              onChange={({ mediaUrl }) => setClueAudioUrl(mediaUrl ?? '')}
              onUploadingChange={setUploading}
            />
            <p className="text-sm text-gray-400">Plays when the clue is shown. Other clue audio and video wait until the recording finishes. Start the answer timer from the host when ready.</p>
          </fieldset>

          <fieldset className="rounded-lg border border-gray-700 bg-gray-800/30 p-4 space-y-3">
            <legend className="px-2 text-lg font-bold text-jeopardy-gold">Response</legend>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Response (correct answer)</label>
              <input
                className="input-field"
                placeholder="What is...?"
                value={response}
                onChange={e => setResponse(e.target.value)}
              />
            </div>
            <MediaEditor
              disabled={uploading}
              label="Response media (shown when the answer is revealed)"
              mediaType={responseMediaType}
              mediaUrl={responseMediaUrl}
              onChange={media => { setResponseMediaType(media.mediaType); setResponseMediaUrl(media.mediaUrl ?? ''); }}
              onUploadingChange={setUploading}
            />
          </fieldset>

          {/* Timer */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Answer timer (seconds)</label>
            <input
              type="number"
              min={5}
              max={300}
              className="input-field w-32"
              value={timerSeconds}
              onChange={e => setTimerSeconds(Number(e.target.value))}
            />
          </div>

        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-gray-700">
          {finalJeopardy ? (
            <button className="btn-danger text-sm" disabled={uploading} onClick={() => { onRemove(); onClose(); }}>Remove Final Jeopardy</button>
          ) : <div />}
          <button
            className="btn-primary"
            disabled={uploading || !category.trim() || !clue.trim()}
            onClick={save}
          >Save</button>
        </div>
      </div>
    </div>
  );
}
