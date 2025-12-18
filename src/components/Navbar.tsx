import React from 'react';
import Link from 'next/link';

export default function Navbar() {
  return (
    <nav
      className={[
        // Dynamic-island style: centered pill, not edge-to-edge
        "fixed left-1/2 top-4 z-50 -translate-x-1/2",
        "w-[min(92vw,980px)]",
        "rounded-full border border-white/15",
        "bg-white/10 backdrop-blur-md",
        "shadow-[0_20px_50px_-20px_rgba(0,0,0,0.65)]",
        "transition-all duration-300",
        "hover:bg-white/15 hover:border-white/25",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-7">
        <div className="text-white text-lg sm:text-xl font-semibold tracking-wide">
          <Link href="/" className="inline-flex items-center gap-2">
            Get Dev Team
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="px-4 py-2 text-white/90 hover:text-white rounded-full transition-colors duration-200 hover:bg-white/10"
          >
            Enter
          </Link>
        </div>
      </div>
    </nav>
  );
}

