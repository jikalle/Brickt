export default function Disclosures() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">Risk Disclosures</h1>
      <div className="space-y-4 text-gray-700 dark:text-gray-300">
        <p>
          Investments in tokenized real-estate offerings are speculative and can result in partial
          or total loss of capital.
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>No guaranteed returns. Profit distributions are not guaranteed.</li>
          <li>Liquidity may be limited and exits may be delayed or unavailable.</li>
          <li>Smart-contract, wallet, and network failures may cause losses.</li>
          <li>Regulatory and jurisdiction rules may restrict participation.</li>
          <li>Platform, protocol, and transaction fees reduce net outcomes.</li>
        </ul>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This page is a product-level summary. Full disclosure text is maintained in
          `docs/INVESTOR_DISCLOSURES.md` and must be legal-approved for production.
        </p>
      </div>
    </div>
  );
}
