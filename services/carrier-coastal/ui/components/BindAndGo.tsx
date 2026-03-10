import { useState } from "react";
import { api } from "../api";

interface BindResult {
  quote_id: string;
  policy_id: string;
  bind_status: string;
  effective_date: string;
  expiration_date: string;
  premium_annual: number;
  premium_semi_annual: number;
  premium_monthly: number;
  bound_at: string;
}

interface IdCardData {
  policy_id: string;
  carrier: string;
  insured_name: string;
  vehicle: string;
  effective_date: string;
  expiration_date: string;
  policy_type: string;
}

function formatCurrency(value: number | null): string {
  if (value == null) return "N/A";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BindAndGo() {
  const [quoteId, setQuoteId] = useState("");
  const [paymentPlan, setPaymentPlan] = useState("annual");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [result, setResult] = useState<BindResult | null>(null);
  const [idCard, setIdCard] = useState<IdCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Estimated prices for display - these would come from a prior quote lookup
  const estimatedAnnual = result?.premium_annual ?? null;
  const estimatedSemiAnnual = result?.premium_semi_annual ?? null;
  const estimatedMonthly = result?.premium_monthly ?? null;

  async function handleBind(e: React.FormEvent) {
    e.preventDefault();
    if (!quoteId.trim() || !effectiveDate) return;
    setLoading(true);
    setError("");
    setResult(null);
    setIdCard(null);
    try {
      const data = (await api.bindQuote(
        quoteId.trim(),
        effectiveDate,
        paymentPlan,
      )) as BindResult;
      setResult(data);

      // Fetch the ID card after successful bind
      try {
        const card = (await api.getIdCard(data.policy_id)) as IdCardData;
        setIdCard(card);
      } catch {
        // ID card fetch is optional; don't block on failure
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Bind &amp; Go</h2>

      <form onSubmit={handleBind}>
        <div className="form-group">
          <label>Quote ID</label>
          <input
            type="text"
            value={quoteId}
            onChange={(e) => setQuoteId(e.target.value)}
            placeholder="Enter quote ID to bind"
          />
        </div>

        <div className="form-group">
          <label>Effective Date</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>

        <div className="bind-card" style={{ marginTop: 8 }}>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label>Payment Plan</label>
          </div>
          <div className="payment-options">
            <div
              className={`payment-option ${paymentPlan === "annual" ? "selected" : ""}`}
              onClick={() => setPaymentPlan("annual")}
            >
              <div className="plan-name">Annual</div>
              <div className="plan-price">{estimatedAnnual ? formatCurrency(estimatedAnnual) : "--"}</div>
              <div className="plan-period">per year</div>
            </div>
            <div
              className={`payment-option ${paymentPlan === "semi_annual" ? "selected" : ""}`}
              onClick={() => setPaymentPlan("semi_annual")}
            >
              <div className="plan-name">Semi-Annual</div>
              <div className="plan-price">{estimatedSemiAnnual ? formatCurrency(estimatedSemiAnnual) : "--"}</div>
              <div className="plan-period">every 6 months</div>
            </div>
            <div
              className={`payment-option ${paymentPlan === "monthly" ? "selected" : ""}`}
              onClick={() => setPaymentPlan("monthly")}
            >
              <div className="plan-name">Monthly</div>
              <div className="plan-price">{estimatedMonthly ? formatCurrency(estimatedMonthly) : "--"}</div>
              <div className="plan-period">per month</div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-accent"
          disabled={loading || !quoteId.trim() || !effectiveDate}
          style={{ marginTop: 16, padding: "14px 32px", fontSize: 16, fontWeight: 700, width: "100%" }}
        >
          {loading ? "Binding..." : "Bind Now"}
        </button>
      </form>

      {error && <div className="error-msg" style={{ marginTop: 16 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 20 }}>
          <div className="success-msg">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              Policy bound successfully!
              <span className="instant-badge" style={{ marginLeft: 8 }}>Confirmed</span>
            </div>
            <div className="detail-grid" style={{ marginTop: 8 }}>
              <div className="detail-item">
                <span className="detail-label">Policy ID</span>
                <span className="detail-value">{result.policy_id}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Status</span>
                <span className="detail-value" style={{ textTransform: "capitalize" }}>{result.bind_status}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Effective Date</span>
                <span className="detail-value">{result.effective_date}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Expiration Date</span>
                <span className="detail-value">{result.expiration_date}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Bound At</span>
                <span className="detail-value">{new Date(result.bound_at).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Digital ID Card */}
          <div className="id-card">
            <div className="id-card-header">
              <div className="id-card-carrier">COASTAL STAR</div>
              <div className="id-card-type">Insurance ID Card</div>
            </div>
            <div className="id-card-body">
              <div className="id-card-field">
                <div className="id-card-field-label">Policy Number</div>
                <div className="id-card-field-value">{result.policy_id}</div>
              </div>
              <div className="id-card-field">
                <div className="id-card-field-label">Status</div>
                <div className="id-card-field-value" style={{ textTransform: "capitalize" }}>{result.bind_status}</div>
              </div>
              <div className="id-card-field">
                <div className="id-card-field-label">Effective</div>
                <div className="id-card-field-value">{result.effective_date}</div>
              </div>
              <div className="id-card-field">
                <div className="id-card-field-label">Expires</div>
                <div className="id-card-field-value">{result.expiration_date}</div>
              </div>
              {idCard && (
                <>
                  <div className="id-card-field full-width">
                    <div className="id-card-field-label">Insured</div>
                    <div className="id-card-field-value">{idCard.insured_name}</div>
                  </div>
                  <div className="id-card-field full-width">
                    <div className="id-card-field-label">Vehicle</div>
                    <div className="id-card-field-value">{idCard.vehicle}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
