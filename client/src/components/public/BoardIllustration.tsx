/** Product illustration: a standard board with a legal two-jump capture path. */
export function BoardIllustration({ title }: { title: string }) {
  const stones: [number, number, "white" | "black"][] = [
    [7, 11, "white"],
    [8, 10, "black"],
    [10, 8, "black"],
    [6, 8, "white"],
    [7, 7, "white"],
    [5, 9, "black"],
    [10, 11, "black"],
    [11, 12, "white"],
    [12, 10, "white"],
    [12, 6, "black"],
    [13, 7, "white"],
    [9, 5, "black"],
    [6, 12, "black"],
    [5, 6, "white"],
    [11, 5, "white"],
  ];
  return (
    <svg viewBox="0 0 660 660" role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id="hero-wood" x2="1" y2="1">
          <stop stopColor="#ead0a0" />
          <stop offset="1" stopColor="#c49a61" />
        </linearGradient>
        <radialGradient id="hero-white" cx="35%" cy="25%" r="75%">
          <stop stopColor="#fffdf5" />
          <stop offset="0.65" stopColor="#eee8d8" />
          <stop offset="1" stopColor="#bcb3a0" />
        </radialGradient>
        <radialGradient id="hero-black" cx="35%" cy="25%" r="75%">
          <stop stopColor="#555047" />
          <stop offset="0.6" stopColor="#29261f" />
          <stop offset="1" stopColor="#12120f" />
        </radialGradient>
        <filter id="hero-shadow" x="-30%" y="-30%" width="180%" height="180%">
          <feDropShadow dx="2" dy="4" stdDeviation="2.5" floodOpacity="0.25" />
        </filter>
      </defs>
      <rect x="8" y="8" width="644" height="644" rx="5" fill="url(#hero-wood)" />
      <g stroke="#705330" strokeWidth="0.9" opacity="0.65">
        {Array.from({ length: 19 }, (_, n) => 42 + n * 32).map((p) => (
          <g key={p}>
            <path d={`M42 ${p}H618`} />
            <path d={`M${p} 42V618`} />
          </g>
        ))}
      </g>
      {[3, 9, 15].flatMap((x) =>
        [3, 9, 15].map((y) => (
          <circle key={`${x}-${y}`} cx={42 + x * 32} cy={42 + y * 32} r="3.3" fill="#705330" />
        )),
      )}
      <path
        d="M266 394L330 330L394 266"
        fill="none"
        stroke="#943d2b"
        strokeWidth="2.5"
        strokeDasharray="5 6"
      />
      {[9, 11].map((x, i) => (
        <circle
          key={x}
          cx={42 + x * 32}
          cy={42 + (9 - i * 2) * 32}
          r="12"
          fill="none"
          stroke="#943d2b"
          strokeWidth="2"
        />
      ))}
      {stones.map(([x, y, color]) => (
        <circle
          key={`${x}-${y}`}
          cx={42 + x * 32}
          cy={42 + y * 32}
          r="14.5"
          fill={`url(#hero-${color})`}
          filter="url(#hero-shadow)"
        />
      ))}
    </svg>
  );
}
