const endpoints: [string, string][] = [
  ['GET /api/v1/projects', 'Projects with latest overview'],
  ['POST /api/v1/projects', 'Register a GitHub/GitLab repository'],
  ['GET /api/v1/projects/{id}', 'Overview, scores and trend'],
  ['POST /api/v1/projects/{id}/scans', 'Run a remote scan'],
  ['GET /api/v1/scans/{id}', 'Scan status and details'],
  ['GET /api/v1/scans/{id}/findings', 'Paginated findings'],
  ['POST /api/v1/scans/{id}/insights', 'AI insights']
];

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '56px 24px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>ProjectLens API</h1>
      <p style={{ color: '#9da7b3', marginTop: 0 }}>Remote analysis of code quality, security, progress and production readiness.</p>
      <p>
        Authenticate with <code>Authorization: Bearer &lt;api key&gt;</code>. Full specification:{' '}
        <a href="/api/v1/openapi.json" style={{ color: '#5ab0ff' }}>/api/v1/openapi.json</a>
      </p>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 24 }}>
        <tbody>
          {endpoints.map(([path, desc]) => (
            <tr key={path} style={{ borderBottom: '1px solid #26313d' }}>
              <td style={{ padding: '8px 12px 8px 0', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{path}</td>
              <td style={{ padding: 8, color: '#9da7b3' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
