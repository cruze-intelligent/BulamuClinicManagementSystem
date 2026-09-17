const COMPANY_NAME = 'Cruze Intelligent Systems (U) Ltd';
const COMPANY_URL = process.env.NEXT_PUBLIC_COMPANY_URL;

// Renders as a link to the company site once NEXT_PUBLIC_COMPANY_URL is set;
// falls back to plain text so nothing breaks before that's configured.
export function CompanyName({ className }: { className?: string }) {
  if (!COMPANY_URL) return <span className={className}>{COMPANY_NAME}</span>;
  return (
    <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className={className}>
      {COMPANY_NAME}
    </a>
  );
}

export { COMPANY_NAME, COMPANY_URL };
