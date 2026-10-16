/** Decorative-only victory particles. No reward, score, or combat side effects. */
const SPARKS = [
  { x: 12, y: 58, delay: 0.06 },
  { x: 23, y: 34, delay: 0.22 },
  { x: 34, y: 75, delay: 0.15 },
  { x: 46, y: 21, delay: 0.38 },
  { x: 57, y: 54, delay: 0.05 },
  { x: 67, y: 28, delay: 0.27 },
  { x: 78, y: 64, delay: 0.33 },
  { x: 88, y: 41, delay: 0.17 },
];

export function VictorySparks() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
      <span className="arena-win-halo absolute -top-16 left-1/2 h-32 w-56 -translate-x-1/2 rounded-full bg-amber-300/20 blur-2xl" />
      {SPARKS.map(({ x, y, delay }, index) => (
        <span
          key={index}
          className="arena-win-spark absolute h-1.5 w-1.5 rotate-45 rounded-[1px] bg-amber-200 shadow-[0_0_9px_2px_rgba(251,191,36,0.85)]"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}
