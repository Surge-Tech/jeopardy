import { QRCodeSVG } from 'qrcode.react';

export default function PlayerJoinCode({ roomCode }: { roomCode: string }) {
  const playerUrl = `${window.location.origin}/buzz/${encodeURIComponent(roomCode)}`;
  return <section aria-label="Join game" className="flex flex-col items-center gap-5 text-center min-w-0">
    <h2 className="text-3xl md:text-5xl font-black text-jeopardy-gold">Scan to join</h2>
    <p className="text-2xl">Room <strong className="tracking-widest text-jeopardy-gold">{roomCode}</strong></p>
    <QRCodeSVG value={playerUrl} size={640} level="M" marginSize={4}
      title={`Scan to join room ${roomCode}`}
      className="max-w-full h-auto w-[min(36vh,400px)] flex-shrink-0" />
    <p className="text-lg text-gray-300">Connect to the same Wi-Fi, then scan with your phone camera.</p>
    <p className="text-sm md:text-base break-all text-gray-300">{playerUrl}</p>
  </section>;
}
