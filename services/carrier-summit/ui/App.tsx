import { useState } from "react";
import Header from "./components/Header";
import PropertySubmission from "./components/PropertySubmission";
import UnderwritingReview from "./components/UnderwritingReview";
import PolicyDocuments from "./components/PolicyDocuments";

type Tab = "submission" | "underwriting" | "documents";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("submission");

  return (
    <div className="app">
      <Header />
      <nav className="tab-nav">
        <button
          className={activeTab === "submission" ? "active" : ""}
          onClick={() => setActiveTab("submission")}
        >
          Property Submission
        </button>
        <button
          className={activeTab === "underwriting" ? "active" : ""}
          onClick={() => setActiveTab("underwriting")}
        >
          Underwriting Review
        </button>
        <button
          className={activeTab === "documents" ? "active" : ""}
          onClick={() => setActiveTab("documents")}
        >
          Policy Documents
        </button>
      </nav>
      <main className="content">
        {activeTab === "submission" && <PropertySubmission />}
        {activeTab === "underwriting" && <UnderwritingReview />}
        {activeTab === "documents" && <PolicyDocuments />}
      </main>
      <footer className="footer">
        Training Environment — Not for Production Use
      </footer>
    </div>
  );
}
