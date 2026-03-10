const colors: Record<string, string> = {
  approved: "var(--status-approved)",
  declined: "var(--status-declined)",
  pending_review: "var(--status-pending)",
  assessed: "var(--status-assessed)",
  quoted: "var(--status-default)",
  active: "var(--status-approved)",
  bound: "var(--status-bound)",
  unbound: "var(--status-default)",
  preferred: "var(--status-approved)",
  standard: "var(--status-assessed)",
  non_standard: "var(--status-declined)",
  instant_quoted: "var(--status-instant-quoted)",
  customized: "var(--status-customized)",
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
