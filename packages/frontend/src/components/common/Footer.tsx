export default function Footer() {
  return (
    <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-auto">
      <div className="container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-3 gap-8">
          {/* About */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Homeshare</h3>
            <p className="text-gray-600 dark:text-gray-300">
              Base-native real estate crowdfunding platform
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <a href="/properties" className="text-gray-600 dark:text-gray-300 hover:text-primary-600">
                  Properties
                </a>
              </li>
              <li>
                <a href="/dashboard" className="text-gray-600 dark:text-gray-300 hover:text-primary-600">
                  Dashboard
                </a>
              </li>
              <li>
                <a href="/disclosures" className="text-gray-600 dark:text-gray-300 hover:text-primary-600">
                  Risk Disclosures
                </a>
              </li>
            </ul>
          </div>

          {/* Networks */}
          <div>
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Supported Networks</h3>
            <ul className="space-y-2">
              <li className="text-gray-600 dark:text-gray-300">Base Sepolia</li>
              <li className="text-gray-600 dark:text-gray-300">Base</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 text-center text-gray-600 dark:text-gray-300">
          <p>&copy; 2024 Homeshare. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
