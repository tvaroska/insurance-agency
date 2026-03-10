export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-logo">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            {/* Mountain peaks */}
            <polygon
              points="18,4 28,28 8,28"
              fill="#2d6a4f"
              stroke="#fff"
              strokeWidth="0.5"
            />
            <polygon
              points="10,12 18,28 2,28"
              fill="#1b4332"
              stroke="#fff"
              strokeWidth="0.5"
            />
            <polygon
              points="26,14 34,28 18,28"
              fill="#1b4332"
              stroke="#fff"
              strokeWidth="0.5"
            />
            {/* Snow caps */}
            <polygon points="18,4 21,10 15,10" fill="#fff" opacity="0.9" />
            <polygon points="10,12 12,16 8,16" fill="#fff" opacity="0.7" />
            <polygon points="26,14 28,18 24,18" fill="#fff" opacity="0.7" />
          </svg>
          <div>
            <div className="header-title">SUMMIT FIRE &amp; CASUALTY</div>
            <div className="header-subtitle">Property Portal</div>
          </div>
        </div>
      </div>
    </header>
  );
}
