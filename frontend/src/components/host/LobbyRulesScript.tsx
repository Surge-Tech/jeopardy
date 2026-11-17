export default function LobbyRulesScript({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  return (
    <details open={initiallyOpen} className="rounded-xl border border-gray-700 bg-gray-900 p-5">
      <summary className="cursor-pointer text-xl font-bold text-jeopardy-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-jeopardy-gold">
        Rules introduction
      </summary>
      <p className="mt-2 text-xs text-gray-400">Read aloud before starting the game.</p>
      <div className="mt-4 space-y-4 text-base leading-relaxed text-gray-200">
        <p>Welcome, everyone! Now that you’re connected, keep your buzzer ready and watch the main screen.</p>
        <p>
          The aim is to earn points by answering clues correctly. A correct answer earns the clue’s value;
          a wrong answer loses that amount. If you buzz in, wait for the host to call on you before answering.
        </p>
        <p>
          <strong className="text-white">Watch for the on-screen signal and listen for the sound that tells you the buzzers are active.</strong>{' '}
          Pressing early triggers a short cooldown, so tapping repeatedly could cost you your chance!
        </p>
        <div>
          <p>Here’s when you can buzz:</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li><strong>Text clues:</strong> Once the clue has been read aloud.</li>
            <li><strong>Photo clues:</strong> Once the accompanying text has been read aloud.</li>
            <li><strong>Audio clues:</strong> From the start. Buzzing in stops the audio.</li>
            <li><strong>Video clues:</strong> From the start. Buzzing in stops and hides the video.</li>
          </ul>
        </div>
        <p>
          If someone answers incorrectly, the host must register that answer before buzzing reopens.
          Wait for the signal again!
        </p>
        <p>
          The contestant who answers correctly chooses the next clue. If nobody gets it right,
          the host will explain who chooses next.
        </p>
        <p>
          A <strong>Daily Double</strong> is just for the contestant who selected it.
          You’ll make a wager before seeing the clue, and the other contestants cannot buzz in.
          A correct answer wins your wager; a wrong answer loses it.
        </p>
        <p>
          For the <strong>Final Question</strong>, everyone makes a wager before the clue is revealed.
          You’ll then have a set amount of time to submit your answer privately—no buzzing or calling out.
          A correct answer wins your wager; a wrong answer loses it.
        </p>
        <p>
          In team mode, you share a score with your team. Your captain submits your team’s wagers
          and Final Question answer.
        </p>
        <p>
          Before we start, make sure your name is correct and your device stays connected.
          If you lose connection or have a technical problem, tell the host immediately.
        </p>
        <p className="font-bold text-white">Let’s test the buzzers—and then we’re ready to play!</p>
      </div>
    </details>
  );
}
