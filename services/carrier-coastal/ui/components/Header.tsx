export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-logo">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="17" fill="#0d9488" />
            <path
              d="M4 20 Q9 14, 14 18 T24 16 T34 18"
              stroke="#fff"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M2 24 Q8 18, 14 22 T26 20 T36 22"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <div className="header-title">COASTAL STAR</div>
            <div className="header-subtitle">Auto Portal</div>
          </div>
        </div>
      </div>
    </header>
  );
}
