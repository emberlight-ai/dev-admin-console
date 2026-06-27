'use client';

import Ballpit from '@/components/Ballpit';
import Navbar from '@/components/Navbar';

export default function Home() {
  return (
    <main className="w-full h-screen relative bg-black text-white overflow-hidden">
      <Navbar />

      <div className="absolute inset-0 z-0 pointer-events-none">
        <Ballpit
          count={280}
          gravity={0.01}
          friction={0.9975}
          wallBounce={0.8}
          followCursor={false}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center h-full pointer-events-none">
        <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-4 text-center mix-blend-difference">
          Something New <br/> Entirely
        </h1>
      </div>
    </main>
  );
}
