import { useState } from "react";
import { api } from "../api";
import StatusBadge from "./StatusBadge";

interface Quote {
  quote_id: string;
  client_id: string;
  policy_type: string;
  premium_annual: number | null;
  status: string;
  underwriting_status: string;
  underwriting_notes: string | null;
  coverages: string[];
}

interface Condition {
  condition_id: string;
  description: string;
  status: string;
}

const TIMELINE_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "inspection_scheduled", label: "Inspection Scheduled" },
  { key: "inspection_complete", label: "Inspection Complete" },
  { key: "documents_received", label: "Documents Received" },
  { key: "under_review", label: "Under Review" },
  { key: "decision", label: "Decision" },
];

function getTimelineIndex(status: string): number {
  switch (status) {
    case "submitted":
      return 0;
    case "inspection_scheduled":
      return 1;
    case "inspection_complete":
      return 2;
    case "documents_received":
      return 3;
    case "pending_review":
    case "under_review":
      return 4;
    case "approved":
    case "declined":
    case "referred":
      return 5;
    default:
      return 0;
  }
}

export default function UnderwritingReview() {
  const [quoteId, setQuoteId] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!quoteId.trim()) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setQuote(null);
    setConditions([]);
    try {
      const data: any = await api.getQuote(quoteId.trim());
      const q = data.quote ?? data;
      setQuote(q);
      // Fetch conditions (may 404 if none exist, that's ok)
      try {
        const condData: any = await api.getConditions(quoteId.trim());
        setConditions(condData.conditions ?? []);
      } catch {
        setConditions([]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(decision: string) {
    if (!quote) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.submitDecision(quote.quote_id, decision, notes || undefined);
      setSuccess(`Quote ${quote.quote_id} has been ${decision}.`);
      const data: any = await api.getQuote(quote.quote_id);
      setQuote(data.quote ?? data);
      setNotes("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canDecide = quote && quote.underwriting_status === "pending_review";
  const timelineIndex = quote ? getTimelineIndex(quote.underwriting_status) : -1;

  return (
    <div>
      <div className="card">
        <h2>Underwriting Review</h2>
        <form className="search-bar" onSubmit={handleSearch}>
          <input
            type="text"
            value={quoteId}
            onChange={(e) => setQuoteId(e.target.value)}
            placeholder="Enter quote ID to review"
          />
          <button type="submit" disabled={loading || !quoteId.trim()}>
            {loading ? "Loading..." : "Look Up"}
          </button>
        </form>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}
      </div>

      {quote && (
        <>
          {/* Quote Info */}
          <div className="card">
            <h2>Quote Details</h2>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Quote ID</span>
                <span className="detail-value">{quote.quote_id}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Client ID</span>
                <span className="detail-value">{quote.client_id}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Policy Type</span>
                <span className="detail-value">{quote.policy_type}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Underwriting Status</span>
                <span className="detail-value">
                  <StatusBadge status={quote.underwriting_status} />
                </span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="card">
            <h2>Review Timeline</h2>
            <div className="timeline">
              {TIMELINE_STEPS.map((step, i) => {
                let cls = "timeline-item";
                if (i < timelineIndex) cls += " timeline-complete";
                else if (i === timelineIndex) cls += " timeline-active";
                else cls += " timeline-pending";
                return (
                  <div key={step.key} className={cls}>
                    <div className="timeline-dot" />
                    <div className="timeline-label">{step.label}</div>
                    {i < timelineIndex && (
                      <div className="timeline-date">Completed</div>
                    )}
                    {i === timelineIndex && (
                      <div className="timeline-date">Current</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Conditions */}
          {conditions.length > 0 && (
            <div className="card">
              <h2>Conditions</h2>
              <ul className="conditions-list">
                {conditions.map((cond) => (
                  <li key={cond.condition_id}>
                    <span
                      className={
                        "condition-status " +
                        (cond.status === "met"
                          ? "met"
                          : cond.status === "unmet"
                          ? "unmet"
                          : "pending")
                      }
                    />
                    <div>
                      <div>{cond.description}</div>
                      <div style={{ fontSize: 12, color: "var(--summit-text-muted)" }}>
                        Status: {cond.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decision Actions */}
          <div className="card">
            <h2>Decision</h2>
            {canDecide ? (
              <div className="decision-actions">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional underwriting notes..."
                />
                <button
                  className="btn btn-approve"
                  disabled={submitting}
                  onClick={() => handleDecision("approved")}
                >
                  Approve
                </button>
                <button
                  className="btn btn-decline"
                  disabled={submitting}
                  onClick={() => handleDecision("declined")}
                >
                  Decline
                </button>
                <button
                  className="btn btn-refer"
                  disabled={submitting}
                  onClick={() => handleDecision("referred")}
                >
                  Refer
                </button>
              </div>
            ) : (
              <p style={{ color: "var(--summit-text-muted)", fontSize: 14 }}>
                This quote has already been reviewed ({quote.underwriting_status}).
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
