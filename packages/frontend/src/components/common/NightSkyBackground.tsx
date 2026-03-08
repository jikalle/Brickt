import { useMemo, type CSSProperties, type ReactNode } from 'react';

const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 2 + 0.5,
  delay: Math.random() * 4,
  duration: Math.random() * 3 + 2,
}));

type RawBuilding = {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: 0 | 1;
};

type WindowDef = {
  id: string;
  x: number;
  y: number;
  lit: boolean;
  flicker: boolean;
  delay: number;
};

type BuildingWithWindows = RawBuilding & {
  windows: WindowDef[];
};

const RAW_BUILDINGS: RawBuilding[] = [
  { x: 0, y: 520, width: 60, height: 180, layer: 0 },
  { x: 55, y: 480, width: 45, height: 220, layer: 0 },
  { x: 95, y: 510, width: 70, height: 190, layer: 0 },
  { x: 160, y: 460, width: 55, height: 240, layer: 0 },
  { x: 210, y: 500, width: 40, height: 200, layer: 0 },
  { x: 245, y: 440, width: 65, height: 260, layer: 0 },
  { x: 305, y: 490, width: 50, height: 210, layer: 0 },
  { x: 350, y: 455, width: 80, height: 245, layer: 0 },
  { x: 425, y: 475, width: 45, height: 225, layer: 0 },
  { x: 465, y: 430, width: 60, height: 270, layer: 0 },
  { x: 520, y: 500, width: 55, height: 200, layer: 0 },
  { x: 570, y: 460, width: 70, height: 240, layer: 0 },
  { x: 635, y: 485, width: 45, height: 215, layer: 0 },
  { x: 675, y: 445, width: 65, height: 255, layer: 0 },
  { x: 735, y: 510, width: 50, height: 190, layer: 0 },
  { x: 780, y: 465, width: 75, height: 235, layer: 0 },
  { x: 850, y: 490, width: 55, height: 210, layer: 0 },
  { x: 900, y: 450, width: 60, height: 250, layer: 0 },
  { x: 955, y: 480, width: 45, height: 220, layer: 0 },
  { x: 995, y: 460, width: 70, height: 240, layer: 0 },
  { x: 1060, y: 505, width: 50, height: 195, layer: 0 },
  { x: 1105, y: 470, width: 65, height: 230, layer: 0 },
  { x: 1165, y: 490, width: 55, height: 210, layer: 0 },
  { x: 1215, y: 450, width: 80, height: 250, layer: 0 },
  { x: 1290, y: 480, width: 50, height: 220, layer: 0 },
  { x: 1335, y: 510, width: 60, height: 190, layer: 0 },
  { x: 1390, y: 465, width: 55, height: 235, layer: 0 },
  { x: 10, y: 490, width: 55, height: 210, layer: 1 },
  { x: 60, y: 430, width: 70, height: 270, layer: 1 },
  { x: 125, y: 460, width: 50, height: 240, layer: 1 },
  { x: 170, y: 390, width: 80, height: 310, layer: 1 },
  { x: 245, y: 420, width: 55, height: 280, layer: 1 },
  { x: 295, y: 450, width: 65, height: 250, layer: 1 },
  { x: 355, y: 380, width: 75, height: 320, layer: 1 },
  { x: 425, y: 440, width: 55, height: 260, layer: 1 },
  { x: 475, y: 400, width: 85, height: 300, layer: 1 },
  { x: 555, y: 445, width: 60, height: 255, layer: 1 },
  { x: 610, y: 415, width: 70, height: 285, layer: 1 },
  { x: 675, y: 375, width: 80, height: 325, layer: 1 },
  { x: 750, y: 440, width: 55, height: 260, layer: 1 },
  { x: 800, y: 405, width: 75, height: 295, layer: 1 },
  { x: 870, y: 430, width: 60, height: 270, layer: 1 },
  { x: 925, y: 385, width: 85, height: 315, layer: 1 },
  { x: 1005, y: 445, width: 55, height: 255, layer: 1 },
  { x: 1055, y: 410, width: 70, height: 290, layer: 1 },
  { x: 1120, y: 430, width: 60, height: 270, layer: 1 },
  { x: 1175, y: 380, width: 80, height: 320, layer: 1 },
  { x: 1250, y: 440, width: 55, height: 260, layer: 1 },
  { x: 1300, y: 415, width: 70, height: 285, layer: 1 },
  { x: 1365, y: 450, width: 60, height: 250, layer: 1 },
];

function useWindows(buildings: RawBuilding[]) {
  return useMemo<BuildingWithWindows[]>(() => {
    return buildings.map((b) => {
      const cols = Math.floor(b.width / 9);
      const rows = Math.floor(b.height / 12);
      const windows: WindowDef[] = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          windows.push({
            id: `${r}-${c}`,
            x: b.x + 5 + c * 9,
            y: b.y + 6 + r * 12,
            lit: Math.random() > 0.45,
            flicker: Math.random() > 0.85,
            delay: Math.random() * 5,
          });
        }
      }
      return { ...b, windows };
    });
  }, [buildings]);
}

