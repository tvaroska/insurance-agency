# Environment Blueprint: Evergreen Insurance Partners

**Company Profile:** A mid-sized, independent insurance brokerage specializing in Personal Lines — Auto, Home, and Umbrella.

---

## 1. Company Structure (The "Users")

A typical independent agency of this size has 10–12 employees. GenAI agents in this environment would likely interface with these roles:

| Role | Count | Focus |
|------|-------|-------|
| Agency Principal (Owner) | 1 | Carrier relationships and high-value account strategy |
| Producers (Sales) | 3 | Lead generation, networking, and "binding" new business |
| Customer Service Representatives (CSRs) | 5 | Renewals, policy changes (endorsements), certificates of insurance, billing questions |
| Claims Specialist | 1 | Coordinates between the client and the insurance carrier when a loss occurs |
| Office/Operations Manager | 1 | IT, HR, and agency accounting (commissions) |

---

## 2. Key Performance Indicators (KPIs)

To teach agents how to "think" like a business, you can use these target benchmarks for 2025–2026.

### Efficiency & Service

| KPI Category | Metric | Target | Why It Matters |
|-------------|--------|--------|----------------|
| Retention | Retention Rate | 90%–93% | If this drops, the agency is "leaking" revenue faster than it can sell |
| Sales | Quote-to-Bind Ratio | 25%–35% | Measures sales efficiency. If it's too low, agents are wasting time on bad leads |
| Productivity | Revenue per Employee | $175K–$225K | Essential for scaling. GenAI's goal is to push this higher without adding staff |
| Cross-Sell | Policies per Household | 2.5+ | Moving a client from just "Auto" to "Auto + Home + Umbrella" makes them much more "sticky" |
| Service | Average Response Time | < 4 Hours | Client satisfaction in insurance is highly correlated with speed of response |

### Scale & Size (The "Brag Sheet" Metrics)

| Metric | Typical Range (10–12 Staff) | Industry Context |
|--------|----------------------------|------------------|
| Policies Under Management (PUM) | 4,500–6,500 | Total active insurance contracts currently being serviced |
| Total Premium Volume | $12M–$18M | The total dollar amount of insurance sold (not the agency's profit) |
| Total Revenue (Commission) | $1.8M–$2.5M | Usually ~12–15% of Premium Volume. This pays the salaries and tech |
| Loss Ratio | < 45% | The ratio of claims paid vs. premium collected. Carriers love "clean" agencies |
| New Business Growth | 12%–15% YoY | Necessary to offset the natural "churn" of clients moving or passing away |

---

## 3. IT Systems & Data Sources

GenAI agents in this environment interact with a "Best-of-Breed" stack:

### A. Agency Management System (AMS)

- **Role:** The "Single Source of Truth." Holds client profiles, policy data, and ACORD forms.

### B. Comparative Raters

- **Role:** Multi-carrier quoting engine.

### C. Carrier Portals

- **Role:** Direct carrier sites (Coastal Star Insurance, Summit Fire & Casualty) for claims and underwriting details.

### D. Communication Hub (Email/VoIP)

- **Data:** Unstructured text and transcripts.

### E. CRM & Marketing Automation

- **Role:** Manages the "Top of Funnel" (Leads) and "Customer Journey."
- **Data:** Lead scores, email open rates, campaign tags (e.g., "Referral from Local Realtor").
- **Agent Task:** "Draft a personalized email to all clients who have Home insurance but no Auto, mentioning our new bundle discount."

### F. Document & Content Management (ECM)

- **Role:** Secure storage for signed applications, identity docs (Driver's Licenses), and marketing assets (brand guidelines, flyers).
- **Agent Task:** "Audit the 'Active Clients' folder to find any missing 'Signed Uninsured Motorist Selection' forms."

---

## 4. Example Use Cases for AI Agents

These illustrate the kinds of multi-service workflows an agent could perform in this environment. They are starting points for inspiration — the environment supports any workflow that touches the exposed APIs.

| Use Case | What an agent might do | Systems involved |
|----------|----------------------|------------------|
| **Cross-sell detection** | Notices a client calling about a claim has no life policy, initiates a quote | Comm Hub, AMS, CRM |
| **Coverage verification** | Checks if a client's auto/home coverages meet state minimums and lender requirements | ECM, AMS, Rater |
| **Retention re-shopping** | Finds policies increasing by >15% and pre-emptively quotes a cheaper carrier | AMS, Rater, CRM, Comm Hub |
| **Welcome kit automation** | Monitors CRM for new leads and sends the correct Welcome Kit from ECM | CRM, ECM, Comm Hub |
