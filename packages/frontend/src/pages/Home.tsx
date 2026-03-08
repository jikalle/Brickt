import { Link } from 'react-router-dom';

// Inline SVG Icons
const ChevronRight = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const Building2 = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

const Lock = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const TrendingUp = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);

export default function Home() {
  return (
    <div className="overflow-hidden">
      <div>
        <div className="container mx-auto px-4 py-20 md:py-32">
          {/* Hero Section */}
          <div className="grid md:grid-cols-2 gap-12 items-center mb-32">
            <div className="space-y-6 animate-fade-in-up">
              <div className="inline-block">
                <span className="text-xs font-semibold tracking-widest text-emerald-400 uppercase bg-emerald-400/10 px-4 py-2 rounded-full border border-emerald-400/30">
                  Real Estate. On Chain.
                </span>
              </div>
              
              <h1 className="text-5xl md:text-7xl font-light tracking-tight text-white leading-tight">
                Invest in Real Estate.
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-emerald-400 to-blue-400"> Owned Transparently.</span>
              </h1>
              
              <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
                Own fractional shares of real estate assets with blockchain-verified ownership. Transparent, programmable payouts delivered in USDC.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Link
                  to="/properties"
                  className="group inline-flex items-center justify-center px-8 py-4 bg-emerald-600 text-white font-medium rounded-xl transition-all hover:bg-emerald-500 hover:shadow-2xl hover:shadow-emerald-500/20"
                >
                  <span className="flex items-center gap-2">
                    Browse Properties
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </Link>
                
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center px-8 py-4 bg-slate-800/50 text-white font-medium rounded-xl border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/80 transition-all backdrop-blur"
                >
                  Dashboard
                </Link>
              </div>
            </div>

            {/* Hero property showcase */}
            <div className="relative h-96 animate-fade-in-right hidden md:block md:translate-x-16">
              <div className="absolute inset-0 overflow-hidden rounded-2xl border border-slate-700/50 transform hover:scale-105 transition-transform duration-300">
                <img
                  src="https://images.unsplash.com/photo-1600607687644-c7171b42498f?auto=format&fit=crop&w=1800&q=80"
                  alt="Featured modern property"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/30 to-transparent p-8 flex flex-col justify-end">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                      Live Opportunities
                    </p>
                    <p className="text-2xl font-light text-white">Prime Homes on Base</p>
                    <p className="text-sm text-slate-200">Fractional access to premium real estate inventory.</p>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-4 -right-4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
            </div>
          </div>

          {/* Featured Homes */}
          <div className="mb-32">
            <div className="mb-6">
              <p className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">Featured Homes</p>
              <h2 className="mt-2 text-3xl md:text-4xl font-light text-white">What You Can Invest In</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  title: 'Oceanfront Villa',
                  location: 'Lekki, Lagos',
                  image:
                    'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=1600&q=80',
                },
                {
                  title: 'Urban Luxury Duplex',
                  location: 'Victoria Island, Lagos',
                  image:
                    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=80',
                },
                {
                  title: 'Modern Family Estate',
                  location: 'Abuja, FCT',
                  image:
                    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80',
                },
              ].map((home) => (
                <div
                  key={home.title}
                  className="group relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/60"
                >
                  <img
                    src={home.image}
                    alt={home.title}
                    className="h-56 w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-4">
                    <p className="text-base font-semibold text-white">{home.title}</p>
                    <p className="text-xs text-slate-200">{home.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Features Grid */}
          <div className="mb-32">
            <div className="mb-16">
              <h2 className="text-4xl md:text-5xl font-light text-white mb-4">
                Built for Modern Investing
              </h2>
              <div className="w-16 h-1 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full" />
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="group relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/30 to-emerald-500/30 rounded-2xl opacity-0 group-hover:opacity-100 blur transition duration-300" />
                <div className="relative rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8 h-full transition-all group-hover:border-slate-600">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-6">
                    <Lock className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-3">
                    Base Focused
                  </h3>
                  <p className="text-slate-400 leading-relaxed">
                    Built specifically for Base to keep UX and liquidity simple. Fast transactions and low costs.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="group relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/30 to-blue-500/30 rounded-2xl opacity-0 group-hover:opacity-100 blur transition duration-300" />
                <div className="relative rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8 h-full transition-all group-hover:border-slate-600">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-6">
                    <TrendingUp className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-3">
                    Stablecoin Payouts
                  </h3>
                  <p className="text-slate-400 leading-relaxed">
                    Use USDC for investments and receive transparent USDC profit distributions automatically.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="group relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/30 to-emerald-500/30 rounded-2xl opacity-0 group-hover:opacity-100 blur transition duration-300" />
                <div className="relative rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8 h-full transition-all group-hover:border-slate-600">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center mb-6">
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-3">
                    Fractional Ownership
                  </h3>
                  <p className="text-slate-400 leading-relaxed">
                    Own property tokens representing real shares in institutional-grade real estate assets.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Network Section */}
          <div className="mb-20">
            <div className="rounded-3xl overflow-hidden bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 backdrop-blur p-12">
              <h2 className="text-3xl font-light text-white mb-2">Supported Networks</h2>
              <p className="text-slate-400 mb-8">Deploy on the fastest, most reliable networks</p>
              
              <div className="grid md:grid-cols-2 gap-6">
                {/* Base Sepolia */}
                <div className="rounded-2xl bg-slate-900/80 border border-slate-700/50 p-8 relative overflow-hidden group cursor-pointer transition-all hover:border-slate-600">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 rounded-full blur-3xl group-hover:bg-yellow-500/20 transition" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-white">Base Sepolia</h4>
                      <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    </div>
                    <p className="text-slate-400 font-mono text-sm">USDC • ETH</p>
                    <p className="text-slate-500 text-xs mt-3">Testnet</p>
                  </div>
                </div>

                {/* Base Mainnet */}
                <div className="rounded-2xl bg-slate-900/80 border border-slate-700/50 p-8 relative overflow-hidden group cursor-pointer transition-all hover:border-slate-600">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-white">Base Mainnet</h4>
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    </div>
                    <p className="text-slate-400 font-mono text-sm">USDC • USDT • ETH</p>
                    <p className="text-slate-500 text-xs mt-3">Live</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-blue-500/20 via-emerald-500/10 to-blue-500/20 border border-slate-700/50 p-12 text-center">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950/20" />
            <div className="relative z-10 max-w-2xl mx-auto">
              <h3 className="text-4xl font-light text-white mb-4">
                Ready to diversify your portfolio?
              </h3>
              <p className="text-slate-300 mb-8">
                Join investors taking control of their real estate exposure on blockchain.
              </p>
              <Link
                to="/properties"
                className="inline-flex items-center justify-center px-8 py-4 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-500 hover:shadow-2xl hover:shadow-emerald-500/20 transition-all group"
              >
                Explore Properties
                <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Custom styles */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeInRight {
          from {
            opacity: 0;
            transform: translateX(30px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .animate-fade-in-up {
          animation: fadeInUp 0.8s ease-out forwards;
        }

        .animate-fade-in-right {
          animation: fadeInRight 0.8s ease-out forwards;
          animation-delay: 0.2s;
        }
      `}</style>
    </div>
  );
}