function Skyline() {
  const buildings = useWindows(RAW_BUILDINGS);

  return (
    <svg
      viewBox="0 0 1440 700"
      preserveAspectRatio="xMidYMax slice"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        width: '100%',
        height: '75%',
        zIndex: 5,
      }}
    >
      <defs>
        <linearGradient id="bgBuilding" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d2f38" />
          <stop offset="100%" stopColor="#081e25" />
        </linearGradient>
        <linearGradient id="fgBuilding" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#071a22" />
          <stop offset="100%" stopColor="#040f14" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {buildings
        .filter((b) => b.layer === 0)
        .map((b, i) => (
          <g key={`bg-${i}`}>
            <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="url(#bgBuilding)" />
            {b.width > 60 && (
              <line
                x1={b.x + b.width / 2}
                y1={b.y}
                x2={b.x + b.width / 2}
                y2={b.y - 14}
                stroke="#0d2f38"
                strokeWidth="2"
              />
            )}
            {b.windows.map(
              (w) =>
                w.lit && (
                  <rect
                    key={w.id}
                    x={w.x}
                    y={w.y}
                    width={5}
                    height={7}
                    fill="#c8e88a"
                    opacity={0.25}
                    style={
                      w.flicker
                        ? {
                            animation: `flicker ${2 + w.delay}s ${w.delay}s ease-in-out infinite alternate`,
                          }
                        : {}
                    }
                  />
                )
            )}
          </g>
        ))}

      {buildings
        .filter((b) => b.layer === 1)
        .map((b, i) => (
          <g key={`fg-${i}`}>
            <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="url(#fgBuilding)" />
            {b.height > 280 && (
              <>
                <rect x={b.x + b.width / 2 - 3} y={b.y - 20} width={6} height={20} fill="#071a22" />
                <circle
                  cx={b.x + b.width / 2}
                  cy={b.y - 22}
                  r={3}
                  fill="#ff4444"
                  opacity={0.7}
                  style={{ animation: `blink 2s ${i * 0.4}s ease-in-out infinite alternate` }}
                />
              </>
            )}
            {b.windows.map(
              (w) =>
                w.lit && (
                  <rect
                    key={w.id}
                    x={w.x}
                    y={w.y}
                    width={5}
                    height={7}
                    fill="#d4f09a"
                    opacity={0.35}
                    style={
                      w.flicker
                        ? {
                            animation: `flicker ${2 + w.delay}s ${w.delay}s ease-in-out infinite alternate`,
                          }
                        : {}
                    }
                  />
                )
            )}
          </g>
        ))}

      <rect x={0} y={695} width={1440} height={10} fill="#040f14" />
    </svg>
  );
}

export default function NightSkyBackground({ children }: { children: ReactNode }) {
  return (
    <div style={styles.wrapper}>
      <div style={styles.sky} />

      <svg style={styles.starField} viewBox="0 0 100 100" preserveAspectRatio="none">
        {STARS.map((star) => (
          <circle
            key={star.id}
            cx={star.x}
            cy={star.y}
            r={star.size * 0.15}
            fill="white"
            style={{
              animation: `twinkle ${star.duration}s ${star.delay}s ease-in-out infinite alternate`,
              opacity: 0.6,
            }}
          />
        ))}
      </svg>

      <div style={styles.moonContainer}>
        <div style={styles.moon}>
          <div style={styles.moonInner} />
        </div>
        <div style={styles.moonGlow} />
      </div>

      <Skyline />
      <div style={styles.ground} />
      <div style={styles.fog} />

      <div style={styles.content}>{children}</div>

      <style>{`
        @keyframes twinkle {
          from { opacity: 0.2; transform: scale(0.8); }
          to   { opacity: 0.9; transform: scale(1.2); }
        }
        @keyframes moonFloat {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-12px); }
        }
        @keyframes glowPulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50%      { opacity: 0.28; transform: scale(1.08); }
        }
        @keyframes flicker {
          0%,100% { opacity: 0.35; }
          50%     { opacity: 0.1;  }
        }
        @keyframes blink {
          0%,100% { opacity: 0.7; }
          50%     { opacity: 0.1; }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    position: 'relative',
    width: '100%',
    minHeight: '100vh',
    overflow: 'hidden',
    fontFamily: "'Georgia', serif",
  },
  sky: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at 60% 30%, #1a3a3a 0%, #0e2a2a 40%, #061a1f 100%)',
  },
  starField: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  moonContainer: {
    position: 'absolute',
    top: '12%',
    left: '46%',
    transform: 'translateX(-50%)',
    animation: 'moonFloat 6s ease-in-out infinite',
  },
  moon: {
    position: 'relative',
    width: '90px',
    height: '90px',
    borderRadius: '50%',
    background: '#e8f0b0',
    boxShadow: '0 0 30px 6px rgba(220, 240, 140, 0.3)',
  },
  moonInner: {
    position: 'absolute',
    top: '-6px',
    left: '20px',
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: '#0e2a2a',
  },
  moonGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '160px',
    height: '160px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(220,240,140,0.2) 0%, transparent 70%)',
    animation: 'glowPulse 4s ease-in-out infinite',
    pointerEvents: 'none',
  },
  ground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '8%',
    background: '#040f14',
    zIndex: 6,
  },
  fog: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '30%',
    background:
      'linear-gradient(to top, rgba(4,15,20,0.75) 0%, rgba(6,20,28,0.3) 50%, transparent 100%)',
    pointerEvents: 'none',
    zIndex: 7,
  },
  content: {
    position: 'relative',
    zIndex: 10,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    color: '#d4e8c8',
  },
};
