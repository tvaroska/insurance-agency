import { useState } from "react";
import { api } from "../api";

interface FormData {
  // Step 1: Address
  street: string;
  city: string;
  state: string;
  zip: string;
  // Step 2: Property Details
  year_built: string;
  square_feet: string;
  construction_type: string;
  roof_type: string;
  roof_year: string;
  heating_type: string;
  // Step 3: Photo Checklist
  photos: Record<string, boolean>;
  // Step 4: Coverage Selection
  dwelling_limit: string;
  personal_property_limit: string;
  liability_limit: string;
  deductible: string;
}

const PHOTO_ITEMS = [
  { key: "front_exterior", label: "Front Exterior", desc: "Full front view of the property" },
  { key: "rear_exterior", label: "Rear Exterior", desc: "Full rear view of the property" },
  { key: "roof_view", label: "Roof View", desc: "Clear view of roof condition" },
  { key: "kitchen", label: "Kitchen", desc: "Kitchen area showing appliances" },
  { key: "bathroom", label: "Bathroom", desc: "Primary bathroom" },
  { key: "electrical_panel", label: "Electrical Panel", desc: "Main electrical panel with cover open" },
  { key: "hvac_system", label: "HVAC System", desc: "Heating and cooling equipment" },
];

const STEP_LABELS = ["Address", "Property Details", "Photo Checklist", "Coverage"];

const initialFormData: FormData = {
  street: "",
  city: "",
  state: "",
  zip: "",
  year_built: "",
  square_feet: "",
  construction_type: "",
  roof_type: "",
  roof_year: "",
  heating_type: "",
  photos: {},
  dwelling_limit: "",
  personal_property_limit: "",
  liability_limit: "",
  deductible: "",
};

