export const TIAO_OG_SIZE = {
  width: 1200,
  height: 630,
};

type TiaoOgImageProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  meta?: string[];
};

const stones = [
  { x: 5, y: 4, color: "#f8f1e6" },
  { x: 6, y: 4, color: "#1f1711" },
  { x: 7, y: 5, color: "#f8f1e6" },
  { x: 8, y: 6, color: "#1f1711" },
  { x: 4, y: 7, color: "#1f1711" },
  { x: 5, y: 8, color: "#f8f1e6" },
  { x: 9, y: 8, color: "#1f1711" },
  { x: 10, y: 9, color: "#f8f1e6" },
];

function BoardPreview() {
  const lines = Array.from({ length: 13 }, (_, index) => index);

  return (
    <div
      style={{
        position: "relative",
        width: 384,
        height: 384,
        borderRadius: 28,
        background: "linear-gradient(135deg, #e7c98d 0%, #bc8650 100%)",
        boxShadow: "0 36px 80px rgba(47, 27, 12, 0.34)",
        border: "3px solid rgba(61, 37, 19, 0.5)",
      }}
    >
      {lines.map((line) => (
        <div
          key={`h-${line}`}
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            top: 36 + line * 26,
            height: 2,
            background: "rgba(60, 36, 18, 0.42)",
          }}
        />
      ))}
      {lines.map((line) => (
        <div
          key={`v-${line}`}
          style={{
            position: "absolute",
            top: 36,
            bottom: 36,
            left: 36 + line * 26,
            width: 2,
            background: "rgba(60, 36, 18, 0.42)",
          }}
        />
      ))}
      {stones.map((stone, index) => (
        <div
          key={`${stone.x}-${stone.y}-${index}`}
          style={{
            position: "absolute",
            left: 36 + stone.x * 26 - 13,
            top: 36 + stone.y * 26 - 13,
            width: 30,
            height: 30,
            borderRadius: 999,
            background: stone.color,
            border: stone.color === "#1f1711" ? "2px solid #0d0906" : "2px solid #fff9ef",
            boxShadow: "0 8px 16px rgba(33, 19, 10, 0.26)",
          }}
        />
      ))}
    </div>
  );
}

export function TiaoOgImage({ eyebrow, title, subtitle, meta = [] }: TiaoOgImageProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-between",
        padding: 54,
        background: "linear-gradient(135deg, #fff8ea 0%, #ecd2a4 48%, #9f6639 100%)",
        color: "#24170e",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 650 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 48,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 0,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 999,
              background: "#24170e",
              boxShadow: "inset -10px -12px 0 rgba(255,255,255,0.16)",
            }}
          />
          <span>Tiao</span>
        </div>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(36, 23, 14, 0.09)",
            color: "#5f3b20",
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 18,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: title.length > 38 ? 58 : 68,
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: 0,
            marginBottom: 24,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 30,
            lineHeight: 1.25,
            color: "#54361f",
            maxWidth: 610,
          }}
        >
          {subtitle}
        </div>
        {meta.length > 0 && (
          <div style={{ display: "flex", gap: 12, marginTop: "auto", flexWrap: "wrap" }}>
            {meta.slice(0, 3).map((item) => (
              <div
                key={item}
                style={{
                  padding: "10px 16px",
                  borderRadius: 999,
                  background: "rgba(255, 255, 255, 0.56)",
                  color: "#382312",
                  fontSize: 22,
                  fontWeight: 700,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
        <BoardPreview />
      </div>
    </div>
  );
}
