/** Obuna tasdiqlandi: qisqa bayram overlay (ortiqcha emas) */
export default function LicenseCelebration() {
  const sparks = 18;
  const bursts = 6;
  return (
    <div className="license-celebration" aria-live="polite">
      <div className="license-celebration-sparks" aria-hidden="true">
        {Array.from({ length: sparks }, (_, i) => (
          <span key={i} className="license-celebration-spark" style={{ "--i": i }} />
        ))}
      </div>
      <div className="license-celebration-bursts" aria-hidden="true">
        {Array.from({ length: bursts }, (_, i) => (
          <span key={i} className="license-celebration-burst" style={{ "--b": i }} />
        ))}
      </div>
      <div className="license-celebration-inner">
        <div className="license-celebration-emoji-wrap">
          <span className="license-celebration-emoji" aria-hidden="true">
            🎉
          </span>
        </div>
        <h2 className="license-celebration-title">Tabriklaymiz!</h2>
        <p className="license-celebration-sub">Obunangiz tasdiqlandi. Xush kelibsiz!</p>
      </div>
    </div>
  );
}
