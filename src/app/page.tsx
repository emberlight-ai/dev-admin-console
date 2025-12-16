'use client';

import FaultyTerminal from '@/components/FaultyTerminal';
import Navbar from '@/components/Navbar';

export default function Home() {
  return (
    <main className="w-full h-screen relative bg-black text-white overflow-hidden">
      <Navbar />
      
      <div className="absolute inset-0 z-0">
        <FaultyTerminal 
          tint="#00ff00"
          gridMul={[2, 1]}
          digitSize={1.5}
          timeScale={0.3}
          flickerAmount={0.5}
          mouseStrength={0.5}
          scanlineIntensity={0.5}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center h-full pointer-events-none">
        <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-4 text-center mix-blend-difference">
          Get Dev <br/> Team
        </h1>
        <p className="text-xl md:text-2xl text-center max-w-2xl mx-auto px-4 mix-blend-difference font-mono">
          We are a team of developers who are passionate about building the next generation of software.
        </p>
      </div>
    </main>
  );
}
