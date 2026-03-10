import { useState } from "react";
import { api } from "../api";

interface Document {
  document_id: string;
  document_type: string;
  filename: string;
  file_size_bytes: number;
  version?: number;
  created_at: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDocType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PolicyDocuments() {
  const [policyId, setPolicyId] = useState("");
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!policyId.trim()) return;
    setLoading(true);
    setError("");
    setDocuments(null);
    try {
      const data: any = await api.getPolicyDocuments(policyId.trim());
      setDocuments(data.documents ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Policy Documents</h2>
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          placeholder="Enter policy ID (e.g. POL-001)"
        />
        <button type="submit" disabled={loading || !policyId.trim()}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && <div className="error-msg">{error}</div>}

      {documents !== null && (
        documents.length === 0 ? (
          <div className="empty-state">No documents found for this policy.</div>
        ) : (
          <table className="doc-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Filename</th>
                <th>Version</th>
                <th>Size</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.document_id}>
                  <td>{formatDocType(doc.document_type)}</td>
                  <td>{doc.filename}</td>
                  <td>
                    {doc.version != null ? (
                      <span className="version-badge">v{doc.version}</span>
                    ) : (
                      <span style={{ color: "var(--summit-text-muted)" }}>--</span>
                    )}
                  </td>
                  <td>{formatBytes(doc.file_size_bytes)}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
