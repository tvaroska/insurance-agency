import { useState } from "react";
import { api } from "../api";

interface RecalcResult {
  quote_id: string;
  original_premium: number;
  adjusted_premium: number;
  coverages: {
    bodily_injury: string;
    property_damage: number;
    collision_deductible: number;
    comprehensive_deductible: number;
    uninsured_motorist: string;
  };
}

function formatCurrency(value: number | null): string {
  if (value == null) return "N/A";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CompareCustomize() {
  const [quoteId, setQuoteId] = useState("");
  const [bodilyInjury, setBodilyInjury] = useState("50/100");
  const [propertyDamage, setPropertyDamage] = useState(50000);
  const [collisionDeductible, setCollisionDeductible] = useState(500);
  const [comprehensiveDeductible, setComprehensiveDeductible] = useState(250);
  const [uninsuredMotorist, setUninsuredMotorist] = useState("50/100");
  const [result, setResult] = useState<RecalcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRecalculate(e: React.FormEvent) {
    e.preventDefault();
    if (!quoteId.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = (await api.recalculatePremium(quoteId.trim(), {
        bodily_injury: bodilyInjury,
        property_damage: propertyDamage,
        collision_deductible: collisionDeductible,
        comprehensive_deductible: comprehensiveDeductible,
        uninsured_motorist: uninsuredMotorist,
      })) as RecalcResult;
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const diff = result ? result.adjusted_premium - result.original_premium : 0;
  const diffSign = diff > 0 ? "+" : "";
  const diffColor = diff > 0 ? "var(--status-declined)" : diff < 0 ? "var(--status-approved)" : "var(--coastal-text-muted)";

  return (
    <div className="card">
      <h2>Compare &amp; Customize</h2>

      <form onSubmit={handleRecalculate}>
        <div className="search-bar">
          <input
            type="text"
            value={quoteId}
            onChange={(e) => setQuoteId(e.target.value)}
            placeholder="Enter quote ID to customize"
          />
        </div>

        <div className="coverage-slider-group">
          <div className="coverage-row">
            <label>Bodily Injury</label>
            <select value={bodilyInjury} onChange={(e) => setBodilyInjury(e.target.value)}>
              <option value="25/50">$25,000 / $50,000</option>
              <option value="50/100">$50,000 / $100,000</option>
              <option value="100/300">$100,000 / $300,000</option>
              <option value="250/500">$250,000 / $500,000</option>
              <option value="500/500">$500,000 / $500,000</option>
            </select>
          </div>

          <div className="coverage-row">
            <label>Property Damage</label>
            <select value={propertyDamage} onChange={(e) => setPropertyDamage(Number(e.target.value))}>
              <option value={25000}>$25,000</option>
              <option value={50000}>$50,000</option>
              <option value={100000}>$100,000</option>
              <option value={250000}>$250,000</option>
            </select>
          </div>

          <div className="coverage-row">
            <label>Collision Deductible</label>
            <select value={collisionDeductible} onChange={(e) => setCollisionDeductible(Number(e.target.value))}>
              <option value={250}>$250</option>
              <option value={500}>$500</option>
              <option value={1000}>$1,000</option>
              <option value={2500}>$2,500</option>
            </select>
          </div>

          <div className="coverage-row">
            <label>Comprehensive Deductible</label>
            <select value={comprehensiveDeductible} onChange={(e) => setComprehensiveDeductible(Number(e.target.value))}>
              <option value={100}>$100</option>
              <option value={250}>$250</option>
              <option value={500}>$500</option>
              <option value={1000}>$1,000</option>
            </select>
          </div>

          <div className="coverage-row">
            <label>Uninsured Motorist</label>
            <select value={uninsuredMotorist} onChange={(e) => setUninsuredMotorist(e.target.value)}>
              <option value="25/50">$25,000 / $50,000</option>
              <option value="50/100">$50,000 / $100,000</option>
              <option value="100/300">$100,000 / $300,000</option>
              <option value="250/500">$250,000 / $500,000</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !quoteId.trim()}
        >
          {loading ? "Recalculating..." : "Recalculate"}
        </button>
      </form>

      {error && <div className="error-msg" style={{ marginTop: 16 }}>{error}</div>}

      {result && (
        <div className="side-by-side">
          <div className="comparison-box original">
            <div className="comparison-label">Original Premium</div>
            <div className="comparison-amount">{formatCurrency(result.original_premium)}</div>
          </div>
          <div className="comparison-box adjusted">
            <div className="comparison-label">Adjusted Premium</div>
            <div className="comparison-amount">{formatCurrency(result.adjusted_premium)}</div>
            <div className="comparison-diff" style={{ color: diffColor }}>
              {diffSign}{formatCurrency(Math.abs(diff))} {diff > 0 ? "increase" : diff < 0 ? "savings" : "no change"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
