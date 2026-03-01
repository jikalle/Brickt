import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchProperties, PropertyResponse } from '../lib/api';

export default function Properties() {
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadProperties = async () => {
      try {
        const data = await fetchProperties();
        if (isMounted) {
          setProperties(data);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage((error as Error).message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadProperties();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
        Property Listings
      </h1>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-6">
        <div className="grid md:grid-cols-4 gap-4">
          <select className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600">
            <option>Base Networks</option>
            <option>Base Sepolia</option>
            <option>Base Mainnet</option>
          </select>
          <input
            type="text"
            placeholder="Search properties..."
            className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
          />
          <select className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600">
            <option>All Status</option>
            <option>Draft</option>
            <option>Funding</option>
            <option>Funded</option>
          </select>
          <button className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700">
            Apply Filters
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-gray-600 dark:text-gray-300">Loading properties...</div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {errorMessage}
        </div>
      )}

      {!loading && !errorMessage && properties.length === 0 && (
        <div className="text-gray-600 dark:text-gray-300">No properties available yet.</div>
      )}

      {/* Property Grid */}
      <div className="grid md:grid-cols-3 gap-6">
        {properties.map((property) => (
          <div
            key={property.propertyId}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden"
          >
            <div className="h-48 bg-gray-300 dark:bg-gray-700"></div>
            <div className="p-6">
              <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">
                {property.name}
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                {property.description}
              </p>
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                Platform fee:{' '}
                {property.platformFeeBps === null
                  ? 'Not available'
                  : `${(property.platformFeeBps / 100).toFixed(2)}%`}
              </p>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  Target: ${(Number(property.targetUsdcBaseUnits) / 1_000_000).toLocaleString()} USDC
                </span>
                <Link
                  to={`/properties/${property.propertyId}`}
                  className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700"
                >
                  View Details
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
