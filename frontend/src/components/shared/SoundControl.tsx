import { useEffect, useState } from 'react';
import { enableSounds } from '../../utils/sounds';

export default function SoundControl() {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    function removeListeners() {
      window.removeEventListener('click', handleInteraction, true);
      window.removeEventListener('keydown', handleInteraction, true);
    }

    async function handleInteraction() {
      try {
        await enableSounds();
        if (active) {
          setEnabled(true);
          removeListeners();
        }
      } catch {
        if (active) setError(true);
      }
    }

    window.addEventListener('click', handleInteraction, true);
    window.addEventListener('keydown', handleInteraction, true);
    return () => {
      active = false;
      removeListeners();
    };
  }, []);

  if (enabled) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[60] border-b border-amber-400/50 bg-amber-950 px-4 py-3 text-center text-sm font-medium text-amber-100 shadow-lg"
    >
      {error
        ? 'Sound could not start. Click anywhere or press any key on this board to try again.'
        : 'Sound is not enabled. Click anywhere or press any key on this board to enable it.'}
    </div>
  );
}
