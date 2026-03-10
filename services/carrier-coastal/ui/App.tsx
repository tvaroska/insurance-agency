import { useState } from "react";
import Header from "./components/Header";
import QuickQuote from "./components/QuickQuote";
import CompareCustomize from "./components/CompareCustomize";
import BindAndGo from "./components/BindAndGo";

type Tab = "quote" | "compare" | "bind";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("quote");

  return (
    <div className="app">
      <Header />
      <nav className="tab-nav">
        <button
          className={activeTab === "quote" ? "active" : ""}
          onClick={() => setActiveTab("quote")}
        >
          Quick Quote
        </button>
        <button
          className={activeTab === "compare" ? "active" : ""}
          onClick={() => setActiveTab("compare")}
        >
          Compare &amp; Customize
        </button>
        <button
          className={activeTab === "bind" ? "active" : ""}
          onClick={() => setActiveTab("bind")}
        >
          Bind &amp; Go
        </button>
      </nav>
      <main className="content">
        {activeTab === "quote" && <QuickQuote />}
        {activeTab === "compare" && <CompareCustomize />}
        {activeTab === "bind" && <BindAndGo />}
      </main>
      <footer className="footer">
        Training Environment — Not for Production Use
      </footer>
    </div>
  );
}