export default function PropertySubmission() {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>({ ...initialFormData });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function updateField(field: keyof FormData, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function togglePhoto(key: string) {
    setFormData((prev) => ({
      ...prev,
      photos: { ...prev.photos, [key]: !prev.photos[key] },
    }));
  }

  function canAdvance(): boolean {
    switch (currentStep) {
      case 1:
        return !!(formData.street && formData.city && formData.state && formData.zip);
      case 2:
        return !!(formData.year_built && formData.square_feet && formData.construction_type && formData.roof_type);
      case 3:
        return true;
      case 4:
        return !!(formData.dwelling_limit && formData.deductible);
      default:
        return false;
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        address: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
        },
        property: {
          year_built: parseInt(formData.year_built, 10),
          square_feet: parseInt(formData.square_feet, 10),
          construction_type: formData.construction_type,
          roof_type: formData.roof_type,
          roof_year: formData.roof_year ? parseInt(formData.roof_year, 10) : undefined,
          heating_type: formData.heating_type || undefined,
        },
        photos: Object.keys(formData.photos).filter((k) => formData.photos[k]),
        coverage: {
          dwelling_limit: parseInt(formData.dwelling_limit, 10),
          personal_property_limit: formData.personal_property_limit
            ? parseInt(formData.personal_property_limit, 10)
            : undefined,
          liability_limit: formData.liability_limit
            ? parseInt(formData.liability_limit, 10)
            : undefined,
          deductible: parseInt(formData.deductible, 10),
        },
      };
      await api.submitProperty(payload);
      setSuccess("Property submission created successfully.");
      setFormData({ ...initialFormData });
      setCurrentStep(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function stepClass(step: number): string {
    if (step === currentStep) return "step step-active";
    if (step < currentStep) return "step step-complete";
    return "step step-pending";
  }

  return (
    <div className="card">
      <h2>Property Submission</h2>

      {/* Step Indicator */}
      <div className="step-indicator">
        {STEP_LABELS.map((label, i) => {
          const step = i + 1;
          return (
            <span key={step} style={{ display: "contents" }}>
              {i > 0 && (
                <span
                  className={
                    "step-connector" + (step <= currentStep ? " connector-complete" : "")
                  }
                />
              )}
              <span className={stepClass(step)}>
                <span className="step-number">
                  {step < currentStep ? "\u2713" : step}
                </span>
                <span className="step-label">{label}</span>
              </span>
            </span>
          );
        })}
      </div>

      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="success-msg" style={{ marginBottom: 16 }}>{success}</div>}

      {/* Step 1: Address */}
      {currentStep === 1 && (
        <div>
          <div className="form-group">
            <label>Street Address</label>
            <input
              type="text"
              value={formData.street}
              onChange={(e) => updateField("street", e.target.value)}
              placeholder="123 Main St"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => updateField("city", e.target.value)}
                placeholder="Denver"
              />
            </div>
            <div className="form-group">
              <label>State</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => updateField("state", e.target.value)}
                placeholder="CO"
                maxLength={2}
              />
            </div>
          </div>
          <div className="form-group">
            <label>ZIP Code</label>
            <input
              type="text"
              value={formData.zip}
              onChange={(e) => updateField("zip", e.target.value)}
              placeholder="80202"
              maxLength={10}
            />
          </div>
        </div>
      )}

      {/* Step 2: Property Details */}
      {currentStep === 2 && (
        <div>
          <div className="form-row">
            <div className="form-group">
              <label>Year Built</label>
              <input
                type="number"
                value={formData.year_built}
                onChange={(e) => updateField("year_built", e.target.value)}
                placeholder="1995"
              />
            </div>
            <div className="form-group">
              <label>Square Footage</label>
              <input
                type="number"
                value={formData.square_feet}
                onChange={(e) => updateField("square_feet", e.target.value)}
                placeholder="2400"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Construction Type</label>
              <select
                value={formData.construction_type}
                onChange={(e) => updateField("construction_type", e.target.value)}
              >
                <option value="">Select...</option>
                <option value="frame">Frame</option>
                <option value="masonry">Masonry</option>
                <option value="masonry_veneer">Masonry Veneer</option>
                <option value="fire_resistive">Fire Resistive</option>
                <option value="superior">Superior</option>
              </select>
            </div>
            <div className="form-group">
              <label>Roof Type</label>
              <select
                value={formData.roof_type}
                onChange={(e) => updateField("roof_type", e.target.value)}
              >
                <option value="">Select...</option>
                <option value="asphalt_shingle">Asphalt Shingle</option>
                <option value="metal">Metal</option>
                <option value="tile">Tile</option>
                <option value="slate">Slate</option>
                <option value="wood_shake">Wood Shake</option>
                <option value="flat_membrane">Flat / Membrane</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Roof Year</label>
              <input
                type="number"
                value={formData.roof_year}
                onChange={(e) => updateField("roof_year", e.target.value)}
                placeholder="2010"
              />
            </div>
            <div className="form-group">
              <label>Heating Type</label>
              <select
                value={formData.heating_type}
                onChange={(e) => updateField("heating_type", e.target.value)}
              >
                <option value="">Select...</option>
                <option value="forced_air">Forced Air</option>
                <option value="radiant">Radiant</option>
                <option value="heat_pump">Heat Pump</option>
                <option value="baseboard">Baseboard</option>
                <option value="wood_stove">Wood Stove</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Photo Checklist */}
      {currentStep === 3 && (
        <div>
          <p style={{ fontSize: 14, color: "var(--summit-text-muted)", marginBottom: 16 }}>
            Confirm that the following photos have been taken and are ready for upload.
          </p>
          <ul className="photo-checklist">
            {PHOTO_ITEMS.map((item) => (
              <li
                key={item.key}
                className={formData.photos[item.key] ? "checked" : ""}
                onClick={() => togglePhoto(item.key)}
              >
                <input
                  type="checkbox"
                  checked={!!formData.photos[item.key]}
                  onChange={() => togglePhoto(item.key)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="check-label">
                  <div>{item.label}</div>
                  <div className="check-desc">{item.desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Step 4: Coverage Selection */}
      {currentStep === 4 && (
        <div>
          <div className="form-row">
            <div className="form-group">
              <label>Dwelling Limit ($)</label>
              <input
                type="number"
                value={formData.dwelling_limit}
                onChange={(e) => updateField("dwelling_limit", e.target.value)}
                placeholder="350000"
              />
            </div>
            <div className="form-group">
              <label>Personal Property Limit ($)</label>
              <input
                type="number"
                value={formData.personal_property_limit}
                onChange={(e) => updateField("personal_property_limit", e.target.value)}
                placeholder="175000"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Liability Limit ($)</label>
              <input
                type="number"
                value={formData.liability_limit}
                onChange={(e) => updateField("liability_limit", e.target.value)}
                placeholder="300000"
              />
            </div>
            <div className="form-group">
              <label>Deductible ($)</label>
              <select
                value={formData.deductible}
                onChange={(e) => updateField("deductible", e.target.value)}
              >
                <option value="">Select...</option>
                <option value="500">$500</option>
                <option value="1000">$1,000</option>
                <option value="2500">$2,500</option>
                <option value="5000">$5,000</option>
                <option value="10000">$10,000</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="form-actions">
        {currentStep > 1 ? (
          <button
            className="btn btn-secondary"
            onClick={() => setCurrentStep((s) => s - 1)}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {currentStep < 4 ? (
          <button
            className="btn btn-primary"
            disabled={!canAdvance()}
            onClick={() => setCurrentStep((s) => s + 1)}
          >
            Next
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!canAdvance() || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "Submitting..." : "Submit Property"}
          </button>
        )}
      </div>
    </div>
  );
}
