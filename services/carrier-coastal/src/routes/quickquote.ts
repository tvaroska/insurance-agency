import { Hono } from "hono";
import {
  requireScopes,
  checkRequired,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { quotes } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const quickQuoteRouter = new Hono<{ Variables: AppVariables }>();

// ── VIN decode simulation ───────────────────────────────────────────

const VIN_MAKES: Record<string, { make: string; models: string[] }> = {
  "1HG": { make: "Honda", models: ["Civic", "Accord", "CR-V"] },
  "1FA": { make: "Ford", models: ["Mustang", "Fusion", "F-150"] },
  "1G1": { make: "Chevrolet", models: ["Malibu", "Equinox", "Silverado"] },
  "5YJ": { make: "Tesla", models: ["Model 3", "Model Y", "Model S"] },
  "WBA": { make: "BMW", models: ["3 Series", "5 Series", "X3"] },
  "JTD": { make: "Toyota", models: ["Camry", "RAV4", "Corolla"] },
};

function decodeVin(vin: string): { year: number; make: string; model: string } {
  const prefix = vin.substring(0, 3).toUpperCase();
  const entry = VIN_MAKES[prefix] || { make: "Generic", models: ["Sedan"] };

  // Year from character 10 (simplified)
  let hash = 0;
  for (let i = 0; i < vin.length; i++) {
    hash = (hash * 31 + vin.charCodeAt(i)) & 0x7fffffff;
  }
  const year = 2018 + (hash % 8); // 2018-2025
  const model = entry.models[hash % entry.models.length];

  return { year, make: entry.make, model };
}

function computeInstantPremium(vehicleYear: number, driverDob: string): {
  annual: number;
  semi_annual: number;
  monthly: number;
} {
  const vehicleAge = 2026 - vehicleYear;
  const driverAge = driverDob
    ? Math.floor((Date.now() - new Date(driverDob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 35;

  // Base rate
  let annual = 1200;

  // Vehicle age factor
  if (vehicleAge <= 2) annual *= 1.15;
  else if (vehicleAge <= 5) annual *= 1.0;
  else annual *= 0.9;

  // Driver age factor
  if (driverAge < 25) annual *= 1.4;
  else if (driverAge < 30) annual *= 1.15;
  else if (driverAge > 65) annual *= 1.1;

  annual = Math.round(annual * 100) / 100;

  return {
    annual,
    semi_annual: Math.round((annual * 0.52) * 100) / 100,
    monthly: Math.round((annual / 12) * 100) / 100,
  };
}

// POST /quotes/quick — Instant quote with VIN decode
quickQuoteRouter.post(
  "/quick",
  requireScopes("carrier:quotes:write"),
  async (c) => {
    const body = await c.req.json();

    throwIfErrors([
      checkRequired("vin", body.vin),
      checkRequired("client_id", body.client_id),
      checkRequired("driver_name", body.driver_name),
    ]);

    const now = new Date().toISOString();
    const quoteId = `QT-CSTL-${Date.now()}`;
    const requestId = `QR-${Date.now()}`;

    // Decode VIN
    const vehicle = decodeVin(body.vin);
    const premiums = computeInstantPremium(vehicle.year, body.driver_dob || "1990-01-01");

    // Generate risk assessment inline (speed-focused)
    const riskScore = 50 + Math.floor(Math.random() * 35);
    const riskTier = riskScore >= 75 ? "preferred" : riskScore >= 50 ? "standard" : "non_standard";
    const riskFactors = [
      { factor: "driver_age", impact: riskScore >= 60 ? "positive" : "neutral", detail: "Driver age assessment" },
      { factor: "vehicle_value", impact: "neutral", detail: `${vehicle.year} ${vehicle.make} ${vehicle.model}` },
      { factor: "claims_history", impact: "positive", detail: "No claims on file" },
    ];

    const defaultCoverages = [
      { type: "bodily_injury", limit: "100/300" },
      { type: "property_damage", limit: 50000 },
      { type: "collision", deductible: 500 },
      { type: "comprehensive", deductible: 250 },
      { type: "uninsured_motorist", limit: "100/300" },
    ];

    db.insert(quotes)
      .values({
        quote_id: quoteId,
        request_id: requestId,
        client_id: body.client_id,
        policy_type: "personal_auto",
        premium_annual: premiums.annual,
        premium_monthly: premiums.monthly,
        premium_semi_annual: premiums.semi_annual,
        coverages: JSON.stringify(defaultCoverages),
        deductibles: JSON.stringify({ collision: 500, comprehensive: 250 }),
        status: "assessed",
        submitted_at: now,
        risk_score: riskScore,
        risk_tier: riskTier,
        risk_factors: JSON.stringify(riskFactors),
        assessed_at: now,
        vin: body.vin,
        vehicle_year: vehicle.year,
        vehicle_make: vehicle.make,
        vehicle_model: vehicle.model,
        driver_name: body.driver_name,
        driver_dob: body.driver_dob || null,
        driver_license: body.driver_license || null,
        coverage_config: JSON.stringify(defaultCoverages),
      })
      .run();

    return c.json(
      {
        quote_id: quoteId,
        client_id: body.client_id,
        vehicle: { vin: body.vin, year: vehicle.year, make: vehicle.make, model: vehicle.model },
        premium: premiums,
        risk_score: riskScore,
        risk_tier: riskTier,
        coverages: defaultCoverages,
        status: "assessed",
        assessed_at: now,
      },
      201,
    );
  },
);

export { quickQuoteRouter };
