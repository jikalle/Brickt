import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-16">
      {/* Hero Section */}
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
          Base-Native Real Estate Crowdfunding
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
          Invest in real estate on Base with transparent onchain ownership
        </p>
        <div className="flex justify-center gap-4">
          <Link
            to="/properties"
            className="bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 transition"
          >
            Browse Properties
          </Link>
          <Link
            to="/dashboard"
            className="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white px-8 py-3 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            Investor Dashboard
          </Link>
        </div>
      </div>

      <div className="mb-10 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
        Investing carries risk of partial or total loss. Review{' '}
        <Link to="/disclosures" className="underline font-medium">
          Risk Disclosures
        </Link>{' '}
        before participating.
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-3 gap-8 mb-16">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Base Focused</h3>
          <p className="text-gray-600 dark:text-gray-300">
            Built specifically for Base to keep UX and liquidity simple
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Multiple Tokens</h3>
          <p className="text-gray-600 dark:text-gray-300">
            Use USDC for investments and receive transparent USDC profit distributions
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Fractional Ownership</h3>
          <p className="text-gray-600 dark:text-gray-300">
            Own property tokens representing shares in real estate assets
          </p>
        </div>
      </div>

      {/* Supported Networks */}
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg">
        <h2 className="text-3xl font-bold mb-6 text-center text-gray-900 dark:text-white">
          Supported Network
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="text-center">
            <h4 className="font-bold text-lg mb-2 text-gray-900 dark:text-white">Base Sepolia</h4>
            <p className="text-gray-600 dark:text-gray-300">USDC, ETH</p>
          </div>
          <div className="text-center">
            <h4 className="font-bold text-lg mb-2 text-gray-900 dark:text-white">Base</h4>
            <p className="text-gray-600 dark:text-gray-300">USDC, USDT, ETH</p>
          </div>
        </div>
      </div>
    </div>
  );
}
