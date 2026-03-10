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
  premium_annual: number;
  premium_semi_annual: number;
  premium_monthly: number;
  vehicle: {
    vin: string;
    year: string;
    make: string;
    model: string;
  };
}

function formatCurrency(value: number | null): string {
  if (value == null) return "N/A";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Simple VIN decode simulation - extracts vehicle info from VIN structure
function decodeVin(vin: string): VehicleInfo {
  const makes: Record<string, string> = {
    "1": "Chevrolet", "2": "Ford", "3": "Toyota", "4": "Honda",
    "5": "Nissan", "J": "Toyota", "W": "BMW", "S": "Subaru",
  };
  const firstChar = vin.charAt(0).toUpperCase();
  const make = makes[firstChar] || "Honda";
  const yearCode = vin.charAt(9);
  const yearMap: Record<string, string> = {
    "L": "2020", "M": "2021", "N": "2022", "P": "2023",
    "R": "2024", "S": "2025", "T": "2026",
  };
  const year = yearMap[yearCode.toUpperCase()] || "2023";
  const models: Record<string, string[]> = {
    Chevrolet: ["Malibu", "Equinox", "Silverado"],
    Ford: ["Escape", "F-150", "Explorer"],
    Toyota: ["Camry", "RAV4", "Corolla"],
    Honda: ["Civic", "Accord", "CR-V"],
    Nissan: ["Altima", "Rogue", "Sentra"],
    BMW: ["3 Series", "X3", "X5"],
    Subaru: ["Outback", "Forester", "Crosstrek"],
  };
  const modelList = models[make] || ["Sedan"];
  const modelIdx = parseInt(vin.charAt(7) || "0", 36) % modelList.length;
  return { year, make, model: modelList[modelIdx] };
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
        license_number: licenseNumber.trim(),
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
            <div className="premium-amount">{formatCurrency(result.premium_annual)}</div>
            <div className="premium-label">Annual Premium</div>
            <div className="premium-breakdown">
              <div className="breakdown-item">
                <div className="breakdown-amount">{formatCurrency(result.premium_semi_annual)}</div>
                <div className="breakdown-label">Semi-Annual</div>
              </div>
              <div className="breakdown-item">
                <div className="breakdown-amount">{formatCurrency(result.premium_monthly)}</div>
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
