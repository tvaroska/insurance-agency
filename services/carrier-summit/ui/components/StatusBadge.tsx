const colors: Record<string, string> = {
  approved: "var(--status-approved)",
  declined: "var(--status-declined)",
  pending_review: "var(--status-pending)",
  referred: "var(--status-referred)",
  quoted: "var(--status-default)",
  active: "var(--status-approved)",
  bound: "var(--status-approved)",
  inspection_scheduled: "var(--status-inspection-scheduled)",
  inspection_complete: "var(--status-inspection-complete)",
  conditions_pending: "var(--status-conditions-pending)",
  submitted: "var(--summit-green)",
  under_review: "var(--status-referred)",
  documents_received: "var(--summit-green)",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="status-badge"
      style={{ backgroundColor: colors[status] || "var(--status-default)" }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
