import React from 'react';
import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex justify-between items-center backdrop-blur-md bg-white/10 border-b border-white/20 shadow-lg">
      <div className="text-white text-xl font-bold tracking-wider">
        <Link href="/">Get Dev Team</Link>
      </div>
      <div>
        <Link 
          href="/login" 
          className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all duration-300 border border-white/20 hover:border-white/40 backdrop-blur-sm"
        >
          Sign In
        </Link>
      </div>
    </nav>
  );
}

