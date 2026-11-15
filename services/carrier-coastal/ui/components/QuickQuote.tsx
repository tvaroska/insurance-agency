import { useState } from "react";
import { api } from "../api";
import StatusBadge from "./StatusBadge";

interface VehicleInfo {
  year: string;
  make: string;
  model: string;
}

interface QuoteResult {
  quote_id: string;
  client_id: string;
  status: string;
  premium?: {
    annual: number;
    semi_annual: number;
    monthly: number;
  };
  premium_annual?: number;
  premium_semi_annual?: number;
  premium_monthly?: number;
  vehicle: {
    vin: string;
    year: string | number;
    make: string;
    model: string;
  };
}

function formatCurrency(value: number | null): string {
  if (value == null) return "N/A";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// VIN decode matching services/carrier-coastal/src/routes/quickquote.ts
function decodeVin(vin: string): VehicleInfo {
  const vinMakes: Record<string, { make: string; models: string[] }> = {
    "1HG": { make: "Honda", models: ["Civic", "Accord", "CR-V"] },
    "1FA": { make: "Ford", models: ["Mustang", "Fusion", "F-150"] },
    "1G1": { make: "Chevrolet", models: ["Malibu", "Equinox", "Silverado"] },
    "5YJ": { make: "Tesla", models: ["Model 3", "Model Y", "Model S"] },
    "WBA": { make: "BMW", models: ["3 Series", "5 Series", "X3"] },
    "JTD": { make: "Toyota", models: ["Camry", "RAV4", "Corolla"] },
  };
  const prefix = vin.substring(0, 3).toUpperCase();
  const entry = vinMakes[prefix] || { make: "Generic", models: ["Sedan"] };
  let hash = 0;
  for (let i = 0; i < vin.length; i++) {
    hash = (hash * 31 + vin.charCodeAt(i)) & 0x7fffffff;
  }
  const year = String(2018 + (hash % 8));
  const model = entry.models[hash % entry.models.length];
  return { year, make: entry.make, model };
}

export default function QuickQuote() {
  const [vin, setVin] = useState("");
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null);
  const [decoded, setDecoded] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [driverDob, setDriverDob] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [clientId, setClientId] = useState("");
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleDecode() {
    if (vin.trim().length < 5) return;
    const info = decodeVin(vin.trim());
    setVehicle(info);
    setDecoded(true);
  }

  async function handleGetQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!vin.trim() || !driverName.trim() || !driverDob || !licenseNumber.trim() || !clientId.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = (await api.quickQuote({
        vin: vin.trim(),
        driver_name: driverName.trim(),
        driver_dob: driverDob,
        driver_license: licenseNumber.trim(),
        client_id: clientId.trim(),
      })) as QuoteResult;
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Quick Quote</h2>
      <form className="quick-quote-form" onSubmit={handleGetQuote}>
        {/* VIN Lookup */}
        <div className="vin-lookup">
          <div className="form-group">
            <label>VIN</label>
            <input
              type="text"
              value={vin}
              onChange={(e) => { setVin(e.target.value); setDecoded(false); setVehicle(null); }}
              placeholder="Enter 17-character VIN"
              maxLength={17}
            />
          </div>
          <button type="button" onClick={handleDecode} disabled={vin.trim().length < 5}>
            Decode
          </button>
        </div>

        {/* Decoded Vehicle Info */}
        {decoded && vehicle && (
          <div className="detail-grid" style={{ padding: "12px 16px", background: "var(--coastal-sand)", borderRadius: 6 }}>
            <div className="detail-item">
              <span className="detail-label">Year</span>
              <span className="detail-value">{vehicle.year}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Make</span>
              <span className="detail-value">{vehicle.make}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Model</span>
              <span className="detail-value">{vehicle.model}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Status</span>
              <span className="detail-value">
                <span className="instant-badge">Decoded</span>
              </span>
            </div>
          </div>
        )}

        {/* Driver Info */}
        <div className="form-row">
          <div className="form-group">
            <label>Driver Name</label>
            <input
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Full legal name"
            />
          </div>
          <div className="form-group">
            <label>Date of Birth</label>
            <input
              type="date"
              value={driverDob}
              onChange={(e) => setDriverDob(e.target.value)}
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>License Number</label>
            <input
              type="text"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="Driver license number"
            />
          </div>
          <div className="form-group">
            <label>Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. CLIENT-001"
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !vin.trim() || !driverName.trim() || !driverDob || !licenseNumber.trim() || !clientId.trim()}
        >
          {loading ? "Quoting..." : "Get Quote"}
        </button>
      </form>

      {error && <div className="error-msg" style={{ marginTop: 16 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>Quote Result</h2>
            <StatusBadge status={result.status} />
          </div>

          <div className="premium-display">
            <div className="premium-amount">
              {formatCurrency(result.premium?.annual ?? result.premium_annual ?? null)}
            </div>
            <div className="premium-label">Annual Premium</div>
            <div className="premium-breakdown">
              <div className="breakdown-item">
                <div className="breakdown-amount">
                  {formatCurrency(result.premium?.semi_annual ?? result.premium_semi_annual ?? null)}
                </div>
                <div className="breakdown-label">Semi-Annual</div>
              </div>
              <div className="breakdown-item">
                <div className="breakdown-amount">
                  {formatCurrency(result.premium?.monthly ?? result.premium_monthly ?? null)}
                </div>
                <div className="breakdown-label">Monthly</div>
              </div>
            </div>
          </div>

          <div className="detail-grid" style={{ marginTop: 16 }}>
            <div className="detail-item">
              <span className="detail-label">Quote ID</span>
              <span className="detail-value">{result.quote_id}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Client ID</span>
              <span className="detail-value">{result.client_id}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
