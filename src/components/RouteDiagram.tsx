/**
 * The whole route in one picture, with sound dots travelling: DAW to a Multi-Output Device, which feeds your headphones
 * and the virtual cable; the cable feeds Play Your Line. The numbers are the four things to set. Colours come from the app.
 */
export function RouteDiagram() {
  return (
    <svg className="route-diagram" viewBox="0 0 760 250" role="img" aria-label="Sound goes from your DAW to your headphones and into a virtual cable, and from the cable into Play Your Line">
      <g fill="none" strokeWidth="2">
        <rect x="10" y="60" width="150" height="70" rx="10" stroke="var(--color-accent)" />
        <rect x="250" y="20" width="170" height="60" rx="10" stroke="var(--color-green)" />
        <rect x="250" y="110" width="170" height="60" rx="10" stroke="#ffb200" />
        <rect x="560" y="95" width="190" height="90" rx="10" stroke="var(--color-accent)" />
        <path d="M160 85 C 200 85 210 50 250 50" stroke="var(--color-green)" strokeDasharray="5 5" />
        <path d="M160 105 C 200 105 210 140 250 140" stroke="#ffb200" strokeDasharray="5 5" />
        <path d="M420 140 L 560 140" stroke="var(--color-accent)" strokeDasharray="5 5" />
      </g>
      <g textAnchor="middle" fill="var(--color-label)" fontSize="15" fontWeight="600">
        <text x="85" y="92">Your DAW</text>
        <text x="335" y="48">Headphones</text>
        <text x="335" y="138">Virtual cable</text>
        <text x="655" y="130">Play Your Line</text>
      </g>
      <g textAnchor="middle" fill="var(--color-label-secondary)" fontSize="12">
        <text x="85" y="112">output = Multi-Output</text>
        <text x="335" y="66">you hear the DAW</text>
        <text x="335" y="156">BlackHole or VB-Cable</text>
        <text x="655" y="150">input = the cable</text>
        <text x="655" y="168">output = your headphones</text>
      </g>
      <circle className="route-dot" cx="165" cy="140" r="5" fill="#ffb200" style={{ ["--d" as string]: "240px" }} />
      <circle className="route-dot" cx="420" cy="140" r="5" fill="var(--color-accent)" style={{ ["--d" as string]: "136px" }} />
      <circle className="route-dot late" cx="165" cy="85" r="5" fill="var(--color-green)" style={{ ["--d" as string]: "80px" }} />
      <g fontSize="12" fontWeight="700" textAnchor="middle">
        {[
          [85, 48, "1"],
          [335, 198, "2"],
          [655, 72, "3"],
          [655, 210, "4"],
        ].map(([x, y, n]) => (
          <g key={String(n)}>
            <circle cx={x} cy={y} r="12" fill="var(--color-accent)" />
            <text x={x} y={Number(y) + 4} fill="#fff">{n}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
